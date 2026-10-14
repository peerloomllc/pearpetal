// Opt-in seeder (proposals/2026-10-14-opt-in-seeder.md, src/seeders.js).
//
// Compat: the new `seeders` fields ride on rows older versions already accept, so
// an older peer's apply keeps them and its view does not differ.
// Integration (with the real seeder from ../peerloom-seeder over a local DHT
// testnet): a partner catches up on a share from the seeder alone, and the
// private log (device-link's personal base) registers with the seeder.

const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const b4a = require('b4a')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const { generateKeypair } = require('@peerloom/core/identity')
const { signValue } = require('@peerloom/core/records')
const { createGroupEngine } = require('@peerloom/core/engine')
const { rowSharedDecision, applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')
const { mintAddWriter, authorizeWriter } = require('../src/admission')
const deviceLink = require('../src/deviceLink')
const seeders = require('../src/seeders')

const SEEDER = path.join(__dirname, '..', '..', 'peerloom-seeder', 'src', 'seeder.js')
const haveSeeder = fs.existsSync(SEEDER) && fs.existsSync(path.join(__dirname, '..', '..', 'peerloom-seeder', 'node_modules', 'blind-peer'))
const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

const dirs = []
function tmpDir () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-seed-')); dirs.push(d); return d }
function cleanup () { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } }

test('an older apply accepts share:meta carrying seeders', () => {
  const kp = generateKeypair()
  const pub = b4a.toString(kp.publicKey, 'hex')
  const meta = signValue({ pubkey: pub, updatedAt: 1000, ownerPubkey: pub, scope: 'phase', createdAt: 1000, seeders: [KEY_A] }, kp.secretKey)
  assert.equal(rowSharedDecision('share:meta', meta, null, pub), 'accept')
  const later = signValue({ pubkey: pub, updatedAt: 2000, ownerPubkey: pub, scope: 'phase', createdAt: 1000 }, kp.secretKey)
  assert.equal(rowSharedDecision('share:meta', later, meta, pub), 'accept', 'turning it off is an ordinary update')
})

test('ownerPrefs.seeders survives the own-device mirror', async () => {
  const store = new Map()
  const localDb = {
    get: async (k) => (store.has(k) ? { value: store.get(k) } : null),
    put: async (k, v) => { store.set(k, v) },
    del: async (k) => { store.delete(k) },
  }
  const mirror = deviceLink.makeMirror(localDb)
  await mirror('ownerPrefs', 'ownerPrefs', { goal: 'track', seeders: [KEY_B, KEY_A], updatedAt: 5 })
  assert.deepEqual(await seeders.ownSeeders(localDb), [KEY_A, KEY_B])
})

test('cleanKeys keeps 64-hex keys only, once each, sorted', () => {
  assert.deepEqual(seeders.cleanKeys([KEY_B, 'nope', KEY_A, KEY_B, 7]), [KEY_A, KEY_B])
  assert.deepEqual(seeders.cleanKeys(null), [])
})

