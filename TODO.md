# PearPetal TODO

Open work only. Completed work (dated, with PRs) lives in `DONE.md`; deep
rationale for T2/T3 changes lives in `DECISIONS.md`.

Pruned 2026-07-21 in a full walk-through of every item. Shipped work moved to
`DONE.md`; what is below is what survived. Dropped deliberately, not forgotten:
promoting Play closed testing to production, a dark-mode screenshot set, the
deeper coach-mark onboarding tour, the remaining "cut the scrolling" trims (steps
1 + 4 already made the screen fit), partner notifications, and the swarm-topic
accumulation mitigations B/C. The diagnostics keep-or-revert review closed as
"keep the code as is".

## Verification still owed

- **Hardware-gate the blind relay: the POSITIVE case (owed by PR #95, 2026-07-23).**
  HALF DONE 2026-07-23. Already confirmed on the TCL (debug 1.0.2, both phones
  installed): the policy is LIVE - "Direct connections tried" read 4, and that
  counter only increments inside our `relayThrough` hook, so Hyperswarm is calling
  it on every outbound dial. Escalations were 0 on wifi, which IS the negative case
  the gate wanted: a punchable network is never relayed.
  THE RELAY PATH ITSELF IS NOW PROVEN (2026-07-23, unplanned). While scrolling the
  Settings page the TCL's panel moved from `0/0` to **Connections we helped relay
  1/1** with both phones running PearPetal on the same wifi. That counter is
  hyperdht's own server-side one (`lib/server.js` `_relayConnection` -> attempts,
  then successes on pair), so a real remote peer escalated to the DEPLOYED relay
  node and the relayed connection SUCCEEDED. The relay works end to end.
  Two caveats on that result: the peer was not positively identified (the Pixel is
  observe-only per rule 6, so its side could not be read), and it happened over
  wifi, not cellular - a same-LAN hairpin-NAT punch failure is the likely trigger.
  STILL OWED is therefore the CARRIER case specifically: two devices on mobile
  data with wifi OFF, a pairing whose direct punch fails, confirmed to complete
  THROUGH the relay, with the escalating side's own counter read too. See
  `proposals/2026-07-23-blind-relay.md` (Verify).
  Read it off **Settings -> Connect anywhere -> Connection details**: "Times the
  helper was offered" is this device's escalation count and "Connections we helped
  relay" is the other end's, so a relayed pairing shows up as one non-zero on EACH
  phone, not both on one. Copy details gives the raw JSON.
  Practical note: the TCL is a poor second peer for this (PearGuard's ~2 min/day
  limit on `com.pearpetal.debug`), and it needs two phones on CELLULAR, so this is
  most likely a Tim-drives-it test rather than an adb one.

- **Tap-test the universal links (human test only).** Actually TAP an
  `https://peerloomllc.com/petal/link|join` link on the iPhone and confirm it opens
  PearPetal (iOS UL), and the same on Android (App Links against the live
  `assetlinks.json`). Everything is built, provisioned and deployed; nobody has
  confirmed the tap itself. Note the `with-ios-no-associated-domains` plugin STRIPS
  the entitlement by DEFAULT, so any iOS build that must have UL needs
  `PEARPETAL_ASSOCIATED_DOMAINS=1` at prebuild time.
  THE iOS SIDE IS NOW READY TO TAP (2026-07-23). `com.pearpetal` 1.0.2 is installed
  on the iPhone SE from a `PEARPETAL_ASSOCIATED_DOMAINS=1` build, and all three
  preconditions were verified rather than assumed:
  1. the signed binary carries `com.apple.developer.associated-domains` ->
     `applinks:peerloomllc.com`, present in the code-signature blob (so it is signed,
     not merely declared);
  2. the embedded provisioning profile permits that entitlement (`*`), which is why
     the archive did NOT hit the wildcard-profile failure the plugin warns about;
  3. `https://peerloomllc.com/.well-known/apple-app-site-association` returns 200 as
     `application/json` and lists `G79ALD29NA.com.pearpetal` with paths
     `/petal/link`, `/petal/link/*`, `/petal/join`, `/petal/join/*`.
  So all that remains on iOS is the human tap. Open the app once first so iOS fetches
  the association file; an immediate tap can fall through to Safari once.
  ANDROID IS STILL UNCHECKED end to end - `assetlinks.json` has not been re-verified
  this session.

## Health import - slice 3 still to build

