# Daily flower note

**Goal** - An opt-in, once-a-day local notification written in a garden voice, chosen
on-device from the cycle phase and the user's chosen flower, so tracking feels like a
daily ritual rather than a clinical chore. The PearPetal answer to Stardust's astrology
notifications, themed on flowers and seasons instead of planets.

**Tier - T1.** Device-local only: two new fields on the existing `notifications` local
row, a new pure copy module, and extra events in the list the shell already schedules.
No wire change, no Autobase row, no new IPC method, no shell change at all. Proposal
written anyway because it shares a surface with the T1 notifications proposal
(`2026-07-09-notifications.md`) and because the *copy* is the feature, so the tone rules
deserve to be written down before 80 lines of jokes are.

## Decisions (resolved 2026-07-30 with Tim)

1. **Both tones, user picks.** A `noteTone` pref with two corpora: **Playful** (dry,
   witty, snack-positive - the Stardust register) and **Gentle** (almanac voice, seasonal
   observation, no punchline). Default Playful. Nobody gets a joke on a day they did not
   want one.
2. **Every day.** Once daily at the existing reminder time, not only on phase changes.
   The daily ritual is the entire point of the comparison.
3. **Push, not just in-app.** It rides the existing OS local-notification path.
4. **Opt-in twice over.** Master `notifications.enabled` is still off by default, and
   `dailyNote` is additionally off by default, so an existing user who already turned on
   cycle reminders does not silently start getting daily notes on upgrade.

## Scope - what this builds

### Copy (`src/petalNotes.js`, new, pure)

**Seven sub-phase buckets, not four phases.** Early and late luteal are different weeks to
live through, and so are day one of a period and its tail. Splitting them is both more
lines and better-aimed lines: `menstrual-early`, `menstrual-late`, `follicular`,
`fertile-rise`, `fertile-peak`, `luteal-early`, `luteal-late`.

- `NOTES[tone][bucket]` - `[title, body]` pairs, **sized to how many days of a cycle the
  bucket actually covers**. Luteal-early gets 14 lines and menstrual-early gets 6, because
  one is a 6-day stretch and the other is 2 days.
- `SPECIES[flower][bucket]` - one extra pair per bucket for each of the five species in the
  flower picker, in that flower's voice (the rose keeps its thorns, the lotus grows from
  mud, the dahlia is a lumpy tuber holding all the ruffles). Mixed into the same pool, so
  the picked flower shows up in the writing, not just on the dial.
- **159 lines in all**: 62 per tone plus 7 per species.
- `noteFor(pred, dateIso, { tone, flower })` -> `{ title, body, bucket, phase }`.

**The pick walks the pool, it does not sample it.** The index is a counter that steps by
one per day spent in that bucket and carries across cycles (`positionInBucket +
cycleIndex * daysThatBucketCoversForThisUser`), offset by `hash(flower + tone)`. So:

- the same date always renders the same note, across the many reschedules the shell does;
- consecutive days can never repeat;
- a pool is walked end to end before anything comes back, which makes "pool size divided by
  days per cycle" the true repeat interval - **nothing a user can see returns inside eight
  weeks**, asserted by walking 56 days of every tone x flower combination;
- and a given cycle day does not land on the same line every month.

The per-cycle advance is **measured off the user's own projection** rather than hardcoded,
because a 35-day cycle stretches the follicular stretch far more than the rest. An advance
shorter than the days actually spent in a bucket would overlap and repeat within a single
cycle - the bug the first draft of this had.

Growing a pool later is a pure-data change: no migration, no wire, nothing persisted.

### Where a FUTURE date sits in the cycle (`src/prediction.js`)

`projectionFromRows` reports on *today*. A note scheduled 10 days out needs to know about
*that* date, so `cycleSlotOn(pred, dateIso)` projects the current cycle's pattern forward
and back by cycle length, the same way `projectCalendar` already does, and returns
`{ phase, dayOfCycle, cycleIndex, daysToOvulation, daysToNextPeriod }` - enough to place
the date in a sub-phase bucket and to rotate the copy per cycle. `phaseOnDate()` is the
thin wrapper for callers that only want the phase. Exported and unit-tested on its own.

