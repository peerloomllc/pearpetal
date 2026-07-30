// PearPetal daily flower note - the once-a-day garden-voice line that rides the
// existing local-notification path. PURE: a corpus plus a deterministic pick, so
// it unit-tests without a base, a clock, or the OS scheduler.
//
// Design: proposals/2026-07-30-daily-flower-note.md.
//   - Two tones the user picks between: `playful` (dry, witty, snack-positive) and
//     `gentle` (almanac voice, seasonal observation, no punchline).
//   - Seven SUB-PHASE buckets, not four phases. Early and late luteal are
//     different weeks to live through, and so are day one and the tail of a
//     period, so they get their own lines. Each bucket is sized to how many days
//     of a cycle it actually covers (luteal-early is 7 days, follicular is ~3), so
//     nothing repeats inside two cycles - see the sizing table below.
//   - One line per bucket in each flower species' own voice, so the flower picked
//     for the dial also shows up in the writing.
//   - Deterministic pick keyed on the day number plus a per-cycle rotation, so the
//     same date always renders the same note across the many reschedules the shell
//     does, consecutive days can never draw the same line, AND a given day of the
//     cycle does not land on the same line every month.
//   - Goal-neutral by construction: the lines are about energy, weather and snacks,
//     never about conceiving or avoiding, so every goal can read the same line.
//
// Sizing (28-day cycle, 5-day period, 14-day luteal - the app's own defaults):
//   bucket          days/cycle   lines/tone   +species = pool   repeats after
//   menstrual-early      2            6              7            ~3.5 cycles
//   menstrual-late       3            6              7            ~2.3 cycles
//   follicular           4           10             11            ~2.7 cycles
//   fertile-rise         4            8              9            ~2.2 cycles
//   fertile-peak         3            6              7            ~2.3 cycles
//   luteal-early         6           14             15            ~2.5 cycles
//   luteal-late          6           12             13            ~2.2 cycles
// 159 lines in all: 62 per tone plus 7 per species. Nothing a user can see comes
// back inside eight weeks, which test/petalNotes.test.js asserts by walking 56
// days of every tone x flower combination. A cycle much longer than 28 days
// stretches the follicular and luteal stretches, so those repeat sooner; growing
// a pool is a pure-data change with no migration.

const { isoToDays, diffDays, addDays, cycleSlotOn } = require('./prediction')

