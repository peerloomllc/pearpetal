# Wire protocol — PearPetal v1

**Status**: Approved 2026-07-06. Approval per Constitution §3 = Tim commits this
proposal into the new `pearpetal` repo. All open questions resolved (see below and
`DECISIONS.md`); review record in `reviews/2026-07-06-wire-protocol.md`. App is
pre-scaffold: this is the locked v1 wire spec, implementation not started. No
PearPetal peers exist yet, so v1 is the forward-compat floor.

**Goal**: Define the PearPetal v1 wire protocol (two-base topology, invite-link
grammars, Hyperbee schema, Autobase apply branches, signed envelope, swarm topic
derivation, partner-share projection) so the sensitive-data privacy boundary is
correct from the first device build.

**Tier**: T3. New protocol from scratch, new pairing surface, block-encryption
and consent-scoped sharing of the most sensitive data class in the suite
(menstrual / fertility). No prior peers, so the only compat obligation is
forward-compat for the v1 series. Built on `@peerloom/core` (proven by PearList).

---

## The core design decision: two bases, not one

PearPetal's whole pitch is "cycle data never touches a server, and you choose
exactly what a partner sees." A single shared Autobase (partner joins, sees
everything) violates the second half. So v1 splits storage into **two separate
Autobases with separate encryption keys**:

1. **Private base** — the full daily log and period history. Replicated ONLY
   across the owner's own devices. Its encryption key never leaves devices the
   owner controls. This is the source of truth; predictions are computed locally
   from it.
2. **Shared base** (optional, one per partner link) — carries only a
   **consented projection** the owner writes (current phase, predicted dates,
   and — only if scope allows — a symptom summary). A partner is admitted here
   and NOWHERE else. Withholding the private base key from the partner invite IS
   the privacy boundary (mirrors PearCircle's blind-seeder seed invite, which
   withholds the block-encryption key by design).

Raw entries and predictions stay device-local unless the owner explicitly shares
a projection. This is the discipline the catalog flagged PearCare will need too;
PearPetal proves it on a simpler, mostly-single-writer app.

---

## Scope

In scope:
- Two-base topology and how each is bootstrapped, encrypted, and discovered.
- Own-device link invite and partner-share invite grammars.
- Hyperbee key schema: local-only, private-base-replicated, shared-base-replicated.
- Autobase apply branches per record kind on each base.
- Signed envelope for log entries and projection rows.
- Consent scope levels and the projection the owner writes to a shared base.
- Local prediction inputs and where the computation lives (device-local only).

Out of scope (v1):
- Two-way partner logging. In v1 the partner is READ-ONLY on the shared base;
  they cannot append cycle data. Revisit in v2 (couples-conception mode).
- Health-platform import (Apple Health / Google Fit BBT, HealthConnect). v2.
- Multiple simultaneous partners. Keyspace permits it; v1 ships single-partner.
- Cross-identity account recovery. As with PearCircle there is none — but a
  second linked device IS the backup, so a single lost device is not data loss.
- Medical-grade / clinical prediction. v1 is a calendar + optional BBT estimate
  with an explicit not-medical-advice disclaimer.

---

## Compat

No prior peers. v1 is the floor. Every replicated record carries `v: 1`. Strict
additive evolution within v1 (new optional fields free; new required field or
apply-semantics change bumps to `v: 2` with per-record translation). The two
encryption keys and the two base keys are the truly breaking layer beneath the
record schema; a v2 that changes them is a hard fork, not an additive bump.

---

## Design

### 1. Identity

- 32-byte Ed25519 keypair via `sodium-universal` on first launch (`@peerloom/core`
  `identity` module).
- Stored only in the local Hyperbee under `identity`, never replicated.
- Public key is the canonical device identifier.
- Own devices are distinct pubkeys linked into the private base as co-writers.

### 2. The two bases

**Private base** (`privateBase`): a per-owner Autobase created at first launch.
Bootstrap writer core is this first device. Additional own devices are admitted
as writers via the device-link invite (§3). Opened with an `encryptionKey`
(32-byte random, generated once at creation). Block-encrypted; a peer without the
key replicates ciphertext only.

