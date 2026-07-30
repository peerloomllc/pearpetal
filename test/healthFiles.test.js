const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseHealthFile, parseAppleHealth, parseCsv, detectFormat,
  toCelsius, localDayFrom, normaliseFlow, csvColumns, splitCsvLine, detectDelimiter,
} = require('../src/healthFiles')
const { planImport } = require('../src/healthImport')

// --- units and dates --------------------------------------------------------

test('temperatures: an explicit unit is obeyed', () => {
  assert.equal(toCelsius(36.5, 'degC'), 36.5)
  assert.ok(Math.abs(toCelsius(97.7, 'degF') - 36.5) < 0.01)
})

test('temperatures: with no unit, the RANGE decides', () => {
  // A basal temperature is never ~98 in Celsius, and never ~36 in Fahrenheit.
  assert.ok(Math.abs(toCelsius(97.7, '') - 36.5) < 0.01)
  assert.equal(toCelsius(36.5, ''), 36.5)
  assert.equal(toCelsius('not a number', 'degC'), null)
})

test('dates: ISO, US-style and Apple stamps all give the local day', () => {
  assert.equal(localDayFrom('2026-07-12 07:03:00 -0500'), '2026-07-12') // Apple
  assert.equal(localDayFrom('2026-07-12T07:03:00Z'), '2026-07-12')
  assert.equal(localDayFrom('7/12/2026 07:03'), '2026-07-12')          // US CSV
  assert.equal(localDayFrom('rubbish'), null)
  assert.equal(localDayFrom(undefined), null)
})

test('flow words from any source land on the four values PearPetal knows', () => {
  assert.equal(normaliseFlow('Heavy'), 'heavy')
  assert.equal(normaliseFlow('moderate'), 'medium')
  assert.equal(normaliseFlow('2'), 'medium')     // numeric exports
  assert.equal(normaliseFlow('spotting'), 'spotting')
  assert.equal(normaliseFlow('torrential'), null)
  assert.equal(normaliseFlow(''), null)
})

// --- Apple Health -----------------------------------------------------------

const APPLE = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_GB">
 <Record type="HKQuantityTypeIdentifierStepCount" startDate="2026-07-12 09:00:00 +0100" value="812"/>
 <Record type="HKQuantityTypeIdentifierBasalBodyTemperature" unit="degC" creationDate="2026-07-13 08:00:00 +0100" startDate="2026-07-12 07:03:00 +0100" value="36.42"/>
 <Record type="HKCategoryTypeIdentifierMenstrualFlow" startDate="2026-07-01 00:00:00 +0100" value="HKCategoryValueMenstrualFlowMedium"/>
 <Record type="HKCategoryTypeIdentifierMenstrualFlow" startDate="2026-07-03 00:00:00 +0100" value="HKCategoryValueMenstrualFlowNone"/>
 <Record type="HKCategoryTypeIdentifierMenstrualFlow" startDate="2026-07-04 00:00:00 +0100" value="HKCategoryValueMenstrualFlowUnspecified"/>
