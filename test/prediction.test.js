const test = require('node:test')
const assert = require('node:assert/strict')
const { projectionFromRows, pregnancyProjection, cycleStarts, median, addDays, diffDays } = require('../src/prediction')

const day = (date, flow, bbt) => (bbt === undefined ? { date, flow } : { date, flow, bbt })
const at = (today) => ({ today })

test('no history: not known, defaults to follicular', () => {
  const p = projectionFromRows([], [], at('2026-07-06'))
  assert.equal(p.known, false)
  assert.equal(p.phase, 'follicular')
  assert.equal(p.dayOfCycle, null)
  assert.equal(p.confidence, 'none')
})

test('infers a period start from a bleeding run and predicts the next period', () => {
  const days = [day('2026-07-01', 'medium'), day('2026-07-02', 'medium'), day('2026-07-03', 'light')]
  const p = projectionFromRows(days, [], at('2026-07-06'))
  assert.equal(p.known, true)
  assert.equal(p.dayOfCycle, 6)
  assert.equal(p.nextPeriodStart, addDays('2026-07-01', 28)) // one start -> default 28
  assert.equal(p.ovulationEst, addDays(p.nextPeriodStart, -14))
  assert.equal(diffDays(p.fertileStart, p.ovulationEst), 5)
  assert.equal(diffDays(p.ovulationEst, p.fertileEnd), 1)
  assert.equal(p.confidence, 'low') // single start, defaults used
})

test('uses the MEDIAN of recent cycle lengths (robust to one irregular cycle)', () => {
  // Gaps 28, 28, 40 -> median 28, not the mean the 40-day gap would drag up.
  const starts = [{ start: '2026-01-01' }, { start: '2026-01-29' }, { start: '2026-02-26' }, { start: '2026-04-07' }]
  const p = projectionFromRows([], starts, at('2026-04-10'))
  assert.equal(p.cycleLen, 28)
})

test('honors a user cycle-length pref when there is no gap history', () => {
  const p = projectionFromRows([day('2026-07-01', 'heavy')], [], { today: '2026-07-03', prefs: { avgCycleLength: 31 } })
  assert.equal(p.cycleLen, 31)
  assert.equal(p.nextPeriodStart, addDays('2026-07-01', 31))
})

test('a user luteal-length pref moves the ovulation estimate', () => {
  const p = projectionFromRows([day('2026-07-01', 'medium')], [], { today: '2026-07-03', prefs: { lutealLength: 12 } })
  assert.equal(p.ovulationEst, addDays(p.nextPeriodStart, -12))
})

test('BBT sustained rise overrides the calendar ovulation estimate', () => {
  const days = [day('2026-07-01', 'medium')]
  for (const d of ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12']) days.push(day(d, null, 36.4))
  days.push(day('2026-07-13', null, 36.75), day('2026-07-14', null, 36.72), day('2026-07-15', null, 36.7))
  const p = projectionFromRows(days, [], at('2026-07-16'))
  assert.equal(p.ovulationSource, 'bbt')
  assert.equal(p.ovulationEst, '2026-07-12') // day before the first sustained shift
  assert.equal(p.confidence, 'high')
})

test('flow today reads as the menstrual phase', () => {
  const p = projectionFromRows([day('2026-07-06', 'medium')], [], at('2026-07-06'))
  assert.equal(p.phase, 'menstrual')
})

test('regular history without BBT still reads high confidence', () => {
  const starts = [{ start: '2026-04-01' }, { start: '2026-04-29' }, { start: '2026-05-27' }, { start: '2026-06-24' }]
  const p = projectionFromRows([], starts, at('2026-06-30'))
  assert.equal(p.confidence, 'high') // >=3 tight cycles
})

test('spotting alone does not start a period', () => {
  const p = projectionFromRows([day('2026-07-06', 'spotting')], [], at('2026-07-06'))
  assert.equal(p.known, false)
})

test('helpers: median and cycleStarts', () => {
  assert.equal(median([28, 30, 26]), 28)
  assert.equal(median([28, 30]), 29)
  const starts = cycleStarts([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-02', flow: 'light' }], [{ start: '2026-06-01' }])
  assert.deepEqual(starts, ['2026-06-01', '2026-07-01'])
})

test('pregnancy: inactive unless goal is pregnant with dates', () => {
  assert.equal(pregnancyProjection({}, '2026-07-08').active, false)
  assert.equal(pregnancyProjection({ goal: 'pregnant' }, '2026-07-08').active, false) // no dates
  assert.equal(pregnancyProjection({ goal: 'track', pregnancy: { lmp: '2026-01-01' } }, '2026-07-08').active, false)
})

test('pregnancy: weeks/days, trimester, due date derived from LMP', () => {
  // LMP 2026-01-01, today +100 days -> 14 weeks 2 days, trimester 2.
  const p = pregnancyProjection({ goal: 'pregnant', pregnancy: { lmp: '2026-01-01' } }, addDays('2026-01-01', 100))
  assert.equal(p.active, true)
  assert.equal(p.gestDays, 100)
  assert.equal(p.weeks, 14)
  assert.equal(p.days, 2)
  assert.equal(p.trimester, 2)
  assert.equal(p.dueDate, addDays('2026-01-01', 280)) // 40 weeks from LMP
  assert.equal(p.daysUntilDue, 180)
})

test('pregnancy: dueDate-only derives the LMP and progress clamps', () => {
  const due = '2026-10-08'
  const p = pregnancyProjection({ goal: 'pregnant', pregnancy: { dueDate: due } }, due)
  assert.equal(p.active, true)
  assert.equal(p.lmp, addDays(due, -280))
  assert.equal(p.daysUntilDue, 0)
  assert.equal(p.weeks, 40)
  assert.equal(p.progress, 1) // at/after term, clamped
})
