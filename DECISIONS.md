# PearPetal - Decisions

Append-only, newest on top. Per Constitution §4.

## 2026-07-06 - Wire protocol v1 approved + open questions resolved
Tier: T3
Context: `proposals/2026-07-06-wire-protocol.md` reached approval (Tim committed it
into the new `pearpetal` repo). Its six open questions needed v1 answers.
Choice (all v1):
  1. Recovery: optional user-held encrypted export, passphrase-wrapped, on-demand,
     never automatic, never uploaded. No cloud/seeder ever. ≥2 linked devices are
     the primary backup.
  2. Predictions: never written to any base; recomputed on-device from the log so
     prediction data never crosses the wire. New device shows a brief "computing…".
  3. `full`-scope symptom whitelist (fixed, coarse, non-clinical): cramps,
     headache, fatigue, bloating, tender-breasts, nausea, backache, acne,
     mood-low, mood-irritable, energy-high, libido-high. Notes/BBT/intimacy and
     any off-list tag are never projected. Versioned constant; widening is
     additive v1.x.
  4. Multi-partner: v1 single-partner (keyspace permits N; deferral not preclusion).
  5. Two-way couples mode: v2 (v1 partner read-only; a v2 mutual base is additive).
  6. Block-encryption: always-on, no toggle, both bases from day one; no legacy
     unencrypted tier.
Alternatives: cloud/seeder backup (rejected - breaks the no-server pitch);
replicating predictions for instant display on new devices (rejected - puts
derived sensitive data on the wire for a cosmetic gain); open-ended symptom
projection (rejected - unauditable redaction boundary).
Consequences: implementation must provide the encrypted-export path, an on-device
recompute with a "computing…" state, and enforce the symptom whitelist in the
projection writer (with an apply-branch test asserting off-list tags never appear
in `summary:`). App remains pre-scaffold; these lock v1 before code starts.

## 2026-07-06 - App name = PearPetal (DECIDED)
Tier: T0 (branding, no wire effect)
Context: menstrual / fertility tracker in the Pear* suite. Category rewards a
discreet home-screen name (many users do not want an obvious period app on
screen) over a literal one. Placeholder in APP-IDEAS.md was "PearPetal".
Choice: **PearPetal**. Rationale:
  - "Flowers" is a genuine historical euphemism for menstruation (Middle English
    / Victorian "her flowers" = menses), so the flowering wordplay points right
    at the subject rather than being merely decorative.
  - Discreet and soft on the home screen, which suits the sensitive category.
  - Enables the signature UI (below), which the name reinforces.
Signature UI intent: an interactive **petal dial** modeled on Stardust's
interactive moon-phase dial, but floral instead of celestial. A ring of petals
that furls and blooms across the cycle, tap a petal to open that day's log. It
maps directly onto the wire protocol's four-value `phase:current`:
  - menstrual = petals furled (deep red)
  - follicular = budding / opening
  - fertile / ovulation = full bloom
  - luteal = fading, petals closing
So the dial needs zero protocol change (see `proposals/2026-07-06-wire-protocol.md`).
Design guardrail: keep the metaphor floral but the EXECUTION restrained and
modern (botanical geometry, muted palette, NOT the pink-and-cursive period-app
cliche). The floral-cliche blend-in is the main risk; a clean adult aesthetic is
how we avoid it. Also: we take Stardust's engagement hook (the playable dial) but
NOT its credibility problem - Stardust went viral on a privacy claim it could not
back (caught sharing phone numbers); our P2P two-base design can actually back it.
Alternatives considered: PearMoon (moon-cycle, my earlier rec, dropped in favor
of the flower metaphor + petal dial), PearPetal (too literal), PearBloom (close
sibling, "bloom" reads more active but "petal" is softer and more distinctive),
PearPhase, PearTide, PearLuna, PearFlow (too on-the-nose).
Consequences: repo/folder is `pearpetal/`; bundle id `com.pearpetal`; invite-link
path prefix `/petal/` (per-app prefix convention, avoids host collision on
peerloomllc.com); custom scheme `pear://pearpetal/`. Catalog, proposal, and memory
renamed 2026-07-06.

## 2026-07-06 - Two-base topology as the privacy boundary
Tier: T3
Context: cycle/fertility is the most sensitive data class in the suite. The pitch
is "never touches a server, and you choose exactly what a partner sees." A single
shared Autobase (partner joins, sees everything) breaks the second half.
Choice: split storage into two separate Autobases with independent 32-byte
encryption keys. A PRIVATE base holds the full daily log + period history and
replicates ONLY across the owner's own devices; its enc key never leaves those
devices. A per-partner SHARED base carries only an owner-written, consent-scoped
projection (phase, predicted dates, optional redacted symptom summary). The
partner-share invite deliberately withholds the private base key: that withholding
IS the boundary (mirrors PearCircle's blind-seeder seed invite).
Alternatives: (a) single shared base with field-level ACLs in the apply pass -
rejected, ACLs do not stop a peer replicating the raw encrypted blocks it can
decrypt; structural separation does. (b) partner gets a read replica of the
private base with client-side redaction - rejected, redaction that depends on the
reader's client is not a boundary.
Consequences: partner is READ-ONLY in v1 (writer at the Autobase layer for
identity binding, zero accepted write surface). Predictions are computed
on-device from the private base and never cross the wire. Revocation is
forward-only: it stops future updates and can rotate the enc key, but cannot
unsend blocks the partner already replicated (P2P invariant, UI must state it).
See `proposals/2026-07-06-wire-protocol.md` (T3 draft).

## 2026-07-06 - Build on @peerloom/core
Tier: T3
Context: PearPetal is slated as the append-only-LOG extraction vehicle, built
after PearList lands `@peerloom/core` and before PearCare, mirroring the
PearList-as-list-vehicle logic (APP-IDEAS.md build-order decision 2026-07-06).
Choice: consume `@peerloom/core` (identity, records/signing, pairing, sync) rather
than copy-fork from PearCircle. PearPetal exercises the log data shape and the
local-only-vs-replicated split so PearCare inherits a proven engine.
Alternatives: copy-fork from PearCircle like the three shipped apps - rejected,
the whole point of PearList's extraction was so the next apps stop copy-forking.
Consequences: PearPetal scaffolding depends on `@peerloom/core` being published /
`file:`-linkable first. Any core gap PearPetal surfaces feeds back into the
package before PearCare relies on it.
