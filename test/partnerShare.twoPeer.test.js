// Two real peers on a local DHT testnet, driving PearPetal's own method table.
// Guards the 2026-09-09 partner-viewer bug: opening the shared cycle screen used
// to make the viewer write to the shared base about eight times a second for as
// long as the screen was open, which pushed its own input core past the retention
// threshold and got its own blocks pruned, after which the app never opened
// again. See DECISIONS.md.

const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')
const { mintAddWriter, authorizeWriter } = require('../src/admission')
const { _setDeviceLinkEnabledForTest } = require('../src/deviceLink')

const _tmpDirs = []
function tmpDir () {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-2p-'))
  _tmpDirs.push(d)
  return d
}
function cleanup () { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } }

// The shipped worklet wiring, minus the relay swarm (the testnet supplies one).
function makeEngine (dir, mkSwarm, onEvent) {
  const engine = createGroupEngine({
    appId: 'pearpetal',
    corestore: new Corestore(dir),
    createSwarm: mkSwarm,
    applyOps: applyPetalOp,
    methods: petalMethods,
    mintAddWriter,
    authorizeWriter,
    retentionKeepRecent: 512,
  })
  const read = new PassThrough()
  const pending = new Map()
  let id = 1
  engine.start({
    read,
    write: (buf) => {
      for (const line of String(buf).split('\n')) {
        if (!line.trim()) continue
        let m
        try { m = JSON.parse(line) } catch { continue }
        if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m) }
        else if (m.event && onEvent) onEvent(m.event, m.data)
      }
    },
  })
  const call = (method, args = {}) => new Promise((resolve, reject) => {
    const i = id++
    pending.set(i, (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)))
    read.write(JSON.stringify({ id: i, method, args }) + '\n')
  })
  return { engine, call }
}

async function waitFor (label, fn, ms = 30000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try { if (await fn()) return } catch {}
    await new Promise((r) => setTimeout(r, 120))
  }
  throw new Error('timed out waiting for: ' + label)
}

// The viewer's OWN input core on a shared base: the one nobody else can serve back.
function ownCoreLength (engine, groupId) {
  const base = engine.bases.get(groupId)
  if (!base) return null
  const selfHex = base.local.key.toString('hex')
  for (const w of base.activeWriters) {
    if (w?.core?.key && w.core.key.toString('hex') === selfHex) return w.length
  }
  return null
}

async function pairOwnerAndViewer (t) {
  _setDeviceLinkEnabledForTest(false)
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const ownerDir = tmpDir()
  const viewerDir = tmpDir()
  const O = makeEngine(ownerDir, mkSwarm)
  let updated = () => {}
  const V = makeEngine(viewerDir, mkSwarm, (event, data) => { if (event === 'group:updated') updated(data) })
  t.after(async () => {
    try { await O.engine.close() } catch {}
    try { await V.engine.close() } catch {}
    try { await testnet.destroy() } catch {}
    cleanup()
  })

  await O.call('init', {})
  await O.call('cycle:create', {})
  const iso = (d) => d.toISOString().slice(0, 10)
  await O.call('period:log', { start: iso(new Date(Date.now() - 6 * 86400000)) })
  const share = await O.call('share:create', { scope: 'full' })

  await V.call('init', {})
  await V.call('partner:join', { inviteKey: share.inviteKey })
  await Promise.all([O.engine.swarm.flush(), V.engine.swarm.flush()])
  const groupId = (await V.call('partner:list'))[0].groupId
  await waitFor('the viewer sees the phase', async () => !!(await V.call('partner:view', { groupId })).phase)
  await waitFor('the viewer becomes a writer', () => V.engine.bases.get(groupId)?.writable === true)
  return { O, V, groupId, viewerDir, mkSwarm, setUpdated: (fn) => { updated = fn } }
}

