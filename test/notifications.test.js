const test = require('node:test')
const assert = require('node:assert/strict')
const { notificationEvents, parseTime, describe, NOTE_HORIZON_DAYS, NOTE_HORIZON_LOW_CONF, MAX_EVENTS } = require('../src/notifications')
const { projectionFromRows } = require('../src/prediction')

// A trustworthy (medium-confidence) projection fixture, today = 2026-07-10.
// Ovulation + fertile are this cycle; the next period is 2026-08-01.
const basePred = () => ({
  known: true, confidence: 'medium', cycleLen: 28, birthControl: false,
  nextPeriodStart: '2026-08-01', ovulationEst: '2026-07-18',
  fertileStart: '2026-07-13', fertileEnd: '2026-07-19',
})
const on = (over = {}) => ({ enabled: true, discreet: false, period: true, fertility: true, time: '09:00', ...over })
const opts = (over = {}) => ({ today: '2026-07-10', goal: 'track', ...over })

test('parseTime: valid, invalid, and out-of-range', () => {
  assert.deepEqual(parseTime('07:30'), [7, 30])
  assert.deepEqual(parseTime('9:05'), [9, 5])
  assert.deepEqual(parseTime(undefined), [9, 0])
  assert.deepEqual(parseTime('nope'), [9, 0])
  assert.deepEqual(parseTime('30:99'), [23, 59])
})

test('disabled -> no events', () => {
  assert.deepEqual(notificationEvents(basePred(), opts({ notif: on({ enabled: false }) })), [])
  assert.deepEqual(notificationEvents(basePred(), opts({ notif: {} })), [])
})

test('pregnant goal -> no cycle events', () => {
  assert.deepEqual(notificationEvents(basePred(), opts({ notif: on(), goal: 'pregnant' })), [])
})

test('confidence none/low -> no events (never nag on a guess)', () => {
  for (const confidence of ['none', 'low']) {
    assert.deepEqual(notificationEvents({ ...basePred(), confidence }, opts({ notif: on() })), [])
  }
})

test('unknown / missing projection -> no events', () => {
  assert.deepEqual(notificationEvents({ known: false }, opts({ notif: on() })), [])
  assert.deepEqual(notificationEvents(null, opts({ notif: on() })), [])
})

test('enabled: schedules period + fertility events, future-only', () => {
  const ev = notificationEvents(basePred(), opts({ notif: on() }))
  const cats = new Set(ev.map((e) => e.category))
  assert.ok(cats.has('period-soon') && cats.has('period-due'))
  assert.ok(cats.has('fertile-open') && cats.has('ovulation'))
  // all in the future (>= today)
  for (const e of ev) assert.ok(e.dateIso >= '2026-07-10', `${e.dateIso} should be >= today`)
  // the k=0 period-due lands on the predicted next-period start
  assert.ok(ev.some((e) => e.category === 'period-due' && e.dateIso === '2026-08-01'))
  assert.ok(ev.some((e) => e.category === 'period-soon' && e.dateIso === '2026-07-31'))
  // fertile-open + ovulation for this cycle
  assert.ok(ev.some((e) => e.category === 'fertile-open' && e.dateIso === '2026-07-13'))
  assert.ok(ev.some((e) => e.category === 'ovulation' && e.dateIso === '2026-07-18'))
})

test('projects ~2 cycles ahead (a second period + ovulation appear)', () => {
  const ev = notificationEvents(basePred(), opts({ notif: on() }))
  // k=1 period-due = 2026-08-01 + 28 = 2026-08-29
  assert.ok(ev.some((e) => e.category === 'period-due' && e.dateIso === '2026-08-29'))
  // k=1 ovulation = 2026-07-18 + 28 = 2026-08-15
  assert.ok(ev.some((e) => e.category === 'ovulation' && e.dateIso === '2026-08-15'))
})

test('respects the horizon (no events beyond horizonDays)', () => {
  const ev = notificationEvents(basePred(), opts({ notif: on(), horizonDays: 20 }))
  for (const e of ev) assert.ok(e.dateIso <= '2026-07-30', `${e.dateIso} within 20d of today`)
})

test('birth control suppresses fertility but keeps period', () => {
  const ev = notificationEvents({ ...basePred(), birthControl: true }, opts({ notif: on() }))
  const cats = new Set(ev.map((e) => e.category))
  assert.ok(cats.has('period-due'))
  assert.ok(!cats.has('fertile-open') && !cats.has('ovulation'))
})

test('per-category toggles', () => {
  const noPeriod = notificationEvents(basePred(), opts({ notif: on({ period: false }) }))
  assert.ok(!noPeriod.some((e) => e.category.startsWith('period')))
  assert.ok(noPeriod.some((e) => e.category === 'ovulation'))
  const noFert = notificationEvents(basePred(), opts({ notif: on({ fertility: false }) }))
  assert.ok(!noFert.some((e) => e.category === 'fertile-open' || e.category === 'ovulation'))
  assert.ok(noFert.some((e) => e.category === 'period-due'))
})

test('discreet mode swaps every notification to neutral wording', () => {
  const ev = notificationEvents(basePred(), opts({ notif: on({ discreet: true }) }))
  assert.ok(ev.length > 0)
  for (const e of ev) {
    assert.equal(e.title, 'PearPetal')
    assert.ok(!/period|fertile|ovulation|pregnan/i.test(e.body), `discreet body leaks: ${e.body}`)
  }
})

