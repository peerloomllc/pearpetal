// Correcting the period log.
//
// Before this, a period logged on the wrong date was permanent: nothing in the UI
// called period:getAll or period:set, and no delete existed at any layer. Every
// period start feeds cycleStarts() and the cycle-length median, so one mistyped
// date skewed every future prediction with no way back short of reinstalling.
//
// Deleting the span row alone is not enough, and that is the subtle part:
// cycleStarts() infers a start from a run of BLEEDING DAYS as well as from a
// period row, and period:log stamps a medium flow across the span. So a delete
// that left the days behind would change nothing the user can see.

const test = require('node:test')
const { before } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')
const { _setDeviceLinkEnabledForTest } = require('../src/deviceLink')

before(() => _setDeviceLinkEnabledForTest(false))

const _tmpDirs = []
function driver () {
  const responses = []
  const read = new EventEmitter()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-ph-'))
  _tmpDirs.push(dir)
  const engine = createGroupEngine({
    appId: 'pearpetal',
    corestore: new Corestore(dir),
    createSwarm: () => {
      const ee = new EventEmitter()
      ee.join = () => ({ flushed: async () => {} }); ee.leave = () => {}; ee.destroy = async () => {}
      return ee
    },
    applyOps: applyPetalOp,
    methods: petalMethods,
  })
  engine.start({ read, write: (buf) => responses.push(JSON.parse(buf.toString())) })
  let nextId = 1
  const call = async (method, args) => {
    const id = nextId++
    read.emit('data', Buffer.from(JSON.stringify({ id, method, args }) + '\n'))
    for (let i = 0; i < 400; i++) {
      const r = responses.find((x) => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise((res) => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call }
}
function cleanup () { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } }

// Two clean 28-day cycles, plus one logged on a date that never happened.
const GOOD_A = '2026-05-01'
const GOOD_B = '2026-05-29'
const TYPO = '2026-05-18'  // gaps become 17 and 11; 17 is inside the 15..60 band the code trusts

async function seed (call) {
  await call('init', {})
  await call('cycle:create', {})
  for (const s of [GOOD_A, GOOD_B]) await call('period:log', { start: s, end: null, today: '2026-07-01' })
  return call
}

test('a logged period can be listed, which nothing could do before', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  const list = await A.call('period:getAll', {})
  assert.deepEqual(list.map((p) => p.start).sort(), [GOOD_A, GOOD_B])
})

test('deleting a period removes the cycle start it anchored, days and all', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  await A.call('period:log', { start: TYPO, end: null, today: '2026-07-01' })

  // The typo is anchoring a cycle, so the median gap is no longer 28. It reads 21
  // rather than 17, because projectionFromRows floors the cycle length at 21.
  const skewed = await A.call('cycle:prediction', {})
  assert.notEqual(skewed.cycleLen, 28, 'the typo skewed the cycle length')

  const del = await A.call('period:delete', { start: TYPO })
  assert.equal(del.ok, true)
  assert.ok(del.cleared > 0, 'the flow it stamped was cleared too')

  const list = await A.call('period:getAll', {})
  assert.deepEqual(list.map((p) => p.start).sort(), [GOOD_A, GOOD_B], 'the typo is gone from the list')

  // The real assertion: the prediction recovers. Clearing only the span row would
  // leave the bleeding days behind, and cycleStarts() would infer the same start.
  const fixed = await A.call('cycle:prediction', {})
  assert.equal(fixed.cycleLen, 28, 'the cycle length is back to what the real periods say')
})

test('deleting keeps the symptoms, notes and BBT of those days, only the bleeding goes', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  await A.call('period:log', { start: TYPO, end: null, today: '2026-07-01' })
  await A.call('day:set', { date: TYPO, symptoms: ['headache'], notes: 'long day', bbt: 36.5 })

  await A.call('period:delete', { start: TYPO })
  const day = await A.call('day:get', { date: TYPO })
  assert.equal(day.flow, null, 'the bleeding is retracted')
  assert.deepEqual(day.symptoms, ['headache'], 'the symptoms still happened')
  assert.equal(day.notes, 'long day')
  assert.equal(day.bbt, 36.5)
})

test('keepDays leaves the log untouched', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  await A.call('period:log', { start: TYPO, end: null, today: '2026-07-01' })
  const del = await A.call('period:delete', { start: TYPO, keepDays: true })
  assert.equal(del.cleared, 0)
  assert.equal((await A.call('day:get', { date: TYPO })).flow, 'medium')
})

