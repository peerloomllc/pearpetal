# Review - PearPetal wire protocol v1 (T3)

**Shipped**: `proposals/2026-07-06-wire-protocol.md`, the v1 wire protocol for
PearPetal (menstrual / fertility tracker). Defines the two-base topology (private
base replicated across the owner's own devices only; a per-partner shared base
carrying a consent-scoped projection), the two invite grammars on the `/petal/`
path prefix, the Hyperbee schema and apply branches on each base, the signed
envelope, swarm topic derivation, the local-only prediction model, and forward-only
revocation semantics. All six open questions resolved at approval (see
`DECISIONS.md` 2026-07-06 "Wire protocol v1 approved").

**Signed off**: Tim, 2026-07-06, by committing the proposal into the new
`pearpetal` repo (Constitution §3 approval convention). Prepared by Claude.

**Notes**: App is pre-scaffold - this locks the wire spec before any code. No
PearPetal peers exist, so v1 is the forward-compat floor: every replicated record
carries `v: 1` and evolves additively. The truly breaking layer (the two base keys
and two encryption keys) would be a hard fork, not an additive bump. Built on
`@peerloom/core`; scaffolding waits on that package being `file:`-linkable.