**Shared base** (`sharedBase:{partnerPubkey}`): created lazily the first time the
owner shares with a partner. A SEPARATE Autobase with its OWN 32-byte encryption
key. The owner is its bootstrap writer; the partner is admitted as a writer only
so Autobase can bind and verify their identity, but the apply branch REJECTS all
partner-authored cycle rows in v1 (read-only partner, §5). One shared base per
partner link; revoking a partner tombstones and stops replicating that base.

### 3. Invite links

Two grammars, per-app `/petal/` path prefix to avoid host collision on
`peerloomllc.com`.

**Device link (own devices only)** — carries the PRIVATE base:
```
https://peerloomllc.com/petal/link?base={hex(privateBaseKey)}&enc={hex(privateEncKey)}&owner={hex(pubkey)}&ts={issuedMs}
```
- Shown device-to-device as a QR only, never sent over any channel.
- Short-lived: `ts` older than 10 minutes is rejected by the scanning device.
- Grants full access — this is the owner linking their own second device.

**Partner share** — carries the SHARED base, and deliberately NOT the private
base or its key:
```
https://peerloomllc.com/petal/share?base={hex(sharedBaseKey)}&enc={hex(sharedEncKey)}&owner={hex(pubkey)}&scope={phase|fertility|full}&ts={issuedMs}
```
- The absence of the private base/enc key is the privacy boundary. A partner can
  never derive it (the shared enc key is independent random, not derived from
  any private material).
- `scope` fixes what the projection contains (§6). Encoded in the link so the
  partner's client knows what to expect; enforced by what the owner actually
  writes, not by the partner's honesty.

Legacy custom scheme accepted for both: `pear://pearpetal/link?...`,
`pear://pearpetal/share?...`.

### 4. Hyperbee keys

**Local-only (never replicated):**

