// PearPetal merge rules (the tripWire.js / listWire.js analog). Pure, so they
// unit-test without standing up a real Autobase. Plugged into the @peerloom/core
// engine as its applyOps.
//
// This file governs the PRIVATE base only (the owner's own devices). The
// per-partner SHARED base (a consent-scoped projection) is a separate base with
// its own rules and lands in a later slice; see
// proposals/2026-07-06-wire-protocol.md.
//
// Data model (private base, all rows authored by the owner's own devices):
//   device:{pubkey}   -> signed { pubkey, label, updatedAt, sig }
//   day:{yyyymmdd}    -> signed { date, flow?, symptoms?, mood?, notes?, bbt?,
//                                 createdBy, createdAt, updatedAt, pubkey,
//                                 deleted?, sig }
//   period:{yyyymmdd} -> signed { start, end?, createdBy, createdAt, updatedAt,
//                                 pubkey, deleted?, sig }
//
// day: and period: rows are keyed by DATE, not by author, because every device
// on the private base is the SAME person: any of your devices may edit any day,
// and concurrent edits resolve last-writer-wins. This deliberately differs from
// the multi-person per-writer keyspace (PearCircle) - see DECISIONS.md
// 2026-07-06 "Private base is date-keyed". device:{pubkey} rows ARE per-writer
// (a device may only write its own roster row), so no device can spoof another.

const { verifyValue } = require('@peerloom/core/records')

const FUTURE_TS_TOLERANCE_MS = 5 * 60 * 1000

function deviceKey (pubkey) { return 'device:' + pubkey }
function dayKey (yyyymmdd) { return 'day:' + yyyymmdd }
function periodKey (yyyymmdd) { return 'period:' + yyyymmdd }
const DEVICE_RANGE = { gt: 'device:', lt: 'device:~' }
const DAY_RANGE = { gt: 'day:', lt: 'day:~' }
const PERIOD_RANGE = { gt: 'period:', lt: 'period:~' }

const NAMESPACES = ['device:', 'day:', 'period:']
const inNamespace = (key) => typeof key === 'string' && NAMESPACES.some((n) => key.startsWith(n))

// Accept / reject decision for a device:, day:, or period: row. Pure: takes the
// incoming signed value and whatever (if anything) is already stored at that key.
//   'accept' -> caller should view.put(key, incoming)
//   'reject' -> drop the op
//
// day: and period: rows are shared across the owner's own devices (any admitted
// writer may edit any of them, LWW). device:{pubkey} rows are per-writer: a
// device may only write its OWN row, so nobody can spoof another device.
function rowApplyDecision (key, incoming, existing) {
  if (!inNamespace(key)) return 'reject'
  if (!incoming || typeof incoming !== 'object') return 'reject'
  if (typeof incoming.pubkey !== 'string') return 'reject'
  if (typeof incoming.updatedAt !== 'number') return 'reject'
  if (incoming.updatedAt > Date.now() + FUTURE_TS_TOLERANCE_MS) return 'reject'
  if (!verifyValue(incoming)) return 'reject'
  if (key.startsWith('device:') && key.slice('device:'.length) !== incoming.pubkey) return 'reject'

  if (existing) {
    // No resurrection: once a key is a tombstone, reject every later write.
    if (existing.deleted === true) return 'reject'
    if (typeof existing.updatedAt === 'number') {
      if (incoming.updatedAt < existing.updatedAt) return 'reject'
      // Deterministic tie-break on equal timestamps: higher signature wins, so
      // every peer converges on the same value.
      if (incoming.updatedAt === existing.updatedAt && String(incoming.sig) <= String(existing.sig)) return 'reject'
    }
  }
  return 'accept'
}

// engine applyOps: one op at a time, in linearized order. A delete is a put of a
// { deleted: true } tombstone (kept in the view so no-resurrection holds), so
// only 'put' ops exist.
async function applyPetalOp (op, ctx) {
  const { view } = ctx
  if (!op || op.type !== 'put' || typeof op.key !== 'string') return
  if (!inNamespace(op.key)) return
  const existing = (await view.get(op.key))?.value
  if (rowApplyDecision(op.key, op.value, existing) === 'accept') {
    await view.put(op.key, op.value)
  }
}

module.exports = {
  applyPetalOp, rowApplyDecision,
  deviceKey, dayKey, periodKey,
  DEVICE_RANGE, DAY_RANGE, PERIOD_RANGE,
  FUTURE_TS_TOLERANCE_MS,
}
