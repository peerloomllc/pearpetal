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

## iOS donations - one open call

- **Does the two-week donation NUDGE come back on iOS too?** PR #126 brought back the About
  page's "Support development" section but deliberately left the nudge gated, because it is
  the surface that surfaces ITSELF and so is the one a reviewer is most likely to read as
  soliciting under Guideline 3.1.1. Android is unaffected either way. One line to flip if the
  answer is yes (the `IS_IOS` check in the donation-nudge effect in `src/ui/App.jsx`).

## Live bug - blank screen on a partner-viewer (CAUSE FOUND, fix on PR #127)

Root cause found 2026-09-09 and reproduced end to end: `partner:view` -> `publishMember`
-> `group:updated` -> `partner:view` was a write loop appending ~8 rows a second to the
shared base while the partner screen sat open, which pushed the viewer's own input core
past the retention threshold, after which the sweep cleared its own blocks and the app
never opened again. See `DECISIONS.md` 2026-09-09. Fixed in PR #127 (PearPetal) and
peerloom-core PR #20. What is left:

- **Get it onto the reporter's phone.** He is on iOS 1.0.5 and his install is already in
  the broken state, so he needs a build carrying both PRs plus the "Rebuild it" button, or
  a reinstall. Decide whether this rides a version bump or a TestFlight build.

- **Confirm the fix on hardware.** The reproduction is a Node harness on a DHT testnet, so
  it proves the engine behaviour and not the phone. Owed: the partner screen left open on
  a real pair for a few minutes, with the shared base's row count read afterwards, and one
  cold start with the other phone switched off. The iPhone SE is the reporter's platform.

- **Open PearPetal once on the iPhone SE and confirm it boots.** Still open from before:
  the build with PRs #123/#124 is INSTALLED on the SE but was never launched
  (`ios-dev-install.sh` cannot launch headlessly without a mounted Developer Disk Image).
  Fold this into the run above.

- **Audit the other apps for the same loop shape.** The bug is a read path that writes,
  feeding a listener that re-reads. PearList, PearCal and PearGuard sit on the same engine
  and the same `group:updated` pattern. The core half is fixed for all of them; the write
  loop is per-app.

## Found in the 2026-09-09 review, not yet fixed

The timezone half is fixed (PR pending). These two are confirmed with tests that
were run, not inferred, and both are ordinary bugs rather than anything subtle.

- **A backup does not restore the health settings it was told to save.** Export
  writes `days`, `periods` and five prefs; `conditions`, `birthControl`,
  `pregnancy` and the `profile` (display name, avatar) are never written, and
  `import:data`'s goal whitelist omits `pregnant`. Round-tripped onto a fresh
  device: goal `pregnant` -> `track`, pregnancy dates -> null, conditions
  `["pcos","thyroid"]` -> `[]`, birthControl true -> false, name "Ada" -> "".
  Days and periods survive. Everything shaping the PREDICTION does not, silently,
  and pregnancy mode switches itself off. This is the move-to-a-new-phone path the
  App Store description sells. Fields are additive so old backups keep importing.
  Repro: `export:data` then `import:data` on a second engine, diff `prefs:get`.

- **A period logged on the wrong date is permanent.** `period:getAll` and
  `period:set` exist and NOTHING in the UI calls them, and no delete exists at any
  layer (`period:set` always writes `deleted: false`). So there is no way to see
  your logged periods, correct a start date or remove one. Every period start
  feeds `cycleStarts()` and the cycle-length median, so one mistyped date skews
  predictions forever; export-then-import cannot clear it either, because import
  merges rather than replaces. Needs a `period:delete` in the worklet plus a
  history screen. The largest of the three and the only one needing UI design.

- **`day:delete` has no UI either.** Milder: a day can be blanked field by field,
  so the row survives but says nothing. Worth folding into the same screen.

## Feature gaps from the same review

Logged for ranking, not started. The feature set is already rich; these are what a
walk through the code and the method table showed to be missing.

- **No lock on the app.** No PIN, no Face ID, nothing biometric anywhere in
  `src/`, `app/` or `app.json`. Anyone holding the unlocked phone opens straight
  into her cycle. For a menstrual tracker sold on privacy this is the most
  conspicuous omission, and the competitors all have it. Needs a decision on what
  it actually protects: the app on open, or also the partner view, and what
  happens to notifications on the lock screen (discreet mode already exists).

- **No cycle history or statistics.** No list of past cycles, no average length,
  no symptom or mood patterns over time. The data is all stored and `period:getAll`
  already returns it; this is a screen, not engine work. It is also what people
  open a tracker to look at after a few months, and it pairs naturally with the
  period edit/delete item above.

- **No way to erase everything.** A privacy-first app with no in-app delete-all.
  Uninstalling does it, but nothing says so and there is no control. Cheap to add
  and it matches the promise the onboarding makes.

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

