# Sharing ended (revoke tombstone)

**Goal** - When an owner revokes a partner's share, let the partner see a calm
"sharing ended" state on their next open, instead of silently frozen data.

**Tier** - T2. Adds one optional field to the owner-signed `share:meta` row (new
persisted shared value + cross-peer effect) and changes the revoke FLOW (soft-close
instead of immediate destroy). NOT T3: it changes no privacy boundary, no crypto, no
key management, and no admission/auth gate - revoke stays forward-only and the
partner's already-replicated blocks are untouched. Fully back-compatible (old peers
ignore the field). Decisions resolved with Tim 2026-07-09.

## Background (current behaviour)

`share:revoke` (`src/petalMethods.js`) deletes the owner's local membership
(`groups:joined:{groupId}`) and calls `ctx.destroyGroup` - which leaves the swarm
topic and closes the base LOCALLY on the owner. It writes NO signal, rotates no key,
and does not touch the partner. The partner runs a separate process with its own full
replica, so it just stops receiving updates and shows the last-synced projection
forever, with no indication the share ended. `destroyGroup` (core `engine.js`) does not
wipe disk; it only stops the owner announcing/serving.

The apply gate (`rowSharedDecision` in `src/petalWire.js`) validates `share:meta`
whole-row by owner signature (`incoming.pubkey === existing.ownerPubkey`), with no
per-field schema - so a new optional field inherits the gate for free.

## Decisions (resolved 2026-07-09 with Tim)

1. **Soft-close delivery.** On revoke the owner writes the tombstone and KEEPS serving
   the base (does not destroy it) so the tombstone replicates to the partner whenever
   they next reconnect - reliable even if the partner is offline at revoke time. The
   owner stops sending projection updates; the share moves to an "Ended" state with a
   "Remove permanently" action that finally destroys the base. (Rejected: hard-destroy,
   which only reaches a partner connected at revoke time.)
2. **Partner sees a banner + keeps last data.** A calm "{name} stopped sharing their
   cycle" banner atop the last-known (dimmed) view, with a "Remove" button. (Rejected:
   replacing/hiding the data, or a chip-only treatment.)
3. **No notification.** Partner-facing stays a passive on-open state, per the
   notifications decision (2026-07-09-notifications). No push.

## Scope

### Wire (T2, additive)

- **`share:meta` gains two OPTIONAL owner-written fields: `revoked: true` +
  `revokedAt: <ms>`.** Owner-signed, inherits the existing owner-write-only gate - NO
  apply-rule change. Uses a distinct `revoked` field, NOT `deleted` (the apply
  resurrection guard keys off `deleted`, and we must not permanently poison the row).

### Owner side (`petalMethods.js`)

- **`share:revoke` becomes soft-close**: read the current `share:meta`, re-write it with
  `revoked: true` + `revokedAt: Date.now()` (merging the existing owner/scope/identity
  fields, re-signed with a fresh `updatedAt` so LWW keeps it current), then FLAG the
  membership record `groups:joined:{groupId}` with `revoked: true` + `revokedAt` (kind
  stays `shared-out`). Does NOT destroy the base. Idempotent.
- **New `share:remove` method** = the OLD revoke behaviour: `localDb.del` the membership
  + `destroyGroup`. This is the owner's "Remove permanently" (fully abandons the base,
  accepting the partner may not have synced the tombstone yet).
- **`refreshShares`** skips memberships flagged `revoked` (so a revoked partner gets no
  further projection writes; their phase/predict/summary rows stay frozen at last sync).
- **`share:list`** includes revoked shares with `revoked`/`revokedAt` so the owner UI can
  show an "Ended" section.

### Partner side (`petalMethods.js`)

- **`partner:view`** + **`partner:list`** read `meta.revoked` / `meta.revokedAt` and add
  `revoked` + `revokedAt` to their return shapes (one line each).

### UI (`src/ui/App.jsx`)

- **`PartnerView`**: when `revoked`, show a calm banner ("{ownerName} stopped sharing
  their cycle · {date}") above the existing view (dimmed), plus a "Remove" button
  (`partner:leave`); stop the 2s poll (nothing new is coming).
- **`ViewerHome`**: a revoked partner card shows "Sharing ended" in place of the scope
  label.
- **Owner `Sharing` screen**: revoked shares render in a subtle "Sharing ended" section
  with a "Remove permanently" button (`share:remove`); the Revoke button on an active
  share now soft-closes.

### Out of scope

- Key rotation on revoke (proposal 2026-07-06 said revoke "can" rotate): NOT done here -
  soft-close serves the SAME base with a frozen projection, so no new data is exposed;
  a re-share still mints a fresh base + key. Revisit only if revoked bases ever need to
  keep updating for a different partner (they don't - each share is its own base).
- Auto-cleanup of lingering revoked bases (TTL / partner-ack): the partner cannot write
  to the owner-write-only base, so there is no ack channel; v1 is manual "Remove
  permanently" only. A future TTL is additive.
- Multi-partner (v1 is single-partner; the per-base keyspace already generalises).

## Compat

Additive, no migration, no version bump. Field-level:
- **New owner -> old partner**: owner writes `revoked`; the old partner ignores the
  unknown field and keeps showing frozen data - exactly today's behaviour, no worse.
- **Old owner -> new partner**: old owner hard-destroys and never writes `revoked`; the
  new partner sees frozen data (no banner) - today's behaviour.
- **New <-> new**: the banner shows. Old and new peers still fully interoperate.

## Verify

- **Unit** (`petalWire.test.js`): an owner-signed `share:meta` carrying `revoked:true`
  applies; a partner-signed one is rejected (existing gate); a later owner `share:meta`
  write still applies (we used `revoked`, not `deleted`, so the resurrection guard is not
  tripped).
- **Method** (`petalMethods.test.js`): owner `cycle:create` + `share:create` ->
  `share:revoke`: assert `share:meta` now has `revoked:true` + `revokedAt`, the
  membership is flagged revoked and STILL EXISTS (base not destroyed), and
  `refreshShares`/`period:log` writes no further projection to it. `share:remove` deletes
  the membership + destroys the base. `share:list` surfaces the revoked flag.
- **Partner read**: `partner:view` / `partner:list` return `revoked:true` once the meta
  says so (single-engine read of a locally-written revoked meta; cross-peer replication
  rides the existing pairing path).
- **`npm run verify`** green (tests + 3 bundles).
- **On-device** (hardware pass): owner revokes on the TCL; the partner (Pixel) shows the
  "sharing ended" banner on next open; "Remove permanently" (owner) and "Remove"
  (partner) both clear.

## Rollback

`revoked`/`revokedAt` are optional fields; backing out means reverting `share:revoke` to
the `share:remove` (hard-destroy) body and dropping the two reads - no persisted schema
to migrate, and old/new peers already ignore the field. Forward-only, low blast radius.

## Open questions

- Should a revoked base auto-remove after the partner has demonstrably synced the
  tombstone? No ack channel exists (owner-write-only), so deferred; manual remove for v1.
- Owner-side "Ended" section: keep indefinitely vs a gentle "remove after N days" nudge?
  v1 keeps it until manual removal.