### Events (`src/notifications.js`)

A `daily-note` category alongside `period-*` and `fertile-*`, same shape, same `pp:` id
prefix, so the shell needs **no change**: it already schedules whatever the worklet hands
it.

- Horizon **14 days** (not the 60 the cycle events use). Two reasons: iOS caps an app at
  64 pending local notifications, and the phase estimate for a date two cycles out is not
  worth the slot. The shell re-arms on every foreground and after every log entry.
- A `MAX_EVENTS = 56` cap over the whole returned list (earliest kept) as a hard guard
  against ever crowding the iOS limit. In practice the list is ~24.
- **Confidence:** unlike the cycle reminders, a note is not an instruction to act on, so
  it does not need the same "never nag on a guess" bar. It requires a known cycle, and at
  `low` confidence it schedules only **3 days** ahead. `none` still schedules nothing.
- **Fertile framing is softened, never faked.** When confidence is `low` or the user is on
  hormonal birth control, a `fertile` day falls back to the follicular / luteal pool
  rather than announcing a bloom we are guessing at. Matches how the dial and summary
  already hide the fertile framing on birth control.
- **Goal:** `pregnant` suppresses everything, as it already does for cycle reminders. The
  corpus is otherwise deliberately goal-neutral: the lines are about energy, weather and
  snacks, never about conceiving or avoiding, so a `conceive` user and an `avoid` user can
  read the same line without either being nudged.
- **Discreet mode wins.** A note inherits the existing discreet swap and reads exactly
  "PearPetal / You have a reminder", identical to every other category, so the lock screen
  still reveals nothing.

### Prefs + UI

`notifications` local row gains `dailyNote` (bool, default false) and `noteTone`
(`playful` | `gentle`, default `playful`), validated in `notifications:set` like the
existing fields, never crossing the wire. Settings' Reminders card gains a "Daily flower
note" row and, when it is on, a two-chip tone picker.

### What this does NOT do

No in-app note on the main screen (the dial is the hero; revisit later). No partner-facing
note. No streaks, no scores, no shareable cards. No copy fetched from anywhere - there is
no network path for text in this app and this feature does not add one.

## Compat

Additive and device-local. A device with no `dailyNote` field defaults to off, so upgrade
changes nothing until the user asks for it. No wire change, no migration, old and new
peers are indistinguishable.

## Verify

- Unit (`test/petalNotes.test.js`): determinism (same date -> same note), no consecutive
  repeats, **no repeat inside 56 days for any tone x flower**, every bucket sized to
  outlast two cycles of its own phase (measured, not assumed), no duplicated line and no
  duplicated title within what one user can see, every picker flower has a voice in every
  bucket, per-cycle rotation, both tones resolve, every entry a well-formed non-empty
  `[title, body]`.
- Unit (`test/prediction.test.js`): `phaseOnDate` across a full projected cycle, forward
  and backward from the anchor.
- Unit (`test/notifications.test.js`): note events off by default; 14-day horizon; 3-day
  horizon at low confidence; fertile softening on low confidence and on birth control;
  discreet wording; suppressed while pregnant; the `MAX_EVENTS` cap.
- On-device: enable reminders + daily note, set the time a few minutes out, confirm it
  fires with the app killed, confirm the tone chip changes the wording, confirm discreet
  neutralises it.

## Rollback

Gated by `dailyNote` (default off). Turning it off cancels the notes on the next resync,
which happens on foreground. Removing the feature is deleting `petalNotes.js`, the events
branch and the two prefs - no data or wire state to unwind.

## Open questions

- Whether the note should also appear in-app under the dial for users who keep
  notifications off entirely. Deferred, not built.
- Whether to widen the corpus again once it has been lived with. Eight weeks without a
  repeat is the bar this hits at a 28-day cycle; a much longer cycle sees the follicular
  and luteal lines sooner. Adding lines is a pure-data change with no migration, and the
  sizing test will say exactly which bucket needs them.
