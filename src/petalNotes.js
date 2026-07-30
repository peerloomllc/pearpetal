// PearPetal daily flower note - the once-a-day garden-voice line that rides the
// existing local-notification path. PURE: a corpus plus a deterministic pick, so
// it unit-tests without a base, a clock, or the OS scheduler.
//
// Design: proposals/2026-07-30-daily-flower-note.md.
//   - Two tones the user picks between: `playful` (dry, witty, snack-positive) and
//     `gentle` (almanac voice, seasonal observation, no punchline).
//   - Four phase pools, plus one line per phase in each flower species' own voice,
//     so the flower picked for the dial also shows up in the writing.
//   - Deterministic pick keyed on the day number, so the same date always renders
//     the same note across the many reschedules the shell does, and consecutive
//     days can never draw the same line.
//   - Goal-neutral by construction: the lines are about energy, weather and snacks,
//     never about conceiving or avoiding, so every goal can read the same line.

const { isoToDays, diffDays, phaseOnDate } = require('./prediction')

// --- the corpus -------------------------------------------------------------
// Each entry is [title, body]. Titles stay short enough for a lock screen and
// evocative rather than explicit - "Petals furled" tells a passing stranger
// nothing. (Discreet mode replaces both anyway.)
const NOTES = {
  playful: {
    menstrual: [
      ['Petals furled', 'The garden is closed for maintenance. Roots still working. You are allowed to be a root today.'],
      ['Compost season', 'Everything last month did not need is going back into the soil. Rude, necessary, oddly satisfying.'],
      ['Under the mulch', 'Nothing above ground is happening, and that is the correct amount of happening.'],
      ['Rain day', 'Forecast: hot water bottle, with a chance of not answering messages.'],
      ['Dormant, not dead', 'Bulbs look like onions in a drawer for months. Then they show off. Take the drawer week.'],
      ['Low light', 'Ferns grow in the shade on purpose. Dim the lights and get on with it.'],
      ['Roots first', 'Nothing blooms while it is busy holding on. This week is the holding on.'],
      ['Greenhouse weather', 'Warm, damp and slightly dramatic. Snacks are a horticultural necessity.'],
    ],
    follicular: [
      ['First shoots', 'Something green is happening. This is the week you buy seeds for a garden you do not have.'],
      ['Sap rising', 'Energy is arriving faster than plans for it. Start the thing.'],
      ['Seed catalogue brain', 'Every idea looks achievable today. Write them down before the frost of Thursday.'],
      ['Spring cleaning', 'Sudden urge to reorganise a cupboard? Botanically on schedule.'],
      ['New growth', 'The garden is ambitious this week. Let it be. Prune later.'],
      ['Buds forming', 'Say yes to something. You will have the energy for it. Probably.'],
      ['Longer days', 'More light, more you. Spend some of it on something that is actually fun.'],
      ['Good soil', 'Planting week. A hard conversation or a gym membership both count.'],
    ],
    fertile: [
      ['Full bloom', 'You are, botanically speaking, showing off. The bees have noticed. So has your 10am.'],
      ['Peak petal', 'Open, bright and slightly ridiculous about it. Enjoy the week.'],
      ['Pollinators inbound', 'Everything about you is doing a bit more today. That is the design.'],
      ['Wide open', 'Confidence is up. Patience may not be. Use the first, budget the second.'],
      ['Bloom watch', 'This is the photo the garden magazine wants. Take up the space.'],
      ['Warm front', 'Skin, mood and opinions all a little warmer this week.'],
      ['Showtime', 'Flowers do not apologise for being loud. Neither should you.'],
      ['High summer', 'Big energy, short attention span. Do the fun thing first.'],
    ],
    luteal: [
      ['Late light', 'The bloom is softening. Batten down: snacks, blanket, low expectations of small talk.'],
      ['Harvest mood', 'Cravings inbound. A whole loaf is technically a harvest.'],
      ['Petals dropping', 'Patience is a seasonal crop and it is out of season. Be kind to yourself, and to your inbox.'],
      ['Golden hour', 'Slower, warmer and done with nonsense. An excellent combination, actually.'],
      ['Windfall', 'Everything feels a bit much this week. Eat the fruit off the ground and go to bed early.'],
      ['Turning leaves', 'Energy is drawing back in. Cancel one thing. No explanation needed.'],
      ['Nesting', 'Sudden need to make the room nice? Perfectly normal for this part of the year.'],
      ['Autumn edge', 'Cooler mood, sharper opinions. The garden is entitled.'],
    ],
  },
  gentle: {
    menstrual: [
      ['Petals furled', 'A quiet turn of the season. Rest is part of the growing, not a pause in it.'],
      ['The soil rests', 'Fields lie fallow so the next season has something to give. So do you.'],
      ['Still water', 'Nothing is asked of a garden in the rain. Let today be small.'],
      ['Deep roots', 'The work happening now is underground and unseen. It still counts.'],
      ['Winter light', 'Short days and soft edges. Warmth and a slower pace are enough for today.'],
      ['Fallow', 'The ground is not empty. It is gathering.'],
      ['A closed bloom', 'Closed is a shape a flower is allowed to be.'],
      ['Quiet weather', 'Be gentle with the garden today, and with the gardener.'],
    ],
    follicular: [
      ['First shoots', 'New growth is starting. Nothing needs to be rushed to be real.'],
      ['Lengthening light', 'The days are opening. So is your energy, a little at a time.'],
      ['Buds', 'Something is forming. It does not have to be finished to be worth tending.'],
      ['Fresh soil', 'A good week for beginnings, small ones included.'],
      ['Rising sap', 'Steadier energy is returning. Spend a little of it on yourself.'],
      ['Early spring', 'Green at the edges. Enjoy the slow build.'],
      ['Tending', 'A good day for small care: water, light and a little attention.'],
      ['Unfolding', 'One leaf at a time is still growth.'],
    ],
    fertile: [
      ['Full bloom', 'The garden is at its brightest. Let yourself be seen a little.'],
      ['Open petals', 'Energy and warmth are high. A good time for the things you care about.'],
      ['Midsummer', 'Long light and easy growth. Enjoy it without needing to earn it.'],
      ['In flower', 'This is the open part of the cycle. Take what you like from it.'],
      ['Sunlit', 'A brighter, more social stretch. Or not. It is your garden.'],
      ['Peak season', 'Everything is a little more alive today, including you.'],
      ['Warm days', 'Steady warmth. A good week to say the thing out loud.'],
      ['Blooming', 'Nothing to do here but let it happen.'],
    ],
    luteal: [
      ['Late light', 'The bloom is easing. A slower pace is the right pace now.'],
      ['Turning season', 'Energy is drawing inward. Let the list get shorter.'],
      ['Harvest', 'Take stock gently. You do not have to finish everything this month.'],
      ['Softening', 'Warm food, early nights and fewer plans. All good gardening.'],
      ['Falling leaves', 'Letting things go is part of the season, not a failure of it.'],
      ['Cooler air', 'If everything feels closer to the surface today, that is the weather, not you.'],
      ['Drawing in', 'A good day to protect your own quiet.'],
      ['Late season', 'The garden is allowed to be tired.'],
    ],
  },
}