- **The iOS donation hide (PR #121) has not been seen running.** The gate is a plain
  `window.__pearPlatform === 'ios'` conditional in `src/ui/App.jsx`, covered only by the
  test suite and a clean UI build. Confirm on an iPhone Simulator that About shows no
  "Support development" section and that Android still does, next time either platform is
  built anyway - not worth a dedicated build.

## Health import - shipped, one thing to remember

File import (PR #116) and the iOS Apple Health read (PR #117) are both DONE and verified on
hardware; see `DONE.md` 2026-07-30 and `DECISIONS.md` for why Health Connect was dropped.
What is left here is a build-time trap, not open work.

- **A capability change invalidates every existing provisioning profile for that App ID.**
  Enabling HealthKit on `com.pearpetal` (2026-07-30) silently flipped the "PearPetal App
  Store" profile to `INVALID` server-side while the Mac's cached `.mobileprovision` kept
  signing archives happily. Regenerated 2026-07-31 (new UUID `e5eb05eb-...`) and the stale
  cached copy deleted. NEXT TIME a capability is added, regenerate the DISTRIBUTION profile
  in the same sitting, not just the dev one Xcode auto-creates.
  Check it in one line:
  `security cms -D -i <profile> | plutil -extract Entitlements xml1 -o - - | grep healthkit`
  Distribution cert if one has to be created fresh: `QKKNNXRRK4` (Apple Distribution:
  Timothy Hudgins, expires 2027-03-18). Keep the NAME exact -
  `IOS_PROVISIONING_PROFILE` in `scripts/app.conf` matches on it, and two installed files
  claiming one name is how the wrong one gets picked.

- **`PEARPETAL_HEALTHKIT=1` is now automatic for the RELEASE path only.** `scripts/app.conf`
  exports it (PR #119), so `release.sh` and `ios-appstore.sh` get it for free and
  `ios-appstore.sh` now refuses to archive without the resulting usage string. A hand-run
  `expo prebuild` or `ios-dev-install.sh` that does NOT source `app.conf` still strips the
  entitlement, which is correct default-off behaviour but will make a dev build's Health
  import fail at runtime with no obvious cause. Pass the flag explicitly for those.
  IF A BUILD FAILS with both "doesn't include the HealthKit capability" AND "No Accounts:
  Add a new account in Accounts settings", the cause is `xcodebuild` over SSH being unable
  to regenerate a profile while the login keychain is locked in a non-GUI session. Opening
  the workspace once in the Xcode GUI on the Mac mini creates it; SSH builds sign fine after
  that. (The repo already works around the same class of problem for the signing CERT with
  `buildkey.keychain`.)

## App Store - three releases in a row have stalled in Apple's queue

- **The store's notes must span every version it MISSED, not the newest tag range.** Bitten
  on 1.0.4: the notes were written v1.0.3..v1.0.4, correct for Play, wrong for the App Store
  where the live version is 1.0.1. Fixed by resubmitting with combined notes. The habit to
  keep: `release_notes.md` serves the channel that is current, and any channel that is
  behind needs its own span. Check what the store actually has before writing them, do not
  assume it matches the tag.

- **One App Store version record has now been renamed FORWARD TWICE: 1.0.2 -> 1.0.3 ->
  1.0.4.** Each time because the previous submission sat in WAITING_FOR_REVIEW long enough
  to block the next release (1.0.2 stalled 2026-07-23, 1.0.3 stalled seven days to
  2026-07-31). Neither ever reached a user. Renaming is Apple's supported move and
  `release.sh` automates it, but three in a row is a pattern, not luck.
  WORTH INVESTIGATING if 1.0.4 also stalls: whether something about this app's review
  profile is causing the delay (a health app with HealthKit access is a plausible trigger
  for extra scrutiny) rather than generic queue time. Two data points would separate "our
  app is flagged" from "Apple is slow": how long 1.0 and 1.0.1 took to clear, both of which
  DID get approved.
  UPDATE 2026-08-11: 1.0.4 did NOT stall this time, it was REVIEWED and REJECTED under
  Guideline 3.1.1 (donations outside in-app purchase). So the queue theory is now only about
  1.0.2/1.0.3. Fixed by hiding the donation path on iOS (PR #121) and resubmitting build 14
  on the same record (PR #122); WAITING_FOR_REVIEW since 2026-08-11.

- **`release.sh` cannot drive a rejected-version resubmission.** It assumes a NEW version
  and bumps `expo.version` + tags, so the 2026-08-11 build-14 resubmit was driven by hand
  (bump buildNumber, verify, rsync, `ios-appstore.sh` on the Mac, attach, encryption
  declaration, cancel the stale submission, submit). The one step it does not encode at all
  is the cancel: `items-add` refuses while the rejected submission still holds the version.
  Worth adding a `--resubmit` path that skips the version bump and cancels first, since a
  3.1.1-style rejection will not be the last one.

## Dev infra - release script

- **`release.sh` clobbers hand-written release notes on every run.** Step "Assemble final
  notes" does `printf "%b" "$NOTES" > release_notes.md` unconditionally, then opens `vi`.
  So notes written BEFORE the run (or written during a run that later aborted, as the 1.0.4
  run did) are overwritten by the auto-generated commit-log version and have to be pasted
  back in by hand. Cheap fix: if `release_notes.md` is already newer than the last tag, or
  a `release_notes.next.md` exists, seed the editor with THAT instead of the generated
  text. Low priority, but it bites on exactly the runs that were already going badly.

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
