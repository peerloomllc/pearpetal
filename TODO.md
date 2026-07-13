# PearPetal TODO

Open work only. Completed work (dated, with PRs) lives in `DONE.md`; deep
rationale for T2/T3 changes lives in `DECISIONS.md`. Priority order: release
blockers first, then nice-to-haves, design decisions, deferred, dev-infra.

## Release (v1) - SHIPPED 2026-07-11

PearPetal 1.0.0 launched on the App Store (in review), GitHub, Zapstore, and Google Play
(closed testing). The original v1 blockers, all now done:
1. ~~**Native QR scan + QR render**~~ BUILT (in-WebView) + Android on-device VERIFIED
   2026-07-09. `QrImage` renders a real invite QR via the `qrcode` lib (Sharing share
   rows + Devices); `ScannerView` scans via WebView getUserMedia + `jsQR` (Onboarding +
   JoinPartnerSheet). Camera path confirmed on the TCL: tap Scan QR -> OS CAMERA prompt
   -> grant -> live scanner (CAMERA in app.json + AndroidManifest; NSCameraUsageDescription
   for iOS; shell grants the WebView request). Removed the dead `shell:scanQr` stub. The
   QR now opens in a bottom sheet that auto-dismisses on real peer connection (`share:connected`);
   full-screen scanner (portal fix). PR #49. Android end-to-end scan CONFIRMED by Tim 2026-07-10.
   iOS WebView scanner CONFIRMED 2026-07-10. FULLY DONE.
