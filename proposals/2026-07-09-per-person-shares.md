# Per-person shares

**Goal** - Let a share row show WHO joined (name + avatar), so two identical-looking
"Phase" shares become "Shared with Ada" / "Shared with Sam".

**Tier** - T3. It touches the sharing / consent surface and is entangled with
writer-admission security, so it is tracked at T3 even though Part A alone (below) is
an additive, back-compatible new row type (T2-shaped).

## Scope

Split into two parts. **This proposal implements Part A only.** Part B is a separate
follow-up because it lives in `@peerloom/core` (shared across the whole suite) and is
security-critical.

### Part A - joiner identity (PearPetal only, implemented here)

- **New shared-base row family `member:{pubkey}`**, self-signed by the JOINER:
  `{ pubkey, displayName?, updatedAt, sig }`. Add `member:` to `SHARED_NAMESPACES` in
  `petalWire.js`. (The row schema reserves room for an avatar pointer, but the joiner
  AVATAR is a follow-up: it needs the joiner's blob to replicate to the owner via the
  shared base's blob store, which is unverified. Name ships now; the owner UI renders
  an initials avatar meanwhile.)
- **Apply rule** (`rowSharedDecision`): a `member:` row is accepted iff the key suffix
  equals `incoming.pubkey` and the value verifies (a self-write, mirroring the private
  base's `device:{pubkey}` rows) - so a writer may only publish their OWN member row,
  never spoof another's. LWW + tombstone as elsewhere. **Owner-write-only still holds
  for every projection row** (`share:/phase:/predict:/summary:`): unchanged.
- **`member:publish` method** - a joined viewer writes their profile into the shared
  base under `member:{ownPubkey}`. Called on `partner:join` and whenever the viewer's
  profile changes while joined. Reuses the profile blob-avatar pattern already used for
  `share:meta` owner identity.
- **`share:list` (owner)** - read the base's `member:*` rows (excluding the owner's own
  pubkey) and attach `joiners: [{ pubkey, name, avatar }]` to each share row. Keep the
  existing `createdAt`.
- **UI** - "People you share with" rows show the joiner's name + avatar ("Shared with
  Ada"); before anyone joins, a "Waiting for someone to join · shared {date}" state.
  Copy makes clear the link is a bearer link (anyone with it can view) until Part B.

### Part B - writer-admission gating (`@peerloom/core`, NOT in this change)

Gate `addWriter` so only the intended joiner becomes a writer and a partner cannot
admit a third party. Needs its own proposal + cross-suite testing (PearList, PearCircle,
PearGuard all build on core). **Until Part B lands, a joiner's name is self-attested
(spoofable) and the existing third-party-admission caveat remains** - this is the same
deferred "Shared-base addWriter gating" security item, now surfaced in the UI copy.

### Out of scope

Consent scopes, owner->multiple-partner semantics beyond display, any core change.

## Compat

- `member:` is a NEW namespace, additive. No existing row type changes.
- **Old owner peer**: `applyPetalOp` ignores an unknown namespace (no-op); `share:list`
  simply omits joiners. No break.
- **Old joiner peer**: never publishes a member row; owner shows the "waiting" state.
- Old-code and new-code peers still fully interoperate on the projection (the shared
  data itself is unaffected); only the identity display differs. No migration needed.

## Verify

- **Unit** (`petalWire.test.js`): a `member:` row signed by its own pubkey is accepted;
  a `member:` row whose key pubkey != signer is rejected; a `member:`-shaped attempt to
  write a projection row is rejected; LWW + tombstone hold. Owner-only rules for
  `share:/phase:/predict:/summary:` unchanged (regression).
- **Engine/two-peer** (`petalMethods.test.js`): owner `share:create`; a second peer
  `partner:join` + `member:publish`; owner `share:list` returns the joiner's name.
- **On-device**: TCL owner + Pixel viewer -> owner's Sharing screen shows
  "Shared with {name}".

## Rollback

Part A is additive and ignored by old code. Revert = stop reading/writing `member:`
rows; no migration, no core change, blast radius is PearPetal-only.
