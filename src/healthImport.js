// PearPetal Apple Health / Health Connect import - the MERGE, as pure functions
// over the existing day rows and whatever the platform handed us, so the rules
// unit-test without a base, a native module, or a phone.
//
// Design: proposals/2026-07-30-health-import.md. The parts that matter here:
//
//   - ONE WAY. Nothing in this file writes back to the health platform, and the
//     native side never requests write authorization, so no write-back path
//     exists to misuse.
//   - GAPS ONLY. An import fills what is empty. It never overwrites a value the
//     user typed - the same rule `period:log` already follows for flow. A value a
//     PREVIOUS import wrote may be refreshed, so re-importing a corrected reading
//     works.
//   - DE-DUPLICATION IS FREE. `day:` rows are keyed by date, so re-importing a
//     range overwrites the same keys rather than appending. Duplicates are
//     structurally impossible; that is a dividend of the date-keyed decision
//     (DECISIONS.md 2026-07-06).
//   - PROVENANCE IS PER FIELD, not per row. A day can hold a flow the user typed
//     AND a BBT that came from the platform, so a single row-level `source` marker
//     would be a lie. Each imported field is recorded in a `sources` map
//     (`{ bbt: 'healthkit' }`); a field with no entry was entered by hand. This
//     refines the proposal's "a `source` field" - the compat story is identical
//     (additive, unknown fields replicate and verify unchanged on an older peer,
//     because rowApplyDecision validates structure and never whitelists fields).
//
// The shell hands over already-normalised samples: ISO dates in the user's local
// timezone and BBT in CELSIUS. Sorted ascending by time, so the FIRST sample on a
// date wins - a basal reading is the waking one, not the last of the day.

const { FLOW_VALUES, isoToDays, daysToIso } = require('./prediction')

// The fields an import may touch. Deliberately narrow: everything else HealthKit
// and Health Connect expose (sexual activity, cervical mucus, ovulation tests,
// symptoms) is out of scope - see the proposal.
const IMPORTABLE = ['flow', 'bbt']

// Plausible basal body temperature in Celsius. Anything outside this is a unit
// mix-up (Fahrenheit, Kelvin) or a bad reading, and is dropped rather than
// written - a stray 98.6 would wreck the BBT-confirmed ovulation shift, which
// triggers on a sustained 0.2 degree rise.
const BBT_MIN_C = 30
const BBT_MAX_C = 45

// Bound the work a single import can do (~2 years of daily readings). Anything
// past this is reported, never silently dropped.
const MAX_SAMPLES = 800

// A real calendar date, not just the right shape: 2026-07-32 and 2026-02-30 match
// the pattern but are not days, and a platform that hands one over is confused
// about something. Round-tripping through the day arithmetic settles it.
const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && daysToIso(isoToDays(s)) === s

// Was this field entered by hand? A field with a value and no `sources` entry
// came from the user, and an import must not touch it.
function isManual (row, field) {
  if (!row || row[field] === undefined || row[field] === null) return false
  const src = row.sources && row.sources[field]
  return !src
}

// Reduce raw samples to at most one value per date per field, first-wins, with
// everything unusable counted rather than dropped quietly.
function collapse (samples, today) {
  const byDate = new Map()
  const stats = { invalid: 0, future: 0, overflow: 0 }
  const list = Array.isArray(samples) ? samples : []
  if (list.length > MAX_SAMPLES) stats.overflow = list.length - MAX_SAMPLES

  for (const s of list.slice(0, MAX_SAMPLES)) {
    if (!s || !isIsoDate(s.date)) { stats.invalid++; continue }
    if (today && s.date > today) { stats.future++; continue }
    const entry = byDate.get(s.date) || {}
    let used = false

    if (s.flow !== undefined && s.flow !== null) {
      if (!FLOW_VALUES.has(s.flow)) stats.invalid++
      else if (entry.flow === undefined) { entry.flow = s.flow; used = true }
    }
    if (s.bbt !== undefined && s.bbt !== null) {
      const n = Number(s.bbt)
      if (!Number.isFinite(n) || n < BBT_MIN_C || n > BBT_MAX_C) stats.invalid++
      else if (entry.bbt === undefined) { entry.bbt = Math.round(n * 100) / 100; used = true }
    }
    if (used || Object.keys(entry).length) byDate.set(s.date, entry)
  }
  return { byDate, stats }
}

// Build the write plan for an import. PURE - it decides, the caller applies.
//   existing: { [dateIso]: dayRow } as already stored
//   samples:  [{ date, flow?, bbt? }] from the platform, BBT in Celsius
//   opts.source: 'healthkit' | 'healthconnect'
//   opts.today:  iso, so a sample dated in the future is refused
// Returns { writes: [{ date, patch, sources }], added, updated, keptManual, ... }
// where `patch` holds only the fields to change and `sources` is the map to merge
// onto the row.
function planImport (existing, samples, opts = {}) {
  const source = opts.source || 'health'
  const { byDate, stats } = collapse(samples, opts.today)
  const writes = []
  let added = 0
  let updated = 0
  let keptManual = 0
  let unchanged = 0

  for (const date of [...byDate.keys()].sort()) {
    const incoming = byDate.get(date)
    const row = existing && existing[date]
    const patch = {}
    const sources = {}

    for (const field of IMPORTABLE) {
      if (incoming[field] === undefined) continue
      if (isManual(row, field)) { keptManual++; continue } // the user's own entry always wins
      const current = row ? row[field] : undefined
      if (current === incoming[field]) { unchanged++; continue }
      patch[field] = incoming[field]
      sources[field] = source
      if (current === undefined || current === null) added++
      else updated++ // refreshing a value a previous import wrote
    }

    if (Object.keys(patch).length) writes.push({ date, patch, sources })
  }

  return { writes, added, updated, keptManual, unchanged, ...stats, source }
}

module.exports = {
  planImport, collapse, isManual,
  IMPORTABLE, BBT_MIN_C, BBT_MAX_C, MAX_SAMPLES,
}
