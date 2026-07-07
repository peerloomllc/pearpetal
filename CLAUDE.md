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

Pre-scaffold. Wire protocol v1 locked 2026-07-06: see
`proposals/2026-07-06-wire-protocol.md` (T3) and `reviews/2026-07-06-wire-protocol.md`.
No implementation yet. Slated as the append-only-log extraction vehicle, built
after PearList lands `@peerloom/core` and before PearCare (see
`/home/tim/peerloomllc/APP-IDEAS.md`).

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
