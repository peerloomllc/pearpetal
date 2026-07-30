const test = require('node:test')
const assert = require('node:assert/strict')
const { planImport, collapse, isManual, MAX_SAMPLES } = require('../src/healthImport')

const TODAY = '2026-07-30'
const plan = (existing, samples, over = {}) =>
  planImport(existing, samples, { source: 'healthkit', today: TODAY, ...over })

test('fills gaps: an empty log takes everything the platform offers', () => {
  const r = plan({}, [
    { date: '2026-07-10', bbt: 36.4 },
    { date: '2026-07-11', flow: 'medium' },
  ])
  assert.equal(r.added, 2)
  assert.equal(r.updated, 0)
  assert.equal(r.keptManual, 0)
  assert.deepEqual(r.writes, [
    { date: '2026-07-10', patch: { bbt: 36.4 }, sources: { bbt: 'healthkit' } },
    { date: '2026-07-11', patch: { flow: 'medium' }, sources: { flow: 'healthkit' } },
  ])
})

test('never overwrites what the user typed, per FIELD not per row', () => {
  // The user typed the flow on this day; the BBT slot is empty.
  const existing = { '2026-07-10': { date: '2026-07-10', flow: 'heavy' } }
  const r = plan(existing, [{ date: '2026-07-10', flow: 'light', bbt: 36.5 }])
  assert.equal(r.keptManual, 1)          // the flow was left alone
  assert.equal(r.added, 1)               // the BBT filled the gap
  assert.deepEqual(r.writes, [
    { date: '2026-07-10', patch: { bbt: 36.5 }, sources: { bbt: 'healthkit' } },
  ])
})

test('a value a previous import wrote CAN be refreshed', () => {
  const existing = { '2026-07-10': { date: '2026-07-10', bbt: 36.4, sources: { bbt: 'healthkit' } } }
  const r = plan(existing, [{ date: '2026-07-10', bbt: 36.6 }])
  assert.equal(r.updated, 1)
  assert.equal(r.keptManual, 0)
  assert.deepEqual(r.writes[0].patch, { bbt: 36.6 })
})

test('re-importing the same data is a no-op, so it cannot pile up', () => {
  const existing = { '2026-07-10': { date: '2026-07-10', bbt: 36.4, sources: { bbt: 'healthkit' } } }
  const r = plan(existing, [{ date: '2026-07-10', bbt: 36.4 }])
  assert.deepEqual(r.writes, [])
  assert.equal(r.unchanged, 1)
  assert.equal(r.added + r.updated, 0)
})

test('a manual value is still manual after an import touched another field', () => {
  const row = { date: '2026-07-10', flow: 'heavy', bbt: 36.4, sources: { bbt: 'healthkit' } }
  assert.equal(isManual(row, 'flow'), true)   // typed
  assert.equal(isManual(row, 'bbt'), false)   // imported
  assert.equal(isManual(row, 'notes'), false) // absent
})

test('implausible temperatures are dropped, not written', () => {
  // 98.6 is Fahrenheit; 310 is Kelvin. Either would wreck the 0.2 degree
  // BBT ovulation shift if it landed in the log.
  const r = plan({}, [
    { date: '2026-07-10', bbt: 98.6 },
    { date: '2026-07-11', bbt: 310 },
    { date: '2026-07-12', bbt: 36.5 },
  ])
  assert.equal(r.invalid, 2)
  assert.equal(r.writes.length, 1)
  assert.equal(r.writes[0].date, '2026-07-12')
})

test('an unknown flow value is refused', () => {
  const r = plan({}, [{ date: '2026-07-10', flow: 'torrential' }])
  assert.equal(r.invalid, 1)
  assert.deepEqual(r.writes, [])
})

test('bad and future dates are refused', () => {
  const r = plan({}, [
    { date: 'not-a-date', bbt: 36.4 },
    { date: '2026-07-32', bbt: 36.4 },
    { date: '2026-08-01', bbt: 36.4 }, // after TODAY
    { date: '2026-07-29', bbt: 36.4 },
  ])
  assert.equal(r.invalid, 2)
  assert.equal(r.future, 1)
  assert.equal(r.writes.length, 1)
})

test('the first reading of a day wins (a basal temp is the waking one)', () => {
  const r = plan({}, [
    { date: '2026-07-10', bbt: 36.4 }, // on waking
    { date: '2026-07-10', bbt: 37.1 }, // later, after moving about
  ])
  assert.equal(r.writes.length, 1)
  assert.equal(r.writes[0].patch.bbt, 36.4)
})

test('temperatures are rounded to two decimals', () => {
  const r = plan({}, [{ date: '2026-07-10', bbt: 36.44999999 }])
  assert.equal(r.writes[0].patch.bbt, 36.45)
})

test('an oversized import is capped and the overflow is reported, never silent', () => {
  const many = Array.from({ length: MAX_SAMPLES + 25 }, (_, i) => ({ date: '2026-07-10', bbt: 36.4 + (i % 5) / 100 }))
  const r = plan({}, many)
  assert.equal(r.overflow, 25)
})

test('the source is recorded per field and carried through', () => {
  const r = planImport({}, [{ date: '2026-07-10', bbt: 36.4 }], { source: 'healthconnect', today: TODAY })
  assert.equal(r.source, 'healthconnect')
  assert.deepEqual(r.writes[0].sources, { bbt: 'healthconnect' })
})

test('nothing to import is not an error', () => {
  for (const input of [[], null, undefined]) {
    const r = plan({}, input)
    assert.deepEqual(r.writes, [])
    assert.equal(r.added, 0)
  }
})

test('collapse keys strictly by date, so a range cannot produce duplicate days', () => {
  const { byDate } = collapse([
    { date: '2026-07-10', bbt: 36.4 },
    { date: '2026-07-10', flow: 'light' },
    { date: '2026-07-11', bbt: 36.5 },
  ], TODAY)
  assert.equal(byDate.size, 2)
  assert.deepEqual(byDate.get('2026-07-10'), { bbt: 36.4, flow: 'light' })
})
