// Drives the REAL PearPetal method table with the device-link path turned ON
// (DEVICE_LINK_ENABLED via the test setter), so the private base is served by
// @peerloom/device-link's personal base instead of a @peerloom/core group. Proves
// the SLICE 2b threading end-to-end at the IPC level. Cross-device pairing is
// covered by device-link's own two-peer test; here it is one device.
//
// getDeviceLink is a per-worklet singleton, so each test uses ONE engine and
// resets the singleton + flag around itself.

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
function tmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-dlm-'))
  _tmpDirs.push(dir)
  return new Corestore(dir)
}
after(() => {
  _setDeviceLinkEnabledForTest(false)
  for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }
})

function fakeSwarm () {
  const ee = new EventEmitter()
  ee.join = () => ({ flushed: async () => {} })
  ee.leave = () => {}
  ee.destroy = async () => {}
  return ee
}

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
    for (let i = 0; i < 300; i++) {
      const r = responses.find((x) => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise((res) => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call }
}

// Run one device-link-on scenario with clean singleton + flag lifecycle.
async function withDeviceLink (fn) {
  _resetForTest()
  _setDeviceLinkEnabledForTest(true)
  const d = driver()
  try {
    await d.call('init', {})
    await fn(d)
  } finally {
    await d.engine.close().catch(() => {})
    _setDeviceLinkEnabledForTest(false)
    _resetForTest()
  }
}

test('cycle:create mints a personal base; cycle:status flips to hasBase', async () => {
  await withDeviceLink(async ({ call }) => {
    const s0 = await call('cycle:status', {})
    assert.equal(s0.hasBase, false)
    const c = await call('cycle:create', {})
    assert.equal(c.created, true)
    const s1 = await call('cycle:status', {})
    assert.equal(s1.hasBase, true)
    // Idempotent.
    assert.equal((await call('cycle:create', {})).created, false)
  })
})

test('day:set -> day:get / day:getAll through the personal base + mirror', async () => {
  await withDeviceLink(async ({ call }) => {
    await call('cycle:create', {})
    await call('day:set', { date: '2026-07-10', flow: 'medium', symptoms: ['cramps'] })
    await call('day:set', { date: '2026-07-11', flow: 'light' })
    const got = await call('day:get', { date: '2026-07-10' })
    assert.equal(got.flow, 'medium')
    assert.deepEqual(got.symptoms, ['cramps'])
    const all = await call('day:getAll', {})
    assert.equal(all.length, 2)
    assert.equal(all[0].date, '2026-07-11') // newest first
    // Delete tombstones it out of reads.
    await call('day:delete', { date: '2026-07-11' })
    assert.equal(await call('day:get', { date: '2026-07-11' }), null)
    assert.equal((await call('day:getAll', {})).length, 1)
  })
})

test('period:log stamps flow across the span + records the span', async () => {
  await withDeviceLink(async ({ call }) => {
    await call('cycle:create', {})
    const r = await call('period:log', { start: '2026-07-01', end: '2026-07-03' })
    assert.equal(r.marked, 3)
    const periods = await call('period:getAll', {})
    assert.equal(periods.length, 1)
    assert.equal(periods[0].start, '2026-07-01')
    const days = await call('day:getAll', {})
    assert.equal(days.length, 3, 'three bleeding days stamped')
    assert.ok(days.every((d) => d.flow === 'medium'))
  })
})

test('cycle:prediction becomes known after logging a period', async () => {
  await withDeviceLink(async ({ call }) => {
    await call('cycle:create', {})
    const before = await call('cycle:prediction', {})
    assert.equal(before.known, false)
    await call('period:log', { start: '2026-06-05', end: '2026-06-09' })
    await call('period:log', { start: '2026-07-03', end: '2026-07-07' })
    const after = await call('cycle:prediction', {})
    assert.equal(after.known, true, 'two logged periods yield a projection')
    assert.ok(after.phase)
  })
})

test('device roster comes from device-link deviceMeta', async () => {
  await withDeviceLink(async ({ call }) => {
    await call('cycle:create', {})
    await call('device:setLabel', { label: 'My phone' })
    const devices = await call('device:getAll', {})
    const self = devices.find((d) => d.self)
    assert.ok(self, 'own device present')
    assert.equal(self.label, 'My phone')
  })
})

test('link:invite mints a scannable pearpetal:// pair URL', async () => {
  await withDeviceLink(async ({ call }) => {
    await call('cycle:create', {})
    const inv = await call('link:invite', {})
    assert.match(inv.inviteKey, /^pearpetal:\/\/pair\?/)
  })
})

test('export:data returns the days logged on the personal base', async () => {
  await withDeviceLink(async ({ call }) => {
    await call('cycle:create', {})
    await call('day:set', { date: '2026-07-10', flow: 'heavy', notes: 'hi' })
    const dump = await call('export:data', {})
    assert.equal(dump.app, 'pearpetal')
    assert.equal(dump.days.length, 1)
    assert.equal(dump.days[0].date, '2026-07-10')
    assert.equal(dump.days[0].flow, 'heavy')
  })
})

test('with the flag OFF, methods still use the core-group base (no regression)', async () => {
  _resetForTest(); _setDeviceLinkEnabledForTest(false)
  const { engine, call } = driver()
  try {
    await call('init', {})
    const c = await call('cycle:create', {})
    assert.ok(c.groupId, 'core-group path returns a groupId')
    assert.equal(c.created, true)
    await call('day:set', { date: '2026-07-10', flow: 'medium' })
    assert.equal((await call('day:get', { date: '2026-07-10' })).flow, 'medium')
  } finally {
    await engine.close().catch(() => {})
  }
})