test('goal tunes the fertility copy (conceive vs avoid vs track)', () => {
  const bodyFor = (goal, cat) =>
    notificationEvents(basePred(), opts({ notif: on(), goal })).find((e) => e.category === cat).body
  assert.match(bodyFor('conceive', 'ovulation'), /peak fertility/i)
  assert.match(bodyFor('avoid', 'fertile-open'), /not contraception/i)
  assert.match(bodyFor('avoid', 'ovulation'), /not contraception/i)
  assert.doesNotMatch(bodyFor('track', 'fertile-open'), /contraception|conceive/i)
})

test('event ids are deterministic (idempotent reschedule)', () => {
  const a = notificationEvents(basePred(), opts({ notif: on() })).map((e) => e.id)
  const b = notificationEvents(basePred(), opts({ notif: on() })).map((e) => e.id)
  assert.deepEqual(a, b)
  assert.ok(a.every((id) => id.startsWith('pp:')))
})

test('describe: discreet ignores category + goal', () => {
  assert.deepEqual(describe('period-due', 'avoid', true), describe('ovulation', 'conceive', true))
})

// --- the daily flower note (proposals/2026-07-30-daily-flower-note.md) -------

const notes = (ev) => ev.filter((e) => e.category === 'daily-note')

test('the daily note is off unless asked for, even with reminders on', () => {
  assert.equal(notes(notificationEvents(basePred(), opts({ notif: on() }))).length, 0)
})

test('daily note: one a day over the 14-day rolling window, starting today', () => {
  const ev = notes(notificationEvents(basePred(), opts({ notif: on({ dailyNote: true }), flower: 'rose' })))
  assert.equal(ev.length, NOTE_HORIZON_DAYS + 1) // today through today+14
  assert.equal(ev[0].dateIso, '2026-07-10')
  assert.equal(ev.at(-1).dateIso, '2026-07-24')
  assert.deepEqual([...new Set(ev.map((e) => e.dateIso))].length, ev.length) // one per date
  for (const e of ev) {
    assert.ok(e.id.startsWith('pp:daily-note:'))
    assert.ok(e.title.length && e.body.length)
    assert.equal(e.hour, 9)
  }
  // consecutive days never repeat the same line
  for (let i = 1; i < ev.length; i++) assert.notEqual(ev[i].title, ev[i - 1].title)
})

test('daily note: schedules on a low-confidence guess, but only a few days out', () => {
  const ev = notificationEvents({ ...basePred(), confidence: 'low' }, opts({ notif: on({ dailyNote: true }) }))
  const n = notes(ev)
  assert.equal(n.length, NOTE_HORIZON_LOW_CONF + 1)
  // ...and the cycle reminders stay suppressed at low confidence
  assert.equal(ev.length, n.length)
})

test('daily note: the tone pref changes the wording', () => {
  const one = (noteTone) => notes(notificationEvents(basePred(), opts({ notif: on({ dailyNote: true, noteTone }), flower: 'rose' })))
  const playful = one('playful')
  const gentle = one('gentle')
  assert.equal(playful.length, gentle.length)
  assert.ok(playful.some((e, i) => e.body !== gentle[i].body))
})

test('daily note: discreet mode neutralises it like every other category', () => {
  const ev = notes(notificationEvents(basePred(), opts({ notif: on({ dailyNote: true, discreet: true }) })))
  assert.ok(ev.length > 0)
  for (const e of ev) {
    assert.equal(e.title, 'PearPetal')
    assert.equal(e.body, 'You have a reminder. Open the app to view it.')
  }
})

test('daily note: suppressed while pregnant, and stable across reschedules', () => {
  assert.deepEqual(notificationEvents(basePred(), opts({ notif: on({ dailyNote: true }), goal: 'pregnant' })), [])
  const a = notificationEvents(basePred(), opts({ notif: on({ dailyNote: true }), flower: 'lotus' }))
  const b = notificationEvents(basePred(), opts({ notif: on({ dailyNote: true }), flower: 'lotus' }))
  assert.deepEqual(a, b)
})

test('the whole list is capped, so the iOS 64-pending limit can never be crowded', () => {
  const ev = notificationEvents(basePred(), opts({ notif: on({ dailyNote: true }), horizonDays: 3000 }))
  assert.equal(ev.length, MAX_EVENTS)
  // the earliest are the ones kept
  assert.equal(ev[0].dateIso, '2026-07-10')
})

test('integration: a real medium-confidence projection yields events', () => {
  // Three tight 28-day cycles -> medium+ confidence, known projection.
  const starts = ['2026-04-14', '2026-05-12', '2026-06-09', '2026-07-07']
  const days = starts.map((d) => ({ date: d, flow: 'medium' }))
  const pred = projectionFromRows(days, [], { today: '2026-07-10' })
  assert.equal(pred.known, true)
  assert.notEqual(pred.confidence, 'none')
  const ev = notificationEvents(pred, opts({ notif: on() }))
  assert.ok(ev.length > 0)
  assert.ok(ev.some((e) => e.category === 'period-due'))
})