- **iOS HealthKit read (slice 3 of `proposals/2026-07-30-health-import.md`).** Slices 1
  (the pure merge rules) and 2 (Android / Health Connect) shipped 2026-07-30 in PRs #113
  and #114; the worklet method, the UI row and the whole merge policy are done and shared,
  so this is only the platform read. Build a small read-only Expo module following
  `modules/backup-exclusion/` and `modules/local-network/`, request `toRead` ONLY and never
  `toShare` so no write-back path exists, and hand the shell the same normalised samples
  Android already produces (local dates, Celsius, sorted ascending). Needs the HealthKit
  entitlement plus `NSHealthShareUsageDescription`, both prebuild-time, so they go in a
  config plugin like the associated-domains one.
  DESIGN NOTE ALREADY ESTABLISHED: HealthKit deliberately makes a DENIED read
  indistinguishable from "no such data", so the UI can never say "you denied access" - only
  "no data found". The `read-failed` and `denied` messages added for Android exist and can
  be reused, but iOS cannot tell them apart.
  Verify on a real iPhone, not the Simulator: the Simulator has no meaningful HealthKit
  data and fakes the permission surface.

- **A non-empty read has never happened, and it may need a Play-installed build.** Android
  has been proven to reach Health Connect, ask for access, surface a refusal honestly and
  complete an EMPTY read. What is missing is real records crossing into the log.
  EVERYTHING ALREADY TRIED, so nobody repeats it:
  - A throwaway writer app (session scratchpad, deliberately never in this repo) declaring
    the WRITE permissions PearPetal lacks. It wrote 11 records successfully on the
    emulator, so seeding itself is solved.
  - Reading them back from PearPetal on the emulator: Health Connect's permission screen
    never renders for this app, and the only alternative, `pm grant`, bypasses Health
    Connect's own bookkeeping - after which the platform refuses every read with
    "Incorrect health permission state".
  - The TCL, which runs Android 15 with Health Connect built in. Same result: the in-app
    permission request returns an empty grant, and Health Connect's own screen lists
    neither app, showing "Install apps that work with Health Connect to see them here".
  THE LIKELY EXPLANATION, and it changes the shape of the remaining work: Health Connect
  may simply not grant access to a SIDELOADED debug build. If so, the Play Console health
  declaration below is not just paperwork before release - it is a PRECONDITION for testing
  the feature at all, and a non-empty read can first be proven on an internal-testing track
  build rather than on any sideload. Worth confirming before spending more device time.
  Until then the merge is covered by 24 tests, including one proving an imported BBT moves
  the prediction from calendar to bbt.

- **Play Console health declaration form.** Reading Health Connect data in a released build
  requires the declaration ("Period tracking", with a justification per data type) or users
  get an error dialog and the app cannot read at all. Not needed for debug builds; needed
  before any release that ships the import.

## Next release notes - lines already drafted

- **Include the backup change in the next release's notes.** `release_notes.md` currently
  holds the shipped 1.0.3 copy the store is serving, so it was deliberately NOT overwritten.
  Drop these in when the next version is cut (plain language per rule 13):

  Improved
    - Your cycle log now stays out of your phone's automatic backup. iPhone and Android
      both copy app data to iCloud or Google by default. PearPetal's log no longer goes
      with it, so your cycle stays on your own devices the way the app has always said it
      does. Moving to a new phone directly still brings everything across.

  Please note
    - Because your log is not in your phone's automatic backup, the way to keep a copy is
      Settings, Backup and restore. You can set a password so the file is encrypted, and
      you choose where it is stored.

  Also worth a line if the daily flower note ships in the same version:

  New
    - A daily note from the garden. Turn it on under Settings, Reminders, and each day
      PearPetal sends a short line written for where you are in your cycle, in the voice
      of the flower you picked. Choose Playful or Gentle, and it stays hidden on your lock
      screen if you use Discreet mode.

## Nice-to-have / UX polish

- **Promote `src/relay.js` into `@peerloom/core` (rule of three).** It is
  app-agnostic and PearTune has a near twin (`protocol/relay.js`). Deliberately
  not done in PR #95: two copies of a ~110-line pure module beat a new core API
  plus a version bump across the suite, and core already exposes `createSwarm` as
  the seam. Do it when a THIRD app adopts the relay. Until then, a change to the
  relay key or the policy must be made in both places.
