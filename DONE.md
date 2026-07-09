# PearPetal - Done

Chronological log of shipped work, newest first. One line (or few) per item with
its date + PR. Deep rationale for T2/T3 changes lives in `DECISIONS.md`; open
work lives in `TODO.md`.

## 2026-07-09

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
