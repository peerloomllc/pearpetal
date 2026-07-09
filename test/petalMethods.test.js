// Drive the real engine IPC loop on one peer (init, then the device-local
// methods) and assert the worklet behaviour. Cross-peer replication is covered
// in @peerloom/core's two-peer test; here we only need the local method table.

const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')
const { addDays, todayIso } = require('../src/prediction')

const _tmpDirs = []
function tmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-'))
  _tmpDirs.push(dir)
  return new Corestore(dir)
}
after(() => { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } })

function fakeSwarm () {
  const ee = new EventEmitter()
  ee.left = []
  ee.join = () => ({ flushed: async () => {} })
  ee.leave = (topic) => { ee.left.push(topic) }
  ee.destroy = async () => {}
  return ee
}

// A driver around the engine's IPC loop: feed a method call, await its reply.
function driver () {
  const responses = []
  const read = new EventEmitter()
  const engine = createGroupEngine({
    appId: 'pearpetal', corestore: tmpStore(), createSwarm: fakeSwarm,
    applyOps: applyPetalOp, methods: petalMethods,
  })
  engine.start({ read, write: (buf) => responses.push(JSON.parse(buf.toString())) })
  let nextId = 1
  const call = async (method, args) => {
    const id = nextId++
    read.emit('data', Buffer.from(JSON.stringify({ id, method, args }) + '\n'))
    for (let i = 0; i < 200; i++) {
      const r = responses.find(x => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise(res => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call }
}

test('donation reminder: fresh is not due, dismiss marks it shown', async () => {
  const { engine, call } = driver()
  await call('init', {})
  const s1 = await call('donation:status', {})
  assert.equal(s1.due, false) // first use just now, 14 days not elapsed
  assert.equal(s1.shown, false)
  assert.equal(typeof s1.firstUseAt, 'number')
  await call('donation:dismiss', {})
  const s2 = await call('donation:status', {})
  assert.equal(s2.shown, true)
  assert.equal(s2.due, false)
  await engine.close()
})

test('donation reminder: due once 14 days have elapsed, then dismiss stops it', async () => {
  const { engine, call } = driver()
  await call('init', {})
  // Seed a first-use 15 days ago (the nudge triggers at 14). Seeding the localDb
  // row directly stands in for "the app has been in use for two weeks".
  const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000
  await engine.localDb.put('donateReminder', { firstUseAt: fifteenDaysAgo, shown: false })

  const due = await call('donation:status', {})
  assert.equal(due.due, true) // 14 days elapsed and not yet shown -> due
  assert.equal(due.shown, false)
  assert.equal(due.firstUseAt, fifteenDaysAgo) // existing first-use is preserved, not reset

  // The UI marks it shown the moment it surfaces, so it never nags twice.
  await call('donation:dismiss', {})
  const after = await call('donation:status', {})
  assert.equal(after.shown, true)
  assert.equal(after.due, false)
  await engine.close()
})

// A 1x1 transparent PNG / GIF as base64 data URLs (enough to exercise the blob path).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

test('profile: set + get round-trips name and a blob-stored avatar', async () => {
  const { engine, call } = driver()
  await call('init', {})
  const set = await call('profile:set', { displayName: '  Ada  ', avatar: PNG })
  assert.equal(set.displayName, 'Ada') // trimmed
  assert.ok(set.avatar && set.avatar.startsWith('data:image/'))
  const got = await call('profile:get', {})
  assert.equal(got.displayName, 'Ada')
  assert.ok(got.avatar && got.avatar.startsWith('data:image/')) // resolved back from the blob store
  await engine.close()
})

test('profile: a GIF avatar keeps its type (animated avatars survive)', async () => {
  const { engine, call } = driver()
  await call('init', {})
  const set = await call('profile:set', { displayName: 'Bea', avatar: GIF })
  assert.ok(set.avatar.startsWith('data:image/gif'))
  // name-only edit preserves the avatar (no re-append needed)
  const after = await call('profile:set', { displayName: 'Bea B' })
  assert.ok(after.avatar && after.avatar.startsWith('data:image/gif'))
  await engine.close()
})

test('profile: name + avatar are projected into the share:meta claim', async () => {
  const { engine, call } = driver()
  await call('init', {})
  await call('cycle:create', {})
  await call('profile:set', { displayName: 'Ada', avatar: PNG })
  const { groupId } = await call('share:create', { scope: 'phase' })
  const base = engine.bases.get(groupId)
  await base.update()
  const meta = (await base.view.get('share:meta'))?.value
  assert.equal(meta.displayName, 'Ada')
  assert.ok(meta.avatarBlob && meta.avatarBlob.key && meta.avatarBlob.id) // id is a hyperblobs id object
  assert.equal(typeof meta.avatarHash, 'string')
  assert.equal(meta.avatarType, 'image/png')
  assert.ok(meta.ownerPubkey) // owner recorded -> owner-write-only still holds
  await engine.close()
})

test('profile: clearing the avatar removes the pointer', async () => {
  const { engine, call } = driver()
  await call('init', {})
  await call('profile:set', { displayName: 'Ada', avatar: PNG })
  const cleared = await call('profile:set', { displayName: 'Ada', avatar: null })
  assert.equal(cleared.avatar, undefined)
  await engine.close()
})

test('profile: an oversized avatar is rejected', async () => {
  const { engine, call } = driver()
  await call('init', {})
  const big = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024) // ~2.25MB decoded, over the 2MB cap
  await assert.rejects(() => call('profile:set', { displayName: 'Ada', avatar: big }))
  await engine.close()
})

// period:log records the span AND stamps bleeding flow across it, so the calendar
// and dial (which key off logged flow) actually reflect an added period.
test('period:log stamps bleeding flow across the span and records the span', async () => {
  const { engine, call } = driver()
  await call('init', {})
  await call('cycle:create', {})
  const start = addDays(todayIso(), -30)
  const end = addDays(todayIso(), -26) // a 5-day period, fully in the past
  const r = await call('period:log', { start, end })
  assert.equal(r.marked, 5)
  const byDate = Object.fromEntries((await call('day:getAll', {})).map(d => [d.date, d]))
  for (let i = 0; i < 5; i++) assert.equal(byDate[addDays(start, i)]?.flow, 'medium', 'day ' + i + ' should be logged as flow')
  const periods = await call('period:getAll', {})
  assert.ok(periods.find(p => p.start === start && p.end === end), 'explicit span row recorded')
  // and the logged bleeding anchors the cycle -> prediction now knows the cycle
  assert.equal((await call('cycle:prediction', {})).known, true)
  await engine.close()
})

test('period:log preserves a day that already has a chosen flow', async () => {
  const { engine, call } = driver()
  await call('init', {})
  await call('cycle:create', {})
  const start = addDays(todayIso(), -20)
  const heavyDay = addDays(start, 1)
  await call('day:set', { date: heavyDay, flow: 'heavy' }) // user already picked an intensity
  const r = await call('period:log', { start, end: addDays(start, 4) })
  assert.equal(r.marked, 4) // 5-day span minus the pre-set heavy day
  const byDate = Object.fromEntries((await call('day:getAll', {})).map(d => [d.date, d]))
  assert.equal(byDate[heavyDay].flow, 'heavy') // not clobbered
  assert.equal(byDate[start].flow, 'medium')
  await engine.close()
})

test('share:list includes an empty joiners list until someone joins', async () => {
  const { engine, call } = driver()
  await call('init', {})
  await call('cycle:create', {})
  const { groupId } = await call('share:create', { scope: 'phase' })
  const row = (await call('share:list', {})).find((s) => s.groupId === groupId)
  assert.ok(row)
  assert.deepEqual(row.joiners, [])
  await engine.close()
})

test('share:revoke is idempotent: revoking an already-gone share is ok, not an error', async () => {
  const { engine, call } = driver()
  await call('init', {})
  await call('cycle:create', {})
  const { groupId } = await call('share:create', { scope: 'phase' })
  assert.equal((await call('share:revoke', { groupId })).ok, true)
  // A second revoke (double-fire / reload race) must not throw "share not found".
  const again = await call('share:revoke', { groupId })
  assert.equal(again.ok, true)
  assert.equal(again.already, true)
  await engine.close()
})

test('member:publish is a no-op when this device has joined no shares', async () => {
  const { engine, call } = driver()
  await call('init', {})
  const r = await call('member:publish', {})
  assert.equal(r.published, 0)
  await engine.close()
})

test('period:log with no end marks through today (ongoing period)', async () => {
  const { engine, call } = driver()
  await call('init', {})
  await call('cycle:create', {})
  const start = addDays(todayIso(), -2)
  const r = await call('period:log', { start })
  assert.equal(r.marked, 3) // start, start+1, today
  const byDate = Object.fromEntries((await call('day:getAll', {})).map(d => [d.date, d]))
  assert.equal(byDate[todayIso()]?.flow, 'medium')
  const span = (await call('period:getAll', {})).find(p => p.start === start)
  assert.equal(span.end, null) // ongoing
  await engine.close()
})
