const test = require('node:test')
const assert = require('node:assert/strict')
const { notificationEvents, parseTime, describe } = require('../src/notifications')
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