// The shipped worklet wiring, minus the relay swarm (the testnet supplies one).
function makeEngine (dir, mkSwarm) {
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

async function waitFor (label, fn, ms = 40000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try { if (await fn()) return } catch {}
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('timed out waiting for: ' + label)
}

test('a partner catches up on a share from the seeder alone', { skip: !haveSeeder && 'no ../peerloom-seeder install here' }, async (t) => {
  deviceLink._setDeviceLinkEnabledForTest(false)
  const { createSeeder } = require(SEEDER)
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  const open = []
  t.after(async () => {
    for (const e of open.reverse()) { try { await seeders.getSeeding(e).close() } catch {} try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
    deviceLink._setDeviceLinkEnabledForTest(true)
  })

  const ownerDir = tmpDir()
  const viewerDir = tmpDir()
  const O = makeEngine(ownerDir, mkSwarm)
  open.push(O.engine)
  let V = makeEngine(viewerDir, mkSwarm)
  open.push(V.engine)
  await O.call('init', {})
  await O.call('cycle:create', {})
  const iso = (d) => d.toISOString().slice(0, 10)
  await O.call('period:log', { start: iso(new Date(Date.now() - 6 * 86400000)) })
  const share = await O.call('share:create', { scope: 'full' })
  await V.call('init', {})
  seeders.getSeeding(V.engine).start()
  await V.call('partner:join', { inviteKey: share.inviteKey })
  const groupId = (await V.call('partner:list'))[0].groupId
  await waitFor('the viewer sees the phase', async () => !!(await V.call('partner:view', { groupId })).phase)

  // Pairing sends no app label; the share does not use the seeder until asked.
  const { seederKey } = await O.call('seeder:pair', { link: seeder.openPairing().link })
  assert.equal(seederKey, b4a.toString(seeder.seederKey, 'hex'))
  assert.deepEqual((await seeder.devices()).map((d) => d.app || null), [null], 'no app label at pairing')
  assert.equal((await O.call('share:list'))[0].seeder, false, 'off by default')
  const listed = await O.call('seeder:list')
  assert.equal(listed.length, 1)
  assert.equal(listed[0].paired, true)

  await O.call('seeder:share:set', { groupId, on: true })
  const shareKey = b4a.toString(O.engine.bases.get(groupId).key, 'hex')
  await waitFor('the seeder allows the share', () => seeder.allowedSpaces().includes(shareKey))
  await waitFor('the viewer reads the seeder from share:meta', async () => {
    const meta = (await V.engine.bases.get(groupId).view.get('share:meta'))?.value
    return Array.isArray(meta?.seeders) && meta.seeders.includes(seederKey)
  })

  // The viewer goes away; the owner logs a day; the seeder takes it; the owner
  // goes away; the viewer comes back and catches up from the seeder alone.
  await seeders.getSeeding(V.engine).close()
  await V.engine.close()
  open.splice(open.indexOf(V.engine), 1)
  const day = iso(new Date(Date.now() - 1 * 86400000))
  await O.call('day:set', { date: day, flow: 'heavy', symptoms: ['cramps'] })
  const ob = O.engine.bases.get(groupId)
  await waitFor('the seeder holds the new projection', async () => {
    await ob.update()
    const core = seeder.peer.store.get({ key: ob.local.key })
    await core.ready()
    const ok = core.contiguousLength >= ob.local.length
    await core.close()
    return ok
  })
  await seeders.getSeeding(O.engine).close()
  await O.engine.close()
  open.splice(open.indexOf(O.engine), 1)

  V = makeEngine(viewerDir, mkSwarm)
  open.push(V.engine)
  await V.call('init', {})
  seeders.getSeeding(V.engine).start()
  await waitFor('the viewer gets the day from the seeder alone', async () => {
    const v = await V.call('partner:view', { groupId })
    return (v.summary || []).some((r) => r.date === day)
  }, 60000)
})

test('the private log registers with the seeder, and Stop using takes it off', { skip: !haveSeeder && 'no ../peerloom-seeder install here' }, async (t) => {
  deviceLink._setDeviceLinkEnabledForTest(true)
  deviceLink._resetForTest()
  const { createSeeder } = require(SEEDER)
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  const O = makeEngine(tmpDir(), mkSwarm)
  t.after(async () => {
    try { await seeders.getSeeding(O.engine).close() } catch {}
    try { await O.engine.close() } catch {}
    try { await seeder.close() } catch {}
    await testnet.destroy()
    deviceLink._resetForTest()
    cleanup()
  })
  await O.call('init', {})
  await O.call('cycle:create', {})
  const dl = await deviceLink.getDeviceLink(O.engine)
  await waitFor('the personal base is open', () => !!dl.personalBase)
  const personal = b4a.toString(dl.personalBase.key, 'hex')

  const { seederKey } = await O.call('seeder:pair', { link: seeder.openPairing().link })
  await waitFor('the seeder allows the private log', () => seeder.allowedSpaces().includes(personal))
  assert.deepEqual((await O.call('seeder:list')).map((s) => [s.seederKey, s.inUse]), [[seederKey, true]])
  assert.deepEqual((await O.call('prefs:get')).goal, 'track', 'settings still read the same')

  // A settings change keeps the seeder list.
  await O.call('prefs:set', { avgCycleLength: 30 })
  assert.deepEqual(await seeders.ownSeeders(O.engine.localDb), [seederKey])

  const r = await O.call('seeder:stop', { seederKey })
  assert.equal(r.stopped, true)
  assert.equal(r.dropping, 1)
  assert.deepEqual(await O.call('seeder:list'), [])
  await waitFor('the seeder schedules the drop, 7 days out', async () => {
    const due = (await seeder.drops()).find((x) => x.space === personal)?.due
    return due && due > Date.now() + 6 * 86400000
  }, 20000)
})
