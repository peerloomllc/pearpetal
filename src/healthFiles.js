// PearPetal health-export parsers - turn a file the user exported from some other
// health app into the same `{ date, flow?, bbt? }` samples src/healthImport.js
// already knows how to merge. PURE: text in, samples out, so every format tests
// without a device, a picker, or a permission.
//
// WHY FILES ARE THE PRIMARY PATH (DECISIONS.md 2026-07-30): Health Connect's
// permission is not askable to a sideloaded build, and PearPetal ships on Zapstore
// and as a GitHub APK to people deliberately avoiding Google. A file the user
// chose needs no permission, no vendor, and no network, so it works on every store
// and every ROM and cannot be switched off by someone else's policy.
//
// The merge rules are NOT here. Everything about what may overwrite what lives in
// healthImport.js and is shared with every source.

const { FLOW_VALUES } = require('./prediction')

// Apple writes Fahrenheit or Celsius depending on the user's locale, and CSV
// exports frequently do not say at all. Anything that looks like a body
// temperature in Fahrenheit is converted; healthImport then rejects whatever still
// lands outside its 30-45 C plausibility range.
const F_MIN = 90
const F_MAX = 110

function toCelsius (value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const u = String(unit || '').toLowerCase()
  if (u.includes('f')) return (n - 32) * 5 / 9
  if (u.includes('c')) return n
  // No unit given: infer from the range rather than assuming a default. A basal
  // temperature is never ~98 in Celsius, and never ~36 in Fahrenheit.
  if (n >= F_MIN && n <= F_MAX) return (n - 32) * 5 / 9
  return n
}

