// PearPetal local-notification scheduling - PURE functions over a cycle
// projection + the device-local notification prefs, so they unit-test without a
// base or the OS scheduler. The RN shell (app/index.tsx) turns each returned
// event into an OS-scheduled local notification (expo-notifications); nothing
// here touches expo, Date-of-day, or the timezone - the shell converts
// { dateIso, hour, minute } into a local instant when it schedules.
//
// Design decisions (proposals/2026-07-09-notifications.md, resolved 2026-07-09):
//   - v1 reminder set: period due + fertile window / ovulation only.
//   - goal-aware (conceive leads with fertility; avoid uses a not-contraception
//     caution; pregnant suppresses all cycle reminders; birth control suppresses
//     the fertility reminders, matching the dial / summary).
//   - confidence-gated: nothing scheduled while confidence is none/low (never
//     nag on a guess).
//   - user-configurable discretion: discreet mode swaps every notification to
//     neutral wording so a lock-screen glance reveals nothing.
//
// Extended 2026-07-30 (proposals/2026-07-30-daily-flower-note.md) with the
// opt-in daily flower note: one garden-voice line a day, written on-device by
// src/petalNotes.js from the phase on that date and the chosen flower.

const { addDays, diffDays, todayIso } = require('./prediction')
const { noteFor, bucketDaysFor } = require('./petalNotes')

const DEFAULT_HOUR = 9
const DEFAULT_HORIZON_DAYS = 60 // ~2 cycles ahead, so reminders survive the app
// being closed for a full cycle (the shell reschedules on every foreground).
// The daily flower note gets a much shorter horizon than the cycle events: iOS
// caps an app at 64 pending local notifications, and the phase estimate for a
// date two cycles out is not worth a slot. The shell re-arms on every foreground
// and after every log entry, so the window keeps rolling forward.
const NOTE_HORIZON_DAYS = 14
const NOTE_HORIZON_LOW_CONF = 3 // a guess is fine for a few days, not a fortnight
// Hard guard on the whole returned list so we can never crowd the iOS limit,
// however the corpus or the horizons change later. In practice the list is ~24.
const MAX_EVENTS = 56

// Parse an "HH:MM" pref into [hour, minute], defaulting to 09:00 on anything odd.
function parseTime (t) {
  const m = typeof t === 'string' && t.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return [DEFAULT_HOUR, 0]
  const hh = Math.max(0, Math.min(23, Number(m[1])))
  const mm = Math.max(0, Math.min(59, Number(m[2])))
  return [hh, mm]
}

// Descriptive (or discreet) copy for one event category, tuned by goal. Discreet
// mode is deliberately identical for every category so nothing about the subject
// leaks on a lock screen; the specifics show only after opening the app.
function describe (category, goal, discreet) {
  if (discreet) return { title: 'PearPetal', body: 'You have a reminder. Open the app to view it.' }
  switch (category) {
    case 'period-soon':
      return { title: 'Period likely tomorrow', body: 'Your next period is predicted to start tomorrow.' }
    case 'period-due':
      return { title: 'Period may start today', body: 'Your next period is predicted around today.' }
    case 'fertile-open':
      if (goal === 'conceive') return { title: 'Fertile window opening', body: 'Your most fertile days are starting - good timing if you are trying to conceive.' }
      if (goal === 'avoid') return { title: 'Fertile window opening', body: 'Higher chance of pregnancy over the next several days. PearPetal is not contraception.' }
      return { title: 'Fertile window opening', body: 'Your estimated fertile window is starting.' }
    case 'ovulation':
      if (goal === 'conceive') return { title: 'Ovulation predicted', body: 'Ovulation is predicted around today - your peak fertility.' }
      if (goal === 'avoid') return { title: 'Ovulation predicted', body: 'Peak fertility around today. PearPetal is not contraception.' }
      return { title: 'Ovulation predicted', body: 'Ovulation is estimated around today.' }
    default:
      return { title: 'PearPetal', body: 'You have a reminder.' }
  }
}