// The written note is a SECOND consent on top of the full scope: full alone sends
// the redacted day summary and never the note. See
// proposals/2026-09-10-notes-on-a-full-share.md.
test('a note reaches a full-share partner only while the notes switch is on', async (t) => {
  const { O, V, groupId } = await pairOwnerAndViewer(t)
  const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
  await O.call('day:set', { date: day, flow: 'light', symptoms: ['cramps'], notes: 'rough one, told work' })

  // Full scope, switch off (the default): the day is there, the note is not.
  await waitFor('the viewer sees the day', async () => {
    const v = await V.call('partner:view', { groupId })
    return (v.summary || []).some((r) => r.date === day)
  })
  const off = await V.call('partner:view', { groupId })
  assert.equal(off.scope, 'full')
  assert.equal(off.notes, false, 'the viewer is told notes are not being shared')
  assert.equal((off.summary.find((r) => r.date === day) || {}).note, undefined, 'no note on a full share by itself')

  // Switch ON. The window is re-projected, so a day written BEFORE the switch
  // carries its note - that is the answered open question in the proposal.
  await O.call('share:setNotes', { groupId, notes: true })
  await waitFor('the note lands', async () => {
    const v = await V.call('partner:view', { groupId })
    return (v.summary.find((r) => r.date === day) || {}).note === 'rough one, told work'
  })
  assert.equal((await V.call('partner:view', { groupId })).notes, true)

  // Switch OFF. The same window is rewritten without the note, so a viewer who
  // syncs after the change no longer has it.
  await O.call('share:setNotes', { groupId, notes: false })
  await waitFor('the note goes', async () => {
    const v = await V.call('partner:view', { groupId })
    return (v.summary.find((r) => r.date === day) || {}).note === undefined
  })
  const back = await V.call('partner:view', { groupId })
  assert.equal(back.notes, false)
  assert.ok(back.summary.find((r) => r.date === day), 'the day itself is still shared')
  assert.deepEqual((back.summary.find((r) => r.date === day) || {}).symptomTags, ['cramps'], 'and so are its tags')
})

// Removing a day has to remove it from the person you share with too. Nothing did
// that before: the projection only ever wrote the days that still existed, so a
// deleted day's summary row stayed on the shared base for good - and with notes
// able to ride on that row, "remove this day" was leaving the note on their phone.
test('a day the owner removes leaves the partner screen too', async (t) => {
  const { O, V, groupId } = await pairOwnerAndViewer(t)
  const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
  await O.call('share:setNotes', { groupId, notes: true })
  await O.call('day:set', { date: day, flow: 'medium', symptoms: ['cramps'], notes: 'said too much' })
  await waitFor('the note lands', async () => {
    const v = await V.call('partner:view', { groupId })
    return (v.summary.find((r) => r.date === day) || {}).note === 'said too much'
  })

  await O.call('day:delete', { date: day })
  await waitFor('the day goes', async () => {
    const v = await V.call('partner:view', { groupId })
    return !v.summary.find((r) => r.date === day)
  })

  // And it can come back: the row is blanked, not tombstoned, so the same date
  // logged again reaches them like any other day.
  await O.call('day:set', { date: day, flow: 'light' })
  await waitFor('the day comes back', async () => {
    const v = await V.call('partner:view', { groupId })
    const r = v.summary.find((x) => x.date === day)
    return !!r && r.flow === true
  })
  assert.equal((await V.call('partner:view', { groupId })).summary.find((r) => r.date === day).note, undefined, 'and it comes back without the note that was removed')
})

