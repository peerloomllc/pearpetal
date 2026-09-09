// Erasing everything has to actually erase everything.
//
// There is no account and no server behind this app, so an erase that leaves
// something behind is not a tidy-up problem, it is the cycle log of somebody who
// asked for it to be gone. The device-local database is cleared by WALKING it
// rather than from a list of keys we remember writing, because a hand-maintained
// list is exactly how a forgotten key survives - and on this app the survivor
// could be the prefs, the profile or the recovery mnemonic.

const test = require('node:test')
const { before } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')
const { _setDeviceLinkEnabledForTest } = require('../src/deviceLink')

before(() => _setDeviceLinkEnabledForTest(false))

const _tmpDirs = []
function driver (dir) {
  const responses = []
  const read = new EventEmitter()
  const d = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-er-'))
  if (!dir) _tmpDirs.push(d)
  const engine = createGroupEngine({
    appId: 'pearpetal',
    corestore: new Corestore(d),
    createSwarm: () => {
      const ee = new EventEmitter()
      ee.join = () => ({ flushed: async () => {} }); ee.leave = () => {}; ee.destroy = async () => {}
      return ee
    },
    applyOps: applyPetalOp,
    methods: petalMethods,
  })
  engine.start({ read, write: (buf) => responses.push(JSON.parse(buf.toString())) })
  let nextId = 1
  const call = async (method, args) => {
    const id = nextId++
    read.emit('data', Buffer.from(JSON.stringify({ id, method, args }) + '\n'))
    for (let i = 0; i < 400; i++) {
      const r = responses.find((x) => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise((res) => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call, dir: d }
}
function cleanup () { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } }

async function seedEverything (call) {
  await call('init', {})
  await call('cycle:create', {})
  await call('day:set', { date: '2026-08-01', flow: 'medium', symptoms: ['cramps'], notes: 'private', bbt: 36.4 })
  await call('period:log', { start: '2026-08-01', end: '2026-08-05', today: '2026-09-01' })
  await call('prefs:set', { avgCycleLength: 30, goal: 'conceive', conditions: ['pcos'] })
  await call('profile:set', { displayName: 'Ada' })
  await call('share:create', { scope: 'full' })
  await call('shell:notifications:set', {}).catch(() => {}) // may not exist worklet-side; ignore
}

test('an erase leaves nothing in the device-local database', async (t) => {
  const A = driver()
  t.after(() => cleanup())
  await seedEverything(A.call)

  const before = []
  for await (const { key } of A.engine.localDb.createReadStream()) before.push(key)
  assert.ok(before.length > 0, 'there is something to erase')
  assert.ok(before.some((k) => k.startsWith('groups:joined:')), 'including a group membership')
  assert.ok(before.includes('identity'), 'and this device its own identity')

  const r = await A.call('data:erase', {})
  assert.equal(r.ok, true)
  assert.ok(r.groups >= 1, 'the groups were destroyed, not just forgotten')

  // Re-open the SAME store from scratch and read it raw: the engine that did the
  // erasing has closed itself, and what matters is what the next launch finds.
  const store = new Corestore(A.dir)
  await store.ready()
  const Hyperbee = require('hyperbee')
  const db = new Hyperbee(store.get({ name: 'local' }), { keyEncoding: 'utf-8', valueEncoding: 'json' })
  await db.ready()
  const after = []
  for await (const { key } of db.createReadStream()) after.push(key)
  await store.close()
  assert.deepEqual(after, [], 'nothing survived: no identity, no memberships, no prefs, no profile')
})

test('the phone comes back as a fresh install, not a broken one', async (t) => {
  const A = driver()
  t.after(() => cleanup())
  await seedEverything(A.call)
  await A.call('data:erase', {})

  // What the next launch does. A new engine over the same directory.
  const B = driver(A.dir)
  await B.call('init', {})
  const status = await B.call('cycle:status', {})
  assert.equal(status.hasBase, false, 'no cycle')
  assert.equal(status.partners, 0, 'no partners')
  assert.deepEqual(await B.call('day:getAll', {}).catch(() => []), [], 'no days')
  assert.deepEqual(await B.call('period:getAll', {}).catch(() => []), [], 'no periods')
  assert.equal((await B.call('profile:get', {})).displayName, '', 'no name')
  const prefs = await B.call('prefs:get', {})
  assert.equal(prefs.goal, 'track', 'prefs back to defaults, not the conceive goal that was set')
  assert.deepEqual(prefs.conditions, [], 'and no tracked conditions')
  // A fresh install can still start tracking, which is what "not broken" means.
  await B.call('cycle:create', {})
  assert.equal((await B.call('cycle:status', {})).hasBase, true)
  await B.engine.close()
})

test('the identity is replaced, so the phone is not recognisable as the old one', async (t) => {
  const A = driver()
  t.after(() => cleanup())
  await A.call('init', {})
  await A.call('cycle:create', {})
  const wasA = (await A.call('cycle:status', {})).pubkey
  await A.call('data:erase', {})

  const B = driver(A.dir)
  await B.call('init', {})
  const wasB = (await B.call('cycle:status', {})).pubkey
  assert.notEqual(wasB, wasA, 'a new signing identity, so old rows cannot be attributed to this device')
  await B.engine.close()
})
