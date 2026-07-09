# Shared-base addWriter gating (per-person shares, Part B)

**Goal** - Ensure only the intended joiner can become a writer on a shared base, so a
partner cannot silently admit a third party to the owner's consented projection.

**Tier** - T3. Pairing / writer-admission / capability crypto in `@peerloom/core`,
which every suite app (PearList, PearGuard, PearCircle, PearPetal) builds on.
**Proposal + rollback + RCA readiness required. This is a DESIGN proposal to agree the
approach before any core code.**

## Problem

On a PearPetal shared base the joiner is admitted as an Autobase **writer** (so pairing
binds their identity and so they can publish their `member:{pubkey}` row - per-person
shares Part A). The apply layer already rejects every projection write from a non-owner,
so a partner cannot forge cycle data. **But an Autobase writer can call `addWriter`.** A
partner could therefore admit a THIRD party, who would then replicate the owner's
consented projection. Bounded leak (only the shared scope, never the private log) but
still a consent violation - and it makes "Shared with Ada" untrustworthy, since Ada
could add Bob.

The tension: bearer invites let a joiner **self-admit** while the owner is offline
(async sharing). We must keep async joins working while preventing a joiner from
admitting anyone else.

## Options

- **A. Owner-only addWriter (base policy).** Core honors an `addWriter` only when it is
  authored by the base's founding/owner key. Simple, but breaks async joins: the owner
  must be online to admit each joiner (the joiner can no longer self-admit).
- **B. Single-use / capped writers.** The invite admits exactly one writer, then the
  pairing capability is consumed; core caps the shared base at 2 writers (owner +
  joiner) and ignores further `addWriter`. Keeps async joins; simple mental model; but
  "one invite = one person" changes the current reusable-link behaviour.
- **C. Capability-gated addWriter (RECOMMENDED).** The owner signs a **single-writer
  capability** into the invite. A joiner's `addWriter` is honored by core only if it
  presents a valid, unused owner capability; a partner holds no capability-minting key,
  so they cannot admit others - even while the owner is offline. Async joins keep
  working (the capability was pre-signed at invite time). Generalizes: each app supplies
  its own admission policy.

Recommendation: **C**, exposed as a core hook so admission policy is app-owned:

```
createGroup({ ..., writerAdmission: 'capability' })   // or a policy object
// core calls, before honoring an addWriter system op:
authorizeWriter({ base, candidatePubkey, capability, view }) -> boolean
```

PearPetal's policy: accept iff `capability` verifies against the `ownerPubkey` recorded
in `share:meta` and has not been spent. The PRIVATE base keeps its current policy
(the owner's own devices may link) - admission is **per base**, not global.

## Scope

- **In:** a core writer-admission hook + capability verification in the Autobase apply
  path; PearPetal wiring (owner mints a capability into each share invite; policy checks
  it); making the current reusable bearer invite either single-use (Option B flavor) or
  capability-bound (C).
- **Out:** changing consent scopes or the projection; the Part A identity display (already
  shipped); any change to private-base device linking beyond leaving it as-is.

## Compat

- **Cross-suite:** this changes `@peerloom/core` pairing. Every app that creates groups
  must be audited: PearList (household lists), PearGuard (parent/child), PearCircle
  (location). Default the new policy OFF (legacy self-admit) so existing apps are
  unaffected until they opt in; PearPetal opts in for shared bases only.
- **Old vs new PearPetal peers:** an old owner mints no capability; a new joiner still
  self-admits (policy off) -> no regression, but no gating either. Gating only holds once
  BOTH sides are new AND the base was created with the policy on. Document that shares
  created before this ships remain bearer-gated.
- **Migration:** none for data; the change is in admission, not stored rows.

## Verify

- **Core unit/integration:** a capability-backed `addWriter` is honored; an `addWriter`
  from a writer WITHOUT a capability is ignored; a spent capability is rejected; the
  private-base owner-device linking path is unaffected (regression across the suite's
  existing pairing tests).
- **PearPetal two-peer:** owner shares -> joiner admits via capability -> joiner is a
  writer and can publish `member:`; joiner attempts to `addWriter` a third key -> ignored
  (third party never replicates the projection).
- **On-device:** owner (TCL) + joiner (Pixel) + a third device: confirm the third cannot
  be added by the joiner.

## Rollback / RCA readiness

- Policy defaults OFF; disabling it reverts to today's self-admit with zero data change.
- Because this touches pairing for the whole suite, land it behind the per-app opt-in and
  roll out one app at a time (PearPetal first). RCA doc required if a pairing regression
  reaches any app's release pipeline (Constitution SS6).

## Open questions

1. Reusable share links vs one-link-per-person: does Option C keep links reusable (mint N
   capabilities) or move to single-use (one capability per link)? Leaning single-use for
   shares (matches "Shared with Ada"); revisit if a "family, many viewers" case appears.
2. Capability format + storage: signed blob in the invite fragment vs a row seeded into
   the base at create time. Must not bloat the invite URL.
3. Where the core hook lives relative to the existing `mux.pair` admission path fixed in
   core `aa83311` (avoid reintroducing the writer-admission churn from that bug).
