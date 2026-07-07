const test = require('node:test')
const assert = require('node:assert/strict')
const { projectionFromRows, addDays, diffDays } = require('../src/prediction')

const day = (date, flow) => ({ date, flow })

test('no history: not known, defaults to follicular', () => {
  const p = projectionFromRows([], [], '2026-07-06')
  assert.equal(p.known, false)
  assert.equal(p.phase, 'follicular')
  assert.equal(p.dayOfCycle, null)
})

test('infers a period start from a bleeding run and predicts the next period', () => {
  // A 3-day bleed starting 2026-07-01; today is day 6 of the cycle.
  const days = [day('2026-07-01', 'medium'), day('2026-07-02', 'medium'), day('2026-07-03', 'light')]
  const p = projectionFromRows(days, [], '2026-07-06')
  assert.equal(p.known, true)
  assert.equal(p.dayOfCycle, 6)
  // With one start and no gap history, cycle length defaults to 28.
  assert.equal(p.nextPeriodStart, addDays('2026-07-01', 28))
  // Ovulation ~14 days before the next period; fertile window brackets it.
  assert.equal(p.ovulationEst, addDays(p.nextPeriodStart, -14))
  assert.equal(diffDays(p.fertileStart, p.ovulationEst), 5)
  assert.equal(diffDays(p.ovulationEst, p.fertileEnd), 1)
})

test('averages the observed cycle length from multiple starts', () => {
  // Starts 26 days apart -> predicted length 26, not the 28 default.
  const days = [day('2026-05-10', 'heavy'), day('2026-06-05', 'heavy'), day('2026-07-01', 'heavy')]
  const p = projectionFromRows(days, [], '2026-07-02')
  assert.equal(p.cycleLen, 26)
  assert.equal(p.nextPeriodStart, addDays('2026-07-01', 26))
})

test('flow today reads as the menstrual phase', () => {
  const days = [day('2026-07-06', 'medium')]
  const p = projectionFromRows(days, [], '2026-07-06')
  assert.equal(p.phase, 'menstrual')
})

test('explicit period rows count as cycle starts', () => {
  const p = projectionFromRows([], [{ start: '2026-06-01' }, { start: '2026-06-29' }], '2026-07-02')
  assert.equal(p.known, true)
  assert.equal(p.cycleLen, 28)
})

test('spotting alone does not start a period', () => {
  const p = projectionFromRows([day('2026-07-06', 'spotting')], [], '2026-07-06')
  // Spotting is a flow day (so "known" via... no start): no bleeding run -> unknown.
  assert.equal(p.known, false)
})
