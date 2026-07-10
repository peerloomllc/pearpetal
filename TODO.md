# PearPetal TODO

Open work only. Completed work (dated, with PRs) lives in `DONE.md`; deep
rationale for T2/T3 changes lives in `DECISIONS.md`. Priority order: release
blockers first, then nice-to-haves, design decisions, deferred, dev-infra.

## Release blockers (v1) - do before shipping

Not yet built:
1. ~~**Native QR scan + QR render**~~ BUILT (in-WebView) + Android on-device VERIFIED
   2026-07-09. `QrImage` renders a real invite QR via the `qrcode` lib (Sharing share
   rows + Devices); `ScannerView` scans via WebView getUserMedia + `jsQR` (Onboarding +
   JoinPartnerSheet). Camera path confirmed on the TCL: tap Scan QR -> OS CAMERA prompt
   -> grant -> live scanner (CAMERA in app.json + AndroidManifest; NSCameraUsageDescription
   for iOS; shell grants the WebView request). Removed the dead `shell:scanQr` stub. The
   QR now opens in a bottom sheet that auto-dismisses on real peer connection (`share:connected`);
   full-screen scanner (portal fix). PR #49. Android end-to-end scan CONFIRMED by Tim 2026-07-10.
   iOS WebView scanner CONFIRMED 2026-07-10. FULLY DONE.
2. **Store assets + release** (the publish mechanics). DONE so far:
   - ~~Privacy page~~ (+ support + landing) on peerloomllc.com (2026-07-10).
   - ~~Release scripts ported~~ 2026-07-10: `scripts/release.sh` (Android AAB/APK +
     GitHub/Zapstore/Play/Nostr), `scripts/ios-appstore.sh` (App Store archive+upload,
     with a PearPetal `expo prebuild` step that keeps Universal Links),
     `scripts/app.conf`, `scripts/.env.example`, `plugins/with-android-release-signing.js`
     (wired in app.json; signs release with `~/keystore.jks` alias `pearpetal` =
     assetlinks fingerprint). `release.sh --check-versions` green (detects com.pearpetal,
     starts v1.0.0). NOT YET RUN a real signed build/upload (needs `scripts/.env` creds).
   - ~~Listing copy drafted~~ 2026-07-10: `metadata/listing-play.md` (Play),
     `metadata/listing-appstore.md` (App Store - subtitle/keywords/privacy-label/
     age-rating/export-compliance guidance), `release_notes.md` (v1.0.0 what's-new).
   - ~~Screenshot harness + scripts~~ DONE 2026-07-10: a fixtures harness
     (`src/ui/screenshot-fixtures.js`, 6 deterministic scenes computed by the real
     prediction; wired through ipc.js/App.jsx/shell/`app/screenshot/[n].tsx`) + ported
     capture scripts (`android-screenshots.sh`, `ios-screenshots.sh`, `screenshots.sh`,
     `frame-android-screenshots.sh`). **Android Pixel_9 screenshots captured** (all 6
     scenes render correctly: dial hero, calendar, sharing, partner view, flower picker,
     settings) in `metadata/android/screenshots/`.
   - ~~iOS simulator screenshots~~ DONE 2026-07-10: `scripts/screenshots.sh` on the Mac's
     iPhone-17-Pro-Max sim (UDID in `app.conf`) -> `metadata/ios/screenshots/` (6 scenes
     at 1320x2868, the App Store 6.9" size; dynamic island + iOS status bar, all verified).
   - ~~Play feature graphic + hi-res icon~~ DONE 2026-07-10:
     `metadata/android/play-listing/feature-1024x500.png` (rose-glow dark banner: cherry
     blossom + two-tone PearPetal wordmark + "Private cycle & fertility tracking / No
     accounts. No servers. No cloud.") and `icon-512.png` (Play hi-res icon).
   REMAINING:
   - Optional: a dark-mode screenshot set (the harness supports it - add `dark` to
     APPEARANCES in the screenshot scripts).
   - Minor polish: `PartnerView` shows raw ISO dates (`2026-07-23`) vs the owner view's
     `Jul 23` - swap to `fmtDate` for a nicer scene 4 (and app).
   - **iOS App Store distribution profile**: create "PearPetal App Store" (App Store dist
     profile for com.pearpetal; the App ID already has Associated Domains) for
     `ios-appstore.sh` manual signing.
   - **Fill `scripts/.env`** (keystore + ASC + Play creds) and do a first signed
     build + upload (TestFlight / Play internal).
   - Confirm current Play/App Store policy for menstrual/health trackers at submission.
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

- **APK size audit** (same pass recently done for PearCircle + PearGuard). The debug
  APK is ~476MB (`android/app/build/outputs/apk/debug/app-debug.apk`) - audit what's
  bloating it and confirm the release build is lean. Usual suspects: both ABIs shipped in
  one universal APK (split per-ABI or ship an AAB), unstripped native `.so`s / debug
  symbols, duplicated holepunch/bare native addons, bundled fonts (`src/ui/fonts.js` is
  ~57KB of embedded glyph data), and any dev-only deps leaking into the release graph.
  Compare `unzip -l` of debug vs release, check `enableProguardInReleaseBuilds` /
  `shrinkResources`, and mirror whatever fixes landed for PearCircle/PearGuard.
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