| Key | Value |
|-----|-------|
| `identity` | `{ publicKey, secretKey, createdAt }` |
| `profile:local` | `{ displayName, avatar?, updatedAt }` |
| `prefs:local` | `{ avgCycleLength, avgPeriodLength, lutealLength, goal: 'track'|'conceive'|'avoid', updatedAt }` |
| `prediction:cache` | `{ nextPeriodStart, fertileStart?, fertileEnd?, ovulationEst?, computedAt }` (pure local compute over the private base; never replicated) |
| `privateBase` | `{ key: hex, encryptionKey: hex, createdAt }` (bootstrap refs for own devices) |
| `shares:{partnerPubkey}` | `{ baseKey: hex, encKey: hex, scope, label?, createdAt, revoked?: boolean, revokedAt?: number }` (owner's local registry of active partner links) |

**Replicated on the PRIVATE base (own devices):**

| Key | Value |
|-----|-------|
| `device:{pubkey}` | `{ pubkey, label, updatedAt, v: 1, sig }` (linked own devices; per-writer keyed) |
| `day:{yyyymmdd}` | `{ date, flow?: 'spotting'|'light'|'medium'|'heavy'|null, symptoms?: string[], bbt?: number, mood?: string[], intimacy?: { protected?: boolean }, notes?: string, createdBy, createdAt, updatedAt, pubkey, deleted?: boolean, v: 1, sig }` (one row per calendar day, shared across your own devices, edits LWW on `updatedAt`) |
| `period:{yyyymmddStart}` | `{ start, end?, createdBy, createdAt, updatedAt, pubkey, deleted?: boolean, v: 1, sig }` (explicit period span; optional, else derived locally from `flow` days) |

`yyyymmdd` / `yyyymmddStart` are fixed-width so lexicographic scans return date
order (substrate key convention).

**Amendment 2026-07-06 (implementation, slice 1): `day:` / `period:` are keyed by
DATE, not by author.** The original spec keyed them `day:{pubkey}:{yyyymmdd}`
(per-writer keyspace, the PearCircle multi-person pattern). Building it showed that
is wrong for the private base: every device on it is the SAME person, so you want
ONE canonical entry per day, editable from any of your devices, not a divergent
row per device. So `day:`/`period:` are now shared date-keyed rows resolved
last-writer-wins across your own devices (the author pubkey is still recorded in
the value and proven by the signature). Only `device:{pubkey}` stays per-writer
keyed (a device may write only its own roster row, so none can spoof another). The
`owner` singleton is dropped for slice 1 (the device roster suffices; admission is
physical, device-to-device). v1 remains the floor; no shipped peers exist. See
`DECISIONS.md` 2026-07-06 "Private base is date-keyed".

**Replicated on a SHARED base (partner link), owner-written only:**

| Key | Value |
|-----|-------|
| `share:meta` | `{ ownerPubkey, scope, createdAt, v: 1 }` (singleton) |
| `share:partner:{pubkey}` | `{ pubkey, addedAt, v: 1 }` (the admitted partner) |
| `phase:current` | `{ phase: 'menstrual'|'follicular'|'fertile'|'luteal', dayOfCycle, updatedAt, v: 1, sig }` (all scopes) |
| `predict:current` | `{ nextPeriodStart, fertileStart?, fertileEnd?, ovulationEst?, updatedAt, v: 1, sig }` (`fertile*`/`ovulation*` present only when `scope !== 'phase'`) |
| `summary:{yyyymmdd}` | `{ date, flow?: boolean, symptomTags?: string[], updatedAt, v: 1, sig }` (present only when `scope === 'full'`; a redacted per-day projection — coarse `flow` boolean and a whitelisted symptom tag set, never raw notes / BBT / intimacy) |

The shared base NEVER contains `day:` / `period:` raw rows. The owner's client
derives `phase:current`, `predict:current`, and (if `full`) `summary:` from the
private base and writes only those. Raw log detail is structurally absent from
what the partner replicates.

The four `phase` values also drive the app's signature UI: an interactive petal
dial that furls and blooms across the cycle (menstrual = furled, fertile = full
bloom). It is fed entirely by `phase:current` + local prediction, so the protocol
needs no change to support it. See `DECISIONS.md` 2026-07-06 naming entry.

### 5. Autobase apply branches

**Private base:**
- `owner`: bootstrap-writer-only; later appends ignored.
- `device`: any current writer; a new `device:` row also drives Autobase
  `addWriter` for that pubkey (own-device admission via `@peerloom/core`).
- `day`: writer may write ONLY its own `{pubkey}` keyspace; LWW on `updatedAt`;
  `deleted: true` is a soft-delete tombstone, no resurrection (a newer
  non-deleted `updatedAt` un-deletes, matching the substrate rule).
- `period`: same author/LWW/tombstone rules as `day`.

**Shared base:**
- `share:meta`, `share:partner`: owner-write only.
- `phase:current`, `predict:current`, `summary:`: owner-write only; LWW on
  `updatedAt`. **Any partner-authored row on any key is rejected** — this is what
  makes the partner read-only in v1. The partner is a writer at the Autobase
  layer (so their identity is bound and verifiable) but has zero accepted
  write surface.

All accepted rows are signed by the author pubkey and verified in the apply pass
before the view update (substrate rule; `@peerloom/core` `records` module).

### 6. Consent scope

`scope` is fixed at share-link creation and governs what the owner's client
writes to that shared base:

| scope | phase:current | predict:current | summary: |
|-------|---------------|-----------------|----------|
| `phase` | yes | `nextPeriodStart` only | no |
| `fertility` | yes | full (adds fertile window + ovulation est) | no |
| `full` | yes | full | yes (redacted per-day flow + whitelisted symptom tags) |

Widening scope = create a new share link (new shared base). Narrowing / revoking
= §8.

### 7. Prediction (local only)

Computed on-device from the private base; **never replicated** (each device
recomputes from the replicated log, so no prediction data crosses the wire).
Inputs: period-start history + `prefs:local`. v1 method:
- Cycle length = trailing average of observed start-to-start gaps (fallback to
  `avgCycleLength` until enough history).
- Next period = last start + cycle length.
- Ovulation estimate = next period − `lutealLength` (default 14).
- Fertile window = ovulation −5 … +1 days.
- Optional refinement: a sustained BBT rise narrows the ovulation estimate when
  `bbt` values are logged.

Explicitly labelled not medical advice, not contraception-grade. The `goal`
pref only changes copy/emphasis (conceive vs avoid), never the math's honesty.

### 8. Revocation and its honest limits

Revoking a partner: write `revoked: true` to the local `shares:{pubkey}` row,
stop announcing the shared base's swarm topic, and rotate — abandon that shared
base entirely (a re-share mints a fresh base + key). Rotating the encryption key
locks the partner out of all FUTURE blocks.

What revocation CANNOT do (and the UI must say so plainly): unsend blocks the
partner already replicated. Like PearCircle presence, sharing is forward-only —
past projected data the partner holds locally is theirs until they delete it.
This is a P2P invariant, not a bug; the honest framing is part of the pitch.

### 9. Swarm topics

- Private base topic = `blake2b(privateBaseKey)`. Announced only while at least
  one own device is online; this is how own devices find each other.
- Shared base topic = `blake2b(sharedBaseKey)`, announced per active (non-revoked)
  partner link.
- No global discovery topic. No directory.

### 10. Envelope and freshness

Every replicated row is canonical-JSON signed by the author (`@peerloom/core`).
Unsigned envelope MUST carry `pubkey` (== writing core identity) and `updatedAt`
(UTC ms; reject > 5 min in the future per local clock). `day:` / `period:` edits
dedup by key with LWW on `updatedAt`.

---

## Verify

- jest round-trip for both invite grammars (`buildDeviceLink`/`parseDeviceLink`,
  `buildShareLink`/`parseShareLink`) including rejection cases (stale `ts`,
  missing fields, private-key fields absent from a share link).
- jest sign/verify path over canonicalized rows (reuse `@peerloom/core` records
  tests).
- jest prediction unit tests against fixture cycle histories (regular, irregular,
  sparse, BBT-refined) asserting predicted dates and the not-enough-history
  fallback.
- jest apply-branch tests asserting: partner-authored shared-base rows are
  rejected; cross-pubkey `day:` writes are rejected; `full`-scope `summary:` rows
  never carry raw `notes`/`bbt`/`intimacy`.
- Two-device own-link smoke: link a second device, log on A, confirm B shows the
  same log and recomputes the same prediction.
- Partner-share smoke: share at each scope, confirm the partner device sees only
  the scoped projection and NONE of the raw log; confirm the partner cannot
  write.
- Revoke smoke: revoke, confirm the partner stops receiving updates; confirm the
  UI states past data cannot be unsent.

Canonical `npm run verify` (test + build:bare + build:ui) to be defined in the
app `CLAUDE.md` when scaffolded, matching PearCircle/PearList.

## Rollback

Unshipped: rollback before the first public build is a code revert. Post-ship,
breaking changes require `v: 2` with per-record translation in the apply
branches; the two-base/two-key layer would be a hard fork.

## Open questions

All resolved 2026-07-06 at approval; recorded in `DECISIONS.md`.

1. ~~**Own-device recovery when zero devices remain.**~~ Resolved: plain
   **JSON export / import**. The app writes the full log to a JSON file saved
   locally to the device (Downloads / Files), and can import it back. On demand,
   never automatic, never uploaded anywhere. No cloud, no seeder, no encryption
   wrapper — the file is the user's to store and protect (same model as a manual
   local backup). With ≥2 linked devices the log is self-backing; the export is
   the escape hatch for the all-devices-lost case and doubles as a manual
   migration path. A lost single device with a linked second device is not data
   loss.
