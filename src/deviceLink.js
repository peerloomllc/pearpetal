// PearPetal <-> @peerloom/device-link wiring (the private base + own-device
// linking + mnemonic identity). Built per proposals/2026-07-12-adopt-device-link.md.
//
// SLICE 1 (this file): the integration layer only - a localDb-backed keystore
// adapter, and a flag-gated factory that constructs + starts the device-link
// engine on the SHARED runtime (the same Corestore + Hyperswarm + localDb the
// @peerloom/core group engine already owns, reached through the method context's
// ctx.store / ctx.swarm / ctx.localDb, added in peerloom-core PR #15).
//
// It is DORMANT until DEVICE_LINK_ENABLED flips: nothing in the shipped app
// calls getDeviceLink() yet, so cycle:create / link:join stay on the core-group
// private base. SLICE 2 flips the flag and reroutes those methods (QR-first
// linking per DECISIONS 2026-07-12), adds the export/import migration, the
// recovery-phrase UI, and gates the flip on the B->A hardware check.
//
// Identity model (proposal decision #2 = coexist): core's per-device keypair
// keeps signing day:/period:/device: rows exactly as today (verifyValue still
// gates them); the device-link mnemonic is purely the recovery + device-pairing
// anchor for the personal base.

const { createDeviceLink } = require('@peerloom/device-link/personal')
const { verifyValue } = require('@peerloom/core/records')
const { rowApplyDecision } = require('./petalWire')

// Master switch for the whole device-link path. OFF until the personal-base
// linking is hardware-verified (esp. the B->A direction, proposal decision #6).
// While false, the app runs the existing core-group private base unchanged.
const DEVICE_LINK_ENABLED = false

// The mnemonic lives device-local in localDb, NEVER in any Autobase and NEVER in
// a backup (matches PearPetal's "no secrets in export" rule). This is the whole
// keystore surface device-link needs.
const MNEMONIC_KEY = 'deviceLink:mnemonic'
function makeKeystore (localDb) {
  return {
    hasMnemonic: async () => !!((await localDb.get(MNEMONIC_KEY).catch(() => null))?.value?.mnemonic),
    getMnemonic: async () => (await localDb.get(MNEMONIC_KEY).catch(() => null))?.value?.mnemonic ?? null,
    setMnemonic: async (m) => { await localDb.put(MNEMONIC_KEY, { mnemonic: m, createdAt: Date.now() }) },
  }
}

// The app record types the personal-base apply accepts + mirrors. The device
// roster is handled natively by device-link (deviceMeta / listLinkedDevices), so
// only the date-keyed cycle rows are registered here. validate is the cheap
// signature gate; the fuller LWW / no-resurrection decision runs in the mirror.
function makeRecords () {
  return {
    day: { validate: (v) => verifyValue(v) },
    period: { validate: (v) => verifyValue(v) },
  }
}

// Mirror sink: device-link calls this from the personal-base apply for each
// accepted record. We fold it into the device-local view (localDb) under the
// same day:/period: keys the UI reads, reusing PearPetal's existing
// last-writer-wins + no-resurrection decision so convergence is identical to the
// core-group path. A null value is a delete (device-link uses tombstone puts, so
// this is belt-and-suspenders).
function makeMirror (localDb) {
  return async (_type, key, value) => {
    if (value == null) { await localDb.del(key).catch(() => {}); return }
    const existing = (await localDb.get(key).catch(() => null))?.value
    if (rowApplyDecision(key, value, existing) === 'accept') await localDb.put(key, value).catch(() => {})
  }
}

// Lazily construct + start one device-link engine for this worklet, sharing the
// group engine's runtime. Cached, so repeated calls (once per method dispatch)
// return the same instance. The caller gates on DEVICE_LINK_ENABLED; this
// factory itself is flag-agnostic so tests can drive it directly.
let _dlPromise = null
function getDeviceLink (ctx) {
  if (_dlPromise) return _dlPromise
  _dlPromise = (async () => {
    const dl = createDeviceLink({
      store: ctx.store,
      swarm: ctx.swarm,
      localDb: ctx.localDb,
      keystore: makeKeystore(ctx.localDb),
      records: makeRecords(),
      mirror: makeMirror(ctx.localDb),
      platform: '',
      onEvent: (event, data) => { try { ctx.emit(event, data) } catch {} },
    })
    await dl.start()
    return dl
  })()
  return _dlPromise
}

// Drop the cached instance (tests model a fresh worklet).
function _resetForTest () { _dlPromise = null }

module.exports = {
  DEVICE_LINK_ENABLED,
  makeKeystore,
  makeRecords,
  makeMirror,
  getDeviceLink,
  _resetForTest,
}