// One line per phase in each species' own voice, mixed into the pool above so the
// flower on the dial also shows up in the writing. Keys match src/ui/flowers.js.
const SPECIES = {
  rose: {
    menstrual: ['The rose keeps its thorns', 'Closed, guarded and still the best thing in the garden. No notes.'],
    follicular: ['The rose is budding', 'Layer by layer, in its own time. Roses have never once been rushed.'],
    fertile: ['The rose is open', 'Every petal at once. Subtlety is for other flowers.'],
    luteal: ['The rose sheds', 'Petals fall and the plant is fine. Keep the thorns.'],
  },
  sakura: {
    menstrual: ['The blossom rests', 'Bare branches for now. Everyone still knows what is coming.'],
    follicular: ['Buds on the branch', 'Cherry blossom does nothing slowly except this part.'],
    fertile: ['Blossom, all at once', 'Five days of glory and a whole country stops to look. Take your five days.'],
    luteal: ['Petal fall', 'Falling blossom is the famous part, not the sad part.'],
  },
  lotus: {
    menstrual: ['The lotus is under water', 'It grows out of mud. This week is the mud. Still a lotus.'],
    follicular: ['Rising through', 'The lotus takes its time getting to the surface and never apologises for the trip.'],
    fertile: ['The lotus opens', 'Clean, wide open, and it came from a pond. Remember that on a hard day.'],
    luteal: ['Closing for evening', 'The lotus shuts at dusk and opens again. Nothing is being lost here.'],
  },
  poppy: {
    menstrual: ['The poppy is a seed head', 'Loud in summer, quiet now and full of next year.'],
    follicular: ['Poppies coming up', 'They grow in disturbed ground, the messier the better. Good week for a fresh start.'],
    fertile: ['Poppy red', 'The loudest colour in the field, and no explanation offered.'],
    luteal: ['Papery petals', 'Poppies drop fast and seed everywhere. Fair trade.'],
  },
  dahlia: {
    menstrual: ['The dahlia is a tuber', 'A lumpy thing in a shed holding all of the ruffles. Rest is the storage phase.'],
    follicular: ['Dahlia shoots', 'It puts out leaves for weeks before a single flower. The build is the point.'],
    fertile: ['Dahlia, fully ruffled', 'Absurd numbers of petals, zero restraint. Learn from it.'],
    luteal: ['Last of the dahlias', "The garden's late show. Slower, and still the best thing there."],
  },
}

