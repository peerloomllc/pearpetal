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
- **App icon / notification icons**: confirm on-device (needs `expo prebuild`, which
  wipes the .debug config - pair with the durable-debug-config dev-infra item).
- **Invite/share URL**: copy a link on one phone, open/paste on another.
- **Petal dial in the partner view + ring day-scrub**: owner taps a past tick ->
  editor jumps; partner sees the dial.
- **About page Bitcoin flow**: Android opens a wallet or the sheet; iOS hides Support
  development.
- **User profile**: live two-phone owner->partner name display (propagation is
  unit-covered; needs the Pixel as partner).

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
  the `expo prebuild` notification-icon item (pair with durable-debug-config). Partner-facing
  "sharing ended" is still a DEFERRED T2 (needs a revoke tombstone - revoke writes no signal
  today).
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
- **Make the debug-build Android config durable**: `applicationIdSuffix ".debug"` +
  `debuggableVariants = []` are edited into the generated `android/` (lost on `expo
  prebuild`). Move both into a config plugin. Suite convention: debug builds are
  standalone `.debug`-suffixed installs (never Metro-dependent).
- **iOS dev-install workflow** (`scripts/ios-dev-install.sh`): build + archive on the
  Mac mini, then install from this linux box via `ideviceinstaller install <ipa>` over
  USB (devicectl install fails "Authorization required" over the wireless CoreDevice
  link; screenshot/launch need a mounted Developer Disk Image).
