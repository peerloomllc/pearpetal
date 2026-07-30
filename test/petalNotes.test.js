const test = require('node:test')
const assert = require('node:assert/strict')
const { noteFor, noteForBucket, bucketForSlot, bucketDaysFor, poolFor, NOTES, SPECIES, TONES, BUCKETS } = require('../src/petalNotes')
const { FLOWER_KEYS } = require('../src/ui/flowers')
const { addDays, cycleSlotOn } = require('../src/prediction')

// Same fixture shape as the notifications tests: today = 2026-07-10, the next
// period is 2026-08-01, so the current cycle runs 2026-07-04 -> 2026-07-31.
const basePred = (over = {}) => ({
  known: true, confidence: 'medium', cycleLen: 28, periodLen: 5, birthControl: false,
  nextPeriodStart: '2026-08-01', ovulationEst: '2026-07-18',
  fertileStart: '2026-07-13', fertileEnd: '2026-07-19',
  ...over,
})

// How many days of a cycle each bucket really covers, measured off the fixture.
// The pool has to outlast two cycles of that, or a line comes back too soon.
const DAYS_PER_CYCLE = bucketDaysFor(basePred())

test('corpus is well formed: every entry a non-empty [title, body]', () => {
  const entries = []
  for (const tone of TONES) for (const bucket of BUCKETS) entries.push(...NOTES[tone][bucket])
  for (const flower of Object.keys(SPECIES)) for (const bucket of BUCKETS) entries.push(SPECIES[flower][bucket])
  assert.ok(entries.length >= 150, `corpus is ${entries.length} lines, expected 150+`)
  for (const e of entries) {
    assert.equal(e.length, 2)
    const [title, body] = e
    assert.ok(typeof title === 'string' && title.length > 0 && title.length <= 40, `bad title: ${title}`)
    assert.ok(typeof body === 'string' && body.length > 0 && body.length <= 160, `bad body: ${body}`)
  }
})

test('no line is used twice anywhere in the corpus', () => {
  const seen = new Map()
  const add = (where, [title, body]) => {
    const key = `${title}|${body}`
    assert.ok(!seen.has(key), `duplicate line in ${where} and ${seen.get(key)}: ${title}`)
    seen.set(key, where)
  }
  for (const tone of TONES) for (const bucket of BUCKETS) for (const e of NOTES[tone][bucket]) add(`${tone}/${bucket}`, e)
  for (const flower of Object.keys(SPECIES)) for (const bucket of BUCKETS) add(`${flower}/${bucket}`, SPECIES[flower][bucket])
})

test('titles are unique within everything one user can see (their tone + their flower)', () => {
  // Two different lines sharing a title read as a repeat even when the body
  // differs, so the constraint is per tone-and-flower, not per bucket.
  for (const tone of TONES) {
    for (const flower of Object.keys(SPECIES)) {
      const seen = new Map()
      const add = (where, title) => {
        assert.ok(!seen.has(title), `${tone}/${flower}: "${title}" in ${where} and ${seen.get(title)}`)
        seen.set(title, where)
      }
      for (const bucket of BUCKETS) {
        for (const [title] of NOTES[tone][bucket]) add(`${tone}/${bucket}`, title)
        add(`${flower}/${bucket}`, SPECIES[flower][bucket][0])
      }
    }
  }
})

test('every bucket is sized to outlast two cycles of its own phase', () => {
  for (const tone of TONES) {
    for (const bucket of BUCKETS) {
      assert.ok(Array.isArray(NOTES[tone][bucket]), `${tone}/${bucket} missing`)
      // +1 for the species line every user gets, since a flower is always set.
      const pool = NOTES[tone][bucket].length + 1
      const need = DAYS_PER_CYCLE[bucket] * 2
      assert.ok(pool >= need, `${tone}/${bucket}: pool ${pool} < ${need} (${DAYS_PER_CYCLE[bucket]} days/cycle x 2)`)
    }
  }
})

test('every flower in the picker has a voice in every bucket', () => {
  for (const key of FLOWER_KEYS) {
    assert.ok(SPECIES[key], `no species lines for ${key}`)
    for (const bucket of BUCKETS) assert.ok(SPECIES[key][bucket], `${key}/${bucket} missing`)
  }
})

