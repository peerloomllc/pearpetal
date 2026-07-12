// Proves the device-link-backed private store (src/privateStore.js) supports the
// exact operations petalMethods performs on the private base, so SLICE 2b can
// thread the method table through it. Single-peer semantics only; cross-device
// pairing/replication is covered by @peerloom/device-link's own two-peer test.

const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const { generateKeypair } = require('@peerloom/core/identity')
const { DAY_RANGE, PERIOD_RANGE, dayKey, periodKey } = require('../src/petalWire')
const ps = require('../src/privateStore')
const { _resetForTest } = require('../src/deviceLink')

const _tmpDirs = []
function tmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-ps-'))
  _tmpDirs.push(dir)
  return new Corestore(dir)
}
after(() => { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } })

function fakeSwarm () {
  const ee = new EventEmitter()
  ee.join = () => ({ flushed: async () => {} })
  ee.leave = () => {}
  ee.destroy = async () => {}
  return ee
}

async function mkCtx () {
  const store = tmpStore(); await store.ready()
  const localCore = store.get({ name: 'local' }); await localCore.ready()
  const localDb = new Hyperbee(localCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  await localDb.ready()
  return { store, swarm: fakeSwarm(), localDb, emit: () => {}, identity: generateKeypair() }
}

async function collect (stream) {
  const out = []
  for await (const { value } of stream) out.push(value)
  return out
}

test('typeForKey + parsePairUrl are pure and correct', () => {
  assert.equal(ps.typeForKey('day:20260712'), 'day')
  assert.equal(ps.typeForKey('period:20260712'), 'period')
  assert.equal(ps.typeForKey('device:abc'), null)
  const link = ps.parsePairUrl('pearpetal://pair?topic=aa&handshake=bb&identity=cc&expires=1699999999999')
  assert.deepEqual(link, { topic: 'aa', handshake: 'bb', identity: 'cc', expiresMs: 1699999999999 })
})

test('exists flips false -> true across enable()', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  assert.equal(await ps.exists(ctx), false, 'no personal base yet')
  const r = await ps.enable(ctx)
  assert.equal(r.enabled, true)
  assert.equal(await ps.exists(ctx), true, 'personal base exists after enable')
  await ctx.store.close(); _resetForTest()
})

test('day rows: put -> update -> readRow + range scan; tombstone hides from reads', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  await ps.enable(ctx)

  await ps.put(ctx, dayKey('20260712'), { date: '2026-07-12', flow: 'medium', createdBy: 'x', deleted: false })
  await ps.put(ctx, dayKey('20260713'), { date: '2026-07-13', flow: 'light', createdBy: 'x', deleted: false })
  await ps.update(ctx)

  const row = await ps.readRow(ctx, dayKey('20260712'))
  assert.equal(row.date, '2026-07-12')
  assert.equal(row.flow, 'medium')
  assert.equal(typeof row.sig, 'string', 'row was signed by the core identity')

  const days = (await collect(ps.createReadStream(ctx, DAY_RANGE))).filter((v) => !v.deleted)
  assert.equal(days.length, 2, 'both day rows mirrored + readable')

  // A tombstone put (deleted:true) must drop it from the non-deleted view.
  await ps.put(ctx, dayKey('20260713'), { date: '2026-07-13', createdBy: 'x', deleted: true })
  await ps.update(ctx)
  const live = (await collect(ps.createReadStream(ctx, DAY_RANGE))).filter((v) => !v.deleted)
  assert.equal(live.length, 1, 'tombstoned day no longer in the live view')
  assert.equal(live[0].date, '2026-07-12')

  await ctx.store.close(); _resetForTest()
})

test('period rows round-trip through the personal base + mirror', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  await ps.enable(ctx)
  await ps.put(ctx, periodKey('20260701'), { start: '2026-07-01', end: null, createdBy: 'x', deleted: false })
  await ps.update(ctx)
  const periods = await collect(ps.createReadStream(ctx, PERIOD_RANGE))
  assert.equal(periods.length, 1)
  assert.equal(periods[0].start, '2026-07-01')
  await ctx.store.close(); _resetForTest()
})

test('device roster maps to device-link deviceMeta (setDeviceLabel -> listDevices)', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  await ps.enable(ctx)
  await ps.setDeviceLabel(ctx, 'My phone')
  await ps.update(ctx)
  const devices = await ps.listDevices(ctx)
  const self = devices.find((d) => d.self)
  assert.ok(self, 'own device present in the roster')
  assert.equal(self.label, 'My phone')
  await ctx.store.close(); _resetForTest()
})

test('linkInvite mints a scannable pearpetal:// pair URL once enabled', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  await ps.enable(ctx)
  const inv = await ps.linkInvite(ctx)
  assert.match(inv.url, /^pearpetal:\/\/pair\?/)
  const link = ps.parsePairUrl(inv.url)
  assert.ok(link.topic && link.handshake && link.identity, 'url carries topic/handshake/identity')
  await ctx.store.close(); _resetForTest()
})