2. ~~**Store assets + release (v1.0.0 launch)**~~ SHIPPED 2026-07-11 - full record in
   DONE.md. PearPetal 1.0 is out on ALL channels: **App Store** (Waiting for Review),
   **GitHub Releases** (120.8MB arm64 APK), **Zapstore**, **Google Play** (closed testing).
   Everything done: privacy/support/landing pages; listing copy (`metadata/listing-*.md`);
   iOS 6.9" + Android screenshots via the fixtures harness; Play feature graphic + hi-res
   icon; release pipeline (`release.sh` + `ios-appstore.sh`) wired + run; iOS App Store
   distribution profile + ASC key; Android App Links live with BOTH the `pearpetal` upload
   key and Google's Play app-signing key in `assetlinks.json`.
   REMAINING (not in our hands): await Apple's review verdict + Google's closed-test review;
   then promote Play closed testing -> production (Google's 12-tester/14-day gate).
   OPTIONAL polish (non-blocking): a dark-mode screenshot set (harness supports it - add
   `dark` to APPEARANCES); `PartnerView` raw ISO dates (`2026-07-23`) -> `fmtDate`
   (`Jul 23`) for a nicer scene 4 + app.
3. ~~**First-run onboarding / guided demo**~~ BUILT + on-device VERIFIED 2026-07-09
   (see DONE): a skippable `SetupWizard` after "Start tracking" - welcome (hero dial) ->
   name/photo -> goal (incl. pregnancy) -> log last period (dial no longer empty) ->
   reminders opt-in -> "all set" with log-a-day + Share tips. Lands on a populated
   goal-aware dial. REWORKED 2026-07-10 (PR #55): welcome -> name/photo for EVERYONE (moved
   out of the wizard so viewers + restore users set a name too) -> track-vs-view chooser
   (device linking hidden) -> Track = wizard whose first step offers "Set up my cycle" vs
   "Restore from a backup". REMAINING (optional, deferred): a deeper interactive coach-mark
   tour of the live menus/sharing was scoped out of v1 - revisit only if wanted.

All on-device confirmation items are now DONE (see DONE.md 2026-07-10 hardware pass:
iOS QR scanner, iOS Local Network prompt + LAN sync, invite/share URL copy-paste,
two-phone owner->partner name display; earlier: petal dial in partner view 2026-07-07,
app icon / notification glyph + About Bitcoin + sharing-ended 2026-07-09/10).

Website-side (not in-app):
- ~~**Universal-link tap-to-open**~~ DONE + DEPLOYED 2026-07-10 (website PR #27): iOS
  `/.well-known/apple-app-site-association` (`G79ALD29NA.com.pearpetal`, paths
  `/petal/link*` + `/petal/join*`); `/petal/link` + `/petal/join` landing pages that
  reconstruct the `pear://pearpetal/...#<blob>` deep link (blob rides the #fragment);
  `associatedDomains` (`applinks:peerloomllc.com`) in the iOS app.json (pearpetal PR #58);
  PearPetal card + `/pearpetal/` landing/privacy/support pages + Zapstore/GitHub badges +
  website icon & OG art. Android `assetlinks.json` has BOTH the RELEASE `com.pearpetal`
  fingerprint (key `/home/tim/keystore.jks` alias `pearpetal`) and `com.pearpetal.debug`.
  Live-verified on peerloomllc.com: all pages 200, both `.well-known` files served as
  `application/json`.
  - **iOS Universal Links now PROVISIONED + built + installed** 2026-07-10: registered an
    EXPLICIT `com.pearpetal` App ID with the **Associated Domains** capability in the Apple
    Developer portal; created the PearPetal app record in App Store Connect; signed into
    Xcode on the Mac mini (Xcode > Settings > Accounts, PeerLoom LLC) and added
    `-allowProvisioningUpdates` to `ios-dev-install.sh` so xcodebuild mints the explicit
    managed profile that includes the capability. Built with `PEARPETAL_ASSOCIATED_DOMAINS=1`
    (the `with-ios-no-associated-domains` plugin keeps the entitlement when that env is set) ->
    ARCHIVE + EXPORT + install SUCCEEDED on the iPhone SE.
  - REMAINING (human test only): actually TAP an `https://peerloomllc.com/petal/link|join`
    link on the iPhone and confirm it opens PearPetal (iOS UL) - and the same on Android
    (App Links vs the live `assetlinks.json`). Note: the `with-ios-no-associated-domains`
    plugin still STRIPS the entitlement by DEFAULT, so any iOS build that must have UL needs
    `PEARPETAL_ASSOCIATED_DOMAINS=1` at prebuild time.

## Nice-to-have / UX polish

- ~~**Partner (viewer) mode is barebones - needs a real shell**~~ DONE + VERIFIED
  2026-07-10 (see DONE.md): viewer bottom nav (Shared / Settings / About), a scoped
  ViewerSettings (profile + appearance), and a "View a partner's cycle" JoinPartnerSheet
  entry point on the viewer home. Two-phone check passed (TCL owner <-> Pixel viewer).

Prior nice-to-haves shipped + verified 2026-07-10 (see DONE.md): bottom sheets for
day/symptom entry, partner-view scoped Month calendar, joiner photo avatar in per-person
shares.

## Device-link adoption - SHIPPED 2026-07-12 (see DONE.md)

`@peerloom/device-link` is now the default private-base + own-device-linking
engine (flag flipped on, PR #82; hardware-verified TCL+Pixel+iPhone). Follow-ups
still open:
- **Real unpair (writer-block), not just cosmetic roster remove.** `device:remove`
  currently only hides a device from the roster (device-link `removeDevice` = a
  deviceMeta del). A true unpair would block the writer on the personal base.
- **Store release** of the device-link build (version bump + `scripts/release.sh` /
  `ios-appstore.sh`) - a separate, deliberate step.

## Design decisions to make (before building)

- ~~**Notifications (v1 to-self)**~~ BUILT 2026-07-09 (proposal
  2026-07-09-notifications, DECISIONS 2026-07-09): opt-in period-due + fertile/ovulation
  reminders, goal-aware + confidence-gated, user-configurable discreet mode; Settings
  Reminders card; OS-scheduled local notifications (no wire change, no background exec).
  ON-DEVICE VERIFIED on the TCL (opt-in prompt + grant persist, scheduling across a
  2-cycle horizon, backgrounded fire for both descriptive + discreet content, reschedule
  on change, disable-cancels; fixed channelId-on-trigger so scheduled notifications use the
  custom "reminders" channel not expo's fallback). First-run opt-in now folded into the
  onboarding wizard (2026-07-09) and the monochrome tray glyph confirmed (2026-07-09) - both
  DONE. REMAINING: confirm on iOS next hardware pass.
- ~~**JSON export encryption - optional passphrase?**~~ DONE 2026-07-10 (T3, proposal +
  reviews 2026-07-10-encrypted-backups, PR #55): optional password on export - Argon2id
  (sodium `crypto_pwhash`) -> XSalsa20-Poly1305 secretbox over the existing
  `{days,periods,prefs}` payload, self-describing wrapper (`enc` key). Plaintext export
  stays the DEFAULT (blank password); import auto-detects `enc` and prompts; a wrong
  password errors before any write (no partial import); a forgotten password is
  unrecoverable by design (UI says so). See DONE.md.

## Deferred - security / scale

- Migrate `day:`/`period:` retention/paging once logs get long.
- **Swarm topic + connection accumulation** (`@peerloom/core`, T3, suite-wide) -
  proposal `proposals/2026-07-09-swarm-topic-accumulation.md`. Mitigation **A DONE**
  2026-07-10 (viewers join client-only via a persisted `announce` flag; core PR #14 +
  app `partner:join`; DECISIONS + review 2026-07-10). D not changed (Hyperswarm
  `maxPeers=64` default already sane). REMAINING: B (auto-sweep soft-revoked shares -
  blocked on the deferred ack channel) + C (announce back-off - deferred, needs care);
  suite adoption gate = re-run PearList's pairing smoke before other apps rely on the
  core change.
- **Pairing/sync degradation after repeated share/revoke/re-share** (BACKBURNER -
  INTERMITTENT; needs repro + root-cause). Observed: the FIRST pair almost always connects
  immediately, but SUBSEQUENT shares/pairings sometimes take an indeterminate (occasionally
  long) time to sync. It is INTERMITTENT, not consistently reproducible, so deferred for
  future investigation (not a launch blocker). Ideally repeated **share -> revoke ->
  re-share** (and multiple concurrent partners) each pair as fast as the first. Working
  theory: accumulation-driven, same class as the swarm-topic/connection-accumulation item
  above (each share spins up another base + swarm topic; soft-revoke deliberately KEEPS the
  base + swarm alive so the tombstone reaches an offline partner, so revoked shares keep
  announcing/holding connections; re-share adds yet another). Mitigation A (viewers join
  client-only) helps but does not fully fix it; B (auto-sweep soft-revoked shares) is the
  revoke-side leak - still blocked on the deferred ack channel. WHEN REVISITED: instrument
  active topics/connections per share, try to repro on hardware with N>=3 sequential shares
  AND a share/revoke/re-share loop, and find the lever (C announce back-off, a per-base
  connection cap, tearing down swarm for revoked shares once the tombstone is acked, and/or
  capping total simultaneous topics). Relates to the swarm-accumulation proposal + the
  sharing-ended soft-close.

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

- ~~**APK size audit**~~ DONE 2026-07-10 (`plugins/with-android-abis.js`). Root cause of
  the ~476MB was shipping ALL 4 ABIs; the Bare runtime carries a per-ABI native stack
  (libbare-kit.so ~65MB alone). FIX: restrict to `arm64-v8a` (Google Play has required
  64-bit since 2019), mirroring pearlist. **Measured: signed arm64 release APK = 120.8MB
  (~75% smaller), lib/ contains arm64-v8a only, signed with the `pearpetal` key (cert
  SHA-256 = the assetlinks fingerprint, so App Links verify).** Minify/R8 left OFF (all
  siblings do - risky on the holepunch/Bare native stack). NOT fixed (acceptable, shared
  with siblings): `react-native-bare-kit` bundles TWO librocksdb-native (3.17.0 + 3.17.2,
  ~9.6MB redundant) in its addons - a bare-kit packaging quirk, unsafe to patch by hand.
  For Play, `bundleRelease` (AAB) splits per-device regardless.
- **`@peerloom/core` nested node_modules can drift from the app's** (LIKELY SUITE-WIDE).
  Core is file:-symlinked; its own node_modules had version-mismatched native addons vs
  the app's top-level -> iOS `ADDON_NOT_FOUND` at engine init. FIX IN PLACE: `overrides`
  in core's package.json pin the mismatched addons to the app's versions; `ios-dev-
  install.sh` runs `npm install` on the Mac so linked frameworks match. TRADE-OFF: the
  pins must track each app's top-level versions. PROPER FIX: a workspace/hoist setup, or
  drop core's holepunch devDependencies so versions can't drift.
- **Diagnostics - review + keep/revert deliberately** (recommend KEEP the error
  surfacing): `app/index.tsx` shows an "Engine failed to start" page + writes
  `Documents/init-error.txt`; `engine.js` dispatch includes `err.stack`; the fix for
  `callRaw` silently swallowing init errors. The init-error.txt write is optional.
- ~~**Make the debug-build Android config durable**~~ DONE (verified 2026-07-09):
  `applicationIdSuffix ".debug"` + `debuggableVariants = []` live in the
  `plugins/with-android-debug-standalone.js` config plugin, so they SURVIVE a fresh
  `expo prebuild -p android --clean` (confirmed - both present after a clean regen).
  Suite convention holds: debug builds are standalone `.debug`-suffixed installs (never
  Metro-dependent). Remaining build-hygiene gap: `gradlew assembleDebug` uses whatever
  `android/` exists, so a stale `android/` (predating an app.json/icon/plugin change)
  silently ships old assets - as happened with the notification glyph. Consider a
  build wrapper that prebuilds first (same class as the iOS `ios-dev-install.sh` gap
  below).
- **iOS dev-install workflow** (`scripts/ios-dev-install.sh`): build + archive on the
  Mac mini, then install from this linux box via `ideviceinstaller install <ipa>` over
  USB (devicectl install fails "Authorization required" over the wireless CoreDevice
  link; screenshot/launch need a mounted Developer Disk Image).
- **`ios-dev-install.sh` only prebuilds when `ios/` is MISSING** - a stale `ios/` (e.g.
  generated before an icon / plugin / entitlement change) silently ships old assets
  (this is exactly how the blank iOS icon shipped for days). Make it detect staleness or
  always prebuild (ios/ is gitignored + has no custom native code, so `rm -rf ios` before
  a build is safe). Until fixed, `rm -rf ios` before a build after any app.json/icon
  change.