test('the species line joins the pool; an unknown flower just uses the base pool', () => {
  assert.equal(poolFor('menstrual-early', 'playful', 'rose').length, NOTES.playful['menstrual-early'].length + 1)
  assert.deepEqual(poolFor('menstrual-early', 'playful', 'rose').at(-1), SPECIES.rose['menstrual-early'])
  assert.equal(poolFor('menstrual-early', 'playful', 'nope').length, NOTES.playful['menstrual-early'].length)
})

test('deterministic: the same date always renders the same note', () => {
  const opts = { tone: 'playful', flower: 'lotus' }
  assert.deepEqual(noteFor(basePred(), '2026-07-15', opts), noteFor(basePred(), '2026-07-15', opts))
})

test('consecutive days never repeat a line', () => {
  for (const tone of TONES) {
    for (const flower of FLOWER_KEYS) {
      let prev = null
      let date = '2026-07-01'
      for (let i = 0; i < 90; i++, date = addDays(date, 1)) {
        const n = noteFor(basePred(), date, { tone, flower })
        if (prev) assert.notEqual(n.title, prev.title, `repeat on ${date} (${tone}/${flower})`)
        prev = n
      }
    }
  }
})

test('no line comes back inside eight weeks', () => {
  // Walk 56 days of every tone + flower combination and assert nothing repeats.
  for (const tone of TONES) {
    for (const flower of FLOWER_KEYS) {
      const seen = new Map()
      let date = '2026-07-04' // day 1 of the fixture's current cycle
      for (let i = 0; i < 56; i++, date = addDays(date, 1)) {
        const n = noteFor(basePred(), date, { tone, flower })
        assert.ok(!seen.has(n.title), `${tone}/${flower}: "${n.title}" repeats on ${date}, first seen ${seen.get(n.title)}`)
        seen.set(n.title, date)
      }
    }
  }
})

test('the pick rotates per cycle, so the same cycle day is not the same line every month', () => {
  const pred = basePred()
  const opts = { tone: 'playful', flower: 'rose' }
  // Day 1 of three consecutive cycles.
  const titles = ['2026-07-04', '2026-08-01', '2026-08-29'].map((d) => noteFor(pred, d, opts).title)
  assert.equal(new Set(titles).size, 3, `same-cycle-day lines repeat: ${titles.join(', ')}`)
})

test('different flowers see a different order (the pick is salted per flower + tone)', () => {
  const titles = new Set(FLOWER_KEYS.map((f) => noteForBucket('luteal-early', '2026-07-25', { tone: 'playful', flower: f }).title))
  assert.ok(titles.size > 1)
})

test('an unknown tone falls back to playful, an unknown bucket to follicular', () => {
  assert.deepEqual(noteForBucket('luteal-late', '2026-07-25', { tone: 'sarcastic', flower: 'rose' }),
    noteForBucket('luteal-late', '2026-07-25', { tone: 'playful', flower: 'rose' }))
  assert.deepEqual(noteForBucket('nonsense', '2026-07-25', { tone: 'playful', flower: 'rose' }),
    noteForBucket('follicular', '2026-07-25', { tone: 'playful', flower: 'rose' }))
})

test('buckets track the projection across the cycle', () => {
  const p = basePred()
  const at = (d) => noteFor(p, d, { tone: 'playful', flower: 'rose' }).bucket
  assert.equal(at('2026-07-04'), 'menstrual-early') // day 1
  assert.equal(at('2026-07-06'), 'menstrual-late')  // day 3, still bleeding
  assert.equal(at('2026-07-11'), 'follicular')      // after the period, before fertile
  assert.equal(at('2026-07-13'), 'fertile-rise')    // window opens, 5 days out from ovulation
  assert.equal(at('2026-07-18'), 'fertile-peak')    // predicted ovulation day
  assert.equal(at('2026-07-22'), 'luteal-early')    // just after the window closes
  assert.equal(at('2026-07-29'), 'luteal-late')     // the last few days before the next period
  assert.equal(at('2026-08-02'), 'menstrual-early') // day 2 of the NEXT cycle
  assert.equal(at('2026-08-15'), 'fertile-peak')    // next cycle's ovulation, one length on
})

