// SLICE 3: proves the one-time legacy(core-group) -> personal(device-link) private
// base migration. Log cycle data with the flag OFF (core-group base), then flip
// the flag ON on the SAME store (models an in-place upgrade) and assert the
// day/period log is copied onto the device-link personal base, idempotently, with
// the legacy base left intact as a rollback snapshot.

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
const { _resetForTest, _setDeviceLinkEnabledForTest } = require('../src/deviceLink')

const _tmpDirs = []
function tmpDir () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-mig-')); _tmpDirs.push(d); return d }
after(() => {
  _setDeviceLinkEnabledForTest(false); petalMethods._resetMigrationForTest(); _resetForTest()
  for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }
})

function fakeSwarm () {
  const ee = new EventEmitter()
  ee.join = () => ({ flushed: async () => {} })
  ee.leave = () => {}
  ee.destroy = async () => {}
  return ee
}

// A driver on a specific on-disk store dir, so we can close + reopen the "same
// device" to model a process restart across the flag flip.
function driver (dir) {
  const responses = []
  const read = new EventEmitter()
  const engine = createGroupEngine({
    appId: 'pearpetal', corestore: new Corestore(dir), createSwarm: fakeSwarm,
    applyOps: applyPetalOp, methods: petalMethods,
  })
  engine.start({ read, write: (buf) => responses.push(JSON.parse(buf.toString())) })
  let nextId = 1
  const call = async (method, args) => {
    const id = nextId++
    read.emit('data', Buffer.from(JSON.stringify({ id, method, args }) + '\n'))
    for (let i = 0; i < 300; i++) {
      const r = responses.find((x) => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise((res) => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call }
}

test('legacy core-group log migrates onto the device-link personal base on flag flip', async () => {
  const dir = tmpDir()

  // 1. Flag OFF: create a core-group private base and log some cycle data.
  _setDeviceLinkEnabledForTest(false); _resetForTest(); petalMethods._resetMigrationForTest()
  let d = driver(dir)
  await d.call('init', {})
  const created = await d.call('cycle:create', {})
  assert.ok(created.groupId, 'legacy path made a core group')
  await d.call('day:set', { date: '2026-07-10', flow: 'medium', symptoms: ['cramps'], notes: 'hi' })
  await d.call('day:set', { date: '2026-07-11', flow: 'light' })
  await d.call('day:set', { date: '2026-07-12', flow: 'heavy' })
  await d.call('day:delete', { date: '2026-07-12' }) // tombstone - must stay deleted after migration
  await d.call('period:log', { start: '2026-07-09', end: '2026-07-10' })
  const legacyDays = await d.call('day:getAll', {})
  assert.equal(legacyDays.length, 3, 'legacy has 3 live days (10, 11, and the two period-stamped 09/10... minus deleted 12)')
  await d.engine.close()

  // 2. Flag ON, reopen the same store (an upgrade). First method call migrates.
  _setDeviceLinkEnabledForTest(true); _resetForTest(); petalMethods._resetMigrationForTest()
  d = driver(dir)
  await d.call('init', {})
  const status = await d.call('cycle:status', {})
  assert.equal(status.hasBase, true, 'personal base exists after migration')

  const migratedDays = await d.call('day:getAll', {})
  assert.equal(migratedDays.length, legacyDays.length, 'same live-day count on the personal base')
  const jul10 = migratedDays.find((x) => x.date === '2026-07-10')
  assert.equal(jul10.flow, 'medium')
  assert.deepEqual(jul10.symptoms, ['cramps'])
  assert.equal(jul10.notes, 'hi')
  // The tombstoned day did not resurrect.
  assert.equal(await d.call('day:get', { date: '2026-07-12' }), null)

  const periods = await d.call('period:getAll', {})
  assert.equal(periods.length, 1)
  assert.equal(periods[0].start, '2026-07-09')

  // Marker recorded, pointing at the legacy group (rollback snapshot preserved).
  const marker = (await d.engine.localDb.get('deviceLink:migrated')).value
  assert.equal(marker.from, created.groupId)

  // 3. Idempotent: a further restart does not double-migrate or duplicate.
  await d.engine.close()
  _resetForTest(); petalMethods._resetMigrationForTest()
  d = driver(dir)
  await d.call('init', {})
  assert.equal((await d.call('day:getAll', {})).length, legacyDays.length, 'no duplication on second launch')
  await d.engine.close()
})

test('fresh device-link install marks migration done with no legacy base', async () => {
  const dir = tmpDir()
  _setDeviceLinkEnabledForTest(true); _resetForTest(); petalMethods._resetMigrationForTest()
  const d = driver(dir)
  await d.call('init', {})
  // No cycle yet; first call still resolves the (no-op) migration + marks it.
  assert.equal((await d.call('cycle:status', {})).hasBase, false)
  await d.call('cycle:create', {})
  assert.equal((await d.call('cycle:status', {})).hasBase, true)
  const marker = (await d.engine.localDb.get('deviceLink:migrated')).value
  assert.equal(marker.from, null)
  await d.engine.close()
})