const TONES = ['playful', 'gentle']
const DEFAULT_TONE = 'playful'
const PHASES = ['menstrual', 'follicular', 'fertile', 'luteal']

// Small stable string hash (FNV-1a, 32-bit). Only used to give each
// flower + tone combination its own starting offset into a pool.
function hash (s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// The candidate lines for a phase: the tone's pool plus the species line.
function poolFor (phase, tone, flower) {
  const t = TONES.includes(tone) ? tone : DEFAULT_TONE
  const p = PHASES.includes(phase) ? phase : 'follicular'
  const base = NOTES[t][p]
  const sp = SPECIES[flower] && SPECIES[flower][p]
  return sp ? [...base, sp] : [...base]
}

// The note for one date. `phase` is the phase ON THAT DATE (see phaseOnDate), not
// today's. Deterministic: keyed on the day number so the pick is stable across
// reschedules, and stepping one day always steps one entry, so consecutive days
// never repeat.
function noteForPhase (phase, dateIso, opts = {}) {
  const tone = TONES.includes(opts.tone) ? opts.tone : DEFAULT_TONE
  const flower = opts.flower || ''
  const pool = poolFor(phase, tone, flower)
  const idx = (((isoToDays(dateIso) + hash(`${flower}:${tone}`)) % pool.length) + pool.length) % pool.length
  const [title, body] = pool[idx]
  return { title, body }
}

// The note for one date given a projection. Softens the fertile framing rather
// than faking it: on hormonal birth control (where the fertile framing does not
// apply, matching the dial and summary) or at `low` confidence (where the fertile
// window is the least trustworthy part of a guess), a fertile day reads from the
// follicular or luteal pool instead. Returns null when there is nothing honest
// to say.
function noteFor (pred, dateIso, opts = {}) {
  if (!pred || !pred.known) return null
  let phase = phaseOnDate(pred, dateIso)
  if (!phase) return null
  if (phase === 'fertile' && (pred.birthControl || pred.confidence === 'low')) {
    phase = (pred.ovulationEst && diffDays(dateIso, pred.ovulationEst) > 0) ? 'follicular' : 'luteal'
  }
  return { ...noteForPhase(phase, dateIso, opts), phase }
}

module.exports = { noteFor, noteForPhase, poolFor, hash, NOTES, SPECIES, TONES, DEFAULT_TONE, PHASES }
