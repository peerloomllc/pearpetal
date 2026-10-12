// Bring a partner's copy of the shared phase up to today.
//
// The owner writes `phase:current` as { phase, dayOfCycle } for the day she wrote
// it, and only rewrites it when her log changes. If she logs nothing for three
// days, the partner's copy still says the day she last wrote, three days behind
// her own screen, and no amount of syncing fixes it because nothing new was sent
// (reported 2026-10-12 by an iPhone couple). Every shared row already carries the
// owner-signed `updatedAt`, so the partner can count the days since then itself.
//
// The day count is purely date-based on the owner's side until a new period is
// logged, so advancing it here matches her screen. The phase NAME is recomputed
// only when the share carries the fertile window (fertility / full scope); on a
// phase-only share the partner cannot know where the window falls without being
// sent it, so the stored name stands until her next write. The owner also
// re-sends once per day when she opens the app (`refreshSharesIfNewDay`), which
// corrects anything this cannot.
//
// Pure, so it is tested without a network.

const { addDays, diffDays, DEFAULT_PERIOD_LEN } = require('./prediction')

const pad2 = (x) => String(x).padStart(2, '0')

// The wall-clock date of a timestamp in this phone's timezone, matching todayIso.
function isoOfMs (ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function freshPartnerPhase (phase, predict, today) {
  if (!phase || phase.dayOfCycle == null || !Number.isFinite(phase.updatedAt)) return { phase, predict }
  const elapsed = diffDays(isoOfMs(phase.updatedAt), today)
  if (!(elapsed > 0)) return { phase, predict }

  let day = phase.dayOfCycle + elapsed
  let p = predict ? { ...predict } : predict
  // Past the predicted next period, the owner's own prediction rolls into a new
  // predicted cycle of the same length (prediction.js), so mirror that. The cycle
  // length is never sent, but it falls out of the day count and the next-period
  // date as they stood when she wrote them.
  if (p && p.nextPeriodStart) {
    const writtenOn = isoOfMs(phase.updatedAt)
    const cycleStart = addDays(writtenOn, -(phase.dayOfCycle - 1))
    const cycleLen = diffDays(cycleStart, p.nextPeriodStart)
    if (cycleLen >= 1) {
      let shift = 0
      while (day > cycleLen) { day -= cycleLen; shift += cycleLen }
      if (shift) {
        p.rolled = true
        for (const k of ['nextPeriodStart', 'fertileStart', 'fertileEnd', 'ovulationEst']) {
          if (p[k]) p[k] = addDays(p[k], shift)
        }
      }
    }
  }

  // The period length is not sent either, so the default stands in for it: a
  // rolled-over cycle opens on a period, and a period already showing ends after it.
  let name = phase.phase
  const inPeriod = day <= DEFAULT_PERIOD_LEN && (name === 'menstrual' || p?.rolled)
  if (inPeriod) name = 'menstrual'
  else if (p && p.fertileStart && p.fertileEnd && p.ovulationEst) {
    if (diffDays(p.fertileStart, today) >= 0 && diffDays(today, p.fertileEnd) >= 0) name = 'fertile'
    else if (diffDays(today, p.ovulationEst) > 0) name = 'follicular'
    else name = 'luteal'
  }
  if (p) delete p.rolled
  return { phase: { ...phase, phase: name, dayOfCycle: day, advancedBy: elapsed }, predict: p }
}

module.exports = { freshPartnerPhase, isoOfMs }