test('every bucket is actually reachable from a real projection', () => {
  const pred = basePred()
  const seen = new Set()
  let date = '2026-07-04'
  for (let i = 0; i < 28; i++, date = addDays(date, 1)) seen.add(bucketForSlot(cycleSlotOn(pred, date)))
  assert.deepEqual([...seen].sort(), [...BUCKETS].sort())
})

test('fertile framing is softened, not faked, on birth control and on a low-confidence guess', () => {
  const opts = { tone: 'playful', flower: 'rose' }
  assert.equal(noteFor(basePred({ birthControl: true }), '2026-07-18', opts).bucket, 'luteal-early')
  assert.equal(noteFor(basePred({ birthControl: true }), '2026-07-14', opts).bucket, 'follicular')
  assert.equal(noteFor(basePred({ confidence: 'low' }), '2026-07-14', opts).bucket, 'follicular')
  // ...and the softened note really does come from the fallback pool.
  const soft = noteFor(basePred({ confidence: 'low' }), '2026-07-14', opts)
  assert.ok(NOTES.playful.follicular.some(([t]) => t === soft.title) || SPECIES.rose.follicular[0] === soft.title)
})

test('no projection -> no note', () => {
  assert.equal(noteFor({ known: false }, '2026-07-15', {}), null)
  assert.equal(noteFor(null, '2026-07-15', {}), null)
  assert.equal(noteFor(basePred({ nextPeriodStart: null }), '2026-07-15', {}), null)
})

// --- a logged flow day wins over the projection ------------------------------
// The dial calls a day menstrual whenever flow is logged on it, so the note must
// too. Found on the emulator 2026-07-30: a bleed running past the predicted
// period length had the dial reading "Menstrual - day 11" against a follicular
// note.

test('a logged flow day always speaks from a menstrual pool, whatever the projection says', () => {
  const p = basePred()
  const opts = { tone: 'playful', flower: 'rose' }
  // 2026-07-14 projects as fertile-rise; logging flow on it must override that.
  assert.equal(noteFor(p, '2026-07-14', opts).bucket, 'fertile-rise')
  const flowDays = new Set(['2026-07-13', '2026-07-14'])
  const forced = noteFor(p, '2026-07-14', { ...opts, flowDays })
  assert.equal(forced.bucket, 'menstrual-early') // day 2 of the run, still the early voice
  assert.ok(NOTES.playful['menstrual-early'].some(([t]) => t === forced.title) ||
    SPECIES.rose['menstrual-early'][0] === forced.title)
})

test('the early/late split follows the logged RUN, not the day of cycle', () => {
  const p = basePred()
  const opts = { tone: 'playful', flower: 'rose' }
  // A bleed that starts mid-cycle: first two days early, the rest late.
  const run = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23']
  const flowDays = new Set(run)
  const buckets = run.map((d) => noteFor(p, d, { ...opts, flowDays }).bucket)
  assert.deepEqual(buckets, ['menstrual-early', 'menstrual-early', 'menstrual-late', 'menstrual-late'])
})

test('a long bleed past the predicted period length no longer contradicts the dial', () => {
  // The emulator case: period start 2026-07-20 logged medium every day to 07-30,
  // so the dial says menstrual on day 11 while the projection says otherwise.
  const p = basePred({ nextPeriodStart: '2026-08-17', ovulationEst: '2026-08-03', fertileStart: '2026-07-29', fertileEnd: '2026-08-04', confidence: 'low' })
  const flowDays = new Set(Array.from({ length: 11 }, (_, i) => addDays('2026-07-20', i)))
  const bare = noteFor(p, '2026-07-30', { tone: 'playful', flower: 'rose' })
  const withLog = noteFor(p, '2026-07-30', { tone: 'playful', flower: 'rose', flowDays })
  assert.notEqual(bare.bucket, 'menstrual-late')       // what shipped, and disagreed
  assert.equal(withLog.bucket, 'menstrual-late')       // now agrees with the dial
})

test('flow days never repeat a line on consecutive days either', () => {
  const p = basePred()
  const flowDays = new Set(Array.from({ length: 12 }, (_, i) => addDays('2026-07-04', i)))
  let prev = null
  let date = '2026-07-04'
  for (let i = 0; i < 12; i++, date = addDays(date, 1)) {
    const n = noteFor(p, date, { tone: 'playful', flower: 'rose', flowDays })
    if (prev) assert.notEqual(n.title, prev.title, `repeat on ${date}`)
    prev = n
  }
})
