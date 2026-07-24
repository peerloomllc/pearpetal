# PearPetal - Done

Chronological log of shipped work, newest first. One line (or few) per item with
its date + PR. Deep rationale for T2/T3 changes lives in `DECISIONS.md`; open
work lives in `TODO.md`.

## 2026-07-23

- **Settings page regrouped: one idiom, four groups, ~4 screens down to ~1.3**
  (PR #96, Tim's call after reviewing the page on device). The page had three
  competing card styles with no rule - centred-title always-open (flower,
  appearance, tracking-for), left-title-plus-switch always-open (reminders,
  connection) and icon-plus-chevron collapsed (lengths, health, data, recovery,
  devices) - so a user could not predict whether a thing would be open or need a
  tap. Appearance sat permanently expanded taking a third of a screen while
  "Health & birth control", which actually moves predictions, was hidden. The
  cycle settings were split, with "What are you tracking for?" near the top and
  "Cycle lengths" + "Health" five cards later. And the title said "Cycle settings"
  over a page where 7 of 11 cards had nothing to do with the cycle.
  Now: titled **Settings**, profile pinned open at top (it is identity, and the one
  thing a partner sees), then four labelled groups - YOUR CYCLE (tracking for /
  lengths / health), HOW IT LOOKS (appearance + flower merged into one section),
  ALERTS & CONNECTION (reminders / connect anywhere), YOUR DATA (devices /
  recovery phrase / backup & restore). Every row is the same `CollapsibleCard`
  with an icon.
  `CollapsibleCard` gained an optional `right` slot for a control pinned to the
  header outside the expand button - a switch has to be flippable WITHOUT opening
  the section, and it cannot be nested inside the header button (invalid, and the
  click would fire both). `AppearanceCard` split into `ThemeRow` (the segmented
  control, now inside the owner's section) plus the old card wrapper, which the
  VIEWER settings still uses since it has no sections to slot into.
  VERIFIED on the TCL (debug 1.0.2): all four groups render, every section expands
  and collapses with the caret rotating, the flower picker and theme control render
  inside their merged section, and both switches flip without expanding their row.
  `npm test` 131/131.

- **Connection details: make a relayed connection observable** (PR #96): the relay
  shipped in PR #95 with no way to tell "it connected" from "it connected THROUGH the
  relay", which left the off-LAN hardware gate unfalsifiable.
  FINDING that shaped the work: hyperdht keeps `stats.relaying { attempts, successes,
  aborts }` but increments it ONLY in `lib/server.js`, on the side ACCEPTING a
  connection that asked to be relayed. The side that ESCALATED gets no counter, so
  copying PearTune's surface would have read a flat 0 on the phone that was actually
  rescued. So `src/relay.js` now counts its own decisions (`dials` / `direct` /
  `offered` / `suppressed`) in the policy function Hyperswarm calls per dial;
  `offered` is the escalation counter that was missing, and `suppressed` distinguishes
  "the network blocked it" from "you switched the helper off".
  Surfaced via a new `network:stats` method and a collapsed "Connection details"
  panel inside the Settings connection card, polling every 2s while open so the
  numbers move during a live pairing, with a Copy details button for the raw JSON.
  Every hyperdht-sourced field degrades to null rather than throwing when the swarm
  has no dht yet.
  VERIFIED: `npm run verify` green - 131 tests (up from 126: 4 new counter tests in
  `test/relay.test.js` plus a `network:stats` graceful-degradation test in
  `test/petalMethods.test.js`) and all three bundles built.
  VERIFIED ON HARDWARE (2026-07-23, `com.pearpetal.debug` 1.0.2 built and installed
  over USB to BOTH the Pixel 9 Pro `53071FDAP00038` and the TCL `4H65K7MFZXSCSWPR`;
  driven on the TCL per CLAUDE.md rule 6, Pixel install confirmed by
  `dumpsys package` and otherwise left untouched). Settings -> "Connect anywhere"
  renders with the toggle ON, the explainer, and Connection details expanding to real
  live numbers: Connected right now 0, Direct connections tried 4, Times the helper
  was offered 0, Connections we helped relay 0/0.
  THAT IS A RESULT, not just a screenshot. "Direct connections tried" only
  increments INSIDE our `relayThrough` hook, so a non-zero value proves Hyperswarm is
  calling the policy on every outbound dial and the PR #95 wiring is live on a real
  device. And 0 escalations on wifi is exactly the negative case the gate wants: a
  punchable network is never relayed.
  THEN, UNPLANNED, THE POSITIVE CASE APPEARED. While scrolling the Settings page
  the panel moved from `0/0` to **Connections we helped relay 1/1**, with both
  phones running PearPetal on the same wifi. That is hyperdht's own server-side
  counter, so a real remote peer escalated to the DEPLOYED relay node and the
  relayed connection succeeded: the relay works end to end against live
  infrastructure, not just in tests. Caveats recorded honestly - the peer was not
  positively identified (the Pixel is observe-only, so its escalation counter could
  not be read) and it was wifi, not cellular, so a same-LAN hairpin-NAT punch
  failure is the likely trigger.
  STILL OWED: the CARRIER case specifically. Tracked in `TODO.md`.
  Also fixed here: the card's wifi icon was vertically centred, so on a narrow phone
  it floated beside the middle line of the three-line description instead of the
  title. `alignItems: 'flex-start'`; re-verified on the TCL.

- **Off-LAN backstop: adopt the shared PeerLoom blind relay** (PR #95): two phones on
  carrier CGNAT often cannot hole-punch to each other, and PearPetal is phone-to-phone
  on both of its paths (device linking and partner sharing) with no always-on node
  anywhere in its design to soften it. The swarm now offers the already-deployed,
  suite-shared relay as a retry when a direct punch aborts. Rationale, privacy posture
  and the direct-first proof in `DECISIONS.md` 2026-07-23 and
  `proposals/2026-07-23-blind-relay.md`.
  Shipped: `src/relay.js` (baked key + pure policy + the fail-safe cache), a
  `createSwarm` injection in `src/bare.js` through the seam `@peerloom/core` already
  exposed (core unchanged, no core release needed), `network:get`/`network:set` backed
  by a device-local `network` record and a "Connect anywhere" card in Cycle settings.
  `z32` promoted to a direct dependency.
  VERIFIED: `npm run verify` green - 126 tests (up from 115: 10 new in
  `test/relay.test.js` covering gate ordering, direct-first, the randomized-NAT case,
  the fail-safe unhydrated cache and the real `createRelaySwarm` wiring, plus one
  `network:get`/`network:set` round-trip in `test/petalMethods.test.js`) and all three
  bundles built. NOT YET VERIFIED ON HARDWARE - the two-phones-on-cellular gate is
  still owed and is tracked in `TODO.md`.

## 2026-07-23

- **All three devices on merged `main`, iPhone rebuilt with Universal Links**
  (PR #101 for the tracking; the builds themselves are not code changes). After
  merging PRs #95/#96/#98/#99/#100, built and installed from clean `main`:
  Pixel 9 Pro + TCL on `com.pearpetal.debug` 1.0.2 via
  `scripts/android-debug-install.sh`, and the iPhone SE on `com.pearpetal` 1.0.2 via
  `scripts/ios-dev-install.sh` (archive on the Mac mini, `ideviceinstaller` over USB).
  The iOS build was then REDONE with `PEARPETAL_ASSOCIATED_DOMAINS=1` so Universal
  Links survive prebuild. The plugin's own comment warns that keeping the entitlement
  makes a wildcard dev profile fail to sign - it did not, because the profile permits
  `com.apple.developer.associated-domains` (`*`). Verified rather than assumed: the
  entitlement is in the SIGNED binary (present in the code-signature blob, not just
  the declared plist) pointing at `applinks:peerloomllc.com`, and the live
  `apple-app-site-association` returns 200 as `application/json` listing
  `G79ALD29NA.com.pearpetal` for `/petal/link`, `/petal/link/*`, `/petal/join`,
  `/petal/join/*`. The UL tap-test in `TODO.md` is therefore unblocked on iOS;
  Android was not re-checked.
  PROCESS NOTE worth remembering: PR #97 (the Settings regroup, stacked on #96's
  branch) was AUTO-CLOSED by GitHub when that base branch was deleted on merge, and a
  closed PR cannot be retargeted. The commit was rebased onto `main` and reopened as
  #99. If a stacked PR is used again, merge the child first or retarget it BEFORE
  merging the parent.

- **Dial/Month toggle no longer covers the flower and info buttons on a narrow
  phone** (PR #98, reported by Tim on the TCL). The floating view toggle was a FIXED
  240px centred with `left:50% / translateX(-50%)`, and it sits in the same top band
  as the flower-picker thumb (left) and the dial-info button (right). It also carries
  `zIndex:2` against their `zIndex:1`, so where they collided the toggle won.
  The arithmetic, since this is width-dependent and only bites small screens: a 360dp
  phone gives 360 - 2*24 padding = 312px of content, so a centred 240 spans 36..276.
  The flower button occupies 12..46 (left 12 + pad 4 + 26px thumb + 4) and the info
  button 272..300 (right 12 + pad 4 + 20px glyph + 4). That is a 10px overlap on the
  left and 4px on the right. On a 412dp phone content is 364px, the toggle spans
  62..302 and nothing touches - which is why it looked fine everywhere else.
  FIX: the wrapper is now inset `left/right: TOGGLE_SIDE_CLEAR (52)` instead of
  centred at a fixed width, and `ViewToggle` takes `width:100% / maxWidth:240`. 52
  clears the wider button (46) with 6px spare and stays symmetric, so the toggle is
  still centred and still renders at exactly 240 wherever there is room. Nothing
  changes on a wide screen.
  Note the near-miss: `TOGGLE_INSET` already existed as the VERTICAL padding both
  cards use to clear this same toggle. The new constant is `TOGGLE_SIDE_CLEAR` so the
  two meanings cannot be conflated; the build caught the collision.
  VERIFIED on the TCL (720x1600, 320dpi = 360dp wide): flower thumb and info button
  both fully clear in the Dial view, Month view unaffected, toggle still centred.
  `npm run verify` green (126 tests + all bundles).

## 2026-07-21

- **GrapheneOS/Vanadium WebView resume-freeze fix - renderer-kill recovery** (PR #93):
  ported from PearCircle PR #165 per `/home/tim/peerloomllc/WEBVIEW_FREEZE_FIX_PORT.md`.
  Since the 2026-07-19 Vanadium 151 update, Android's cached-app freezer freezes the
  out-of-process WebView renderer while backgrounded and its compositor never re-attaches
  to the new window surface on resume - taps and JS still run, the screen never repaints.
  Only a FRESH render process recovers it; a view-remount does not (it rebinds the same
  pooled stale renderer). Fix in three parts: a generated `WebViewRecoveryModule` Kotlin
  native module calling `WebViewRenderProcess.terminate()` (API 29+, minSdk is 29), an
  `onRenderProcessGone` -> `reload()` handler on the shell's `<WebView>`, and an AppState
  hook that terminates the renderer on resume after a >=20s background. Android-only;
  iOS/WKWebView has no cached-app freezer. Applied defensively - PearPetal was observed
  immune, but Vanadium hits every WebView app.
  Because `android/` is gitignored and regenerated by `expo prebuild`, the Kotlin ships as
  a config plugin (`plugins/with-android-webview-recovery.js`) that writes the module +
  its `ReactPackage` and registers it in `MainApplication.getPackages()`. That differs
  from PearCircle, which checks `android/` in and edits the Kotlin directly.
  VERIFIED on the GrapheneOS Pixel (`com.pearpetal.debug`, Vanadium 151.0.7922.29):
  `npm run verify` green (115 tests), clean `expo prebuild -p android --clean` regenerated
  both Kotlin files and the registration with the other four Android plugins intact,
  `assembleDebug` BUILD SUCCESSFUL. A 30s background -> resume logged
  `[webview] render process gone, didCrash=false -> reload`, spawned a fresh renderer
  (pid 7194 -> 7551), and the app repainted fully (dial, phase, predictions; gfxinfo frames
  advancing). Trade-off: a return after >=20s background costs a ~1-2s WebView reload;
  `WEBVIEW_RECOVERY_MIN_BG_MS` is the tuning knob.
- **Builds always prebuild first, on both platforms** (PR #94): `android/` and `ios/` are
  gitignored and regenerated from `app.json` + config plugins, so building against a
  stale one silently ships old assets - a build that SUCCEEDS and is wrong. It had
  already cost us twice: the wrong notification glyph on Android and the blank app icon
  on iOS for days.
  `scripts/ios-dev-install.sh` prebuilt only `if [ ! -d ios ]`; it now always runs
  `rm -rf ios && expo prebuild`, with a `SKIP_PREBUILD=1` escape hatch, mirroring what
  `ios-appstore.sh` already did. That also makes `PEARPETAL_ASSOCIATED_DOMAINS=1`
  reliable, since the entitlement is decided at prebuild time and a stale `ios/` ignored
  it. New `scripts/android-debug-install.sh` gives the debug path the guarantee
  `release.sh` already had for release: JS bundles -> `expo prebuild --clean` ->
  `assembleDebug` -> install, resolving a device name through the suite's `adb-find.sh`
  (wifi addresses change on every reconnect, so they are never hardcoded). Debug builds
  are standalone, so a stale `assets/*.bundle` ships as silently as a stale `android/` -
  hence rebuilding the bundles too.
  VERIFIED: both scripts pass `bash -n`; `./scripts/android-debug-install.sh pixel` ran
  the full pipeline green (bundles -> clean prebuild -> BUILD SUCCESSFUL in 47s -> 147MB
  APK -> resolved `pixel` -> `Success`).
- **Store release v1.0.1 shipped to all four channels** (2026-07-16, tag `v1.0.1`):
  GitHub Releases, the App Store, Zapstore and Google Play. Carries the device-link
  engine, which had been the default private-base + own-device-linking engine since
  PR #82 but had never reached users. Recorded here 2026-07-21 - it shipped without a
  DONE.md entry at the time.
  CAVEAT worth knowing: the `app.json` version bump (1.0.1 / buildNumber 7 /
  versionCode 1000001) and the rewritten `release_notes.md` were never committed, so the
  `v1.0.1` tag points at a commit whose `app.json` still said 1.0.0. Committed
  retroactively in PR #94. Since PR #87 the About footer stamps its version from
  `app.json` at build time, so an uncommitted bump means `main` builds a wrong-version
  app.
- **Cycle screen fits one phone screen with no scrolling** (2026-07-16, branch
  `feature/cycle-view-bottomsheets`; recorded here 2026-07-21). The screen used to stack
  a ViewToggle + the dial/calendar card + a full inline `DayEditor` card + a "Recent days"
  collapsible, which overflowed a small phone. Two changes did it:
  - `DayEditor` moved out of an inline card into a sheet. A one-line `DaySummaryBar`
    ("Today · Medium flow · 1 symptom" + Log/Edit) stays inline; the full editor opens in
    `DayEditorSheet`, and tapping a dial day or calendar cell opens the same sheet on that
    date, making scrub -> log one gesture. Unplanned bonus: the dial behind the sheet
    live-updates as you tap.
  - Reclaimed the view-toggle row and the `Add period` button. The Dial/Month toggle no
    longer owns a row - it floats top-centre of the card in the band the dial already
    leaves empty, positioned against a wrapper rather than either card so it does not move
    or remount across views (the calendar card takes `paddingTop: 62` to clear it).
    `Add period` / `Adjust period` is GONE from the tracking (`known`) state: day-to-day
    use is logging flow, which starts a period implicitly, so the by-date-range path is a
    correction, not a daily action (Tim's call). It now lives as a "Set period dates ›"
    link at the foot of the day sheet, handed off on the day sheet's CLOSE so the two
    sheets never stack. The learning (`!known`) state keeps its up-front Add period button,
    where it IS the primary action.
  VERIFIED on the Pixel: no scroll on the dial view, Recent days fully visible with ~250px
  to spare on both views, and the log round-trip (open -> chip -> save -> Done -> bar
  updates) confirmed on hardware. Later confirmed to fit on the iPhone SE too (Tim,
  2026-07-21), which retired the three further trims that had been queued as fallbacks.
- **Dial: "tap the flower centre = back to today" made discoverable** (2026-07-16, branch
  `feature/dial-calendar-polish`; recorded here 2026-07-21). Two halves that turned out not
  to overlap: a `DialInfoSheet` line ("Tap the flower's centre to jump back to today"), and
  a "Today" pill drawn at the dial's centre in `PetalDial.jsx` whenever
  `selDay !== dayOfCycle` - i.e. only while scrubbed away, so the flower stays clean when
  the hint would be a no-op. `pointerEvents: none` on the pill, so the tap belongs to the
  svg handler underneath whose `posToDay` already did the right thing. Pixel-VERIFIED:
  scrub to Jul 7 -> pill appears -> tap centre -> back to today, pill gone. The
  pulse-on-first-scrub idea was deliberately NOT built - the pill is self-evident and a
  pulse would be noise on top.
- **Month view: the "Today" button tracks the DAY, not just the month** (2026-07-16;
  recorded here 2026-07-21). Exactly the one-line fix predicted:
  `atToday = isCurrentMonth && selected === today` replaces `isCurrentMonth`.
  TCL-VERIFIED: the current month with Jul 12 selected now shows the button (it did not
  before); on today it stays hidden. The partner view has a dial but no calendar, so there
  was no second site to fix.
- **Month view: smoother left-right transition** (2026-07-16; recorded here 2026-07-21).
  Pixel-VERIFIED frame-by-frame off `screenrecord`, which is the only way to judge this.
  Went further than "slow it down", because slowing the old animation would not have fixed
  it:
  - `MonthGrid` split out of `MonthCalendar` so the outgoing and incoming months can render
    at once; the outgoing one stays mounted for the length of the slide.
  - Both months travel: 340ms on `cubic-bezier(0.22, 1, 0.36, 1)` (decelerating; plain
    `ease` starts slow and reads as a snap at this length).
  - No opacity fade, full-width travel, `overflow: hidden`. The first attempt kept the fade
    and a 38px nudge, and frames showed the two grids superimposed mid-travel with doubled
    dates. Ghosting. They must never overlap: outgoing slides fully out, incoming fully in,
    clipped by the container, like one strip.
  - `useLayoutEffect`, not `useEffect`, to mount the outgoing copy. With `useEffect` the new
    month rendered offscreen at the start of its slide while the outgoing copy had not
    mounted yet -> a one-frame BLANK FLASH that the old fade had been masking. Caught on the
    frame strip; invisible at full speed but real.
  Deferred and still not built: finger-tracking the swipe (`onTouchMove`) so the grid follows
  and settles instead of animating only on release. Bigger change; the caret + swipe both
  look right without it.
- **iOS to-self cycle reminders confirmed on hardware** (Tim, 2026-07-21). The opt-in
  period-due and fertile/ovulation reminders (built 2026-07-09, proposal
  `2026-07-09-notifications`) had been fully verified on the TCL but never on iOS, which was
  the last open item on that feature. Now confirmed on the iPhone; nothing to change.

## 2026-07-16

- **Donations unhidden on iOS - About section + two-week nudge** (PR #88): dropped BOTH
  `isIOS()` gates, so iOS now matches Android exactly (supersedes the 2026-07-08 blocker
  #7 / #8 entries below). The `isIOS` helper had no other callers and went with them;
  `window.__pearPlatform` is now unread by the UI. A DELIBERATE acceptance of App Store
  3.1.1 review risk - flagged twice, accepted by Tim. If Apple ever objects, re-gate the
  NUDGE first (unprompted = the likelier target) and keep the About section. Built +
  installed on the iPhone SE with `PEARPETAL_ASSOCIATED_DOMAINS=1` (UL entitlement
  confirmed intact in the signed archive); **iOS rendering CONFIRMED on device by Tim**.
  DECISIONS 2026-07-16.
- **About version stamped from `app.json` at build time** (PR #87): the footer hard-coded
  `'0.1.0'` while the release was 1.0.0, so the shipped app showed a stale version.
  `scripts/build-ui.mjs` now reads `expo.version` and injects it via an esbuild `define`
  (throws if absent, so a bad `app.json` fails the build); `package.json` synced to 1.0.0.
  `app.json` is the single version of record - a release version bump no longer needs an
  App.jsx edit.
- **Dropped unused `expo-clipboard`** (PR #89): never imported anywhere; every copy path
  uses `navigator.clipboard.writeText` in the WebView with a `shell:share` fallback. Rode
  in on #87 as a pre-existing working-tree change. Next iOS build regenerates a slightly
  smaller pod set.
- **🍎 PearPetal APPROVED + LIVE on the App Store.** Apple's review verdict came back
  approved; v1.0.0 is publicly downloadable at
  `https://apps.apple.com/us/app/pearpetal/id6789721938` (Health & Fitness, free, iOS 15.1+,
  76.3MB, 16+). Submitted 2026-07-11 as build 2 and Waiting for Review since (see below);
  this closes the last item that was "not in our hands" on the iOS channel.
- **App Store badge enabled on the website** (website PR #35): `/pearpetal/`'s App Store
  badge now links to the listing instead of sitting in `coming-soon` (href + `aria-label`
  / `alt` -> the download wording, matching PearList and PearCircle). Squash-merged to
  `main`, auto-deployed via Cloudflare Pages, and live-verified on peerloomllc.com. Google
  Play stays `coming-soon` until the closed-testing promotion lands.

## 2026-07-12

- **🔗 Device-link adoption SHIPPED - `@peerloom/device-link` enabled by default.**
  PearPetal's private base + own-device linking migrated from `@peerloom/core`
  groups to device-link's personal Autobase + SLIP-48 mnemonic identity + pairing.
  Proposal `2026-07-12-adopt-device-link.md` (T3, 6 decisions); design record in
  `DECISIONS.md`. Built behind `DEVICE_LINK_ENABLED` across slices, then flipped on
  (PR #82) after passing the hardware gate (B->A sync + iOS runtime) on TCL + Pixel
  + iPhone. Partner sharing stays on `@peerloom/core`. Rollback = revert one line
  (core-group path retained + tested; migrated devices keep the legacy base).
  - Delivered: QR-first device linking (generate + scan); recovery phrase (SLIP-48);
    one-time legacy->personal migration on first launch; profile (name+avatar) +
    settings (cycle lengths/goal/flower/conditions/BC) sync across own devices;
    live refresh on sync; remove-device; reordered onboarding (link path skips name).
  - PRs: device-link #1 (Tier-2 green + group test), #2 (blank-QR), #3 (bare-path
    iOS ADDON_NOT_FOUND fix), #4 (personalUpdated event); `@peerloom/core` #15
    (expose store/swarm on method ctx); PearPetal #74 (proposal) #75-#81 (slices +
    fixes) #82 (flag flip). `npm run verify` green throughout (115 tests + 3 bundles).
  - New package `@peerloom/device-link` (private repo `peerloomllc/peerloom-device-link`),
    extracted from PearCal; Tier-1 pure modules + Tier-2 `createDeviceLink` engine.

## 2026-07-11

- **🚀 PearPetal 1.0.0 LAUNCHED on every channel.** First public release, live/submitted
  everywhere:
  - **App Store (iOS)**: v1.0.0 (build 2) submitted, Waiting for Review (see 2026-07-10).
  - **GitHub Releases**: `release.sh` published v1.0.0 - the lean 120.8MB arm64 APK +
    sha256, signed with the `pearpetal` key.
  - **Zapstore**: published via `release.sh` (created `zapstore.yaml`, gitignored per suite
    convention; reused the shared PeerLoom `SIGN_WITH` nsec). Nostr launch note posted.
  - **Google Play**: first PeerLoom app on Play. Created the app, filled the store listing
    (from `metadata/listing-play.md` + feature graphic + Android screenshots) and all App
    content declarations (Data safety = No data collected/shared; target 18+; Health app
    declaration; no ads), uploaded the 50.3MB AAB -> **Play App Signing enrolled**, released
    to closed testing.
- **Android App Links complete for Play + direct installs** (website PR #28): Play delivers
  apps signed with Google's app-signing key (not the `pearpetal` upload key), so
  `assetlinks.json` now lists BOTH fingerprints for `com.pearpetal` - the upload key
  (`34:DA...`, GitHub/Zapstore) and Google's Play signing key (`F6:93...`, Play). Live-
  verified on peerloomllc.com. Also deployed the iOS `pear://`->Keet landing-page fix
  (`petal/{link,join}` show a "Get PearPetal" CTA on iOS instead of bouncing to a
  Keet-claimed scheme).
- **APK size audit** (`plugins/with-android-abis.js`, PR #71): 476MB -> 120.8MB by
  restricting the release to `arm64-v8a` (mirrors pearlist; 64-bit required by Play since
  2019). Signed arm64 APK's cert SHA-256 matches the assetlinks fingerprint. Minify left
  off (matches siblings; risky on the Bare native stack). See DONE below / TODO for detail.
- **Official README + MIT LICENSE** (PR #70): replaced the stale "pre-scaffold" README with
  a proper public one; GitHub now shows the MIT license.
- **Store-screenshot pipeline + assets** (PRs #65, #66, #67): a deterministic fixtures
  harness (`src/ui/screenshot-fixtures.js`, 6 scenes off the real prediction) + ported
  capture scripts; captured Android (Pixel_9) + iOS (iPhone 17 Pro Max, 6.9") sets; Play
  feature graphic + 512 icon.
- **iOS Universal Links provisioned end-to-end** (PR #63): explicit `com.pearpetal` App ID
  with Associated Domains, Xcode account on the Mac + `-allowProvisioningUpdates`, App Store
  Connect record. Apple's AASA CDN refreshed ~80min later, so UL is live.

## 2026-07-10

- **iOS v1.0.0 SUBMITTED to the App Store — Waiting for Review**. First submission. Built
  + uploaded via `scripts/ios-appstore.sh` on the Mac mini (prebuild keeping Universal
  Links -> archive signed by the "PearPetal App Store" distribution profile -> export ->
  upload via the shared ASC API key). app.json bumped to 1.0.0 / iOS build 2 (build 1 was a
  0.1.0 test upload). Listing filled from `metadata/listing-appstore.md` (subtitle, promo
  text, description, keywords), 6.9" screenshots from `metadata/ios/screenshots/`, privacy
  = "Data Not Collected", category Health & Fitness, price Free. Now in Apple's review
  queue. REMAINING (iOS): respond to any review feedback; then release. Android release
  (`scripts/release.sh` -> GitHub/Zapstore/Play) not yet run.
- **iOS Universal Links provisioned end-to-end + App Store Connect app created**: registered
  an EXPLICIT `com.pearpetal` App ID in the Apple Developer portal with the **Associated
  Domains** capability (wildcard App IDs can't carry it); created the PearPetal record in App
  Store Connect (bundle id `com.pearpetal`). The headless archive kept failing (still picked
  the wildcard profile; then `No Accounts`) until we signed the PeerLoom Apple ID into Xcode
  on the Mac mini and added `-allowProvisioningUpdates` to `scripts/ios-dev-install.sh`
  (archive + export) so xcodebuild mints the explicit managed profile including the capability.
  Rebuilt with `PEARPETAL_ASSOCIATED_DOMAINS=1` -> the entitlement (`applinks:peerloomllc.com`)
  is signed in; ARCHIVE + EXPORT + install SUCCEEDED on the iPhone SE. Remaining is the human
  tap-a-link confirm. The `with-ios-no-associated-domains` plugin still strips the entitlement
  by default (so no-env dev builds archive without the App ID); set the env to include UL.
- **iOS dev builds unblocked - strip the Associated Domains entitlement**
  (`plugins/with-ios-no-associated-domains.js`): `ios.associatedDomains` (added for
  Universal Links) made every iOS archive fail because the wildcard dev provisioning
  profile can't sign the Associated Domains capability (same class as the aps-environment
  issue). New config plugin deletes `com.apple.developer.associated-domains` from the
  entitlements by DEFAULT (dev), gated so `PEARPETAL_ASSOCIATED_DOMAINS=1` keeps it for a
  future provisioned build. Verified: generated `PearPetal.entitlements` is empty, archive
  + export + USB install SUCCEEDED, iPhone SE got this session's build. Listed FIRST in the
  app.json `plugins` array (entitlement mods run in reverse order). iOS tap-to-open stays
  deferred until an explicit `com.pearpetal` App ID with the capability is provisioned.
- **All three devices on the partner-mode build** (2026-07-10 device pass): rebuilt +
  installed to the TCL + Pixel 9 Pro (Android debug APK, `adb install -r`, both launch
  clean) and the iPhone SE (iOS, via `scripts/ios-dev-install.sh` on the Mac mini). The
  WebView UI is a native build-time asset (`Asset.fromModule(require('assets/app-ui.bundle'))`
  in `app/index.tsx`), so shipping UI changes needs a full native rebuild, not just build:ui.
- **Partner (viewer) mode gets a real shell** (T1, UI-only, no wire change): the viewer
  side was a dead-end screen; now it mirrors the owner shell where it makes sense.
  - **Viewer bottom nav** (Shared / Settings / About). `BottomNav` generalized to take a
    tab set + width-aware active indicator; new `VIEWER_NAV_TABS`. App routes viewer
    `main/settings/about` and Android Back walks viewer sub-screens -> main like the owner.
  - **Scoped `ViewerSettings`**: profile (name + photo, shown to owners they view) +
    appearance (theme). Deliberately omits cycle prefs / reminders / backup - a viewer has
    no private base, so reminders produce no events, there's nothing to export, and
    `PartnerView` hardcodes the flower. Extracted a shared `AppearanceCard` (owner + viewer);
    reused the self-contained `ProfileCard`. About reuses `AboutScreen` as-is.
  - **"View a partner's cycle" entry point** on `ViewerHome`: opens the existing
    `JoinPartnerSheet` (paste link / scan QR), so a viewer can accept invites from more than
    one owner - not just at first install. On join it refreshes the list and opens the new
    partner's cycle.
  - Dev: `?seed=viewer` browser-preview seed in `ipc.js`. verify green (build:ui clean,
    89 tests). ON-DEVICE VERIFIED 2026-07-10 (two-phone: TCL owner <-> Pixel 9 Pro viewer):
    viewer nav + Settings + About + the "View a partner's cycle" join flow all confirmed good.
- **Website: universal links + privacy/support/landing pages** (in the `website/`
  repo; deploy pending). Closes most of the website-side release work and the App
  Store privacy-page requirement.
  - **Privacy page** (`website/pearpetal/privacy.html`) - health-data specific: the
    structural two-base privacy boundary, on-device predictions never crossing the wire,
    optional encrypted backups, per-permission rationale (camera/notifications/network),
    no accounts/tracking/analytics, children's-privacy + not-medical-advice sections.
    Effective 2026-07-10. Plus a **support/FAQ page** and a **`/pearpetal/` app landing
    page** (store badges, GitHub link), mirroring the PearList pattern.
  - **Universal-link tap-to-open**: iOS `apple-app-site-association` gains
    `G79ALD29NA.com.pearpetal` (paths `/petal/link*`, `/petal/join*`); `associatedDomains`
    (`applinks:peerloomllc.com`) added to the iOS `app.json`; `/petal/link` + `/petal/join`
    landing pages reconstruct the `pear://pearpetal/link|join#<blob>` deep link, passing the
    invite blob through the URL #fragment (so it never reaches the server) and auto-opening
    the app. Verified route-by-route against a local clean-URL server (all 200; deep-link
    reconstruction + JSON validity checked).
  - **Android `assetlinks.json`**: added BOTH the RELEASE `com.pearpetal` fingerprint
    (release key generated in `/home/tim/keystore.jks` alias `pearpetal` on 2026-07-10)
    and `com.pearpetal.debug` (shared default debug keystore) so App Links autoVerify for
    both release and on-device `.debug` builds. PearPetal card added to the homepage
    showcase; `icon-pearpetal.png` + `og-pearpetal.jpg` generated from the app art.
  - DEPLOYED to peerloomllc.com 2026-07-10 (website PR #27, app PR #58). Live-verified:
    all pages 200; both `.well-known` files served as `application/json` (the strict
    content-type iOS requires); AASA carries `com.pearpetal`; `assetlinks.json` carries
    the release + debug fingerprints. REMAINING (tracked in TODO): a hardware tap-to-open
    confirm on the next device pass (needs the iOS `associatedDomains` baked in via a fresh
    `rm -rf ios` prebuild).
- **Hardware verification pass - remaining on-device confirmations DONE**: the last
  code-done-needs-confirmation items are now confirmed on real devices.
  - **iOS WebView QR scanner**: the getUserMedia + `jsQR` scanner (Onboarding +
    JoinPartnerSheet) confirmed on iPhone hardware - OS camera prompt -> live scanner ->
    aim-at-QR decode. Closes release blocker #1 (Android was already confirmed 2026-07-09).
  - **iOS Local Network prompt + LAN partner sync**: the LN prompt appears on first
    partner connect on the iPhone and partner sync takes the LAN path (`modules/local-
    network` + boot-time prompt + app.json infoPlist/Bonjour).
  - **Invite/share URL copy-paste across two phones**: copy the
    `https://peerloomllc.com/petal/link|join#<blob>` link on one phone, paste into the
    other -> deep-link routing joins the share (the paste-into-app path; universal-link
    tap-to-open still pending the website `.well-known` files).
  - **User profile - live two-phone owner->partner name display**: owner sets a name,
    partner sees "{name}'s cycle" live (projected via `share:meta`; previously only
    unit-covered - now confirmed with the Pixel as partner).
- **Nice-to-have UX polish shipped + verified**: bottom sheets for day/symptom entry
  (replacing full-screen pushes, reusing the shared `BottomSheet`); a partner-view scoped
  Month calendar (was owner-only); joiner photo avatar in per-person shares (the joiner's
  avatar blob now replicates to the owner via the shared base's blob store - previously an
  initials-only fallback).
- **Optional password-encrypted JSON backups** (T3, proposal + review
  2026-07-10-encrypted-backups, PR #55): export can seal the file under a password.
  Worklet `encryptBackup`/`decryptBackup` on the already-bundled `sodium-universal` -
  Argon2id (`crypto_pwhash`, interactive limits) -> XSalsa20-Poly1305 secretbox over the
  exact `{days,periods,prefs}` payload; self-describing wrapper (salt/nonce/kdf params
  in-file). `export:data`/`import:data` gained an optional `password` (additive);
  decryption completes BEFORE any DB write so a wrong password never partial-imports; no
  identity/secret key is ever in a backup; plaintext stays the default. `test/backup-
  encryption.test.js` (real IPC path). verify green (89 tests). Reviews entry PR #56.
- **Backup export/import UX** (PR #55, #54): export now saves to a real user-picked folder
  via the Android Storage Access Framework (prompts each export, overwrites the same-name
  file), NOT the share sheet (which can't reach Downloads/Files on scoped-storage /
  GrapheneOS); iOS keeps the share sheet. Import errors are mapped to friendly copy (the
  engine serializes `err.stack` over IPC, so match by substring, never show raw). Both
  export and import confirm with a centered success modal (green check + folder / counts)
  instead of a small green line. On-device verified on the TCL end to end (encrypted export
  -> import round trip, folder save, wrong-password message, restore).
- **Onboarding rework** (PR #55): welcome slide -> name/photo step for EVERYONE (moved out
  of the tracking-only wizard so a partner-viewer and a restore-from-backup user set a name
  too; the backup carries no profile; `profile:set` is device-local so it works before any
  base) -> a track-vs-view chooser (device linking hidden/deferred) -> "Track my cycle" runs
  the wizard whose first step offers "Set up my cycle" vs "Restore from a backup" (import
  merges into the just-created base and boots into the populated app). Welcome copy -> "no
  accounts, no servers. Your data stays on your device."; removed the Skip on the name step;
  equal-width partner View/QR buttons.
- **Two-tone PearPetal wordmark** (PR #55): a `Wordmark` component - a petal bloom (echoing
  the dial) + "Pear" in rose (primary) and "Petal" in orchid (accent), theme-var driven so
  light + dark adapt. Replaces the flat single-colour title on welcome / chooser / viewer
  home / About (sizes 34/24/28). Verified in both themes on the TCL.
- **System theme default that follows the OS** (PR #55): default pref is now `system`, and
  `system` now actually tracks the phone. Root cause was `app.json`
  `userInterfaceStyle:"dark"` forcing RN `Appearance.getColorScheme()` to always report dark
  (LIKELY SUITE-WIDE - check sibling apps); fixed to `automatic`. The shell now injects the
  real OS scheme (`window.__pearColorScheme`) into the WebView before the bundle, seeds the
  pre-paint background from it, and pushes live updates via `Appearance.addChangeListener`;
  `theme.js` prefers the injected scheme and re-stamps `data-theme` on OS flips. Verified
  live on the TCL (OS light -> app light, flip to dark -> app dark, no relaunch); iPhone
  rebuilt from a fresh prebuild so `automatic` is baked into Info.plist.
- **Viewers join shared bases client-only** (T3, swarm-accumulation mitigation A;
  proposal 2026-07-09-swarm-topic-accumulation, DECISIONS + review 2026-07-10): fixes the
  pairing slowdown that grows as a device piles up bases. `@peerloom/core` `joinTopic`
  gains a `{server,client}` option + `joinGroup` an `announce` flag (persisted, re-applied
  on init; default true = unchanged); PearPetal `partner:join` passes `announce:false` so a
  partner (pure viewer) joins CLIENT-ONLY and stops redundantly announcing the owner's
  topic. `link:join` keeps the default. Additive + back-compat (no wire/record break).
  Core `npm test` green (43, incl. announce + restart-persistence + two-peer pairing gate);
  app verify green (86 + 3 bundles). Core PR #14. D (Hyperswarm cap) not changed - default
  maxPeers=64 already sane.

## 2026-07-09

- **QR scan + render verified (release blocker #1)** + dead-stub cleanup: the invite
  QR render (`QrImage` via the `qrcode` lib; Sharing + Devices) and scan (`ScannerView`
  via WebView getUserMedia + `jsQR`; Onboarding + JoinPartnerSheet) were already built
  in-WebView - the "stub" the TODO cited (`shell:scanQr`) was unused dead code. Confirmed
  on the TCL: a real invite QR renders, and tapping Scan QR fires the OS CAMERA prompt ->
  grant -> a live scanner (permission wiring: CAMERA in app.json + AndroidManifest;
  NSCameraUsageDescription for iOS; shell grants the WebView camera request). Removed the
  dead `shell:scanQr` from the shell + browser mock. Remaining: a physical aim-at-a-QR
  decode confirm (same jsQR frame path) + the iOS WebView scanner on hardware.
- **First-run onboarding wizard** (release blocker #3; T1, UI-only, no wire change):
  "Start tracking" now creates the private base and hands off to a short, fully
  skippable `SetupWizard` (new root mode `setup`) instead of dropping onto an empty
  "Learning your cycle" dial. Steps: welcome (a decorative blooming dial to show the
  hero) -> name + optional photo (`profile:set`) -> goal incl. pregnancy (`prefs:set`,
  reuses PregnancySetup) -> log your last period (`period:log`, so the dial is
  immediately meaningful) -> reminders opt-in (the folded-in notifications item;
  `shell:notifications:set`, OS prompt only on enable) -> "you're all set" with
  log-a-day + Share-tab tips. Step dots, Back steps through, every step skippable.
  Reuses the existing Settings controls; a viewer who starts their own cycle also
  goes through it. Shape agreed with Tim (guided setup wizard over a coach-mark tour).
  Verify green (85 tests + 3 bundles). ON-DEVICE VERIFIED on the TCL: full walk-through
  (name Maya, goal conceive, period Jun 25, reminders allowed) lands on a POPULATED,
  goal-aware dial (Menstrual day 15, "best chance to conceive", next period Jul 23);
  name + goal confirmed persisted in Settings. Deferred: a deeper interactive
  coach-mark tour of the live menus (deliberately out of scope for v1).
- **Sharing ended (revoke tombstone)** (T2, proposal 2026-07-09-sharing-ended,
  DECISIONS 2026-07-09): when an owner revokes, the partner now sees a calm "sharing
  ended" state on next open instead of silently frozen data. `share:revoke` SOFT-CLOSES
  - writes `revoked:true`+`revokedAt` into the owner-signed `share:meta` (inherits the
  owner-write-only gate, no apply change; distinct `revoked` field, not `deleted`) and
  flags the membership, but keeps the base + swarm alive so the tombstone reaches an
  offline partner on reconnect; `refreshShares`/`refreshShareMeta` skip revoked shares.
  New `share:remove` is the owner "Remove permanently" (old hard teardown). Partner UI:
  a "sharing ended" banner over the dimmed last-known view + Remove; ViewerHome/Sharing
  show "Sharing ended"; owner Sharing gets an "Ended" section. Additive + back-compat.
  Verify green (85 tests + 3 bundles). ON-DEVICE VERIFIED (TCL owner -> Pixel partner, Full scope): join + live sync, revoke soft-close -> partner "sharing ended" banner over dimmed data (live, no reload), partner Remove + owner Remove-permanently clear.
- **Notification tray glyph confirmed monochrome (Android)** (docs/verification only):
  the tray icon had been the colored launcher icon because the built `android/` predated
  the expo-notifications icon config. A fresh `expo prebuild -p android --clean` wired
  `@drawable/notification_icon` (the white silhouette from `monochrome-icon.png`) + the
  `expo.modules.notifications.default_notification_icon` manifest meta-data + tint color
  `#f2789f`; the rebuilt APK shows a correct WHITE monochrome glyph on the TCL (small-icon
  resource is now a drawable, not the mipmap launcher icon). NO source change needed - the
  app.json config was already correct. Also verified the `.debug` standalone config
  survives a clean prebuild (it lives in `with-android-debug-standalone`), retiring the
  "durable debug config" dev-infra item. iOS notifications always use the app icon, so
  there is no monochrome-glyph work there.

- **To-self local notifications v1** (proposal 2026-07-09-notifications, DECISIONS
  2026-07-09): opt-in cycle reminders (period due day-before + day-of; fertile
  window + ovulation), goal-aware + confidence-gated + birth-control-suppressed,
  with a user-configurable "Discreet" mode that hides cycle wording on the lock
  screen. Pure `src/notifications.js` computes the events; worklet
  `notifications:get/set/schedule` own the device-local prefs; the RN shell hands
  the events to expo-notifications as OS-scheduled DATE triggers (delivered even
  when the app is closed - no background execution), rescheduling on boot / app
  foreground / after any prediction-changing edit. Settings "Reminders" card;
  default OFF, OS prompt only on opt-in. No wire change (T1). Verify green (83
  tests + 3 bundles). ON-DEVICE VERIFIED on the TCL (seeded ovulation=today,
  medium confidence): opt-in shows the OS prompt + grant persists (re-enable
  needs no re-prompt); AlarmManager schedules the right dates at the chosen time
  across a 2-cycle horizon; a reminder FIRES while the app is backgrounded with
  the correct descriptive goal-aware content ("Ovulation predicted") AND with the
  discreet wording ("PearPetal") when discreet is on; changing the time reschedules
  all alarms; disabling cancels every scheduled alarm (18 -> 0). Fixed during the
  pass: scheduled (DATE-trigger) notifications need `channelId` on the TRIGGER, not
  just content, else Android routes them to expo's fallback channel - confirmed the
  fix lands them on the custom "reminders" channel. Partner-facing "sharing ended"
  deferred to a T2 proposal.
- **iOS: strip the push entitlement + fix the app icon** (same notifications work):
  the expo-notifications config plugin adds `aps-environment` (Push Notifications) to
  the iOS entitlements, which the wildcard dev provisioning profile cannot sign - a
  fresh `expo prebuild` + Release archive FAILED. PearPetal is local-notifications-only
  (no remote push), so new config plugin `plugins/with-ios-no-aps.js` removes it.
  GOTCHA: iOS entitlements mods run in REVERSE app.json `plugins` order, so this plugin
  is listed BEFORE "expo-notifications" to run after it. Separately fixed a STALE blank
  iOS app icon: `ios/` was generated 2026-07-07 (before the cherry-blossom `icon.png`
  landed 2026-07-08) and `ios-dev-install.sh` only prebuilds when `ios/` is missing, so
  the blank placeholder kept shipping; regenerating `ios/` rebuilds the AppIcon from the
  current art. Both verified on hardware: archive SUCCEEDED + installed on the iPhone SE
  over USB, real icon on the home screen.
- **Pre-paint dark flash fix** (#42): the RN shell reads the WebView's persisted
  resolved theme (AsyncStorage) at boot and paints the loading view / WebView /
  HTML wrapper / status bar to match, so light-theme users no longer flash dark on
  cold start. WebView reports its theme via a new `shell:theme` message.
- **Android Back** (#41): hardware/gesture Back pops the in-app stack instead of
  exiting. A `BackContext` + `useBackHandler` registry lets any overlay (bottom
  sheets, QR scanner, donation modal, onboarding sub-mode) self-register a dismiss
  handler (LIFO); falls through to partner-view / owner-sub-screen -> main; exits
  only at the root. `canBack` gates the shell's Back consumption.
- **Light / Dark / System theme + theme-aware flowers** (#40): Appearance control
  in Settings (persisted, `system` follows the OS live); a `ThemeContext` re-renders
  the flower SVGs; deepened light palettes for rose/sakura/lotus + a warmer furled
  crimson so pale flowers/menstrual state read on white; `html` background painted
  (fixes a dark strip on scroll); uniform flower-picker tiles; collapsible Recents
  (collapsed by default); calmer dial center (flower switcher -> corner icon).
- **Sharing copy tightened** for Part B (#39): the link grants READ to whoever
  holds it, viewers can't edit, and a partner can't re-share access.
- **Share-row truncation fix** (#38): rows show the joiner name alone (the section
  header already says "People you share with") with a 2-line wrap - no more
  "Shared with L..." on narrow screens.
- **Per-person shares Part B - owner-signed writer admission** (core #13 + app #37):
  on a shared base only the owner may admit a writer, proven by an owner signature
  over the joiner's exact writer key + group; a partner can no longer admit a third
  party. Two optional `@peerloom/core` engine hooks (`mintAddWriter` /
  `authorizeWriter`, default legacy so other suite apps are untouched); PearPetal's
  `src/admission.js`. Verified: core two-peer tests + app unit tests + on-device
  re-pair. Proposal `proposals/2026-07-09-addwriter-gating.md`, DECISIONS 2026-07-09.
- **Per-person shares Part A - who joined** (#32): a joiner self-publishes a
  `member:{pubkey}` name row into the shared base; the owner's Sharing rows show
  "Shared with {name}" (or "Someone joined" / "Not joined yet") + a shared-on date
  and live-refresh. Proposal `proposals/2026-07-09-per-person-shares.md`.
- **Flower picker pill / switcher** (#36, then relocated to a dial corner in #40):
  surfaced the flower switcher on the Cycle page instead of only in Settings.
- **Sharing UX + bottom-sheet animation** (#35): revoke made idempotent (fixes the
  "share not found" error) + double-tap guard; QR/Copy/Revoke as inline phosphor
  icon buttons; centered section headings; capitalized scope; a "View a partner's
  cycle" entry (JoinPartnerSheet) for existing owners; a shared `BottomSheet` that
  slides up/down; 3s live poll so rows flip to "Shared with X" in real time.
- **Add / Adjust period button + flow logging** (#30): a Stardust-style
  Add/Adjust-period control opens a date-picker sheet; `period:log` records the
  span AND stamps bleeding flow across it (so the calendar + dial reflect it),
  preserving any per-day intensity.

## 2026-07-08

- **Monthly calendar view** (Stardust blocker #13): Dial/Month toggle; `MonthCalendar`
  color-coded period/fertile/ovulation/logged from a pure `projectCalendar`. Verified
  on the TCL. DECISIONS 2026-07-08.
- **Cycle customization - conditions + birth control** (Stardust blocker #12):
  device-local `prefs.conditions` (PCOS/endometriosis/irregular/thyroid) +
  `prefs.birthControl`; widen the fertile window + cap confidence; BC hides the
  fertile framing. None cross the wire. DECISIONS 2026-07-08.
- **Pregnancy mode + goal-driven tone** (Stardust blocker #11): a `pregnant` goal +
  `prefs.pregnancy`; a gestational `PregnancyView`/`PregnancyDial`; goal tints the
  cycle summary. Owner-only, never projected. DECISIONS 2026-07-08.
- **2-week donation nudge popup** (blocker #8): device-local `donation:status`/`dismiss`,
  shown once, skipped on iOS; routes to About. (iOS skip SUPERSEDED 2026-07-16, PR #88 -
  the nudge now fires on iOS too.)
- **About page + Bitcoin (Lightning) donation** (blocker #7): AboutScreen + the suite
  donation pattern; iOS hides Support development (App Store 3.1.1). (iOS hiding
  SUPERSEDED 2026-07-16, PR #88 - the section now shows on iOS.)
- **User profile - name + avatar** (T2, proposal 2026-07-08-user-profile): device-local
  `profile` + avatar in the blob store; name/avatar projected via `share:meta` so a
  partner sees "{name}'s cycle". DECISIONS 2026-07-08.
- **One canonical "not medical advice" disclaimer** (T0): consolidated onto About.

## 2026-07-07

- **All sync paths VERIFIED on hardware** (TCL + Pixel + iPhone SE): Android<->Android
  device linking + all 3 consent scopes + revoke; Android<->iOS partner (full scope).
  Required a `@peerloom/core` native-addon-mismatch fix for the iOS build.
- **Partner-view blank-until-re-nav fix**: `PartnerView` polls `partner:view` until the
  projection lands (a UI refresh race, not a sync bug).
- **Petal dial in the partner view + ring day-scrub** (blocker #5): PartnerView shows the
  dial; `onDayTap` maps a tapped angle -> cycle day -> date.
- **Safe-area top inset** (blocker #4): shared `screenPadTop` clears the status bar on
  every title screen.
- **iOS Local Network prompt module** (blocker #1, code): `modules/local-network` +
  boot-time prompt + `app.json` infoPlist/Bonjour (forces the LAN path).
- **Invite/share code as a universal-link URL** (blocker #2, code): invites render/copy as
  `https://peerloomllc.com/petal/link|join#<blob>` (blob in the fragment); deep-link routing
  + Android intent filters.
- **App logo / icon + notification-bar icons** (blocker #6, art): cherry-blossom bloom;
  icon/adaptive/monochrome PNGs wired in `app.json`.

## 2026-07-06 / 07 - Core app (slices 1-6)

- Private base (own-device cycle log) + own-device linking.
- Per-partner shared base: owner-write-only, consent-scoped projection (phase /
  fertility / full); partner read-only; invite withholds the private base key.
- On-device prediction (median cycle length, BBT-confirmed ovulation, confidence).
- The signature petal dial (`src/ui/PetalDial.jsx`).
- Flower picker (`src/ui/flowers.js`) - 5 species, device-local pref.
- JSON export/import (plain-file backup + recovery, shell-mediated).
- Built on `@peerloom/core`. Wire protocol v1 (`proposals/2026-07-06-wire-protocol.md`).
