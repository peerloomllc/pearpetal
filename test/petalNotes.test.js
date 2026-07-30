const test = require('node:test')
const assert = require('node:assert/strict')
const { noteFor, noteForPhase, poolFor, NOTES, SPECIES, TONES, PHASES } = require('../src/petalNotes')
const { FLOWER_KEYS } = require('../src/ui/flowers')
const { addDays } = require('../src/prediction')

// Same fixture shape as the notifications tests: today = 2026-07-10, the next
// period is 2026-08-01, so the current cycle runs 2026-07-04 -> 2026-07-31.
const basePred = (over = {}) => ({
  known: true, confidence: 'medium', cycleLen: 28, periodLen: 5, birthControl: false,
  nextPeriodStart: '2026-08-01', ovulationEst: '2026-07-18',
  fertileStart: '2026-07-13', fertileEnd: '2026-07-19',
  ...over,
})

test('corpus is well formed: every entry a non-empty [title, body]', () => {
  const entries = []
  for (const tone of TONES) for (const phase of PHASES) entries.push(...NOTES[tone][phase])
  for (const flower of Object.keys(SPECIES)) for (const phase of PHASES) entries.push(SPECIES[flower][phase])
  assert.ok(entries.length >= 8 * TONES.length * PHASES.length)
  for (const e of entries) {
    assert.equal(e.length, 2)
    const [title, body] = e
    assert.ok(typeof title === 'string' && title.length > 0 && title.length <= 40, `bad title: ${title}`)
    assert.ok(typeof body === 'string' && body.length > 0 && body.length <= 160, `bad body: ${body}`)
  }
})

test('every tone has all four phases, with at least 8 lines each', () => {
  for (const tone of TONES) {
    for (const phase of PHASES) {
      assert.ok(Array.isArray(NOTES[tone][phase]), `${tone}/${phase} missing`)
      assert.ok(NOTES[tone][phase].length >= 8, `${tone}/${phase} too thin`)
    }
  }
})

test('every flower in the picker has a voice in every phase', () => {
  for (const key of FLOWER_KEYS) {
    assert.ok(SPECIES[key], `no species lines for ${key}`)
    for (const phase of PHASES) assert.ok(SPECIES[key][phase], `${key}/${phase} missing`)
  }
})

test('the species line joins the pool; an unknown flower just uses the base pool', () => {
  assert.equal(poolFor('menstrual', 'playful', 'rose').length, NOTES.playful.menstrual.length + 1)
  assert.deepEqual(poolFor('menstrual', 'playful', 'rose').at(-1), SPECIES.rose.menstrual)
  assert.equal(poolFor('menstrual', 'playful', 'nope').length, NOTES.playful.menstrual.length)
})

test('deterministic: the same date always renders the same note', () => {
  const opts = { tone: 'playful', flower: 'lotus' }
  const a = noteFor(basePred(), '2026-07-15', opts)
  const b = noteFor(basePred(), '2026-07-15', opts)
  assert.deepEqual(a, b)
})

test('consecutive days never repeat a line', () => {
  for (const tone of TONES) {
    for (const flower of FLOWER_KEYS) {
      let prev = null
      let date = '2026-07-01'
      for (let i = 0; i < 60; i++, date = addDays(date, 1)) {
        const n = noteForPhase('luteal', date, { tone, flower })
        if (prev) assert.notEqual(n.title, prev.title, `repeat on ${date} (${tone}/${flower})`)
        prev = n
      }
    }
  }
})

test('different flowers see a different order (the pick is salted per flower + tone)', () => {
  const titles = new Set(FLOWER_KEYS.map((f) => noteForPhase('luteal', '2026-07-25', { tone: 'playful', flower: f }).title))
  assert.ok(titles.size > 1)
  const rose = noteForPhase('luteal', '2026-07-25', { tone: 'playful', flower: 'rose' })
  const gentleRose = noteForPhase('luteal', '2026-07-25', { tone: 'gentle', flower: 'rose' })
  assert.ok(NOTES.gentle.luteal.some(([t]) => t === gentleRose.title) || SPECIES.rose.luteal[0] === gentleRose.title)
  assert.ok(NOTES.playful.luteal.some(([t]) => t === rose.title) || SPECIES.rose.luteal[0] === rose.title)
})

test('an unknown tone falls back to playful, an unknown phase to follicular', () => {
  assert.deepEqual(noteForPhase('luteal', '2026-07-25', { tone: 'sarcastic', flower: 'rose' }),
    noteForPhase('luteal', '2026-07-25', { tone: 'playful', flower: 'rose' }))
  assert.deepEqual(noteForPhase('nonsense', '2026-07-25', { tone: 'playful', flower: 'rose' }),
    noteForPhase('follicular', '2026-07-25', { tone: 'playful', flower: 'rose' }))
})

test('phase tracks the projection across the cycle', () => {
  const p = basePred()
  const at = (d) => noteFor(p, d, { tone: 'playful', flower: 'rose' }).phase
  assert.equal(at('2026-07-05'), 'menstrual')  // day 2 of the current cycle
  assert.equal(at('2026-07-11'), 'follicular') // after the period, before fertile
  assert.equal(at('2026-07-18'), 'fertile')    // predicted ovulation day
  assert.equal(at('2026-07-25'), 'luteal')     // after ovulation, before the next period
  assert.equal(at('2026-08-02'), 'menstrual')  // day 2 of the NEXT cycle
  assert.equal(at('2026-08-15'), 'fertile')    // next cycle's window, one length on
})

test('fertile framing is softened, not faked, on birth control and on a low-confidence guess', () => {
  const opts = { tone: 'playful', flower: 'rose' }
  assert.equal(noteFor(basePred({ birthControl: true }), '2026-07-18', opts).phase, 'luteal')
  assert.equal(noteFor(basePred({ birthControl: true }), '2026-07-14', opts).phase, 'follicular')
  assert.equal(noteFor(basePred({ confidence: 'low' }), '2026-07-14', opts).phase, 'follicular')
  // ...and the softened note really does come from the fallback pool.
  const soft = noteFor(basePred({ confidence: 'low' }), '2026-07-14', opts)
  assert.ok(NOTES.playful.follicular.some(([t]) => t === soft.title) || SPECIES.rose.follicular[0] === soft.title)
})

test('no projection -> no note', () => {
  assert.equal(noteFor({ known: false }, '2026-07-15', {}), null)
  assert.equal(noteFor(null, '2026-07-15', {}), null)
  assert.equal(noteFor(basePred({ nextPeriodStart: null }), '2026-07-15', {}), null)
})
