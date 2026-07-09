# PearPetal TODO

Priority order: release blockers first, then nice-to-haves, design decisions,
deferred, and dev-infra follow-ups. Full detail for the 2026-07-07 hardware
session lives in memory + (should land in) DECISIONS.md.

## Done

- **Slices 1-6 - the core app** (2026-07-06/07):
  - Slice 1: scaffold + PRIVATE base (own-device cycle log) + own-device linking.
  - Slice 2: per-partner SHARED base, owner-write-only consent-scoped projection
    (phase / fertility / full), partner read-only; share invite withholds the
    private base key.
  - Slice 3: on-device prediction (median cycle length, BBT-confirmed ovulation,
    confidence, prefs) surfaced via `cycle:prediction`; never written to any base.
  - Slice 5: the signature petal dial (`src/ui/PetalDial.jsx`).
  - Slice 6: flower picker (`src/ui/flowers.js`) - 5 species, device-local pref.
  - Slice 4: JSON export/import (`export:data`/`import:data`) - plain-file backup +
    recovery, shell-mediated, no encryption wrapper, no cloud.
  - All merged to main; verify green (32 unit tests + 3 bundles + smoke).

- **All sync paths VERIFIED on hardware 2026-07-07** (TCL T513Z + Pixel 9 Pro + iPhone SE):
  - Android<->Android: private-base device linking (join catch-up + LIVE update), all 3
    consent scopes (phase/fertility/full - monotonic, privacy boundary holds), and revoke
    (forward-only: stops future updates, keeps already-received).
  - Android<->iOS cross-platform: iPhone partner <- TCL owner, full scope.
  - Getting iOS working required a native-addon-mismatch fix (see "Dev infra" below +
    memory): `@peerloom/core`'s nested node_modules bundled version-mismatched addons
    (rocksdb-native, bare-fs, ...) the iOS build couldn't link. Fixed by resolving core
    deps to the app's single top-level set + `npm install` on the Mac in ios-dev-install.sh.

## FIXED 2026-07-07 - partner view blank until re-nav (a UI refresh race, NOT a sync bug)

Symptom: partner's cycle stayed blank after a fresh share+join (both iPhone<-Android AND
Android<->Android); leaving the app and re-entering made it appear. Diagnosed on-device:
replication + apply were working the WHOLE time (partner corestore grew ~95KB on join; owner
+104KB; clocks agree so no future-timestamp apply-reject; invites are distinct - the "same
link" look is just the shared `eyJncm91cElkIjoi` base64 prefix). Root cause was purely UI:
`PartnerView` (src/ui/App.jsx) did ONE initial `partner:view` on mount (returns nulls while
the projection is still replicating) and otherwise only refetched on `group:updated` - but
that event can fire in the gap before the view mounts, and is then consumed by the always-on
owner-mode `group:updated` listener (App.jsx ~543) WITHOUT being buffered (ipc.js only buffers
when there are zero listeners). So the mounted partner view never heard the refresh and sat
blank until a manual remount (leave + re-enter), whose fresh initial load ran after data
landed. FIX: `PartnerView` now polls `partner:view` every 2s until the projection lands
(ownerPubkey/phase/predict present), then stops and relies on the live `group:updated`
subscription. T0/T1 UI-only, no wire change. Needs on-device confirmation (auto-fills without
leaving the view). Consider later: don't let the owner-mode listener swallow events meant for
other views (per-groupId event routing), so the poll is a belt-and-suspenders, not the load-
bearing path.

## Flower design options - INVESTIGATED 2026-07-07: NOT lost

The 5-species flower picker (rose, cherry blossom, lotus, poppy, dahlia) is intact in
`src/ui/flowers.js` and fully wired in `src/ui/App.jsx` (Settings "Your flower" picker w/
live thumbnails -> drives the petal dial). Committed + merged in PR #5 (9affdf8) on main.
Git history clean, no stashes, no orphaned/dangling flower commits, working tree clean - the
morning crash did NOT eat it. If it looks absent ON A DEVICE, that's a stale build (see bug
above), not lost code.

## KNOWN LIMITATION (deferred) - linked device's writes slow to sync back to founder

