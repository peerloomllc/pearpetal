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

## Release blockers (v1) - do before shipping

Everything here ships in v1. Rough build order below (the onboarding demo is last
because it demos the finished app).

1. **iOS Local Network prompt module** (port `pearlist/modules/local-network`). CONFIRMED
   REQUIRED 2026-07-07: without it iOS never prompts for Local Network, so partner sync's
   LAN path is blocked (works only after a manual re-entry / slow DHT fallback). A Bonjour
   probe at boot forces the prompt; also fixes slow first-connect (~3.4s vs 112-147s).
2. **Invite/share code as a universal-link URL** (`https://peerloomllc.com/join/<payload>`)
   matching the other apps, instead of the raw base64 blob. Applies to both device linking
   and partner share codes; foundation for web invite handling + QR (do before #3).
3. **Native QR scan + QR render** for link/share codes (currently paste/copy only; the
   "Scan" button is a stub - `shell:scanQr` returns null). Builds on the URL format in #2.
4. **Safe-area top inset** (visual bug): screen titles ("PearPetal", "Partner's cycle") render
   under the status/notification bar and clip behind the clock. Add a top safe-area inset.
   Seen on TCL, Pixel 9 Pro, and iPhone SE.
5. **Petal dial in the partner view too; ring day-scrub** to log a past day by tapping its tick.
6. **App logo / icon + notification-bar icons**: launcher icon, Android adaptive icon
   (foreground/background), and monochrome notification / status-bar icons. Needed before
   any store submission (expo prebuild already warns "no icon").
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
