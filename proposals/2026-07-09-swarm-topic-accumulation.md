# Swarm topic + connection accumulation

**Goal** - Reduce the pairing-reliability degradation that grows as a device
accumulates groups (bases): each persisted group rejoins its own swarm topic on
every boot and multiplexes over shared connections during pairing, so a device
holding many bases pairs slowly or stalls, while a fresh install pairs in ~1s.

**Tier** - T3. Changes `@peerloom/core` swarm discovery + pairing connectivity - the
shared P2P substrate for the whole suite - and peers on old code will not upgrade on
our schedule. The individual mitigations below are back-compatible (they change
discovery topology, not the wire/record format), but the surface is connectivity-
critical, so it is tracked at T3 with a real interop analysis. Per `@peerloom/core`
CLAUDE.md, this proposal lives in the consuming app (PearPetal), which surfaced it.

## Background / root cause (investigation 2026-07-09)

Symptom: after heavy two-device testing (many shares / joins / revokes left on both
phones), scanning a share QR paired slowly or stalled until an app restart, while a
fresh install paired in ~1s. The hypothesis raised was "conflicting swarm topics."

Findings (code references in `peerloom-core/`):

1. **Topics cannot collide.** A group's topic is `blake2b(groupKey)` over a unique
   random 32-byte per-group key (`src/swarm.js:19-27`), and `joinTopic` dedups by
   topic hash (`src/engine.js:174` - `if (topicToGroup.has(topicHex)) return null`).
   Distinct groups produce distinct topics and a topic is never joined twice. So it is
   NOT a topic-collision bug; no appId namespacing is even required since keys are
   globally unique.

2. **One rejoined topic per persisted group, every boot.** `init()` streams every
   `groups:joined:*` row and re-mounts the base + rejoins its topic
   (`src/engine.js:268-274`) - the private base + EVERY shared-out share + EVERY
   shared-in partner + EVERY soft-revoked-but-not-"Remove permanently"'d share. N grows
   with accumulated groups; nothing sheds a topic except an explicit `destroyGroup`
   (`share:remove` / `partner:leave`).

3. **Viewers announce needlessly.** Every group joins with `{ server: true, client:
   true }` (`src/engine.js:176`), INCLUDING shared-in (viewer) bases. A viewer only
   needs to CONNECT to the owner (the server); announcing the owner's topic as a server
   too is redundant and adds discovery load.

4. **Shares multiplex over shared connections.** Pair channels and Corestore
   replication ride the SAME Hyperswarm connection, with multiple bases mounted/joined
   at different times (`src/pairing.js:4,111`). A new partner's pairing therefore runs
   over a possibly-reused connection already carrying other bases' traffic - the exact
   "2nd+ shared space, writer-admission-over-a-reused-connection" path that was the
   known core pairing bug (fixed with the Protomux `mux.pair` listener). It gets
   exercised more as N grows, so churn/stalls become more likely.

5. **No connection cap.** The swarm is `new Hyperswarm({ keyPair })` with defaults
   (`src/engine.js:264`); nothing throttles fan-out when N is large.

Net: not a collision - topic + connection PILE-UP plus reused-connection pairing churn
that degrades with N. A fresh install drops N to ~1 (just the new private base), so
pairing takes the clean single-connection path and is fast. This is inherent to the
swarm-per-group + shared-connection model, so it is SUITE-WIDE (the other apps use the
same core, or the copy-fork equivalent) - which matches "I've seen something similar in
the other apps." Normal users (one partner, a couple of devices) stay at low N and
never notice; our test churn is what surfaced it.

## Scope - proposed mitigations (independent; pick by risk/value)

### A. Viewers join client-only (RECOMMENDED, low-risk)
Give `joinTopic` an explicit `{ server, client }` option and mount shared-in (viewer)
bases with `{ client: true, server: false }`. A viewer connects to the owner (the
server) and no longer announces the topic. Removes redundant viewer-side announcing and
viewer<->viewer / owner<->extra-announcer discovery. The core `joinTopic` is generic
(no `kind`), so the consuming app passes a per-mount server/client hint (PearPetal knows
`kind` from `groups:joined`). **Compat:** an old owner still announces (server); a new
viewer connects (client) and finds it. An old viewer (server+client) still works against
a new owner. Fully interoperable.

### B. Shed dead topics (low-risk, additive)
`destroyGroup` already leaves the topic + clears `topicToGroup` (`src/engine.js:378-382`),
so shedding is just calling it. Encourage/automate cleanup of soft-revoked shares once
their tombstone is delivered (no ack channel today - deferred; a TTL is the interim).
Cheapest immediate lever: surface/nudge "Remove permanently" so revoked shares stop
being rejoined.

### C. Announce back-off (higher-risk, DEFERRED)
Stop server-announcing a share's topic when no partner is connected; re-announce on
demand (owner opens the QR / Devices sheet, or a periodic keepalive). **Risk:** if both
sides back off, neither is discoverable - so the OWNER must keep announcing while
"expecting" a partner (sheet open / recently created) and only throttle otherwise.
Needs careful design; do not ship blind.

### D. Hyperswarm tuning (low-risk config)
Set a sensible `maxPeers` / connection cap + join backpressure so a large N does not fan
out unbounded on constrained mobile networks.

## Compat

A and D are back-compatible (discovery still works against old peers; A only removes
redundant viewer announcing). B is additive (calling existing teardown). C must be
designed so at least one side always announces. No wire-protocol, record, or Hyperbee-key
change; this is connectivity behavior only. No migration.

## Verify

- **Repro harness** (`@peerloom/core` test): mount K synthetic shared-in + shared-out
  bases and measure time-to-first-connection for a fresh pairing at K=1 vs K large;
  assert A + D cut announced-topic count and time-to-pair.
- Core two-peer pairing test still green (pairing over a reused connection).
- **Suite gate:** re-run PearList's pairing smoke (the extraction vehicle) before any
  app adopts, since this is shared core.
- **On-device:** with A, a device holding many bases pairs materially faster than today;
  a fresh install stays at the ~1s baseline.

## Rollback

Each mitigation is independent and revertible with no persisted state to unwind: A is a
per-mount flag (revert to `server:true, client:true`); D is config; B/C are additive.

## Open questions

- Does a viewer ever NEED to be a server (a future multi-viewer topology, or NAT cases
  where the owner cannot hole-punch as server)? If so, gate A with a fallback that
  re-announces when a direct connect fails.
- Auto-sweep policy for soft-revoked shares (blocked on the deferred ack channel from
  the sharing-ended proposal).
- Right `maxPeers` for mobile.
- Should the PRIVATE base also go client-only on non-founder (linked) devices - founder
  announces, linked devices connect - to cut own-device announce load? Investigate
  alongside A.
