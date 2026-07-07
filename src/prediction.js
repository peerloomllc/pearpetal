// PearPetal cycle projection - PURE functions over the day/period log, so they
// unit-test without a base. Produces the phase + predicted dates that a shared
// base projects to a partner (a consented projection), and that the app shows
// locally. This is a BASIC calendar estimate; a later slice refines the
// algorithm (BBT, variable luteal, irregular-cycle handling).
//
// Prediction data lives only here (computed on demand) and in the consented
// shared-base projection; it is NEVER written to the private base, so nothing
// about prediction crosses the wire among your own devices.

const FLOW_VALUES = new Set(['spotting', 'light', 'medium', 'heavy'])
// Bleeding flows infer a period START; spotting marks a bleeding day but does
// not by itself start a period.
const BLEEDING_FLOWS = new Set(['light', 'medium', 'heavy'])

const DEFAULT_CYCLE_LEN = 28
const LUTEAL_LEN = 14

// --- date helpers (UTC day arithmetic, no external deps) --------------------
function isoToDays (iso) { const [y, m, d] = iso.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000) }
function daysToIso (n) { const dt = new Date(n * 86400000); const p = (x) => String(x).padStart(2, '0'); return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` }
function addDays (iso, n) { return daysToIso(isoToDays(iso) + n) }
function diffDays (a, b) { return isoToDays(b) - isoToDays(a) }
function todayIso () { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` }

// Derive { phase, dayOfCycle, cycleLen, nextPeriodStart, ovulationEst,
// fertileStart, fertileEnd, known } from day rows and explicit period rows.
function projectionFromRows (dayRows, periodRows, today = todayIso()) {
  const bleedingDays = new Set(dayRows.filter((d) => BLEEDING_FLOWS.has(d.flow)).map((d) => d.date))
  const anyFlowDays = new Set(dayRows.filter((d) => FLOW_VALUES.has(d.flow)).map((d) => d.date))

  // Cycle starts: explicit period rows, plus inferred starts (a bleeding day
  // whose day-before was not bleeding).
  const startSet = new Set(periodRows.map((p) => p.start))
  for (const d of bleedingDays) if (!bleedingDays.has(addDays(d, -1))) startSet.add(d)
  const starts = [...startSet].sort()

  if (!starts.length) return { known: false, phase: 'follicular', dayOfCycle: null }

  const gaps = []
  for (let i = 1; i < starts.length; i++) gaps.push(diffDays(starts[i - 1], starts[i]))
  const usable = gaps.filter((g) => g >= 15 && g <= 60)
  let cycleLen = usable.length ? Math.round(usable.reduce((a, b) => a + b, 0) / usable.length) : DEFAULT_CYCLE_LEN
  cycleLen = Math.max(21, Math.min(40, cycleLen))

  const lastStart = starts[starts.length - 1]
  // Roll forward to the cycle that contains `today`.
  let cycleStart = lastStart
  while (diffDays(cycleStart, today) >= cycleLen) cycleStart = addDays(cycleStart, cycleLen)
  const dayOfCycle = Math.max(1, diffDays(cycleStart, today) + 1)
  const nextPeriodStart = addDays(cycleStart, cycleLen)
  const ovulationEst = addDays(nextPeriodStart, -LUTEAL_LEN)
  const fertileStart = addDays(ovulationEst, -5)
  const fertileEnd = addDays(ovulationEst, 1)

  let phase
  if (anyFlowDays.has(today) || dayOfCycle <= 5) phase = 'menstrual'
  else if (diffDays(fertileStart, today) >= 0 && diffDays(today, fertileEnd) >= 0) phase = 'fertile'
  else if (diffDays(today, ovulationEst) > 0) phase = 'follicular'
  else phase = 'luteal'

  return { known: true, phase, dayOfCycle, cycleLen, nextPeriodStart, ovulationEst, fertileStart, fertileEnd }
}

module.exports = {
  projectionFromRows,
  isoToDays, daysToIso, addDays, diffDays, todayIso,
  FLOW_VALUES, BLEEDING_FLOWS, DEFAULT_CYCLE_LEN, LUTEAL_LEN,
}