// Both formats hand over a timestamp; we want the LOCAL calendar day it belongs
// to, because that is what the user means by "the morning of the 12th" and what
// the app's own date-picked rows already use. Apple stamps its own UTC offset in
// the string, so the leading date is already local to where the reading was taken.
function localDayFrom (stamp) {
  if (typeof stamp !== 'string') return null
  const iso = stamp.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const slash = stamp.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/) // US-style CSV
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`
  return null
}

// Normalise whatever a source calls a flow level onto PearPetal's four values.
// Numbers appear in Health Connect exports (1/2/3) and some CSVs.
const FLOW_WORDS = {
  light: 'light', mild: 'light', low: 'light', '1': 'light',
  medium: 'medium', moderate: 'medium', normal: 'medium', '2': 'medium',
  heavy: 'heavy', high: 'heavy', '3': 'heavy',
  spotting: 'spotting', spot: 'spotting', trace: 'spotting',
}
function normaliseFlow (raw) {
  if (raw === null || raw === undefined) return null
  const k = String(raw).trim().toLowerCase()
  if (!k) return null
  if (FLOW_VALUES.has(k)) return k
  return FLOW_WORDS[k] || null
}

// --- Apple Health -----------------------------------------------------------
// The Health app exports a zip whose export.xml is a flat list of <Record/> tags.
// It is routinely hundreds of megabytes, so this is deliberately LINE-ORIENTED
// attribute scraping rather than a real XML parse: it never builds a document
// tree, and it tolerates the caller having pre-filtered to the interesting lines.
const APPLE_BBT = 'HKQuantityTypeIdentifierBasalBodyTemperature'
const APPLE_FLOW_TYPE = 'HKCategoryTypeIdentifierMenstrualFlow'
const APPLE_FLOW_VALUES = {
  hkcategoryvaluemenstrualflowlight: 'light',
  hkcategoryvaluemenstrualflowmedium: 'medium',
  hkcategoryvaluemenstrualflowheavy: 'heavy',
  // "Unspecified" means a period WAS logged without an intensity, so it is a
  // bleeding day and medium is the honest middle. "None" means explicitly no
  // flow, which is not a bleeding day at all and must not become one.
  hkcategoryvaluemenstrualflowunspecified: 'medium',
  hkcategoryvaluemenstrualflownone: null,
}
const attrOf = (line, name) => {
  const m = line.match(new RegExp(name + '="([^"]*)"'))
  return m ? m[1] : null
}

function parseAppleHealth (xml) {
  const out = []
  if (typeof xml !== 'string') return out
  for (const line of xml.split('\n')) {
    if (line.indexOf('<Record') === -1) continue
    const type = attrOf(line, 'type')
    if (type !== APPLE_BBT && type !== APPLE_FLOW_TYPE) continue
    // startDate is when the reading was TAKEN; creationDate is when it was
    // written into Health, which can be days later.
    const at = attrOf(line, 'startDate') || attrOf(line, 'creationDate')
    const date = localDayFrom(at)
    if (!date) continue
    const value = attrOf(line, 'value')
    if (type === APPLE_BBT) {
      const c = toCelsius(value, attrOf(line, 'unit'))
      if (c !== null) out.push({ date, bbt: c, at })
    } else {
      const flow = APPLE_FLOW_VALUES[String(value || '').toLowerCase()]
      if (flow) out.push({ date, flow, at })
    }
  }
  return out
}

// --- generic CSV ------------------------------------------------------------
// Covers Samsung Health, Fitbit, Oura and anything else that exports a table.
// Columns are matched by header name, and the caller can override when a header
// is ambiguous - which is why `csvColumns` is exported for a mapping UI later.
const COLUMN_HINTS = {
  date: /^(date|day|start|start.?date|start.?time|timestamp|time)$/i,
  bbt: /(basal|bbt)|^(temp|temperature)(\s|_|-)?(c|f|celsius|fahrenheit)?$/i,
  flow: /(flow|menstrua|period|bleed)/i,
  unit: /^(unit|units)$/i,
}

// Split one CSV line, honouring double quotes. Deliberately small: health exports
// are machine-written tables, not arbitrary user prose.
function splitCsvLine (line, delim) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (ch === delim && !quoted) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

// European exports use semicolons. Pick whichever appears more in the header.
function detectDelimiter (headerLine) {
  const c = (headerLine.match(/,/g) || []).length
  const s = (headerLine.match(/;/g) || []).length
  const t = (headerLine.match(/\t/g) || []).length
  if (t > c && t > s) return '\t'
  return s > c ? ';' : ','
}

// Which column is which. Returns { date, bbt, flow, unit } as indexes or -1.
// `rows` (a few parsed data rows) lets the date column be found by CONTENT when
// the header does not match - health exports are localised, so a header may say
// "Datum" or "Fecha", and chasing translations is a losing game when the values
// themselves are unambiguous.
function csvColumns (headers, override = {}, rows = []) {
  const find = (key) => {
    if (Number.isInteger(override[key])) return override[key]
    return headers.findIndex((h) => COLUMN_HINTS[key].test(h))
  }
  const col = { date: find('date'), bbt: find('bbt'), flow: find('flow'), unit: find('unit') }
  if (col.date < 0 && rows.length) {
    const looksLikeDates = (i) => rows.filter((r) => localDayFrom(r[i])).length > rows.length / 2
    for (let i = 0; i < headers.length; i++) {
      if (i === col.bbt || i === col.flow || i === col.unit) continue
      if (looksLikeDates(i)) { col.date = i; break }
    }
  }
  return col
}

function parseCsv (text, opts = {}) {
  const out = []
  if (typeof text !== 'string') return out
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return out
  const delim = opts.delimiter || detectDelimiter(lines[0])
  const headers = splitCsvLine(lines[0], delim)
  const sample = lines.slice(1, 6).map((l) => splitCsvLine(l, delim))
  const col = csvColumns(headers, opts.columns, sample)
  if (col.date < 0 || (col.bbt < 0 && col.flow < 0)) return out // nothing usable

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim)
    const date = localDayFrom(cells[col.date])
    if (!date) continue
    const at = cells[col.date]
    if (col.bbt >= 0 && cells[col.bbt]) {
      const c = toCelsius(cells[col.bbt], col.unit >= 0 ? cells[col.unit] : opts.unit)
      if (c !== null) out.push({ date, bbt: c, at })
    }
    if (col.flow >= 0 && cells[col.flow]) {
      const flow = normaliseFlow(cells[col.flow])
      if (flow) out.push({ date, flow, at })
    }
  }
  return out
}

// --- entry point ------------------------------------------------------------
// Sniff the format from the content rather than the file name, because a picker
// on Android hands back a content:// URI whose name is often meaningless.
function detectFormat (text) {
  if (typeof text !== 'string') return null
  const head = text.slice(0, 4000)
  if (head.indexOf('<HealthData') !== -1 || head.indexOf('<Record') !== -1) return 'apple-health'
  if (head.indexOf('"app":"pearpetal"') !== -1 || head.indexOf('"app": "pearpetal"') !== -1) return 'pearpetal-backup'
  if (/[,;\t]/.test(head.split(/\r?\n/)[0] || '')) return 'csv'
  return null
}

// Parse whatever was handed over. Returns { format, samples } - never throws, so
// an unreadable file is a message to the user rather than a crash. Samples are
// sorted ascending by timestamp so healthImport's "first reading of a day wins"
// picks the waking temperature.
function parseHealthFile (text, opts = {}) {
  const format = opts.format || detectFormat(text)
  let samples = []
  if (format === 'apple-health') samples = parseAppleHealth(text)
  else if (format === 'csv') samples = parseCsv(text, opts)
  samples.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
  return { format, samples }
}

module.exports = {
  parseHealthFile, parseAppleHealth, parseCsv, detectFormat,
  toCelsius, localDayFrom, normaliseFlow, csvColumns, splitCsvLine, detectDelimiter,
  APPLE_BBT, APPLE_FLOW_TYPE, APPLE_FLOW_VALUES, F_MIN, F_MAX,
}