// Build the list of cycle-notification events to schedule, from a projection
// (projectionFromRows output) and opts:
//   opts.notif = { enabled, discreet, period, fertility, dailyNote, noteTone, time }
//                (device-local)
//   opts.goal  = 'track' | 'conceive' | 'avoid' | 'pregnant'
//   opts.flower = the chosen species key, so the daily note can speak in its voice
//   opts.today = iso (defaults to today)
//   opts.horizonDays = how far ahead to schedule (default 60)
// Returns [{ id, category, dateIso, hour, minute, title, body }], all in the
// future within the horizon. Returns [] when notifications are off or the
// projection is not trustworthy enough to schedule from.
function notificationEvents (pred, opts = {}) {
  const notif = opts.notif || {}
  if (!notif.enabled) return []
  const goal = opts.goal || 'track'
  if (goal === 'pregnant') return [] // pregnancy view replaces cycle prediction
  if (!pred || !pred.known) return []
  if (pred.confidence === 'none') return []

  const today = opts.today || todayIso()
  const horizonDays = opts.horizonDays || DEFAULT_HORIZON_DAYS
  const [hour, minute] = parseTime(notif.time)
  const cycleLen = pred.cycleLen || 28
  const nCycles = Math.ceil(horizonDays / cycleLen) + 1
  // Cycle reminders are never scheduled on a low-confidence guess. The daily note
  // is not an instruction to act on, so it is allowed a short-horizon one.
  const trusted = pred.confidence !== 'low'
  const wantPeriod = trusted && notif.period !== false // default on once enabled
  const wantFertility = trusted && notif.fertility !== false && !pred.birthControl

  const events = []
  // `copy` overrides the category's fixed wording (the daily note writes its own);
  // discreet mode always wins, so every category reads identically on a lock screen.
  const push = (category, dateIso, copy) => {
    // future-only, within the horizon (the shell drops any already-past time today)
    if (!dateIso || diffDays(today, dateIso) < 0 || diffDays(today, dateIso) > horizonDays) return
    const { title, body } = (copy && !notif.discreet) ? copy : describe(category, goal, notif.discreet)
    events.push({ id: `pp:${category}:${dateIso}`, category, dateIso, hour, minute, title, body })
  }

  for (let k = 0; k < nCycles; k++) {
    if (wantPeriod && pred.nextPeriodStart) {
      const ps = addDays(pred.nextPeriodStart, k * cycleLen)
      push('period-soon', addDays(ps, -1))
      push('period-due', ps)
    }
    if (wantFertility) {
      if (pred.fertileStart) push('fertile-open', addDays(pred.fertileStart, k * cycleLen))
      if (pred.ovulationEst) push('ovulation', addDays(pred.ovulationEst, k * cycleLen))
    }
  }
  // The daily flower note: one garden-voice line a day over a short rolling
  // window (proposals/2026-07-30-daily-flower-note.md). Opt-in on top of the
  // master switch, so an existing user who already has reminders on does not
  // start getting notes on upgrade.
  if (notif.dailyNote) {
    const span = Math.min(horizonDays, trusted ? NOTE_HORIZON_DAYS : NOTE_HORIZON_LOW_CONF)
    // Measured once and passed down: it walks a whole projected cycle, and every
    // day in the window would otherwise repeat that walk.
    const bucketDays = bucketDaysFor(pred)
    for (let i = 0; i <= span; i++) {
      const dateIso = addDays(today, i)
      const note = noteFor(pred, dateIso, { tone: notif.noteTone, flower: opts.flower, bucketDays })
      if (note) push('daily-note', dateIso, { title: note.title, body: note.body })
    }
  }

  // Stable order (by date, then category) so equal inputs produce an equal list.
  events.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.category.localeCompare(b.category))
  // Keep the earliest MAX_EVENTS: the far-out cycle reminders are the ones the
  // next foreground resync will re-add anyway.
  return events.length > MAX_EVENTS ? events.slice(0, MAX_EVENTS) : events
}

module.exports = {
  notificationEvents, parseTime, describe,
  DEFAULT_HORIZON_DAYS, NOTE_HORIZON_DAYS, NOTE_HORIZON_LOW_CONF, MAX_EVENTS,
}
