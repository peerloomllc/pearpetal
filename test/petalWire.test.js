const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const { generateKeypair } = require('@peerloom/core/identity')
const { signValue } = require('@peerloom/core/records')
const { rowApplyDecision, rowSharedDecision, applyPetalOp, deviceKey, dayKey, periodKey, phaseKey, predictKey } = require('../src/petalWire')

const KP = generateKeypair()
const PUB = b4a.toString(KP.publicKey, 'hex')

// Build a signed day row at a given updatedAt.
function dayRow (extra = {}, kp = KP, pub = PUB) {
  return signValue({ pubkey: pub, updatedAt: 1000, date: '2026-07-06', flow: 'light', ...extra }, kp.secretKey)
}

test('accepts a fresh, valid, signed day row', () => {
  assert.equal(rowApplyDecision(dayKey('20260706'), dayRow(), null), 'accept')
})

test('accepts a fresh, valid, signed period row', () => {
  const r = signValue({ pubkey: PUB, updatedAt: 1000, start: '2026-07-06' }, KP.secretKey)
  assert.equal(rowApplyDecision(periodKey('20260706'), r, null), 'accept')
})

test('rejects a row whose signature does not verify', () => {
  const r = dayRow()
  r.flow = 'heavy' // tamper after signing
  assert.equal(rowApplyDecision(dayKey('20260706'), r, null), 'reject')
})

test('rejects a row signed by a key other than its pubkey field', () => {
  const other = generateKeypair()
  const r = signValue({ pubkey: PUB, updatedAt: 1000, date: '2026-07-06' }, other.secretKey)
  assert.equal(rowApplyDecision(dayKey('20260706'), r, null), 'reject')
})

test('rejects an updatedAt far in the future', () => {
  const r = dayRow({ updatedAt: Date.now() + 60 * 60 * 1000 })
  assert.equal(rowApplyDecision(dayKey('20260706'), r, null), 'reject')
})

test('day rows are shared across the owner devices: a peer device may edit any day (LWW)', () => {
  // A different device (own second device) signs an edit to the same day key.
  const dev2 = generateKeypair()
  const dev2pub = b4a.toString(dev2.publicKey, 'hex')
  const older = dayRow({ updatedAt: 1000 })
  const newer = signValue({ pubkey: dev2pub, updatedAt: 2000, date: '2026-07-06', flow: 'medium' }, dev2.secretKey)
  assert.equal(rowApplyDecision(dayKey('20260706'), newer, older), 'accept')
  assert.equal(rowApplyDecision(dayKey('20260706'), older, newer), 'reject')
})

test('equal updatedAt breaks ties deterministically by signature', () => {
  const a = dayRow({ flow: 'light' })
  const b = dayRow({ flow: 'heavy' })
  const hi = a.sig > b.sig ? a : b
  const lo = a.sig > b.sig ? b : a
  assert.equal(rowApplyDecision(dayKey('20260706'), hi, lo), 'accept')
  assert.equal(rowApplyDecision(dayKey('20260706'), lo, hi), 'reject')
})

test('no resurrection: a tombstone rejects all later writes', () => {
  const tombstone = dayRow({ deleted: true, updatedAt: 1000 })
  const laterEdit = dayRow({ updatedAt: 5000 })
  assert.equal(rowApplyDecision(dayKey('20260706'), laterEdit, tombstone), 'reject')
})

test('rejects keys outside the device:/day:/period: namespaces', () => {
  assert.equal(rowApplyDecision('other:1', dayRow(), null), 'reject')
})

test('device row is per-writer: only the key-matching pubkey may write it', () => {
  const kp = generateKeypair()
  const pub = b4a.toString(kp.publicKey, 'hex')
  const good = signValue({ pubkey: pub, updatedAt: 1000, label: 'Phone' }, kp.secretKey)
  assert.equal(rowApplyDecision(deviceKey(pub), good, null), 'accept')
  // A device row whose key names a different pubkey than the (validly signed)
  // value is rejected, so no device can overwrite another device's roster entry.
  assert.equal(rowApplyDecision(deviceKey('00'.repeat(32)), good, null), 'reject')
})

// --- applyPetalOp against a mock view ---------------------------------------

function mockView (initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    async get (k) { return m.has(k) ? { value: m.get(k) } : null },
    async put (k, v) { m.set(k, v) },
    _map: m,
  }
}

test('applyPetalOp writes an accepted day row into the view', async () => {
  const view = mockView()
  await applyPetalOp({ type: 'put', key: dayKey('20260706'), value: dayRow() }, { view })
  assert.equal(view._map.get(dayKey('20260706')).flow, 'light')
})

