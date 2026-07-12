# Adopt @peerloom/device-link for the private base + own-device linking

**Goal** - make PearPetal the first real consumer of `@peerloom/device-link`: replace the ad-hoc "private base is a `@peerloom/core` group, link a device by re-using `group:join`" approach with device-link's purpose-built personal Autobase + SLIP-48 mnemonic identity + device-pairing handshake, giving the owner a real recovery phrase and a two-peer-verified linking flow. Partner sharing stays on `@peerloom/core`, untouched.

**Tier** - **T3.** It changes the device-linking pairing flow, introduces mnemonic-based key management (a recovery phrase), and re-homes the private base off core's group model. Peer-affecting between the same user's own devices; not partner-affecting. Migration + rollback required.

## Why now / why PearPetal first

- device-link's Tier-1 (21/21) and Tier-2 engine are green: `two-peer.integration.js` (B pairs to A, becomes a personal-base writer, deviceMeta converges) and `group-plugin.integration.js` both pass, stable, exit 0 (`peerloom-device-link`, PR #1, merged 2026-07-12).
- PearPetal's private base is a **single-user, own-device** log. That maps exactly onto device-link's **identity-only path** - the one that is already proven and needs **no `groupPlugin`**. The engine's still-unwired group surface (the step-5 `groupWriters` round-trip leg, `collectMyGroupWriters()`, a public `deviceGroupWriter` append API) is **not needed here**, because partner sharing keeps running on `@peerloom/core`. That is what makes PearPetal the lowest-risk first consumer.
- PearPetal today has **no mnemonic**: `@peerloom/core` auto-generates a per-device Ed25519 keypair (`localDb['identity']`) and that is the only identity. A private health app has a strong case for a real, user-held recovery phrase. device-link supplies exactly this (SLIP-48 mnemonic -> `keet-identity-key`).
- Own-device linking is currently a known-weak spot: SLICE-1 linking re-uses core group pairing and has a **deferred B->A writer stall under connection churn** (converges after a clean reconnect; see `DECISIONS.md` / TODO). Its UI entry is currently hidden. Adopting a purpose-built, verified pairing engine is the natural way to retire that debt rather than paper over it.

## What PearPetal does today (the thing being replaced)

- `src/bare.js` starts `createGroupEngine({ appId:'pearpetal', applyOps, methods, mintAddWriter, authorizeWriter, ... })`. Every base - private and per-partner shared - is a core group.
- The **private base** is just a core group tagged `kind:'private'` (`tagKind`). `cycle:create` -> core `createGroup`; `link:join` -> core `joinGroup(inviteKey)`. `admission.js` leaves the private base ungated ("owner devices admit each other").
- **Identity** is core's per-device keypair; rows are signed with `ctx.identity.secretKey`.
- **Partner sharing** = core shared bases carrying an owner-signed, consent-scoped projection. This is the hero feature and is explicitly **out of scope** here.

## Scope

**What changes**

1. **Private base -> device-link personal Autobase.** Instantiate `createDeviceLink({ store, swarm, localDb, keystore, records, mirror, platform, onEvent })` in the worklet, sharing the app's one Corestore + Hyperswarm + localDb with the core group engine. device-link namespaces `store.namespace('personal')`, distinct from core's group namespaces, so the two engines coexist on one runtime. `cycle:create` -> `dl.enable()`; the cycle/day/period record types register through device-link's `records` + `mirror` so the apply/mirror path writes them into the same local views the UI already reads.
2. **Own-device linking -> device-link pairing.** `link:join` (and the device-linking UI) drive `dl.startPairing()` / `dl.consumePairLink()` (the `hello -> granted -> personalWriter -> complete` handshake). The `granted` leg carries the mnemonic to the new device, so linking a device also transfers the identity - no separate key export.
3. **New: a recovery phrase.** Surface the device-link mnemonic in onboarding/settings as a "recovery phrase" the user can save, and a "restore from phrase" entry. This is the user-visible payoff of the whole change.
4. **Roster.** The Devices screen reads device-link's `listLinkedDevices()` / `setDeviceNickname()` (replacing the current `device:{pubkey}` roster rows on the private group).

**What does NOT change**

- **Partner sharing stays entirely on `@peerloom/core`** - shared bases, the owner-signed consent-scoped projection, revocation, `admission.js` shared-base gating, `share:*` / `partner:*` methods. No `groupPlugin` is injected; none of device-link's group legs are exercised.
- Predictions stay on-device, never written to any base. Export/import (incl. encrypted backups) is unchanged (and is leaned on for migration, below).
- No partner-facing wire change. An owner's partners see the same projection whether the owner is on the old or new private-base engine.