- **`PartnerView` renders raw ISO dates.** `2026-07-23` -> `fmtDate` (`Jul 23`), for
  a nicer app and a nicer store screenshot scene 4. Small and self-contained. T1.

## Device-link follow-up

- **Real unpair (writer-block), not just cosmetic roster remove.** `device:remove`
  currently only hides a device from the roster (device-link `removeDevice` = a
  deviceMeta del). A true unpair would block the writer on the personal base, so a
  removed device can still write today. Likely T2/T3 - write a proposal first.

## Deferred - security / scale

- Migrate `day:`/`period:` retention/paging once logs get long.
- **Pairing/sync degradation after repeated share/revoke/re-share** (BACKBURNER -
  INTERMITTENT; needs repro + root-cause). Observed: the FIRST pair almost always
  connects immediately, but SUBSEQUENT shares/pairings sometimes take an
  indeterminate (occasionally long) time to sync. Not consistently reproducible, so
  deferred; not a launch blocker. Ideally repeated **share -> revoke -> re-share**
  (and multiple concurrent partners) each pair as fast as the first.
  Working theory: swarm topic + connection accumulation. Each share spins up another
  base + swarm topic; soft-revoke deliberately KEEPS the base + swarm alive so the
  tombstone reaches an offline partner, so revoked shares keep announcing and holding
  connections; re-share adds yet another. Mitigation A shipped 2026-07-10 (viewers
  join client-only via a persisted `announce` flag; core PR #14 + app `partner:join`)
  and helps but does not fully fix it. The full background and the rest of the
  mitigation menu - B (auto-sweep soft-revoked shares, blocked on the deferred ack
  channel) and C (announce back-off) - is in
  `proposals/2026-07-09-swarm-topic-accumulation.md`. B and C were dropped from this
  backlog 2026-07-21, but that proposal remains the reference if this is picked up.
  WHEN REVISITED: instrument active topics/connections per share, try to repro on
  hardware with N>=3 sequential shares AND a share/revoke/re-share loop, and find the
  lever (announce back-off, a per-base connection cap, tearing down swarm for revoked
  shares once the tombstone is acked, and/or capping total simultaneous topics).

## Known limitation (deferred) - linked device's writes slow to sync back to founder

Device linking syncs founder->device immediately, but device->founder (the new
device's own edits + roster row) can STALL until a clean reconnect. Confirmed
2026-07-07 (TCL founder + Pixel linked device); converges once a fresh connection
forms. Root cause: connection churn during initial writer admission (the founder
applied `addWriter` twice, interleaved with pair close/open, so the new-writer core
pull stalled). ENVIRONMENTAL (two real Android devices, leave-then-relink); does NOT
reproduce on a clean local testnet (~0.8s). Deferred because multi-device-for-one-user
is minor here (partner sharing does NOT use the B->A writer path and is fully
verified); new-phone migration is better served by export/import. If revisited:
founder re-pulls new writer cores once the connection settles (needs a real-network
churn repro); also `publishDevice` runs only at join+boot (both before writable) so a
device that becomes writable AFTER `link:join` never re-publishes its `device:{pubkey}`
row - add a post-became-writable retry. Release-notes wording: "a linked second device
may need an app reopen to finish syncing its first edits."

## Dev infra / build durability

- **One unexplained test failure, seen once, never reproduced** (2026-07-21). A
  `npm run verify` run came back 114 pass / 1 fail; the failing test name was not
  captured. 23 subsequent runs (11 `npm test`, 12 full `npm run verify`) were all
  115/0, so it is a flake, not a regression. Most likely a timing-sensitive test in
  the P2P/pairing set. If it recurs, run with `--test-reporter=spec` and capture the
  name before chasing it - a flaky test in the merge gate is worse than a slow one.
- **`@peerloom/core` nested node_modules can drift from the app's** (LIKELY SUITE-WIDE).
  Core is file:-symlinked; its own node_modules had version-mismatched native addons vs
  the app's top-level -> iOS `ADDON_NOT_FOUND` at engine init. FIX IN PLACE: `overrides`
  in core's package.json pin the mismatched addons to the app's versions; `ios-dev-
  install.sh` runs `npm install` on the Mac so linked frameworks match. TRADE-OFF: the
  pins must track each app's top-level versions by hand, so they rot silently. PROPER
  FIX: a workspace/hoist setup, or drop core's holepunch devDependencies so versions
  can't drift.