test('applyPetalOp drops a rejected (tampered) row', async () => {
  const view = mockView()
  const bad = dayRow(); bad.flow = 'heavy'
  await applyPetalOp({ type: 'put', key: dayKey('20260706'), value: bad }, { view })
  assert.equal(view._map.has(dayKey('20260706')), false)
})

test('applyPetalOp ignores non-put ops and out-of-namespace keys', async () => {
  const view = mockView()
  await applyPetalOp({ type: 'del', key: dayKey('20260706') }, { view })
  await applyPetalOp({ type: 'put', key: 'junk:1', value: dayRow() }, { view })
  assert.equal(view._map.size, 0)
})

// --- shared base: owner-write-only projection (partner is read-only) ---------

const OWNER = generateKeypair()
const OWNERPUB = b4a.toString(OWNER.publicKey, 'hex')
const PARTNER = generateKeypair()
const PARTNERPUB = b4a.toString(PARTNER.publicKey, 'hex')

const shareMeta = (kp = OWNER, pub = OWNERPUB, owner = OWNERPUB, extra = {}) =>
  signValue({ pubkey: pub, updatedAt: 1000, ownerPubkey: owner, scope: 'phase', ...extra }, kp.secretKey)
const phaseRow = (kp, pub, extra = {}) => signValue({ pubkey: pub, updatedAt: 2000, phase: 'fertile', dayOfCycle: 12, ...extra }, kp.secretKey)

test('share:meta claim: accepted only when the claimant names itself owner', () => {
  assert.equal(rowSharedDecision('share:meta', shareMeta(), null), 'accept')
  // Claimant names someone else as owner -> reject (cannot claim on another's behalf).
  assert.equal(rowSharedDecision('share:meta', shareMeta(OWNER, OWNERPUB, PARTNERPUB), null), 'reject')
})

test('share:meta update: only the established owner may change it', () => {
  const existing = shareMeta()
  assert.equal(rowSharedDecision('share:meta', shareMeta(OWNER, OWNERPUB, OWNERPUB, { updatedAt: 3000, scope: 'full' }), existing), 'accept')
  // A partner-signed meta update is rejected.
  assert.equal(rowSharedDecision('share:meta', shareMeta(PARTNER, PARTNERPUB, PARTNERPUB, { updatedAt: 3000 }), existing), 'reject')
})

test('share:meta identity fields ride the owner-only gate (name/avatar)', () => {
  // The owner may add displayName + an avatar pointer; it is still owner-signed so
  // it applies. (proposal 2026-07-08 user-profile: additive optional fields.)
  const existing = shareMeta()
  const withId = shareMeta(OWNER, OWNERPUB, OWNERPUB, { updatedAt: 3000, displayName: 'Ada', avatarBlob: { key: 'abc', id: 1 }, avatarHash: 'deadbeef', avatarType: 'image/gif' })
  assert.equal(rowSharedDecision('share:meta', withId, existing), 'accept')
  // A partner cannot forge identity fields onto the owner's meta.
  const forged = shareMeta(PARTNER, PARTNERPUB, PARTNERPUB, { updatedAt: 3000, displayName: 'Ada' })
  assert.equal(rowSharedDecision('share:meta', forged, existing), 'reject')
})

test('phase:current accepted from the owner, rejected from the partner', () => {
  assert.equal(rowSharedDecision(phaseKey(), phaseRow(OWNER, OWNERPUB), null, OWNERPUB), 'accept')
  // Same key, validly self-signed by the partner, but not the owner -> reject.
  assert.equal(rowSharedDecision(phaseKey(), phaseRow(PARTNER, PARTNERPUB), null, OWNERPUB), 'reject')
})

test('shared projection row rejected when no owner is established yet', () => {
  assert.equal(rowSharedDecision(predictKey(), signValue({ pubkey: OWNERPUB, updatedAt: 2000, nextPeriodStart: '2026-08-01' }, OWNER.secretKey), null, null), 'reject')
})

test('applyPetalOp end to end: owner projection lands, partner forgery dropped', async () => {
  const view = mockView()
  await applyPetalOp({ type: 'put', key: 'share:meta', value: shareMeta() }, { view })
  await applyPetalOp({ type: 'put', key: phaseKey(), value: phaseRow(OWNER, OWNERPUB) }, { view })
  assert.equal(view._map.get(phaseKey()).phase, 'fertile')
  // A partner tries to overwrite the phase with a validly self-signed row.
  await applyPetalOp({ type: 'put', key: phaseKey(), value: phaseRow(PARTNER, PARTNERPUB, { phase: 'menstrual', updatedAt: 9000 }) }, { view })
  assert.equal(view._map.get(phaseKey()).phase, 'fertile') // unchanged - forgery rejected
})