// --- the corpus -------------------------------------------------------------
// Each entry is [title, body]. Titles stay short enough for a lock screen and
// evocative rather than explicit - "Petals furled" tells a passing stranger
// nothing. (Discreet mode replaces both anyway.)
const NOTES = {
  playful: {
    'menstrual-early': [
      ['Petals furled', 'The garden is closed for maintenance. Roots still working. You are allowed to be a root today.'],
      ['Day one', 'Everything last month did not need is going back into the soil. Rude, necessary, oddly satisfying.'],
      ['Rain day', 'Forecast: hot water bottle, with a chance of not answering messages.'],
      ['Cut back hard', 'Gardeners prune to the ground and call it kindness. Cancel something.'],
      ['Heavy weather', 'Low sky, wet ground, nothing to prove. The garden agrees.'],
      ['Ground level', 'Today is a horizontal day with snacks. That is the whole forecast.'],
    ],
    'menstrual-late': [
      ['Under the mulch', 'Nothing above ground is happening, and that is the correct amount of happening.'],
      ['Dormant, not dead', 'Bulbs look like onions in a drawer for months. Then they show off. Take the drawer week.'],
      ['Low light', 'Ferns grow in the shade on purpose. Dim the lights and get on with it.'],
      ['Clearing', 'The rain is easing off. Not sunshine yet. Definitely not a to-do list yet.'],
      ['Roots first', 'Nothing blooms while it is busy holding on. This is the holding on.'],
      ['Greenhouse weather', 'Warm, damp and slightly dramatic. Snacks are a horticultural necessity.'],
    ],
    follicular: [
      ['First shoots', 'Something green is happening. This is the week you buy seeds for a garden you do not have.'],
      ['Sap rising', 'Energy is arriving faster than plans for it. Start the thing.'],
      ['Seed catalogue brain', 'Every idea looks achievable today. Write them down before Thursday.'],
      ['Spring cleaning', 'Sudden urge to reorganise a cupboard? Botanically on schedule.'],
      ['Good soil', 'Planting week. A hard conversation or a gym membership both count.'],
      ['Longer days', 'More light, more you. Spend some of it on something that is actually fun.'],
      ['New growth', 'The garden is ambitious this week. Let it be. Prune later.'],
      ['Buds forming', 'Say yes to something. You will have the energy for it. Probably.'],
      ['Digging in', 'Turning the soil over is deeply satisfying and counts as a whole personality this week.'],
      ['Frost gone', 'Safe to plant the risky thing now.'],
    ],
    'fertile-rise': [
      ['Buds swelling', 'The garden is about to do the thing it has been threatening all month.'],
      ['Warm front', 'Skin, mood and opinions all a little warmer this week.'],
      ['Nearly', 'Tight green buds, obviously up to something. Same.'],
      ['Rising heat', 'Confidence up, patience possibly down. Use the first, budget the second.'],
      ['The bees are early', 'Everything about you is doing a bit more today. That is the design.'],
      ['Building', 'Say the thing while you have the nerve. It peaks around now.'],
      ['Green and loud', 'Growth you can practically hear. Do the fun thing first.'],
      ['On the turn', 'Big week incoming. Water accordingly - hydration is not a joke.'],
    ],
    'fertile-peak': [
      ['Full bloom', 'You are, botanically speaking, showing off. The bees have noticed. So has your 10am.'],
      ['Peak petal', 'Open, bright and slightly ridiculous about it. Enjoy it.'],
      ['Showtime', 'Flowers do not apologise for being loud. Neither should you.'],
      ['Wide open', 'This is the photo the garden magazine wants. Take up the space.'],
      ['High summer', 'Big energy, short attention span. Spend it on purpose.'],
      ['Everything at once', 'The whole plant, fully committed. No notes.'],
    ],
    'luteal-early': [
      ['Golden hour', 'Slower, warmer and done with nonsense. An excellent combination, actually.'],
      ['After the show', 'Petals still on, crowd gone home. A good week for finishing things.'],
      ['Late summer', 'The heat has gone out of it and the garden is quietly getting on with fruit.'],
      ['Nesting', 'Sudden need to make the room nice? Perfectly normal for this part of the year.'],
      ['Harvest mood', 'Cravings inbound. A whole loaf is technically a harvest.'],
      ['Steady growth', 'Nothing dramatic today. Compost turned, kettle on, fine.'],
      ['Turning leaves', 'Energy is drawing back in. Cancel one thing. No explanation needed.'],
      ['Fruiting', 'The showy part is over and the useful part has started. Underrated week.'],
      ['Warm ground', 'Still plenty in the tank, just less interested in performing for anyone.'],
      ['Tidy the beds', 'A satisfying week for small finished tasks. Lean into it.'],
      ['Windfall', 'Eat the fruit off the ground. That is what it is for.'],
      ['Shorter evenings', 'Bed earlier than you think is reasonable. It is reasonable.'],
      ['Second wind', 'Quieter energy, but it lasts longer. Spend it on something dull and important.'],
      ['Stocking up', 'Some part of you wants a full cupboard. Let it have one.'],
    ],
    'luteal-late': [
      ['Late light', 'The bloom is softening. Batten down: snacks, blanket, low expectations of small talk.'],
      ['Petals dropping', 'Patience is a seasonal crop and it is out of season. Be kind to yourself, and to your inbox.'],
      ['Autumn edge', 'Cooler mood, sharper opinions. The garden is entitled.'],
      ['First frost', 'Everything feels closer to the surface. Fewer plans, more blanket.'],
      ['Wind picking up', 'If somebody is annoying today, they may genuinely be annoying. Hard to say. Bed early.'],
      ['Bare branches soon', 'The garden is winding down and would like everyone to keep it down.'],
      ['Storm watch', 'Feelings arriving with weather. Let them land, then have toast.'],
      ['Leaf fall', 'Dropping things is the correct move now. Start with the optional ones.'],
      ['Low sun', 'Everything takes slightly more effort this week. That is the season, not a failing.'],
      ['Cold snap', 'Snappy is allowed. Apologising for the weather is not required.'],
      ['Battening down', 'Chocolate, blanket, an early night and no negotiating.'],
      ['End of season', 'Nearly the turn. Coast if you can, cancel if you cannot.'],
    ],
  },
  gentle: {
    'menstrual-early': [
      ['Petals furled', 'A quiet turn of the season. Rest is part of the growing, not a pause in it.'],
      ['Still water', 'Nothing is asked of a garden in the rain. Let today be small.'],
      ['Day one', 'A beginning that looks like an ending. Both are true.'],
      ['The soil rests', 'Fields lie fallow so the next season has something to give. So do you.'],
      ['Soft ground', 'Warmth, quiet and something to lean on. That is the whole list.'],
      ['Low sky', 'Be gentle with the garden today, and with the gardener.'],
    ],
    'menstrual-late': [
      ['Deep roots', 'The work happening now is underground and unseen. It still counts.'],
      ['Fallow', 'The ground is not empty. It is gathering.'],
      ['A closed bloom', 'Closed is a shape a flower is allowed to be.'],
      ['Winter light', 'Short days and soft edges. A slower pace is enough for today.'],
      ['After the rain', 'The ground is soft and everything is a little easier than yesterday.'],
      ['Quiet weather', 'Nothing needs deciding today. Let it keep.'],
    ],
    follicular: [
      ['First shoots', 'New growth is starting. Nothing needs to be rushed to be real.'],
      ['Lengthening light', 'The days are opening. So is your energy, a little at a time.'],
      ['Buds', 'Something is forming. It does not have to be finished to be worth tending.'],
      ['Fresh soil', 'A good week for beginnings, small ones included.'],
      ['Tending', 'A good day for small care: water, light and a little attention.'],
      ['Unfolding', 'One leaf at a time is still growth.'],
      ['Early spring', 'Green at the edges. Enjoy the slow build.'],
      ['Clear morning', 'A little more room today than yesterday. That is worth noticing.'],
      ['Room to grow', 'Nothing has to be decided at once. Growth is allowed to be gradual.'],
      ['Turning green', 'The hard part of the season is behind you for now.'],
    ],
    'fertile-rise': [
      ['Rising sap', 'Steadier energy is returning. Spend a little of it on yourself.'],
      ['Warm days', 'Steady warmth building. A good week to say the thing out loud.'],
      ['Almost open', 'Nearly. There is no prize for arriving early.'],
      ['Early summer', 'Light, warmth and room to move. Take what you like from it.'],
      ['Gathering light', 'Things feel a little more possible this week. That is real.'],
      ['Green season', 'Growth is easy right now. Let it be easy.'],
      ['Toward the sun', 'Leaning toward what you want is allowed. It is what plants do.'],
      ['Coming into flower', 'Whatever you have been building is nearly ready to be seen.'],
    ],
    'fertile-peak': [
      ['Full bloom', 'The garden is at its brightest. Let yourself be seen a little.'],
      ['Open petals', 'Energy and warmth are high. A good time for the things you care about.'],
      ['Midsummer', 'Long light and easy growth. Enjoy it without needing to earn it.'],
      ['In flower', 'This is the open part of the cycle. Take what you like from it.'],
      ['Peak season', 'Everything is a little more alive today, including you.'],
      ['Blooming', 'Nothing to do here but let it happen.'],
    ],
    'luteal-early': [
      ['Turning season', 'Energy is drawing inward. Let the list get shorter.'],
      ['Harvest', 'Take stock gently. You do not have to finish everything this month.'],
      ['Late summer', 'The showy part is over. The useful, quiet part is here.'],
      ['Fruiting', 'Quieter work, and the kind that lasts. Give it the week.'],
      ['Softening', 'Warm food, early nights and fewer plans. All good gardening.'],
      ['Steady light', 'Less brightness, more staying power. Both are worth having.'],
      ['Drawing in', 'A good day to protect your own quiet.'],
      ['Warm ground', 'The heat is still in the soil. There is more here than it looks.'],
      ['Gathering in', 'Bring things closer: people you like, food you like, an early night.'],
      ['Slower days', 'Nothing is behind schedule. The season simply changed.'],
      ['Settled weather', 'A calm stretch. Use it for something small and kind.'],
      ['Turning inward', 'Less to give outward this week, and that is not a deficit.'],
      ['Ripening', 'Some things only finish slowly. So do some weeks.'],
      ['Evening light', 'A good time to rest before you feel you have earned it.'],
    ],
    'luteal-late': [
      ['Late light', 'The bloom is easing. A slower pace is the right pace now.'],
      ['Falling leaves', 'Letting things go is part of the season, not a failure of it.'],
      ['Cooler air', 'If everything feels closer to the surface today, that is the weather, not you.'],
      ['Late season', 'The garden is allowed to be tired.'],
      ['Fewer leaves', 'Less to give, and nothing owed. Both can be true.'],
      ['First frost', 'Tender things need covering this week. You are one of them.'],
      ['Short days', 'Do less. It is not a compromise, it is the season.'],
      ['Wind in the trees', 'Feelings move faster this week. Let them pass through.'],
      ['Banking down', 'Warmth, quiet and an early night. Nothing more is required.'],
      ['Nearly the turn', 'Almost round again. Hold on gently. It passes.'],
      ['Grey light', 'A soft, low week. Ask for less of yourself.'],
      ['Resting soil', 'Whatever does not get done keeps until next month.'],
    ],
  },
}