## Architecture / integration boundary (the crux)

device-link is injected with the app's `store`, `swarm`, and `localDb`. Core currently **owns** those internally and its public surface returns `{ identity, localDb, append, bases, createGroup, joinGroup, destroyGroup, retain, blobs }` - it does **not** expose `store` or `swarm`. So adoption needs ONE of:

- **(A, recommended) A small additive core change**: have `createGroupEngine` expose `store` and `swarm` (and its `keystore` seam) on the returned object. No wire change, no group-behavior change - purely surfacing already-constructed handles so a sibling engine can share them. This keeps device-link and core as peers on one runtime.
- **(B) A core plugin seam**: core instantiates device-link internally from an injected factory. More encapsulated but couples core to device-link's lifecycle.

Identity model - core keeps a per-device signing keypair; device-link introduces a mnemonic-rooted identity. Two viable shapes:

- **(recommended, low-risk) Coexist**: core's per-device keypair keeps signing rows exactly as today; device-link's mnemonic is the **recovery + pairing anchor** for the personal base only. Nothing about how existing rows are signed/validated changes.
- **(cleaner, riskier, defer) Mnemonic-root**: derive core's per-device key from the device-link mnemonic so there is a single identity source. Touches core identity generation - a separate T3, not this change.

## Compat / migration

- **Existing installs** have a core-group private base (key format and namespace differ from a device-link personal base). Because multi-device is currently a minor, UI-hidden path, migrate the **single-device private log** locally, with no new wire protocol, by reusing the **existing export/import**: on first launch of the new build, if a legacy `kind:'private'` group exists and no personal base does, export the log in-process, `dl.enable()` a fresh personal base, import into it, then retire the legacy group. Partner shared bases are untouched and keep working throughout.
- **Cross-version linking** happens only between one user's own devices. A new-code device cannot pair to an old-code device (different pairing protocol). Handle by (a) requiring both devices upgraded with a clear message, and/or (b) keeping the legacy `link:join` path available behind the migration flag for a transition window.
- The whole private-base swap sits behind a **feature flag** so it can ship dark, be migrated in a staged build, and be reverted without stranding data.

## Verify

- `npm run verify` green (existing node tests + all three bundles), plus new tests: recovery-phrase round trip (mnemonic -> restore reconstructs the identity + re-pairs), and a migration test (legacy-private-group export -> personal-base import reconstructs days/periods/prefs).
- device-link's own gate stays green (`npm test` 21/21; `npm run test:integration` two-peer + group-plugin, exit 0).
- On-hardware, the flow PearPetal has already run for its private base (TCL + Pixel + iPhone SE): device A `enable()` + log a day -> device B links by pasted code / QR -> B ends up a personal-base writer with the full log + a working recovery phrase; a later edit on A propagates live to B. Explicitly re-check the **B->A** direction that stalled under the old core-group linking.

## Rollback

device-link instantiation is additive and feature-flagged. Reverting = stop constructing the device-link engine and fall back to the core-group private base; core, partner sharing, and existing data are untouched. Because migration is staged behind the same flag, a device that has not yet migrated loses nothing; a device that has migrated keeps a legacy-base snapshot (or an export) until the flag is retired, so rollback never strands the private log. The core `store`/`swarm` exposure (option A) is inert on its own and can stay.

## Open questions

1. **Core boundary**: expose `store`/`swarm`/`keystore` on `createGroupEngine`'s return (A) or add a plugin seam (B)? (Rec: A - smallest, wire-neutral core change.)
2. **Identity**: coexist (core per-device key signs rows, mnemonic is recovery/pairing anchor) or mnemonic-root (defer to a later core T3)? (Rec: coexist.)
3. **Migration mechanics**: reuse export/import locally (rec) vs. an in-place adopt of the existing private base's cores as the personal base (avoids a copy but needs key/namespace compatibility work).
4. **Recovery phrase scope**: is the phrase purely an identity/pairing anchor, or should it also key the encrypted backup so "phrase + backup file" is a complete offline recovery? (Interacts with the 2026-07-10 encrypted-backups design.)
5. **B->A stall**: confirm device-link's personal-base admission actually resolves the deferred churn stall rather than re-homing it; if it persists, it becomes a device-link engine issue to fix before the flag flips on.
6. **Transition window**: keep legacy `link:join` available during migration, or hard-cut once both devices are upgraded?