Device linking (own 2nd device on the private base) currently syncs founder->device (A->B)
immediately, but device->founder (B->A - the new device's own edits + its roster row) can
STALL until a clean reconnect. Confirmed on-device 2026-07-07 (TCL founder + Pixel linked
device): Pixel edits did not reach the TCL, and the Pixel was absent from the TCL Devices
roster - UNTIL the TCL app was force-stopped + reopened, after which both appeared. So the
data is NOT lost and the merge logic is NOT wrong; it converges once a fresh connection forms.
- ROOT CAUSE: connection CHURN during initial writer admission. Trace (private base
  af1BcrUP): the founder applied `addWriter` for the Pixel's key TWICE, interleaved with
  pair:onclose/pair:remote-open - the swarm connection kept dropping + re-forming right as the
  founder should have started pulling the new writer's core, so that pull stalled. A fresh
  app start tears down all swarm state and the pull completes.
- The churn is ENVIRONMENTAL (two real Android devices; likely the leave-then-relink
  transition: Pixel had just left a partner share (destroyGroup -> swarm.leave) then linked
  the private base with the same peer). It does NOT reproduce on a clean local testnet: a
  two-peer repro of the exact leave-relink sequence (written 2026-07-07, then removed) PASSED
  in ~0.8s, proving pairing/replication logic is correct.
- WHY DEFERRED: multi-device-for-one-user is a minor use case for this app (partner sharing -
  the hero feature, owner-write-only, partner read-only - does NOT use the B->A writer path
  and is fully verified). New-phone migration is better served by export/import (slice 4).
- IF REVISITED: make the founder re-pull new writer cores once the connection settles (churn-
  resilience), needs a way to reproduce real-network churn to verify. Also a genuine small app
  gap: a device that becomes writable AFTER link:join never re-publishes its device:{pubkey}
  row (publishDevice runs only at join + boot, both before writable; add a post-became-writable
  retry, e.g. device:publish on group:updated while owner). Release-notes wording: "a linked
  second device may need an app reopen to finish syncing its first edits."

## Release blockers (v1) - do before shipping

Everything here ships in v1. Rough build order below (the onboarding demo is last
because it demos the finished app).

1. **iOS Local Network prompt module** - CODE DONE 2026-07-07 (branch
   `feature/ios-local-network`), pending on-hardware confirmation. Ported
   `pearlist/modules/local-network` -> `pearpetal/modules/local-network` (service
   `_pearpetallan._tcp`); boot-time `requestLocalNetworkPermission()` in `app/index.tsx`;
   `app.json` iOS `infoPlist` gains `NSLocalNetworkUsageDescription` + `NSBonjourServices`;
   `ios/` regenerated. Verify green, autolinking confirmed. See DECISIONS 2026-07-07.
   REMAINING: install on the iPhone (`scripts/ios-dev-install.sh`) and confirm the LN prompt
   appears + partner sync (iPhone <- Android owner) takes the LAN path.
2. **Invite/share code as a universal-link URL** - CODE DONE 2026-07-07 (branch
   feature/invite-urls, stacked on feature/realtime-ui-sync). Invites now render/copy as
   `https://peerloomllc.com/petal/link#<blob>` (device) and `.../petal/join#<blob>` (partner),
   blob in the #fragment (never hits the server). `parseInvite()` accepts URL or bare blob
   (back-compat); deep links route by path (/link vs /join); added Android intent filters for
   /join. Verify green, round-trip + routing checked. See DECISIONS 2026-07-07. REMAINING:
   on-device check (copy a link on one phone, open/paste on another) + iOS universal-link
   website association (apple-app-site-association + associatedDomains) is website-side, separate.
   - **FOLLOW-UP (website-side, not in-app): https universal-link tap-to-open.** Tapping an
     `https://peerloomllc.com/petal/link|join#...` link auto-opens the app only once the
     website serves the association files: Android `/.well-known/assetlinks.json` (SHA-256 of
     the signing cert, `com.pearpetal`) and iOS `/.well-known/apple-app-site-association`
     (appID `G79ALD29NA.com.pearpetal`, paths `/petal/*`), plus `associatedDomains`
     (`applinks:peerloomllc.com`) in the iOS app config. Until then tapping shows a chooser /
     opens the browser; pear:// scheme + paste-into-app both already work. Also needs a static
     `/petal/link` + `/petal/join` landing page on peerloomllc.com (the # blob stays client-side).
3. **Native QR scan + QR render** for link/share codes (currently paste/copy only; the
   "Scan" button is a stub - `shell:scanQr` returns null). Builds on the URL format in #2.
4. **Safe-area top inset** - DONE 2026-07-07 (branch feature/safe-area-inset). A shared
   `screenPadTop` = `calc(xl + max(var(--pear-safe-top,0), env(safe-area-inset-top,0)))` now
   pads the top of every title screen (PartnerView / Sharing / Devices / CycleSettings were
   missing it; main + ViewerHome upgraded from the raw var). Uses the shell-injected inset OR
   the CSS env() inset (WebView is viewport-fit=cover) so it holds even if the var lands late.
   REMAINING: on-device confirm titles clear the status bar (TCL / Pixel / iPhone).
5. **Petal dial in the partner view + ring day-scrub** - CODE DONE 2026-07-07 (branch
   feature/partner-dial-dayscrub). PartnerView now shows the PetalDial as its hero, driven by a
   `pred` derived from the scoped projection (cycleLen from the shared next-period date; fertile/
   ovulation estimated when the scope withholds them; default flower since the species pref is
   device-local). PetalDial gained `onDayTap(dateIso)`: a tap's angle -> cycle day -> calendar
   date (center = today); the owner main dial uses it to open a past day in the editor (future
   taps ignored). Outer element is now a div + clickable svg (was a single button). verify green.
   REMAINING: on-device confirm (owner taps a past tick -> editor jumps to that day; partner sees
   the dial).
6. **App logo / icon + notification-bar icons** - ART CHOSEN 2026-07-07 (branch feature/app-icon,
   PR #15): a cherry-blossom bloom on solid `#140f11`. Final art = the AI-generated "Alt-2" (in
   ~/Downloads/pearpetal/5e868a36-...svg), chosen over my `buildFlower`-generated one (flatter/
   paler) and the other two alternates; scaled up ~18% and re-squared (its source was a stretched
   2048x1509 canvas). Three 1024 PNGs in `assets/images/` composed via cairosvg + ImageMagick:
   `icon.png` (opaque, iOS/legacy), `adaptive-icon.png` (transparent fg, ~63% safe zone),
   `monochrome-icon.png` (white silhouette, Android themed/notification). Wired in `app.json`:
   `icon`, `android.adaptiveIcon` (fg + mono + `#140f11` bg), expo-splash-screen. REMAINING:
   on-device confirm (needs `expo prebuild` - which wipes the .debug config, so pair with the
   durable-debug-config plugin, dev-infra TODO). Notification icon USAGE lands with #8/notifs.
7. **About page + Bitcoin donation** - CODE DONE 2026-07-08 (branch feature/about-page):
   AboutScreen (reached from Cycle settings -> "About PearPetal") with sections How it works /
   Support development / Learn about Bitcoin / Open source / Share / Contact + version. Donation
   ports the suite pattern (`LIGHTNING_ADDRESS = peerloomllc@strike.me`, `LIGHTNING_WALLETS`,
   `donateBTC` via `shell:canOpenURL 'lightning:test'` -> open `lightning:<addr>` or a wallet
   bottom-sheet). iOS HIDES Support development (`isIOS()` via `window.__pearPlatform`) per App
   Store 3.1.1. Added `shell:canOpenURL` to the shell; `app.json` iOS `LSApplicationQueriesSchemes`
   [lightning,bitcoin] + ported the `with-android-queries` plugin (lightning/bitcoin/https/mailto).
   verify green. REMAINING: on-device check (Android BTC flow opens a wallet or the sheet; iOS
   hides Support development).
8. **2-week donation nudge popup** - DONE 2026-07-08 (branch feature/donation-nudge, stacked
   on feature/phosphor-icons-font). Ported PearList's `DonationReminderModal`: device-local
   `donation:status` (lazily seeds `{firstUseAt, shown}`, `due` at 14 days) + `donation:dismiss`
   (marks shown) on `ctx.localDb`, never crosses the wire. `DonationReminderModal` (PearPetal-
   styled) shows once when the owner is set up; the effect skips iOS (App Store 3.1.1) and marks
   it shown on surface so it never nags twice. "Support development" routes to the About screen.
   verify green (34 tests incl. 2 new + 3 bundles); on-device modal + routing confirmed on Pixel.
9. **Store assets, release scripts, privacy page, listing copy** (the publish mechanics).
   Privacy page is an App Store requirement. Port PearList/PearGuard release scripts.
10. **First-run onboarding / guided demo** (build LAST - demos the finished app): name/avatar
    creation, a walkthrough of the menus + petal dial, how to log a day, how partner sharing
    works. An interactive tour or short skippable demo, not dropping users onto the day editor.

## User profile - name + avatar - DONE 2026-07-08 (branch feature/user-profile)

**IMPLEMENTED** per the approved proposal `proposals/2026-07-08-user-profile.md`
(T2, all 4 open questions resolved as recommended). Backend: `profile` localDb row +
`profile:get`/`profile:set` (avatar in the core blob store, deduped by hash), name +
avatar projected into `share:meta`, `partner:view`/`list` return `ownerName`/
`ownerAvatar`. UI: profile card atop Cycle Settings; "{name}'s cycle" + avatar in
PartnerView / Sharing / ViewerHome. verify green (40 tests + 3 bundles); owner side
on-device on the TCL. REMAINING: live two-phone owner->partner name display (needs the
Pixel as partner = Tim's phone) - propagation is unit-covered. The summary below is the
original spec.

Add a user profile (display name + avatar) at the TOP of the Settings page, following
PearList's proven pattern. Replaces the generic "partner" / "A partner's cycle" strings
throughout with the owner's chosen name.
- **Storage (PearList pattern, see `pearlist/src/listMethods.js` ~L19-55, L232-):** avatar
  bytes live in the content BLOB store (`ctx.blobs`), NOT inline in any row. The profile /
  roster row carries only a tiny pointer `{ avatarBlob:{key,id}, avatarHash, avatarType }`;
  it is resolved back to a `data:<type>;base64,<...>` URL on read and cached by
  `avatarHash`. This keeps the append-only log lean (the avatar is a separate, referenceable
  item, appended once and pointed at - not re-appended on every name change) and, because it
  is a raw blob + type, supports animated GIFs (store `image/gif` bytes, render the data
  URL). Keep back-compat for any legacy inline `avatar` data URL. Profile itself stored
  device-local in `localDb` as `{ displayName, avatarBlob?, avatarHash?, avatarType?,
  updatedAt }` (cf. PearList `profile:get` / `profile:set`).
- **Name replaces "partner":** the owner's display name must reach a partner so their view
  reads e.g. "Ada's cycle" instead of "A partner's cycle". Carry `displayName` (+ optional
  avatar pointer) in the shared base's `share:meta` projection (owner-written, already the
  channel for `ownerPubkey`/`scope`) so it rides the existing consent-scoped path. NOTE:
  adding a field the partner replicates is a wire change -> **T2, needs a proposal**
  (Constitution SS3) with a back-compat note (older peers just miss the name -> fall back to
  "A partner"). Update `PartnerView` ("Partner's cycle" title + "A partner's cycle" rows in
  Sharing/ViewerHome) and the day/roster UI to show the name + avatar.
- **UI:** profile card at the top of Cycle Settings (name text field + avatar picker with a
  live thumbnail, reusing the flower-picker layout idiom); feeds the first-run onboarding
  name/avatar step (blocker #10).

## UX / sharing polish (nice-to-have, found 2026-07-07 on-device)

- **Flower picker is buried in Cycle Settings.** DONE 2026-07-09 (PR #31): a pill under the
  dial (current flower thumb + name) opens a FlowerPickerSheet; the Settings picker stays too.

- **Owner Share screen: differentiate share instances.** DONE 2026-07-09 (per-person shares,
  below): rows now show WHO joined ("Shared with Ada" / "Someone joined" / "Not joined yet")
  plus the shared-on date, so two same-scope shares are tellable apart.

- **Share model DECIDED 2026-07-09: per-individual (who joined).** Tim chose per-person over
  bearer+labels. **Part A shipped** (proposal 2026-07-09-per-person-shares, DECISIONS 2026-07-09):
  a joiner self-publishes a `member:{pubkey}` name row into the shared base; the owner renders it.
  **Part B DONE 2026-07-09** = `@peerloom/core` addWriter gating (owner-signed admission) so a
  partner cannot admit a 3rd party. The joiner name is now owner-gated (not just self-attested),
  so the "Shared with X" row is trustworthy. Bearer-link caveat softens once shipped. REMAINING:
  update the Sharing copy (still says "anyone with a link"; with gating, a partner can no longer
  re-share write access, though the link still grants READ to whoever holds it). Joiner AVATAR
  still deferred (needs cross-base blob replication check; initials avatar for now).

## UX / navigation (nice-to-have, found 2026-07-07 on-device)

- **Android Back should navigate the stack, not exit the app.** The hardware/gesture Back
  currently backs out of the app instead of popping to the previous screen (or the main page).
  Wire Back to the in-app nav stack (the shell already emits a `back` event via BackHandler +
  `shell:navState canBack`; the UI needs to consume it and only fall through to exit at the root).
- **Adopt bottom sheets for item/data entry where applicable** (day log, symptom/flow entry,
  share creation) instead of full-screen pushes - more native-feeling, keeps context.

- **Light/Dark mode toggle in Settings (queued 2026-07-08).** The theme plumbing already exists
  in `src/ui/theme.js` (`setTheme('light'|'dark')`, `loadTheme()` persisting to
  `localStorage['pearpetal:theme']`, and a full LIGHT palette under `:root[data-theme="light"]`);
  dark is the current default and nothing calls `setTheme` yet. Add a toggle in Cycle Settings
  (e.g. a segmented Dark / Light / System control) that calls `setTheme` + persists, and apply
  the saved theme at boot (call `setTheme(loadTheme())` on mount in `App`). Optional: a `System`
  option via `matchMedia('(prefers-color-scheme: dark)')`. Verify both palettes on-device
  (the shell also hardcodes a pre-JS `#140f11` flash bg, so a light-mode first paint may briefly
  flash dark - check whether the shell bg needs to follow the theme too).

## Design decisions to make (before building the feature)

- **Notifications - to self and/or to partner?** To-self local reminders (period-due /
  fertile-window / "log today" / BBT) are pure local scheduling. To-partner notifications
  must respect the consent scope + the no-push-server P2P model. Specific case: **notify a
  partner when the owner revokes?** Recommendation: yes but gently - a passive "sharing ended /
  no longer updating" state on their next open, not a push alert. Background sync ties in (a
  notification may need a background wake). Build only if a real use case needs it.
- **JSON export encryption - optional passphrase?** Slice 4 shipped plain JSON deliberately
  (recovery-first, DECISIONS open-Q1). Revisit an OPTIONAL passphrase-encrypted export (KDF ->
  XChaCha20-Poly1305) so backups aren't plaintext at rest, keeping plain export as the default.
  Decide: default on/off, lost-passphrase = no recovery, import auto-detect encrypted vs plain.

## Release blockers (v1) - Stardust features (pulled into v1 2026-07-08)

PULLED INTO v1 per Tim 2026-07-08 (these are blockers #11-13, build after #7-#10).
Cross-checked against what already exists:
- **Journey / Goals.** DONE 2026-07-08 (branch feature/pregnancy-mode, blocker #11). Added a
  **Pregnant** goal chip that reveals an LMP date input (due date = LMP + 280d shown); when set,
  the main screen swaps the cycle summary for a **gestational view** (`PregnancyView` + a new
  `PregnancyDial` that blooms the flower across ~40 weeks, with trimester ticks) showing weeks+days,
  trimester, due date + countdown, and % progress; day-logging is preserved. "No longer pregnant"
  clears it. Pure `pregnancyProjection(prefs, today)` in prediction.js (device-local; NEVER
  projected to a partner). Goal now also drives tone in the cycle summary: conceive highlights the
  fertile-window row, avoid keeps the "not contraception" caveat loud. verify green (43 tests + 3
  bundles); full flow verified on the TCL (14w0d from an Apr-1 LMP, due Jan 6, reset). STILL TODO
  from this item: surface the goal in first-run onboarding (folds into blocker #10).
- **Cycle customization.** DONE 2026-07-08 (branch feature/conditions-birth-control, blocker #12).
  Added device-local `prefs.conditions` (PCOS / Endometriosis / Irregular cycles / Thyroid, a
  whitelisted multi-select) + `prefs.birthControl` (hormonal-BC toggle) in a new "Health & birth
  control" Settings card. prediction.js: a tracked condition widens the fertile window (+2/+1 days)
  and caps confidence below `high` (`uncertain` flag + tailored copy); `birthControl` is surfaced
  as a flag so the cycle summary HIDES the fertile-window + ovulation rows AND the dial's fertile
  arc, showing a "fertile-window estimates are hidden" note instead. All device-local; NONE cross
  the wire (not added to writeProjection). verify green (45 tests + 3 bundles); verified on the TCL
  (card renders; BC on -> fertile framing hidden on rows + dial; PCOS -> wider + "wider estimate"
  copy).
- **Monthly calendar view.** DONE 2026-07-08 (branch feature/monthly-calendar, blocker #13). A
  Dial/Month toggle (persisted device-local in localStorage) on the owner Cycle screen; Month shows
  a `MonthCalendar` (month grid, prev/next nav, weekday header, legend) color-coded for period /
  fertile / ovulation / logged days. Predicted marks come from a pure `projectCalendar(pred, start,
  end)` in prediction.js (repeats the cycle pattern by cycle length; period projected forward only,
  fertile/ovulation both ways, birth-control suppresses fertile/ovulation); logged bleeding days are
  period (log authoritative for the past). Tap a past/today cell to select+edit it (future dimmed +
  non-tappable); the recent-days list is hidden in Month mode. verify green (47 tests + 3 bundles);
  verified on the TCL (July: logged period 6-7, today ring + logged dot, ovulation ring; August:
  projected period 3-7 + 31, fertile mid-month, ovulation 17). FOLLOW-UP (deferred): a scoped
  calendar in the PARTNER view.

## Deferred - security / scale

- **Shared-base addWriter gating** (security): DONE 2026-07-09 (per-person shares Part B;
  proposal 2026-07-09-addwriter-gating, DECISIONS 2026-07-09). Two @peerloom/core engine
  hooks (mintAddWriter / authorizeWriter, default legacy so other suite apps are untouched);
  PearPetal's `src/admission.js` requires an owner signature to admit on a shared base, so a
  partner can no longer add a third party. Enforced no-back-compat (pre-release). REMAINING:
  on-device re-pair confirm (owner still admits partner; "Shared with X" still shows).
- Migrate `day:`/`period:` retention/paging once logs get long.

## Dev infra / build durability (for clean, repeatable release builds)

- **`@peerloom/core` nested node_modules can drift from the app's** (found 2026-07-07, LIKELY
  SUITE-WIDE). Core is file:-symlinked; its own node_modules (from core's standalone install)
  had version-mismatched native addons vs the app's top-level -> iOS `ADDON_NOT_FOUND` at
  engine init (iOS matches addon frameworks by exact version; Android tolerates). FIX IN PLACE:
  `overrides` in core's package.json pin the mismatched addons (`rocksdb-native` 3.17.2,
  `bare-fs` 4.7.3) to the app's versions, so bundle + linked frameworks agree; core keeps its
  node_modules (so its `npm test` AND the app's Node-run unit tests still resolve core's deps -
  moving node_modules aside breaks that, since Node resolves via realpath). `ios-dev-install.sh`
  also runs `npm install` on the Mac so its linked frameworks match the bundle. TRADE-OFF: the
  pins must track each app's top-level versions until the proper fix. PROPER FIX: a workspace/
  hoist setup, or drop core's holepunch devDependencies so versions can't drift.
- **Diagnostics added this session - review + keep/revert deliberately** (recommend KEEP the
  error surfacing): `app/index.tsx` shows an "Engine failed to start" page on init failure +
  writes `Documents/init-error.txt`; `engine.js` dispatch includes `err.stack`; and the fix for
  `callRaw` silently swallowing init errors. The init-error.txt write is optional.
- **Make the debug-build Android config durable**: `applicationIdSuffix ".debug"` +
  `debuggableVariants = []` are edited into the generated `android/` (lost on `expo prebuild`).
  Move both into a config plugin. Suite convention: debug builds are standalone
  `.debug`-suffixed installs (never Metro-dependent).
- **iOS dev-install workflow** (built 2026-07-07, see `scripts/ios-dev-install.sh`): build +
  archive on the Mac mini, then install from THIS linux box via `ideviceinstaller install <ipa>`
  over USB (devicectl install fails "Authorization required" over the wireless CoreDevice link;
  screenshot/launch need a mounted Developer Disk Image, skipped for now).