// One line per bucket in each species' own voice, mixed into the pool above so the
// flower on the dial also shows up in the writing. Keys match src/ui/flowers.js.
const SPECIES = {
  rose: {
    'menstrual-early': ['The rose is cut back', 'Pruned hard, on purpose, by someone who knows what they are doing. It comes back bigger.'],
    'menstrual-late': ['The rose keeps its thorns', 'Closed, guarded and still the best thing in the garden. No notes.'],
    follicular: ['The rose is budding', 'Layer by layer, in its own time. Roses have never once been rushed.'],
    'fertile-rise': ['A tight rose bud', 'You can see the colour through the seams now.'],
    'fertile-peak': ['The rose is open', 'Every petal at once. Subtlety is for other flowers.'],
    'luteal-early': ['The rose in late season', 'Fewer flowers, deeper scent. A fair trade.'],
    'luteal-late': ['The rose sheds', 'Petals fall and the plant is fine. Keep the thorns.'],
  },
  sakura: {
    'menstrual-early': ['Bare branches', 'Nothing on the tree at all. Everyone still turns up in spring.'],
    'menstrual-late': ['The blossom rests', 'Quiet wood, doing its counting. It knows exactly when.'],
    follicular: ['Buds on the branch', 'Cherry blossom does nothing slowly except this part.'],
    'fertile-rise': ['Nearly open', 'The forecasters are arguing about the exact day. Ignore them.'],
    'fertile-peak': ['Blossom, all at once', 'Five days of glory and a whole country stops to look. Take your five days.'],
    'luteal-early': ['Green leaves after', 'The crowd has gone and the tree gets on with the year.'],
    'luteal-late': ['Petal fall', 'Falling blossom is the famous part, not the sad part.'],
  },
  lotus: {
    'menstrual-early': ['Down in the mud', 'It grows out of mud. This is the mud. Still a lotus.'],
    'menstrual-late': ['Under the surface', 'Nothing visible is happening, which is not the same as nothing.'],
    follicular: ['Rising through', 'The lotus takes its time getting to the surface and never apologises for the trip.'],
    'fertile-rise': ['Breaking the surface', 'Almost up. It has never once hurried the last stretch.'],
    'fertile-peak': ['The lotus opens', 'Clean, wide open, and it came from a pond. Remember that on a hard day.'],
    'luteal-early': ['Steady on the water', 'Open, unbothered and going nowhere. A good look.'],
    'luteal-late': ['Closing for evening', 'The lotus shuts at dusk and opens again. Nothing is being lost here.'],
  },
  poppy: {
    'menstrual-early': ['A poppy in the rain', 'Papery petals, heavy sky. It stays put, and so can you.'],
    'menstrual-late': ['The poppy is a seed head', 'Loud in summer, quiet now and full of next year.'],
    follicular: ['Poppies coming up', 'They grow in disturbed ground, the messier the better. Good week for a fresh start.'],
    'fertile-rise': ['A poppy bud, nodding', 'It hangs its head right up until it does not.'],
    'fertile-peak': ['Poppy red', 'The loudest colour in the field, and no explanation offered.'],
    'luteal-early': ['After the red', 'The field is quieter and full of seed. That was the point all along.'],
    'luteal-late': ['Papery petals', 'Poppies drop fast and seed everywhere. Fair trade.'],
  },
  dahlia: {
    'menstrual-early': ['The dahlia is a tuber', 'A lumpy thing in a shed holding all of the ruffles. Rest is the storage phase.'],
    'menstrual-late': ['In the dark shed', 'Nothing to look at. Everything still there.'],
    follicular: ['Dahlia shoots', 'It puts out leaves for weeks before a single flower. The build is the point.'],
    'fertile-rise': ['Buds like knuckles', 'Tight, green and clearly planning something.'],
    'fertile-peak': ['Dahlia, fully ruffled', 'Absurd numbers of petals, zero restraint. Learn from it.'],
    'luteal-early': ['Still flowering', 'Dahlias keep going long after the rest have packed up. Quietly impressive.'],
    'luteal-late': ['Last of the dahlias', "The garden's late show. Slower, and still the best thing there."],
  },
}

