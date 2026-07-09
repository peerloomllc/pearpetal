# Notifications

**Goal** - Give the owner opt-in local reminders derived from their on-device cycle
prediction (period approaching; fertile window + ovulation), scheduled with the OS so
they fire even when the app is closed, without a server, a background service, or any
wire change. Partner-facing notification is limited to a passive "sharing ended" state
(deferred, tiered separately below).

**Tier** - Mixed, split by scope:
- **v1 to-self reminders: T1.** Device-local prefs feeding OS-scheduled local
  notifications over the existing on-device prediction. No wire change, no new Autobase
  row, nothing crosses to a partner. Proposal optional per Constitution; written here
  because it is a "design decision to make before building" from TODO.md and it shares a
  file with the T2 piece.
- **Partner "sharing ended" state: T2, DEFERRED.** Needs a wire signal (a revoke
  tombstone the partner can read) and a change to the revoke flow. Separate follow-up
  proposal before any code. Not built here.

## Decisions (resolved 2026-07-09 with Tim)

1. **v1 reminder set: Period due + Fertile window/ovulation.** The daily "log today"
   nudge and the BBT morning reminder are NOT in v1 (revisit later). Both shipped
   reminders are goal-aware and confidence-gated (below).
2. **Discretion is user-configurable.** Notifications are descriptive by default
   ("Period likely tomorrow"); a "Discreet notifications" toggle in Settings swaps every
   notification to neutral wording ("PearPetal reminder") so a lock-screen glance reveals
   nothing - the specifics show only after opening the app. This is the app-specific call
   that a generic reminder feature would not need: PearPetal is deliberately discreet on a
   home screen (see the naming decision), and a notification is a new privacy surface.
3. **Opt-in at onboarding.** Notifications are OFF until the user turns them on. First-run
   onboarding asks once (and surfaces the goal there, folding into the onboarding
   blocker); the OS permission prompt fires only when they opt in. A Settings card lets
   them enable/disable and configure later. No first-run permission prompt if they skip.
4. **Partner notifications: passive "sharing ended" only, and DEFERRED.** No push to
   partners in v1. The one real case (owner revokes) becomes a calm "sharing ended" state
   the partner sees on their next open. Because revoke currently writes no signal (it
   destroys the group locally, so a partner just sees frozen data forever), this needs a
   wire tombstone and is tiered T2 for its own proposal.

## Scope - what v1 builds

### Prefs (device-local, like `prefs.flower` / `donation:status`)

A `notifications` local row: `{ enabled, discreet, period, fertility, time }`.
- `enabled` (default false) - master opt-in.
- `discreet` (default false) - neutral notification wording when true.
- `period` / `fertility` (default true once enabled) - per-category toggles matching the
  two v1 reminder types.
- `time` (default e.g. 09:00 local) - time of day non-morning reminders fire.

Never crosses the wire (localDb, not an Autobase), same as the flower and donation prefs.

### Scheduling (the mechanism)

- Port PearList's `expo-notifications ~0.32.17` RN-shell block: `setNotificationHandler`,
  Android channels, permission request/reflect, `shell:notifications:get/set` IPC, and
  tap-routing (`getLastNotificationResponseAsync` cold-start + live listener), plus
  PearCircle's `SchedulableTriggerInputTypes` for time-based triggers.
- **Cycle events are one-off date triggers** computed from `cycle:prediction`:
  - Period due: a reminder the evening before + the morning of the predicted next-period
    date.
  - Fertile window opening + predicted ovulation day.
- The RN shell asks the worklet for the upcoming schedule (a small `notify:schedule`-style
  IPC that returns the list of `{ when, category, discreetTitle, fullTitle }` for the next
  ~1 to 2 cycles), then hands them to the OS. Because they are OS-scheduled, they fire
  even if the app is later killed - **no background execution is needed for the to-self
  scope.**
- **Recompute-and-reschedule**: after any day/period/prefs change and on app foreground
  (AppState `active`), cancel all PearPetal-scheduled cycle notifications and reschedule
  from the fresh prediction (predictions drift as the user logs). Use a stable id prefix
  so only PearPetal's notifications are cancelled.

### Goal-aware + confidence-gated (baked in, not asked)

- The existing goal (track / conceive / avoid / pregnant) drives which reminders fire:
  conceive leads with fertile + ovulation; avoid uses careful "higher chance" wording
  (never framed as contraception, matching the existing caveats); pregnant suppresses
  cycle reminders entirely; birth control suppresses the fertile/ovulation reminder
  (matching how the dial/summary already hide that framing).
- No cycle-event reminder is scheduled while prediction `confidence` is `none`/`low` -
  avoid nagging with a guess. (A future daily log reminder, if added, could still run.)

## Compat

Additive and device-local: no wire change, no new persisted shared field, no migration.
Old and new peers are unaffected because nothing about notifications touches a shared
base. A device with no `notifications` row defaults to disabled.

## Verify

- Unit: a pure "next N cycle-notification events" function over a prediction fixture
  (period-due offset, fertile/ovulation dates, goal + birth-control suppression,
  confidence gate, discreet vs descriptive titles). Add to `npm run verify`.
- Prefs round-trip (`shell:notifications:get/set`, defaults, clamping of `time`).
- On-device (TCL): opt in at onboarding -> OS prompt -> schedule a near-future period-due
  by seeding a log, confirm it fires with the app backgrounded/killed, confirm discreet
  toggle changes the wording, confirm disabling cancels pending ones.

## Rollback

Feature is gated by `notifications.enabled` (default off); disabling cancels all
scheduled notifications. Removing the feature is dropping the RN-shell block + the prefs +
the schedule IPC - no data or wire state to unwind.

## Deferred - partner "sharing ended" state (T2, separate proposal)

When an owner revokes, the partner should see a calm "sharing ended" state instead of
silently frozen data. Today `share:revoke` destroys the group locally and writes no
signal, so the partner has nothing to read. A design would need:
- A revoke tombstone: the owner writes a `share:meta.revoked`/`revokedAt` field (additive,
  owner-signed, inherits the existing owner-write-only apply gate) BEFORE destroying the
  group, and the revoke flow must flush + allow it to replicate before teardown.
- The partner's `partner:view` reads it and the UI shows "sharing ended".
- Honest caveat: delivery is best-effort. If the owner is not connected to the partner at
  revoke time, the tombstone never replicates and the partner keeps seeing frozen data.
  This matches the no-push-server P2P model and the forward-only revocation invariant
  already documented. Tiered T2 (new persisted shared field + revoke-flow change); its own
  proposal + DECISIONS entry when built.

## Open questions

- Exact period-due offsets (evening-before + morning-of vs a single day-before) - settle
  during build against how the prediction dates land.
- Whether the fertile reminder fires once (window opens) or twice (opens + ovulation) by
  default - lean two, both behind the single `fertility` toggle.
