# User profile — display name + avatar

**Status**: Proposed 2026-07-08. Awaiting approval (Constitution §3 = Tim commits
this file). Implementation not started. Builds on the v1 wire protocol
(`2026-07-06-wire-protocol.md`) and the merged nav / donation / UI-cleanup work.

**Goal**: Let the owner set a display name and avatar (device-local), share them
with partners over the existing shared base, and replace the generic "partner" /
"A partner's cycle" strings with the person's name + avatar.

**Tier**: **T2**. It adds new OPTIONAL fields to an already-replicated,
already-owner-signed row (`share:meta`) and makes first use of the core blob store
over a shared base. Old-code and new-code peers still talk (additive optional
fields), so it is not protocol-breaking; but it changes what a persisted shared
row carries and adds a new replicated data path (the avatar blob), which is a
cross-peer effect -> proposal required, with a back-compat note.

---

## Scope

### What changes

**1. Device-local profile record.** A new `localDb` key `profile`:

```
profile -> { displayName: string, avatarBlob?: {key,id}, avatarHash?: string,
             avatarType?: string, updatedAt: number }
```

- `displayName` trimmed + length-capped (e.g. 40 chars).
- Avatar bytes go in the **content blob store** (`ctx.blobs`, a device-local
  Hyperblobs core in the same corestore), NOT inline in any row. The profile keeps
  only the tiny portable pointer `{key,id}` + a content hash + MIME type. This is
  PearList's exact pattern (`pearlist/src/listMethods.js`): the log stays lean, the
  avatar is appended once and pointed at (not re-appended on every name change), and
  because it stores raw bytes + type it supports **animated GIFs** (store the
  `image/gif` bytes, render the resolved `data:` URL).
- Dedup by content hash via a `blobref:{hash}` localDb cache, so re-saving the same
  image reuses the existing blob (PearList pattern).

