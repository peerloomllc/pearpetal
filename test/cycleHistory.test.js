// The cycles the log actually contains.
//
// The point of this method is that it CANNOT disagree with the dial: it derives
// its cycles from cycleStarts() and averages them with the same 15..60 day filter
// and the same median that projectionFromRows uses. A history screen saying
// "usually 31 days" beside a dial predicting from 28 would be worse than no
// screen at all, so that agreement is what these tests pin down.

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-ch-'))
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

// Four starts: 28, 30 and 27 days apart, then the cycle she is in now.
const STARTS = ['2026-04-01', '2026-04-29', '2026-05-29', '2026-06-25']

async function seed (call, starts = STARTS) {
  await call('init', {})
  await call('cycle:create', {})
  for (const s of starts) await call('period:log', { start: s, end: null, today: '2026-07-10' })
}

test('an empty log has no cycles and claims no averages', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await A.call('init', {})
  await A.call('cycle:create', {})
  const h = await A.call('cycle:history', {})
  assert.deepEqual(h.cycles, [])
  assert.equal(h.stats.medianLength, null, 'no invented average from nothing')
  assert.equal(h.stats.regular, false)
})

test('cycles are listed newest first, with the current one open-ended', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  const { cycles } = await A.call('cycle:history', {})
  assert.deepEqual(cycles.map((c) => c.start), [...STARTS].reverse())
  assert.equal(cycles[0].current, true, 'the newest is the one she is in')
  assert.equal(cycles[0].length, null, 'and has no length yet')
  assert.deepEqual(cycles.slice(1).map((c) => c.length), [27, 30, 28])
})

test('the averages match what the dial predicts from', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  const { stats } = await A.call('cycle:history', {})
  const pred = await A.call('cycle:prediction', {})
  assert.equal(stats.medianLength, 28)
  assert.equal(stats.shortest, 27)
  assert.equal(stats.longest, 30)
  assert.equal(stats.variation, 3)
  assert.equal(stats.regular, true, '3 cycles varying by 3 days is regular')
  // The claim this whole method exists to keep true.
  assert.equal(stats.medianLength, pred.cycleLen, 'the screen and the dial agree')
})

test('a logging slip is left out of the average, exactly as the dial leaves it out', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  // A stray start three days after a real one: a 3-day "cycle" nobody has.
  await seed(A.call, ['2026-04-01', '2026-04-04', '2026-05-02'])
  const { cycles, stats } = await A.call('cycle:history', {})
  const pred = await A.call('cycle:prediction', {})
  assert.equal(cycles.length, 3, 'it is still SHOWN, so she can see and fix it')
  assert.equal(stats.usable, 1, 'but only the plausible gap is averaged')
  assert.equal(stats.medianLength, 28)
  assert.equal(stats.medianLength, pred.cycleLen, 'still agrees with the dial')
})

test('period length comes from the explicit end when there is one', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await A.call('init', {})
  await A.call('cycle:create', {})
  await A.call('period:log', { start: '2026-05-01', end: '2026-05-05', today: '2026-06-01' })
  const { cycles, stats } = await A.call('cycle:history', {})
  assert.equal(cycles[0].periodLength, 5)
  assert.equal(stats.medianPeriodLength, 5)
})

test('period length falls back to the run of bleeding days', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await A.call('init', {})
  await A.call('cycle:create', {})
  for (const d of ['2026-05-01', '2026-05-02', '2026-05-03']) await A.call('day:set', { date: d, flow: 'medium' })
  const { cycles } = await A.call('cycle:history', {})
  assert.equal(cycles[0].periodLength, 3, 'three logged days, no period row anywhere')
})

test('two cycles is not enough to call anyone regular', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call, ['2026-05-01', '2026-05-29'])
  const { stats } = await A.call('cycle:history', {})
  assert.equal(stats.usable, 1)
  assert.equal(stats.regular, false, 'one gap says nothing about regularity')
  assert.equal(stats.variation, null)
})

test('a long cycle: the screen reports hers, and says what the dial predicts from', async (t) => {
  // The case the "averages match" test above MISSED, because 28 sits inside the
  // clamp. projectionFromRows caps the cycle length to 21..45 before predicting,
  // so a 57-day median made the summary row read "Usually 45 days" beside a
  // history screen reading 57 - the two surfaces disagreeing about her own
  // cycles, which is the one thing this method exists to prevent. Both numbers
  // are true; they mean different things, and the screen now says so.
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call, ['2026-04-01', '2026-05-28']) // 57 days apart
  const { stats } = await A.call('cycle:history', {})
  const pred = await A.call('cycle:prediction', {})

  assert.equal(stats.medianLength, 57, 'her cycles really did run that long')
  assert.equal(stats.predictsFrom, 45, 'the dial will not project further than 45')
  assert.equal(stats.predictsFrom, pred.cycleLen, 'and predictsFrom is exactly what the dial uses')
  assert.notEqual(stats.medianLength, stats.predictsFrom, 'so the screen has to explain the difference')
})

test('a very short cycle is clamped the other way', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call, ['2026-04-01', '2026-04-17']) // 16 days apart: usable, under the floor
  const { stats } = await A.call('cycle:history', {})
  const pred = await A.call('cycle:prediction', {})
  assert.equal(stats.medianLength, 16)
  assert.equal(stats.predictsFrom, 21, 'floored at 21')
  assert.equal(stats.predictsFrom, pred.cycleLen)
})

test('predictsFrom equals the median whenever it is in range, so no note is shown', async (t) => {
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seed(A.call)
  const { stats } = await A.call('cycle:history', {})
  assert.equal(stats.medianLength, 28)
  assert.equal(stats.predictsFrom, 28, 'identical, so the screen stays quiet about clamping')
})