</HealthData>`

test('apple: reads only the two types we import, ignoring everything else', () => {
  const s = parseAppleHealth(APPLE)
  assert.equal(s.length, 3) // one temperature, two real bleeding days - steps ignored
  assert.deepEqual(s.find((x) => x.bbt), { date: '2026-07-12', bbt: 36.42, at: '2026-07-12 07:03:00 +0100' })
})

test('apple: startDate wins over creationDate, so a late entry lands on the right day', () => {
  // The reading was taken on the 12th and written into Health on the 13th.
  const s = parseAppleHealth(APPLE).find((x) => x.bbt)
  assert.equal(s.date, '2026-07-12')
})

test('apple: "no flow" is NOT a bleeding day, "unspecified" is', () => {
  const flows = parseAppleHealth(APPLE).filter((x) => x.flow)
  assert.deepEqual(flows.map((f) => f.date), ['2026-07-01', '2026-07-04'])
  assert.equal(flows.find((f) => f.date === '2026-07-04').flow, 'medium')
})

test('apple: a Fahrenheit export is converted', () => {
  const xml = '<Record type="HKQuantityTypeIdentifierBasalBodyTemperature" unit="degF" startDate="2026-07-12 07:00:00 -0500" value="97.7"/>'
  const s = parseAppleHealth(xml)
  assert.ok(Math.abs(s[0].bbt - 36.5) < 0.01)
})

// --- CSV --------------------------------------------------------------------

test('csv: headers are matched by name, commas or semicolons', () => {
  const csv = 'Date,Basal body temperature,Flow\n2026-07-12,36.4,Light\n2026-07-13,36.5,\n'
  const s = parseCsv(csv)
  assert.equal(s.length, 3)
  assert.deepEqual(s.filter((x) => x.flow).map((x) => x.flow), ['light'])
  const euro = 'Datum;Temperature;Flow\n2026-07-12;36,4;Heavy\n'.replace('36,4', '36.4')
  assert.equal(detectDelimiter('Datum;Temperature;Flow'), ';')
  assert.equal(parseCsv(euro).length, 2)
})

test('csv: quoted fields and embedded commas survive', () => {
  assert.deepEqual(splitCsvLine('a,"b,c",d', ','), ['a', 'b,c', 'd'])
  assert.deepEqual(splitCsvLine('a,"say ""hi""",b', ','), ['a', 'say "hi"', 'b'])
})

test('csv: a unit column is honoured per row', () => {
  const csv = 'date,temp,unit\n2026-07-12,97.7,F\n2026-07-13,36.5,C\n'
  const s = parseCsv(csv)
  assert.ok(Math.abs(s[0].bbt - 36.5) < 0.01)
  assert.equal(s[1].bbt, 36.5)
})

test('csv: a file with no usable columns yields nothing rather than guessing', () => {
  assert.deepEqual(parseCsv('name,steps\nTim,900\n'), [])
})

test('csv: columns can be overridden when a header is ambiguous', () => {
  const csv = 'when,a,b\n2026-07-12,36.4,heavy\n'
  const s = parseCsv(csv, { columns: { date: 0, bbt: 1, flow: 2 } })
  assert.equal(s.length, 2)
  assert.equal(csvColumns(['when', 'a', 'b'], { date: 0, bbt: 1 }).date, 0)
})

// --- format detection + the whole pipe --------------------------------------

test('the format is sniffed from CONTENT, not the file name', () => {
  assert.equal(detectFormat(APPLE), 'apple-health')
  assert.equal(detectFormat('date,flow\n2026-07-12,light\n'), 'csv')
  assert.equal(detectFormat('{"app":"pearpetal","version":1}'), 'pearpetal-backup')
  assert.equal(detectFormat('hello'), null)
})

test('parseHealthFile sorts ascending, so the waking temperature wins downstream', () => {
  const csv = 'date,temp\n2026-07-12 09:00,37.1\n2026-07-12 07:00,36.4\n'
  const { samples } = parseHealthFile(csv)
  assert.equal(samples[0].bbt, 36.4)
  // ...and healthImport's first-wins rule then keeps it.
  const plan = planImport({}, samples, { source: 'file', today: '2026-07-30' })
  assert.equal(plan.writes[0].patch.bbt, 36.4)
})

test('an unreadable file is empty, not an exception', () => {
  for (const input of ['', 'not a health export', null, undefined]) {
    const r = parseHealthFile(input)
    assert.deepEqual(r.samples, [])
  }
})

test('end to end: an Apple export merges into an empty log', () => {
  const { samples, format } = parseHealthFile(APPLE)
  assert.equal(format, 'apple-health')
  const plan = planImport({}, samples, { source: 'file', today: '2026-07-30' })
  assert.equal(plan.added, 3)
  assert.equal(plan.writes.length, 3)
  assert.deepEqual(plan.writes.find((w) => w.date === '2026-07-12').sources, { bbt: 'file' })
})

test('end to end: a re-import of the same file changes nothing', () => {
  const { samples } = parseHealthFile(APPLE)
  const existing = {}
  for (const w of planImport({}, samples, { source: 'file', today: '2026-07-30' }).writes) {
    existing[w.date] = { date: w.date, ...w.patch, sources: w.sources }
  }
  const second = planImport(existing, samples, { source: 'file', today: '2026-07-30' })
  assert.deepEqual(second.writes, [])
  assert.equal(second.unchanged, 3)
})

test('end to end: a file never overwrites what the user typed', () => {
  const { samples } = parseHealthFile(APPLE)
  const existing = { '2026-07-01': { date: '2026-07-01', flow: 'heavy' } } // typed by hand
  const plan = planImport(existing, samples, { source: 'file', today: '2026-07-30' })
  assert.equal(plan.keptManual, 1)
  assert.ok(!plan.writes.some((w) => w.date === '2026-07-01'))
})
