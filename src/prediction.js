// PearPetal cycle projection - PURE functions over the day/period log, so they
// unit-test without a base. Produces the phase + predicted dates shown to the
// owner and (as a consented projection) to a partner.
//
// Prediction data lives only here (computed on demand) and in the consented
// shared-base projection; it is NEVER written to the private base, so nothing
// about prediction crosses the wire among your own devices.
//
// This is a calendar estimate refined by BBT when available. Explicitly NOT
// medical-grade and NOT contraception-grade (see the disclaimer the UI shows).

const FLOW_VALUES = new Set(['spotting', 'light', 'medium', 'heavy'])
// Bleeding flows infer a period START; spotting marks a bleeding day but does
// not by itself start a period.
const BLEEDING_FLOWS = new Set(['light', 'medium', 'heavy'])

const DEFAULT_CYCLE_LEN = 28
const DEFAULT_PERIOD_LEN = 5
const DEFAULT_LUTEAL_LEN = 14
const FERTILE_PRE = 5   // fertile window opens 5 days before ovulation
const FERTILE_POST = 1  // and closes 1 day after
const BBT_SHIFT_C = 0.2 // sustained rise (deg C) that marks the post-ovulation shift

// --- date helpers (UTC day arithmetic, no external deps) --------------------
function isoToDays (iso) { const [y, m, d] = iso.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000) }
function daysToIso (n) { const dt = new Date(n * 86400000); const p = (x) => String(x).padStart(2, '0'); return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` }
function addDays (iso, n) { return daysToIso(isoToDays(iso) + n) }
function diffDays (a, b) { return isoToDays(b) - isoToDays(a) }
function todayIso () { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` }

function median (nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}
function clamp (n, lo, hi) { return (typeof n === 'number' && Number.isFinite(n)) ? Math.max(lo, Math.min(hi, Math.round(n))) : null }

// Cycle starts from explicit period rows plus inferred starts (a bleeding day
// whose day-before was not bleeding). Sorted ascending, de-duped.
function cycleStarts (dayRows, periodRows) {
  const bleeding = new Set(dayRows.filter((d) => BLEEDING_FLOWS.has(d.flow)).map((d) => d.date))
  const startSet = new Set(periodRows.map((p) => p.start))
  for (const d of bleeding) if (!bleeding.has(addDays(d, -1))) startSet.add(d)
  return [...startSet].sort()
}

// Estimate ovulation for the current cycle from a sustained BBT rise. Returns the
// ISO date of estimated ovulation (the day BEFORE the first sustained shift), or
// null if there is not enough temperature data. Looks only at the current cycle.
function bbtOvulation (dayRows, cycleStart, today) {
  const temps = dayRows
    .filter((d) => typeof d.bbt === 'number' && diffDays(cycleStart, d.date) >= 0 && diffDays(d.date, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (temps.length < 8) return null // need a low-phase baseline plus a shift
  for (let i = 6; i < temps.length; i++) {
    const baseline = temps.slice(i - 6, i).reduce((s, t) => s + t.bbt, 0) / 6
    const shifted = temps[i].bbt >= baseline + BBT_SHIFT_C
    const sustained = shifted && temps[i + 1] && temps[i + 1].bbt >= baseline + BBT_SHIFT_C * 0.5
    if (sustained) return addDays(temps[i].date, -1)
  }
  return null
}

// Derive the full projection from day rows, explicit period rows, and optional
// user prefs { avgCycleLength, avgPeriodLength, lutealLength, goal }.
function projectionFromRows (dayRows, periodRows, opts = {}) {
  const today = opts.today || todayIso()
  const prefs = opts.prefs || {}
  const periodLen = clamp(prefs.avgPeriodLength, 2, 10) || DEFAULT_PERIOD_LEN
  const lutealLen = clamp(prefs.lutealLength, 9, 18) || DEFAULT_LUTEAL_LEN

  const anyFlowDays = new Set(dayRows.filter((d) => FLOW_VALUES.has(d.flow)).map((d) => d.date))
  const starts = cycleStarts(dayRows, periodRows)
  if (!starts.length) return { known: false, phase: 'follicular', dayOfCycle: null, confidence: 'none' }

  // Cycle length: median of recent usable gaps (robust to the odd irregular
  // cycle); fall back to the user's pref, then the default.
  const gaps = []
  for (let i = 1; i < starts.length; i++) gaps.push(diffDays(starts[i - 1], starts[i]))
  const usable = gaps.filter((g) => g >= 15 && g <= 60).slice(-6)
  let cycleLen = usable.length ? median(usable) : (clamp(prefs.avgCycleLength, 21, 45) || DEFAULT_CYCLE_LEN)
  cycleLen = Math.max(21, Math.min(45, cycleLen))

  const lastStart = starts[starts.length - 1]
  let cycleStart = lastStart
  while (diffDays(cycleStart, today) >= cycleLen) cycleStart = addDays(cycleStart, cycleLen)
  const dayOfCycle = Math.max(1, diffDays(cycleStart, today) + 1)
  const nextPeriodStart = addDays(cycleStart, cycleLen)

  // Ovulation: BBT-confirmed if we have a shift this cycle, else calendar
  // (next period minus the luteal length). Confidence rises with data.
  const bbtOv = bbtOvulation(dayRows, cycleStart, today)
  const ovulationEst = bbtOv || addDays(nextPeriodStart, -lutealLen)
  const fertileStart = addDays(ovulationEst, -FERTILE_PRE)
  const fertileEnd = addDays(ovulationEst, FERTILE_POST)

  // Regularity: how spread out recent cycle lengths are.
  const spread = usable.length >= 2 ? Math.max(...usable) - Math.min(...usable) : null
  let confidence
  if (bbtOv) confidence = 'high'
  else if (usable.length >= 3 && spread != null && spread <= 4) confidence = 'high'
  else if (usable.length >= 1) confidence = 'medium'
  else confidence = 'low' // one start, defaults used

  let phase
  if (anyFlowDays.has(today) || dayOfCycle <= periodLen) phase = 'menstrual'
  else if (diffDays(fertileStart, today) >= 0 && diffDays(today, fertileEnd) >= 0) phase = 'fertile'
  else if (diffDays(today, ovulationEst) > 0) phase = 'follicular'
  else phase = 'luteal'

  return {
    known: true, phase, dayOfCycle, cycleLen,
    nextPeriodStart, daysUntilNextPeriod: diffDays(today, nextPeriodStart),
    ovulationEst, ovulationSource: bbtOv ? 'bbt' : 'calendar',
    fertileStart, fertileEnd, confidence,
  }
}

module.exports = {
  projectionFromRows, cycleStarts, bbtOvulation, median,
  isoToDays, daysToIso, addDays, diffDays, todayIso,
  FLOW_VALUES, BLEEDING_FLOWS, DEFAULT_CYCLE_LEN, DEFAULT_LUTEAL_LEN, DEFAULT_PERIOD_LEN,
}
