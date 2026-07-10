# PearPetal - Done

Chronological log of shipped work, newest first. One line (or few) per item with
its date + PR. Deep rationale for T2/T3 changes lives in `DECISIONS.md`; open
work lives in `TODO.md`.

## 2026-07-10

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
    89 tests). REMAINING: on-device confirm on the next hardware pass.
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
  shown once, skipped on iOS; routes to About.
- **About page + Bitcoin (Lightning) donation** (blocker #7): AboutScreen + the suite
  donation pattern; iOS hides Support development (App Store 3.1.1).
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
