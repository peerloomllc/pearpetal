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
const { makeKeystore, makeMirror, listRecords, getDeviceLink, isDeviceLinkEnabled, _resetForTest } = require('../src/deviceLink')

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

test('the flag ships ON (device-link is the default path after the 2026-07-12 flip)', () => {
  assert.equal(isDeviceLinkEnabled(), true)
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

test('mirror folds identityProfile into localDb profile with last-writer-wins', async () => {
  const ctx = await mkCtx()
  const mirror = makeMirror(ctx.localDb)
  await mirror('identityProfile', 'identityProfile', { displayName: 'Ada', updatedAt: 100 })
  assert.equal((await ctx.localDb.get('profile')).value.displayName, 'Ada')
  // Older update does NOT overwrite.
  await mirror('identityProfile', 'identityProfile', { displayName: 'Stale', updatedAt: 50 })
  assert.equal((await ctx.localDb.get('profile')).value.displayName, 'Ada')
  // Newer update wins.
  await mirror('identityProfile', 'identityProfile', { displayName: 'Ada B', updatedAt: 200 })
  assert.equal((await ctx.localDb.get('profile')).value.displayName, 'Ada B')
  await ctx.store.close()
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

// proposals/2026-10-12-encrypt-private-log.md: what a move onto an encrypted
// personal base copies across is exactly what the mirror keeps.
test('listRecords returns every mirrored row as a device-link record', async () => {
  const ctx = await mkCtx()
  await ctx.localDb.put('day:20261001', { flow: 'light' })
  await ctx.localDb.put('period:20261001', { start: '20261001' })
  await ctx.localDb.put('profile', { name: 'Ada', updatedAt: 1 })
  await ctx.localDb.put('prefs', { cycleLength: 28, updatedAt: 1 })
  await ctx.localDb.put('unrelated', { x: 1 })
  const recs = await listRecords(ctx.localDb)
  const byKey = Object.fromEntries(recs.map((r) => [r.key, r.type]))
  assert.deepEqual(byKey, { 'day:20261001': 'day', 'period:20261001': 'period', identityProfile: 'identityProfile', ownerPrefs: 'ownerPrefs' })
  await ctx.store.close()
})

test('a new personal base is encrypted and reports nothing to move', async () => {
  _resetForTest()
  const ctx = await mkCtx()
  const dl = await getDeviceLink(ctx)
  await dl.enable()
  assert.equal(dl.isEncrypted, true, 'founded with a key')
  assert.equal((await dl.moveStatus()).state, 'encrypted')
  await dl.stop()
  _resetForTest()
  await ctx.store.close()
})
