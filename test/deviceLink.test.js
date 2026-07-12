// Unit-tests the PearPetal <-> @peerloom/device-link wiring (src/deviceLink.js):
// the localDb-backed keystore adapter and the flag-gated factory that constructs
// + starts device-link on a shared runtime. Full pairing/replication is covered
// by @peerloom/device-link's own two-peer integration test; here we only prove
// the local integration seam. The wiring is dormant in the app (DEVICE_LINK_ENABLED
// is false) - these tests drive the factory directly, as SLICE 2 will once the
// flag flips.

const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const { makeKeystore, getDeviceLink, isDeviceLinkEnabled, _resetForTest } = require('../src/deviceLink')

const _tmpDirs = []
function tmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-dl-'))
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
  return { store, swarm: fakeSwarm(), localDb, emit: () => {} }
}

test('the flag ships OFF (device-link path dormant until hardware-verified)', () => {
  assert.equal(isDeviceLinkEnabled(), false)
})

test('keystore adapter round-trips a mnemonic through localDb', async () => {
  const ctx = await mkCtx()
  const ks = makeKeystore(ctx.localDb)
  assert.equal(await ks.hasMnemonic(), false, 'no mnemonic initially')
  assert.equal(await ks.getMnemonic(), null)
  const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident'
  await ks.setMnemonic(phrase)
  assert.equal(await ks.hasMnemonic(), true)
  assert.equal(await ks.getMnemonic(), phrase)
  await ctx.store.close()
})

test('getDeviceLink constructs + starts, and enable() mints a writable personal base', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  const dl = await getDeviceLink(ctx)
  assert.equal(dl.isEnabled, false, 'no personal base before enable')
  const r = await dl.enable()
  assert.equal(r.enabled, true)
  assert.equal(!!dl.personalBase && dl.personalBase.writable, true, 'founder is writable on its personal base')
  assert.ok(dl.identityPublicKeyHex, 'a device-link identity was derived')
  await dl.stop()
  await ctx.store.close()
  _resetForTest()
})

test('getDeviceLink is a cached singleton for the worklet', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  const a = getDeviceLink(ctx)
  const b = getDeviceLink(ctx)
  assert.equal(await a, await b, 'same instance returned')
  await (await a).stop()
  await ctx.store.close()
  _resetForTest()
})
