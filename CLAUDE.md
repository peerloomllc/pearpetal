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
Wire protocol v1 in `proposals/2026-07-06-wire-protocol.md` (T3, amended for
date-keyed day rows). Next: JSON export/import, the petal-dial UI. See `TODO.md`.

## Canonical verify

`npm run verify` -> `node --test test/*.test.js && build:bare && build:bare:ios && build:ui`.
Do not merge red. See Constitution §5.

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
