# PearPetal TODO

Open work only. Completed work (dated, with PRs) lives in `DONE.md`; deep
rationale for T2/T3 changes lives in `DECISIONS.md`. Priority order: release
blockers first, then nice-to-haves, design decisions, deferred, dev-infra.

## Release blockers (v1) - do before shipping

Not yet built:
1. **Native QR scan + QR render** for link/share codes. Currently paste/copy only;
   the "Scan" button is a stub (`shell:scanQr` returns null). Builds on the invite
   URL format.
2. **Store assets, release scripts, privacy page, listing copy** (the publish
   mechanics). The privacy page is an App Store requirement. Port PearList/PearGuard
   release scripts.
3. **First-run onboarding / guided demo** (build LAST - it demos the finished app):
   name/avatar creation, a walkthrough of the menus + petal dial, how to log a day,
   how partner sharing works. Interactive tour / short skippable demo, not dropping
   users onto the day editor. Also surface the pregnancy goal here.

Code done, need **on-device confirmation** (bundle these into a hardware pass):
- **iOS Local Network prompt**: install on the iPhone (`scripts/ios-dev-install.sh`),
  confirm the LN prompt appears + partner sync takes the LAN path.
- ~~**App icon / notification icons**~~ CONFIRMED 2026-07-09. iOS home-screen icon: was a
  stale blank `ios/` from before the art landed; regenerated `ios/` -> real cherry-blossom
  icon on the iPhone SE. Android notification-tray glyph: was the colored launcher icon
  because the built `android/` predated the expo-notifications icon config; a fresh `expo
  prebuild -p android` wired `@drawable/notification_icon` (monochrome silhouette from
  `monochrome-icon.png`) + the `default_notification_icon` manifest meta-data + tint color
  `#f2789f`, and the rebuilt APK shows the correct WHITE monochrome glyph on the TCL (icon
  resource is now a drawable, not the mipmap launcher icon). NO source change was needed -
  the app.json config was already correct; it just needed a build from a fresh prebuild.
  NOTE (build hygiene, below): the `.debug` config survives prebuild now (it lives in the
  `with-android-debug-standalone` plugin), so `expo prebuild -p android --clean` is the
  safe way to pick up any app.json/icon/plugin change. iOS notifications always use the app
  icon (no custom small-icon), so nothing further there.
- **Invite/share URL**: copy a link on one phone, open/paste on another.
- **Petal dial in the partner view + ring day-scrub**: owner taps a past tick ->
  editor jumps; partner sees the dial.
- **About page Bitcoin flow**: Android opens a wallet or the sheet; iOS hides Support
  development.
- **User profile**: live two-phone owner->partner name display (propagation is
  unit-covered; needs the Pixel as partner).
- **Sharing ended (soft-close revoke tombstone)**: BUILT 2026-07-09 (proposal
  2026-07-09-sharing-ended). Two-phone confirm: owner (TCL) shares -> partner (Pixel)
  joins -> owner revokes -> partner shows the "sharing ended" banner on next open;
  owner "Remove permanently" + partner "Remove" both clear.

Website-side (not in-app):
- **Universal-link tap-to-open**: serve Android `/.well-known/assetlinks.json`
  (SHA-256 of the `com.pearpetal` signing cert) + iOS `/.well-known/apple-app-site-
  association` (`G79ALD29NA.com.pearpetal`, paths `/petal/*`) + a static `/petal/link`
  + `/petal/join` landing page on peerloomllc.com. Plus `associatedDomains`
  (`applinks:peerloomllc.com`) in the iOS config. Until then a tap shows a chooser;
  the `pear://` scheme + paste-into-app already work.

## Nice-to-have / UX polish

- **Adopt bottom sheets for day/symptom entry** (day log, flow/symptom entry) instead
  of full-screen pushes - more native-feeling, keeps context. (The shared `BottomSheet`
  already exists.)
- **Partner-view scoped calendar**: a Month calendar in the PARTNER view (owner-only
  today).
- **Joiner avatar in per-person shares**: the owner shows an initials avatar for a
  joiner; showing their photo needs the joiner's avatar blob to replicate to the owner
  via the shared base's blob store (unverified). Name already works.

## Design decisions to make (before building)

- ~~**Notifications (v1 to-self)**~~ BUILT 2026-07-09 (proposal
  2026-07-09-notifications, DECISIONS 2026-07-09): opt-in period-due + fertile/ovulation
  reminders, goal-aware + confidence-gated, user-configurable discreet mode; Settings
  Reminders card; OS-scheduled local notifications (no wire change, no background exec).
  ON-DEVICE VERIFIED on the TCL (opt-in prompt + grant persist, scheduling across a
  2-cycle horizon, backgrounded fire for both descriptive + discreet content, reschedule
  on change, disable-cancels; fixed channelId-on-trigger so scheduled notifications use the
  custom "reminders" channel not expo's fallback). REMAINING: (a) first-run opt-in prompt
  folds into the guided-onboarding blocker; (b) confirm on iOS next hardware pass; (c) the
  notification status-bar icon shows the colored app icon, not a monochrome glyph - needs
  the `expo prebuild` notification-icon item (pair with durable-debug-config).
- **JSON export encryption - optional passphrase?** Slice 4 shipped plain JSON
  deliberately (recovery-first). Revisit an OPTIONAL passphrase-encrypted export (KDF
  -> XChaCha20-Poly1305) so backups aren't plaintext at rest, keeping plain export the
  default. Decide: default on/off, lost-passphrase = no recovery, import auto-detect
  encrypted vs plain.

## Deferred - security / scale

- Migrate `day:`/`period:` retention/paging once logs get long.

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
