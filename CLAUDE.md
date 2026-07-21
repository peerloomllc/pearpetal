# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

Constitution applies. See `/home/tim/peerloomllc/CONSTITUTION.md` for risk tiers,
proposal gate, DECISIONS convention, verify gate, and wiki-sync rules.

## Project Overview

PearPetal is a peer-to-peer menstrual / fertility cycle tracker for Android and
iOS. No accounts. No servers. No cloud. Cycle data lives only on the owner's own
devices; a partner can be given a scoped, consented projection of it. The name
plays on "flowers" (a historical euphemism for menses); the signature UI is an
interactive petal dial that furls and blooms across the cycle.

It uses the same three-layer architecture as the rest of the suite:
- React Native (Expo) shell
- WebView React UI
- Bare worklet (P2P backend)

built on the shared `@peerloom/core` package (identity, records/signing, pairing,
sync) rather than copy-forked.

## Status

Slices 1-3 built (2026-07-06) on `@peerloom/core`. Backend: `src/petalWire.js`
(apply rules for both base kinds), `src/petalMethods.js` (cycle / device / day /
period / share / partner / prefs / prediction methods), `src/prediction.js` (pure
projection), `src/bare.js` (worklet). UI: `src/ui/` (onboarding, day log, cycle
summary, settings, devices, sharing, partner view).
- Slice 1: PRIVATE base (own-device cycle log) + own-device linking.
- Slice 2: per-partner SHARED base - owner-written, consent-scoped (phase /
  fertility / full) projection; partner read-only (owner-signature enforced);
  share invite withholds the private base key.
- Slice 3: refined on-device prediction (median cycle length, BBT-confirmed
  ovulation, confidence, prefs) surfaced in the owner UI via `cycle:prediction`;
  never written to any base.
- Slice 5: the signature petal dial (`src/ui/PetalDial.jsx`) - a flower that
  furls/blooms across the cycle, driven by the prediction; the main-screen hero.
- Slice 6: flower picker (`src/ui/flowers.js`) - five real species as parametric
  petal profiles, chosen in cycle-settings, stored device-local (`prefs.flower`).
- Slice 4: JSON export/import (`export:data` / `import:data`) - plain-file backup
  + recovery/migration, shell-mediated (share sheet / document picker) with a
  browser fallback. No encryption wrapper, no cloud.
All core slices (1-6) done. Wire protocol v1 in
`proposals/2026-07-06-wire-protocol.md` (T3, amended for date-keyed day rows).
Remaining is polish + real two-device hardware verification. See `TODO.md`.

## Canonical verify

`npm run verify` -> `node --test test/*.test.js && build:bare && build:bare:ios && build:ui`.
Do not merge red. See Constitution §5.

## Building and installing on a device

`android/` and `ios/` are both gitignored and regenerated from `app.json` + the
config plugins in `plugins/`. Nothing native is hand-written in either directory -
edits there are wiped by the next prebuild, so a durable native change belongs in a
config plugin (see `plugins/with-android-webview-recovery.js` for one that writes a
Kotlin module and registers it in `MainApplication`).

Because of that, every build script prebuilds first. Building against a stale
native directory SUCCEEDS and silently ships old assets, which is how the wrong
notification glyph shipped on Android and a blank app icon shipped on iOS. Use the
scripts rather than calling `gradlew` or `xcodebuild` directly:

- `scripts/android-debug-install.sh [pixel|tcl|<serial>]` - JS bundles ->
  `expo prebuild --clean` -> `assembleDebug` -> install. Debug installs as
  `com.pearpetal.debug` and is standalone (no Metro).
- `scripts/ios-dev-install.sh` - build + archive on the Mac mini, then install from
  this Linux box via `ideviceinstaller` over USB. `devicectl install` fails
  "Authorization required" over the wireless CoreDevice link, and screenshot/launch
  need a mounted Developer Disk Image, so USB + ideviceinstaller is the working path.
- `scripts/release.sh` and `scripts/ios-appstore.sh` - the release channels.

Universal Links are decided at PREBUILD time: `with-ios-no-associated-domains`
strips the entitlement by default, so any iOS build that needs UL must run with
`PEARPETAL_ASSOCIATED_DOMAINS=1`. `scripts/app.conf` exports it for the release
scripts; pass it explicitly to `ios-dev-install.sh`.

## The one thing to get right

The privacy boundary is structural, not trust-based: two separate Autobases with
separate encryption keys. The private base (full log) replicates only across the
owner's own devices; the per-partner shared base carries only an owner-written,
consent-scoped projection. The partner-share invite deliberately withholds the
private base key. Predictions are computed on-device and never cross the wire.
Revocation is forward-only. See `DECISIONS.md`.

## Branch Strategy

Always branch before work. Never commit directly to master/main (the initial repo
scaffold commit excepted).
- Feature branches: `feature/description`
- Bug fix branches: `bugfix/description`
- Merge via GitHub PR