2. ~~**Predictions written to the private base?**~~ Resolved: **no**. Predictions
   are recomputed on-device from the replicated log and are never written to any
   base, so prediction data never crosses the wire. A freshly linked device shows
   a brief "computing…" state until it finishes replicating the log.
3. ~~**`full` scope symptom whitelist.**~~ Resolved: v1 projects only a fixed,
   coarse, non-clinical tag set into `summary:` — `cramps`, `headache`,
   `fatigue`, `bloating`, `tender-breasts`, `nausea`, `backache`, `acne`,
   `mood-low`, `mood-irritable`, `energy-high`, `libido-high`. Free-text notes,
   BBT, intimacy, and any tag outside this list are NEVER projected. The list is
   a versioned constant; widening it is an additive v1.x change and the redaction
   boundary stays auditable.
4. ~~**Multi-partner.**~~ Resolved: v1 ships **single-partner**. The keyspace
   already permits N shared bases, so this is a deferral, not a preclusion.
5. ~~**Two-way couples mode.**~~ Resolved: **v2**. v1's partner is read-only; a
   v2 mutual base (partners co-logging for conception) is additive and not
   precluded by v1.
6. ~~**Block-encryption default.**~~ Resolved: **always-on, no toggle**. Both
   bases are encrypted from day one. There is no unencrypted legacy tier to
   support (unlike PearCircle), so no build-flag gating is needed.