const TONES = ['playful', 'gentle']
const DEFAULT_TONE = 'playful'
const BUCKETS = ['menstrual-early', 'menstrual-late', 'follicular', 'fertile-rise', 'fertile-peak', 'luteal-early', 'luteal-late']
const DEFAULT_BUCKET = 'follicular'
// Nominal days per bucket at the app's default 28-day / 5-day-period /
// 14-day-luteal shape. Only a fallback: `bucketDaysFor` measures the real numbers
// off the user's own projection, because a long cycle stretches the follicular
// stretch far more than it stretches the rest.
const BUCKET_DAYS = {
  'menstrual-early': 2, 'menstrual-late': 3, follicular: 4,
  'fertile-rise': 4, 'fertile-peak': 3, 'luteal-early': 6, 'luteal-late': 6,
}
// A luteal phase is long enough to be two different weeks; the last stretch before
// a period is the one people feel. Split it here.
const LUTEAL_LATE_DAYS = 6
const MENSTRUAL_EARLY_DAYS = 2

// Small stable string hash (FNV-1a, 32-bit). Only used to give each
// flower + tone combination its own starting offset into a pool.
function hash (s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// Which sub-phase bucket a cycle slot (see prediction.cycleSlotOn) falls in.
function bucketForSlot (slot) {
  if (!slot) return null
  switch (slot.phase) {
    case 'menstrual': return slot.dayOfCycle <= MENSTRUAL_EARLY_DAYS ? 'menstrual-early' : 'menstrual-late'
    case 'fertile': return (slot.daysToOvulation != null && slot.daysToOvulation >= 2) ? 'fertile-rise' : 'fertile-peak'
    case 'luteal': return slot.daysToNextPeriod <= LUTEAL_LATE_DAYS ? 'luteal-late' : 'luteal-early'
    default: return 'follicular'
  }
}

// The candidate lines for a bucket: the tone's pool plus the species line.
function poolFor (bucket, tone, flower) {
  const t = TONES.includes(tone) ? tone : DEFAULT_TONE
  const b = BUCKETS.includes(bucket) ? bucket : DEFAULT_BUCKET
  const base = NOTES[t][b]
  const sp = SPECIES[flower] && SPECIES[flower][b]
  return sp ? [...base, sp] : [...base]
}

// The pick itself. `seq` is a counter that steps by exactly one per day spent in
// this bucket and carries on across cycles, so the pool is walked in order: the
// same seq always gives the same line (stable across the shell's many
// reschedules), consecutive days never repeat, and a line only comes back after
// the whole pool has been through.
function pickNote (bucket, seq, opts = {}) {
  const tone = TONES.includes(opts.tone) ? opts.tone : DEFAULT_TONE
  const flower = opts.flower || ''
  const pool = poolFor(bucket, tone, flower)
  const n = seq + hash(`${flower}:${tone}`)
  const [title, body] = pool[((n % pool.length) + pool.length) % pool.length]
  return { title, body }
}

// The note for a bucket on a date, for callers that already know the bucket
// (the tests, and anything that wants a sample). `cycleIndex` advances the walk
// by one cycle's worth of that bucket.
function noteForBucket (bucket, dateIso, opts = {}) {
  const b = BUCKETS.includes(bucket) ? bucket : DEFAULT_BUCKET
  const cycleIndex = Number.isFinite(opts.cycleIndex) ? opts.cycleIndex : 0
  return pickNote(b, isoToDays(dateIso) + cycleIndex * BUCKET_DAYS[b], opts)
}

// Where in its bucket a day sits: a counter that steps by one per day for as long
// as the bucket lasts. Which field to count off depends on what anchors the
// bucket - the period start, ovulation, or the next period.
function positionInBucket (bucket, slot) {
  if (bucket === 'fertile-rise' || bucket === 'fertile-peak') return -(slot.daysToOvulation || 0)
  if (bucket === 'luteal-early' || bucket === 'luteal-late') return -slot.daysToNextPeriod
  return slot.dayOfCycle
}

// The bucket a date really lands in, softening included (see noteFor).
function bucketOn (pred, dateIso) {
  const slot = cycleSlotOn(pred, dateIso)
  const bucket = bucketForSlot(slot)
  if (!bucket) return { slot, bucket }
  if (bucket.startsWith('fertile') && (pred.birthControl || pred.confidence === 'low')) {
    const before = pred.ovulationEst && diffDays(dateIso, pred.ovulationEst) > 0
    return { slot, bucket: before ? 'follicular' : 'luteal-early' }
  }
  return { slot, bucket }
}

// How many days of THIS user's cycle each bucket actually covers, measured by
// walking one projected cycle. The pick advances by exactly this much per cycle,
// so a pool is walked through consecutively - cycle two picks up where cycle one
// stopped - which is what makes "pool length divided by days per cycle" the real
// repeat interval. A fixed table would not do: a 35-day cycle has a follicular
// stretch more than twice as long as a 28-day one, and an advance shorter than
// the days actually spent in a bucket overlaps and repeats within a cycle.
function bucketDaysFor (pred) {
  const L = pred.cycleLen || 28
  const counts = {}
  for (let i = 0; i < L; i++) {
    const { bucket } = bucketOn(pred, addDays(pred.nextPeriodStart, i))
    if (bucket) counts[bucket] = (counts[bucket] || 0) + 1
  }
  return counts
}

// The note for one date given a projection. Softens the fertile framing rather
// than faking it: at `low` confidence (where the fertile window is the least
// trustworthy part of a guess) a fertile day reads from the follicular or luteal
// pool instead. Hormonal birth control is already handled upstream - cycleSlotOn
// never reports a fertile phase then, matching the dial and summary. Returns null
// when there is nothing honest to say.
function noteFor (pred, dateIso, opts = {}) {
  if (!pred || !pred.known || !pred.nextPeriodStart) return null
  const { slot, bucket } = bucketOn(pred, dateIso)
  if (!bucket) return null
  const perCycle = (opts.bucketDays || bucketDaysFor(pred))[bucket] || BUCKET_DAYS[bucket]
  const seq = positionInBucket(bucket, slot) + slot.cycleIndex * perCycle
  return { ...pickNote(bucket, seq, opts), bucket, phase: slot.phase }
}

module.exports = {
  noteFor, noteForBucket, pickNote, bucketForSlot, bucketOn, bucketDaysFor, positionInBucket, poolFor, hash,
  NOTES, SPECIES, TONES, DEFAULT_TONE, BUCKETS, BUCKET_DAYS,
}