This is kept distinct from the existing `deviceProfile` record (which holds this
device's roster `label`): `deviceProfile.label` names a *device*, `profile` names
the *person*.

**2. Two new IPC methods.**
- `profile:get` -> `{ displayName, avatar }` where `avatar` is the resolved
  `data:<type>;base64,<...>` URL (own blob is local, resolves fast) or null.
- `profile:set` `{ displayName?, avatar? }` -> writes `displayName` to `profile`;
  if an `avatar` data URL is supplied, decodes it, `ctx.blobs.put`s the bytes
  (deduped), stores the pointer/hash/type on `profile`, then re-writes `share:meta`
  on every `shared-out` base (same fan-out as the existing `refreshShares`) so
  current partners get the update live.

**3. Extend the owner projection (the wire change).** `share:meta` gains two
OPTIONAL owner-written fields:

```
share:meta -> signed { ownerPubkey, scope, createdAt, updatedAt, pubkey, sig,
                       displayName?,                       // NEW, optional
                       avatarBlob?, avatarHash?, avatarType? }  // NEW, optional
```

- Written by the owner in `share:create` and on every `profile:set` refresh.
- No new key namespace, no new apply branch: `share:meta` is already owner-only
  (`rowSharedDecision` in `petalWire.js` rejects any share:meta update whose signer
  is not the recorded owner), so the new fields inherit that enforcement for free.
- The avatar **bytes** replicate to the partner with **no core change**: the blob
  core lives in the shared corestore, so `store.replicate(conn)` over the shared
  base's swarm connection already serves it, and the partner `ctx.blobs.get({key,
  id})`s the owner's core by key on demand (see `peerloom-core/src/engine.js`
  L300-337). Missing/slow avatar degrades to initials (8s timeout -> null).

**4. Read path.** `partner:view` and `partner:list` resolve and return
`ownerName` + `ownerAvatar` (data URL) from the replicated `share:meta` (+ blob
fetch). `partner:list` should resolve the avatar lazily/cached so the list does not
block on a blob fetch (PearList `resolveAvatarCached` pattern).

**5. UI.**
- Profile card at the TOP of Cycle Settings: a name field + an avatar picker with a
  live thumbnail (reuse the flower-picker layout idiom; file input -> data URL ->
  `profile:set`).
- `PartnerView` title "Partner's cycle" -> "{name}'s cycle"; the "A partner's cycle"
  rows in `Sharing` (Shared-with-you) and `ViewerHome` -> the name + a small avatar.
  Fallback to "A partner" when no name has replicated yet.
- Feeds the first-run onboarding name/avatar step (release blocker #10).

### What does NOT change

- The **private base** schema, the **consent scopes** (phase/fertility/full) and
  their gating of *cycle* data, **owner-write-only** enforcement, the **invite /
  pairing** flow, the **prediction** module. Name/avatar are identity, not cycle
  data, and do not widen any cycle projection.
- No change to `@peerloom/core` (the blob store + owner-signed apply already exist).

---

## Compat

Additive + optional, so no migration and no wire version bump:

- **New owner + old partner**: the partner's JSON parse ignores the unknown
  `displayName` / `avatar*` fields on `share:meta`; it keeps showing "A partner".
- **Old owner + new partner**: `share:meta` simply lacks the fields; the new
  partner UI falls back to "A partner" / initials.
- **Existing shares**: get the name/avatar on the next `share:meta` write. Trigger
  a one-time `share:meta` refresh on boot (owner) if `profile` exists but a
  shared-out base's `share:meta` predates it, so old shares upgrade without the
  owner re-sharing. Forward-only like all shared data (a partner keeps the last
  name they received after revoke).

---

## Verify

- **Unit (`test/petalWire.test.js`)**: `share:meta` carrying the new fields still
  `accept`s from the owner and `reject`s from a non-owner (proves the new fields
  ride the existing owner-only gate, no new bypass).
- **Unit (`test/petalMethods.test.js`)**: `profile:set` stores `displayName` +
  a blob pointer and dedups a repeat image; `profile:get` returns the resolved data
  URL; a GIF (`image/gif`) round-trips.
- **Two-engine test**: owner `profile:set` (name + avatar), partner `partner:join`,
  then `partner:view` returns `ownerName` and `ownerAvatar` resolves (the blob
  replicated over the shared base). Confirms the no-core-change replication claim.
- **`npm run verify`** green (existing 34 tests + the above + 3 bundles).
- **On-device** (Pixel + TCL, cross-platform if an iPhone is available): owner sets
  name + an animated GIF avatar; partner sees "{name}'s cycle" + the avatar; revoke
  still forward-only; a phase-only share still shows the name (see open Q2).

---

## Rollback

The feature is additive and optional, so backing out is low-risk:

1. Stop the owner writing `displayName`/`avatar*` into `share:meta` (revert the
   `share:create` / refresh change) and hide the Settings profile card.
2. Partners that already replicated a name keep it (forward-only, a P2P invariant),
   but no new share carries it and the UI falls back to "A partner".
3. No destructive migration; `profile` + `blobref:` localDb rows and the blob core
   are inert if unused. Revert the branch.

---

## Open questions

1. **Blob-core key scope (security).** `ctx.blobs` is ONE device-global Hyperblobs
   core; the avatar pointer hands a partner that core's key, which grants read to
   *every* blob on it, not just this avatar. Avatar-only today, so acceptable. If
   blobs ever hold private media, revisit (per-scope or encrypted blob cores). OK
   for v1? **Recommend: yes, avatar-only for v1; note it in DECISIONS.**
2. **Which scopes carry identity?** Share name/avatar on ALL scopes (including
   `phase`), or let the owner withhold identity on a minimal share? **Recommend:
   all scopes (it is *who* is sharing, not *what*), with a future per-share
   name/avatar override if anyone wants deniability.**
3. **Avatar size cap.** Bound replication + storage: soft-cap bytes and/or downscale
   on import (GIFs are the pressure). **Recommend a cap (e.g. ~512 KB, downscale
   stills to ~256 px); decide the exact number.**
4. **Own-device roster.** Should the private-base `device:{pubkey}` roster also
   surface `profile.displayName` (unified name across the owner's own devices), or
   stay `deviceProfile.label`-only? **Recommend: keep separate for v1** (person vs
   device), fold in later if the Devices screen returns.