test('moving a period to its right date leaves only one of it', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  const WRONG = '2026-06-26'
  const RIGHT = '2026-06-23'
  await A.call('period:log', { start: WRONG, end: null, today: '2026-07-01' })
  await A.call('period:log', { start: RIGHT, end: null, from: WRONG, today: '2026-07-01' })

  const list = await A.call('period:getAll', {})
  assert.deepEqual(list.map((p) => p.start).sort(), [GOOD_A, GOOD_B, RIGHT], 'the old date did not survive as a second row')

  // The corrected span runs 23rd to 27th, so the 26th is still a bleeding day and
  // should be: what matters is that it is no longer the FIRST one, which is what
  // cycleStarts() reads as a cycle start.
  assert.equal((await A.call('day:get', { date: RIGHT })).flow, 'medium', 'the corrected start bleeds')
  const beforeOldStart = await A.call('day:get', { date: '2026-06-25' })
  assert.equal(beforeOldStart.flow, 'medium', 'and so does the day before the old start')

  // The tail of the old span, past where the corrected one reaches, is retracted.
  const tail = await A.call('day:get', { date: '2026-06-30' })
  assert.ok(!tail || tail.flow == null, 'the old span no longer bleeds past the corrected one')
})

test('deleting a period that is not there says so rather than pretending', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  await assert.rejects(() => A.call('period:delete', { start: '2026-01-01' }), /period not found/)
  await assert.rejects(() => A.call('period:delete', { start: 'nonsense' }), /YYYY-MM-DD/)
})

test('a cycle start worked out from logged days is listed, not hidden', async (t) => {
  // The screen said "no periods logged yet" on a phone with a full log and a live
  // prediction behind it, because a start inferred from bleeding days has no period
  // row. Caught by driving the TCL rather than by reading the code.
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await A.call('init', {})
  await A.call('cycle:create', {})
  // Logged the way the calendar logs: day by day, no period sheet.
  for (const d of ['2026-06-01', '2026-06-02', '2026-06-03']) await A.call('day:set', { date: d, flow: 'medium' })

  assert.equal((await A.call('period:getAll', {})).length, 1, 'the inferred start is listed')
  const [row] = await A.call('period:getAll', {})
  assert.equal(row.start, '2026-06-01')
  assert.equal(row.end, '2026-06-03', 'the span follows the run of bleeding days')
  assert.notEqual(row.end, null, 'an inferred run always has an end; a null one means ONGOING')
  assert.equal(row.inferred, true, 'and is flagged as worked out rather than entered')
})

test('removing an inferred start clears the whole run, not just its first day', async (t) => {
  // Clearing only the first day would promote the second to being the start, so
  // the cycle would still be anchored and nothing would look fixed.
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await A.call('init', {})
  await A.call('cycle:create', {})
  for (const d of ['2026-06-01', '2026-06-02', '2026-06-03']) await A.call('day:set', { date: d, flow: 'medium', symptoms: ['cramps'] })

  const del = await A.call('period:delete', { start: '2026-06-01' })
  assert.equal(del.ok, true)
  assert.equal(del.cleared, 3, 'all three days stopped bleeding')
  assert.deepEqual(await A.call('period:getAll', {}), [], 'no start is left anchoring the cycle')
  // The rest of what was logged on those days is untouched.
  assert.deepEqual((await A.call('day:get', { date: '2026-06-02' })).symptoms, ['cramps'])
})

test('an explicit period and the days it stamped are listed once, not twice', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await A.call('init', {})
  await A.call('cycle:create', {})
  await A.call('period:log', { start: '2026-06-01', end: '2026-06-04', today: '2026-07-01' })
  const rows = await A.call('period:getAll', {})
  assert.equal(rows.length, 1, 'the row and the days it stamped are the same period')
  assert.equal(rows[0].inferred, false)
})

test('a single logged bleeding day is one day, not an ongoing period', async (t) => {
  // It rendered as "Jul 16 - ongoing" on the TCL: the inferred row used a null end
  // for a one-day run, and a null end is what an explicit row uses to mean ongoing.
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await A.call('init', {})
  await A.call('cycle:create', {})
  await A.call('day:set', { date: '2026-06-10', flow: 'light' })
  const [row] = await A.call('period:getAll', {})
  assert.equal(row.start, '2026-06-10')
  assert.equal(row.end, '2026-06-10', 'one day, with an end, not an open span')
  assert.equal(row.inferred, true)
})