test('the partner screen does not write to the shared base while it sits there', async (t) => {
  const { V, groupId, setUpdated } = await pairOwnerAndViewer(t)

  // Settle: the join itself legitimately publishes one member row.
  await V.call('partner:view', { groupId })
  await new Promise((r) => setTimeout(r, 500))
  const before = ownCoreLength(V.engine, groupId)
  assert.ok(before > 0, 'the join published a member row')

  // Now be the partner screen: reload partner:view on every group:updated, which
  // is exactly what App.jsx PartnerView does, and touch nothing else.
  let reloads = 0
  setUpdated((d) => { if (d?.groupId === groupId) { reloads++; V.call('partner:view', { groupId }).catch(() => {}) } })
  V.call('partner:view', { groupId }).catch(() => {})
  await new Promise((r) => setTimeout(r, 6000))
  setUpdated(() => {})
  await new Promise((r) => setTimeout(r, 500))

  const after = ownCoreLength(V.engine, groupId)
  // Before the fix this ran at roughly eight appends a second: ~48 in this window,
  // and 888 in the 45 seconds it took the reporter to look at his partner's cycle.
  assert.equal(after, before, `the idle partner screen appended ${after - before} rows (${reloads} reloads)`)
})

test('a member row IS still published when the name actually changes', async (t) => {
  const { V, groupId } = await pairOwnerAndViewer(t)
  const before = ownCoreLength(V.engine, groupId)
  // profile:set pushes the new name onto every share this device has joined.
  await V.call('profile:set', { displayName: 'Sam' })
  const afterChange = ownCoreLength(V.engine, groupId)
  assert.ok(afterChange > before, 'the new name was written to the shared base')
  // Republishing the same name writes nothing, which is what closes the loop.
  assert.deepEqual(await V.call('member:publish', {}), { published: 0 }, 'an unchanged name publishes nothing')
  assert.equal(ownCoreLength(V.engine, groupId), afterChange)
  // A second real change is still written.
  await V.call('profile:set', { displayName: 'Sam B' })
  assert.ok(ownCoreLength(V.engine, groupId) > afterChange, 'a further change is still written')
})

test('partner:repair rebuilds a shared cycle whose local copy will not open', async (t) => {
  const { O, V, groupId, viewerDir, mkSwarm } = await pairOwnerAndViewer(t)
  await waitFor('the viewer has the summary', async () => {
    const v = await V.call('partner:view', { groupId })
    return !!v.phase
  })

  // Damage it the way the old retention sweep did: the viewer's own blocks, gone.
  const base = V.engine.bases.get(groupId)
  await base.local.clear(0, base.local.length)

  const repaired = await V.call('partner:repair', { groupId })
  assert.equal(repaired.groupId, groupId)
  assert.equal(repaired.attempt, 1)
  await Promise.all([O.engine.swarm.flush(), V.engine.swarm.flush()])
  await waitFor('the rebuilt shared cycle fills back in', async () => {
    const v = await V.call('partner:view', { groupId }).catch(() => null)
    return !!(v && v.phase)
  }, 45000)

  // And it opens on its own afterwards, which is what was broken.
  await V.engine.close()
  const V2 = makeEngine(viewerDir, mkSwarm)
  const outcome = await Promise.race([
    V2.call('init', {}).then(() => 'ok'),
    new Promise((r) => setTimeout(() => r('HUNG'), 25000)),
  ])
  assert.equal(outcome, 'ok', 'the repaired store opens with the owner offline')
  assert.equal(V2.engine.unmounted.size, 0)
  const list = await V2.call('partner:list', {})
  assert.equal(list[0].available, true)
  await V2.engine.close()
})

test('reading a partner cycle does not wait on their phone being around', async (t) => {
  const { O, V, groupId } = await pairOwnerAndViewer(t)
  await waitFor('the viewer has the projection', async () => !!(await V.call('partner:view', { groupId })).phase)

  // Her phone goes away. His app must still show the last cycle it received,
  // promptly - that is the ordinary state of a two-phone app, not a failure.
  await O.engine.close()
  const started = Date.now()
  const view = await V.call('partner:view', { groupId })
  const took = Date.now() - started
  assert.ok(view && view.phase, 'the last known cycle is still shown')
  assert.ok(took < 8000, 'answered in ' + took + 'ms, without waiting on the other phone')

  const list = await V.call('partner:list', {})
  assert.equal(list[0].available, true)
})
