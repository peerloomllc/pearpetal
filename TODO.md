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
6. **App logo / icon + notification-bar icons** - FIRST PASS DONE 2026-07-07 (branch
   feature/app-icon): a cherry-blossom bloom on solid `#140f11`, generated from the app's own
   `buildFlower` geometry (`scripts` inline) so the icon IS the in-app flower. Three 1024 PNGs
   in `assets/images/`: `icon.png` (opaque, iOS/legacy), `adaptive-icon.png` (transparent fg,
   safe-zone crop), `monochrome-icon.png` (white silhouette, Android themed/notification).
   Wired in `app.json`: `icon`, `android.adaptiveIcon` (fg + mono + `#140f11` bg),
   expo-splash-screen. REMAINING: pick the final art (Tim comparing AI-generated alternates),
   then on-device confirm (needs `expo prebuild` - which wipes the .debug config, so pair with
   the durable-debug-config plugin, dev-infra TODO). Notification icon USAGE lands with #8/notifs.
7. **About page** (port the PearCircle / PearList pattern): app name/version, what it is,
   privacy stance ("no account, no server, your data stays on your devices"), open-source +
   license, links (website/privacy/support), and a **"Support Development"** section (this is
   where the Bitcoin Lightning donation lives). Reuse PearList's `LIGHTNING_ADDRESS =
   'peerloomllc@strike.me'`, `LIGHTNING_WALLETS`, the About view, and the `donateBTC` flow
   (`shell:canOpenURL 'lightning:test'` -> open `lightning:<addr>` or show the wallet sheet).
   - **iOS first release: HIDE the "Support Development" section** (Apple rejects external
     donation links). BUT whitelist the Lightning scheme now so wallet detection works later:
     `LSApplicationQueriesSchemes: ["lightning"]` in iOS `app.json` (see pearcircle/app.json)
     + the Android queries plugin (`lightning`,`bitcoin`,`https`, per pearlist). Gate the
     donation UI by platform (live on Android, dark on iOS until an Apple-compliant path).
8. **2-week donation nudge popup** (port PearList's `DonationReminderModal`): one-time gentle
   modal after ~2 weeks of use, driven by a device-local `donation:status` due-flag +
   `donation:dismiss` (never crosses the wire). Respects the iOS gating above.
9. **Store assets, release scripts, privacy page, listing copy** (the publish mechanics).
   Privacy page is an App Store requirement. Port PearList/PearGuard release scripts.
10. **First-run onboarding / guided demo** (build LAST - demos the finished app): name/avatar
    creation, a walkthrough of the menus + petal dial, how to log a day, how partner sharing
    works. An interactive tour or short skippable demo, not dropping users onto the day editor.

## UX / sharing polish (nice-to-have, found 2026-07-07 on-device)

- **Flower picker is buried in Cycle Settings.** Confirmed present + working on-device, but
  the "Your flower" picker lives inside Settings (gear), which is itself hard to find. Surface
  flower choice more prominently (e.g. tap the dial to switch, or a top-level control) in the
  UI polish phase.

- **Owner Share screen: differentiate share instances.** Multiple shares of the same scope
  render as identical-looking "Phase" rows with near-identical codes (invites share the
  `eyJncm91cElkIjoi` base64 prefix; only the tail differs - they ARE distinct). Add a label /
  created-date / short fingerprint (e.g. last 6 chars of groupId) + let the user name a share
  or see who joined, so two "Phase" shares are tellable apart.

## UX / navigation (nice-to-have, found 2026-07-07 on-device)

- **Android Back should navigate the stack, not exit the app.** The hardware/gesture Back
  currently backs out of the app instead of popping to the previous screen (or the main page).
  Wire Back to the in-app nav stack (the shell already emits a `back` event via BackHandler +
  `shell:navState canBack`; the UI needs to consume it and only fall through to exit at the root).
- **Adopt bottom sheets for item/data entry where applicable** (day log, symptom/flow entry,
  share creation) instead of full-screen pushes - more native-feeling, keeps context.

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

## Deferred - security / scale

- **Shared-base addWriter gating** (security): a partner is an Autobase writer, so they could
  `addWriter` a third party to the SHARED base (bounded leak: only the consented projection,
  not the private log). Needs apply-level addWriter gating in `@peerloom/core`. DECISIONS
  2026-07-06 slice 2.
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
