// PearPetal merge rules (the tripWire.js / listWire.js analog). Pure, so they
// unit-test without standing up a real Autobase. Plugged into the @peerloom/core
// engine as its applyOps.
//
// This file governs BOTH base kinds, routing each op by its key namespace (a
// given base only ever holds one family of keys):
//
// PRIVATE base (the owner's own devices):
//   device:{pubkey}   -> signed { pubkey, label, updatedAt, sig }
//   day:{yyyymmdd}    -> signed { date, flow?, symptoms?, mood?, notes?, bbt?,
//                                 createdBy, createdAt, updatedAt, pubkey,
//                                 deleted?, sig }
//   period:{yyyymmdd} -> signed { start, end?, createdBy, createdAt, updatedAt,
//                                 pubkey, deleted?, sig }
//
// SHARED base (one per partner link; a consent-scoped projection the OWNER writes
// and the partner only reads). Every row must be signed by the base's owner:
//   share:meta        -> signed { ownerPubkey, scope, createdAt, updatedAt, pubkey, sig }
//   phase:current     -> signed { phase, dayOfCycle, updatedAt, pubkey, sig }
//   predict:current   -> signed { nextPeriodStart, fertileStart?, fertileEnd?,
//                                 ovulationEst?, updatedAt, pubkey, sig }
//   summary:{yyyymmdd}-> signed { date, flow?: boolean, symptomTags?: string[],
//                                 updatedAt, pubkey, sig }
//
// The partner is admitted as an Autobase writer (so their identity is bound) but
// apply REJECTS every shared-base row not signed by the owner recorded in
// share:meta - that is what makes the partner read-only in v1. See
// proposals/2026-07-06-wire-protocol.md and DECISIONS.md.
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

const PRIVATE_NAMESPACES = ['device:', 'day:', 'period:']
const SHARED_NAMESPACES = ['share:', 'phase:', 'predict:', 'summary:']
const inPrivateNs = (key) => typeof key === 'string' && PRIVATE_NAMESPACES.some((n) => key.startsWith(n))
const inSharedNs = (key) => typeof key === 'string' && SHARED_NAMESPACES.some((n) => key.startsWith(n))
// Back-compat name used by callers/tests for the private-base check.
const inNamespace = inPrivateNs

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

// Accept / reject decision for a SHARED-base row (share:/phase:/predict:/summary:).
// ownerPubkey is the owner recorded in share:meta (or, for the share:meta claim
// itself, resolved from the incoming/existing value). Only the owner may write.
//   'accept' -> caller should view.put(key, incoming)
//   'reject' -> drop the op (this is how a partner is kept read-only)
function rowSharedDecision (key, incoming, existing, ownerPubkey) {
  if (!inSharedNs(key)) return 'reject'
  if (!incoming || typeof incoming !== 'object') return 'reject'
  if (typeof incoming.pubkey !== 'string') return 'reject'
  if (typeof incoming.updatedAt !== 'number') return 'reject'
  if (incoming.updatedAt > Date.now() + FUTURE_TS_TOLERANCE_MS) return 'reject'
  if (!verifyValue(incoming)) return 'reject'

  if (key === 'share:meta') {
    // First write claims ownership: the claimant must name itself as owner.
    if (!existing) return incoming.ownerPubkey === incoming.pubkey ? 'accept' : 'reject'
    // After that only the established owner may update it.
    if (incoming.pubkey !== existing.ownerPubkey) return 'reject'
  } else {
    // Every other shared row must be signed by the base's owner. No owner yet
    // (share:meta not applied) -> reject; a partner's signature -> reject.
    if (!ownerPubkey || incoming.pubkey !== ownerPubkey) return 'reject'
  }

  if (existing) {
    if (existing.deleted === true) return 'reject'
    if (typeof existing.updatedAt === 'number') {
      if (incoming.updatedAt < existing.updatedAt) return 'reject'
      if (incoming.updatedAt === existing.updatedAt && String(incoming.sig) <= String(existing.sig)) return 'reject'
    }
  }
  return 'accept'
}

// engine applyOps: one op at a time, in linearized order. Routes by key
// namespace (private vs shared). A delete is a put of a { deleted: true }
// tombstone (kept in the view so no-resurrection holds), so only 'put' ops exist.
async function applyPetalOp (op, ctx) {
  const { view } = ctx
  if (!op || op.type !== 'put' || typeof op.key !== 'string') return

  if (inPrivateNs(op.key)) {
    const existing = (await view.get(op.key))?.value
    if (rowApplyDecision(op.key, op.value, existing) === 'accept') await view.put(op.key, op.value)
    return
  }

  if (inSharedNs(op.key)) {
    const existing = (await view.get(op.key))?.value
    const ownerPubkey = op.key === 'share:meta'
      ? existing?.ownerPubkey
      : (await view.get('share:meta'))?.value?.ownerPubkey
    if (rowSharedDecision(op.key, op.value, existing, ownerPubkey) === 'accept') await view.put(op.key, op.value)
  }
}

function phaseKey () { return 'phase:current' }
function predictKey () { return 'predict:current' }
function summaryKey (yyyymmdd) { return 'summary:' + yyyymmdd }
const SUMMARY_RANGE = { gt: 'summary:', lt: 'summary:~' }

module.exports = {
  applyPetalOp, rowApplyDecision, rowSharedDecision,
  deviceKey, dayKey, periodKey, phaseKey, predictKey, summaryKey,
  DEVICE_RANGE, DAY_RANGE, PERIOD_RANGE, SUMMARY_RANGE,
  FUTURE_TS_TOLERANCE_MS,
}
