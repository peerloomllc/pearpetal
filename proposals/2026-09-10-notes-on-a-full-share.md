# Notes on a Full share

**Goal** - Let an owner send her written day notes to ONE partner, on purpose, as an
extra switch under the Full scope. Today `full` sends a redacted per-day summary
(whitelisted symptom tags, a bleeding yes/no) and deliberately never sends `notes`.

**Tier** - T3. It widens what leaves the phone on the consent surface, and it moves the
one field the app has always promised stays on the owner's own devices. The wire change
itself is additive and small; the tier is for the promise being changed, not the diff.

**Decisions taken before writing this** (Tim, 2026-09-10):
- A **separate switch under Full**, not a fourth scope. Someone should be able to share
  the full picture and still keep her diary back, which is expected to be the common case.
- **Forward-only.** Turning the switch off stops new notes and leaves notes already
  delivered on the partner's device. The app must say so rather than imply a recall.

## Scope

### What is added

- **A per-share flag `notes`**, boolean, default FALSE, valid only alongside
  `scope: 'full'`. Stored in the same two places the scope already lives:
  the local membership record (`groups:joined:{groupId}`) and the owner-signed
  `share:meta` row on that shared base. A partner's copy of `share:meta` is what tells
  their UI whether to expect notes at all.
- **`summary:{yyyymmdd}.note`**, an optional string on the EXISTING summary row, written
  only when the flag is on. Capped at the same 2000 characters `day:set` already enforces.
  No new row family, no new key namespace, so `rowSharedDecision` and the retention rules
  need no change.
- **`share:setNotes({ groupId, notes })`**, a new owner-only method, so the switch can be
  changed on a share that already exists. There is no `share:setScope` today, so this is
  the first method that edits a live share's consent. It rewrites `share:meta`, updates
  the membership record, and calls `refreshShares`.

### What is NOT added

- No fourth scope, and no change to `phase` or `fertility`, which stay exactly as they are.
- No per-note marking. Turned down as more surface than the feature is worth, and one
  mis-tap shares a note that was meant to be kept.
- No recall. See Compat.
- Nothing for `partner:view` to write. The partner stays read-only.

## Behaviour

`writeProjection` gains one line inside the existing `scope === 'full'` branch: when the
share's `notes` flag is on and the day row has a note, put it on the summary row. When the
flag is off, the field is never written, so a partner's base never holds it.

Turning the switch OFF must also stop the notes already written to that shared base from
being readable, as far as forward-only allows:

1. `share:setNotes({ notes: false })` rewrites every summary row in the window WITHOUT the
   note field. Last-writer-wins means the new row replaces the old one in the view, so a
   partner who syncs after the change sees no notes.
2. A partner who never syncs again keeps what their device already replicated. That is the
   forward-only limit, the same one revocation already has, and the UI says it plainly.

## The wording that has to change

`src/ui/App.jsx` renders the notes box with `placeholder='Private to your devices'`. That
string is a promise, and it stops being true for a share with the switch on. It must
become conditional: the unconditional wording stays while no share has notes turned on,
and changes when one does. This is not a detail to leave to the end - it is the part of
this change a person actually reads.

The share screen needs the same care:
- The switch is off by default and never pre-selected.
- Its label says what goes: "Also share the notes you write on a day".
- Turning it on warns once, in plain words, that notes already sent cannot be taken back.
- The partner's own screen labels the notes as the owner's writing, not as a symptom tag.

## Compat

- **Old partner app, new owner.** A partner on 1.0.6 reads `summary:` rows it already
  understands and ignores an unknown `note` field, so nothing breaks; they simply do not
  see notes until they update.
- **New partner app, old owner.** `share:meta` has no `notes` flag, which reads as false.
- **Existing shares** keep sending no notes until the owner turns the switch on for that
  share, one share at a time. There is no bulk or global setting on purpose.
- **Revoked shares** are frozen at their last projection and are not touched.

## Verify

- Unit: a `full` share with the flag off writes no `note` field, with it on writes the
  note, and `phase`/`fertility` shares never write one whichever way the flag is set.
- Unit: `share:setNotes(false)` rewrites the window and the note field is gone from every
  summary row afterwards.
- Unit: the flag is rejected on a non-full scope, and a partner cannot write it.
- Two-peer: an owner with the switch on, a partner reading the note; then the switch off,
  and the partner's next sync shows the day without it.
- Hardware: one emulator as owner, the TCL as viewer, per rule 15. Read the partner screen
  as text and confirm the note appears under the day it belongs to.

## Rollback

Delete the `notes` flag handling in `writeProjection` and stop writing the field. Rows
already carrying a note keep it until the next `refreshShares` rewrites them, which is
one log edit away. `share:setNotes` becomes a no-op method that can be removed once no
build calls it.

## Open questions

1. **Does turning the switch ON send the notes already in the window?** A `full` share
   projects the last 21 days (`SUMMARY_WINDOW_DAYS`), and `refreshShares` rewrites that
   whole window, so the plain implementation sends up to three weeks of past notes the
   moment the switch goes on. The alternative is to send notes only for days edited after
   the switch, which is more surprising to explain and leaves the screen half full.
   Recommend the plain one, with the confirmation saying "the notes on your last three
   weeks of days will be sent".
2. **Does the partner's screen show the whole note, or a first line?** Notes run to 2000
   characters and the partner's day rows are single lines today. Recommend a first line in
   the row that opens to the whole note, which needs a small screen the partner side does
   not have yet.
3. **Does the owner get any sign of which days a partner can read notes on?** A marker on
   the day itself would be honest, and it is the sort of thing that is easy to leave out
   and hard to add later.
