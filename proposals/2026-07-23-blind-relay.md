# Adopt the shared PeerLoom blind relay as PearPetal's off-LAN backstop

## Goal

Let two PearPetal phones that cannot hole-punch to each other still pair and sync, by
retrying the failed connection through the already-deployed PeerLoom blind relay.

## Tier

**T3.** Not because the change is large - the app diff is one swarm option, one device-local
setting and one Settings card - but because it introduces a new transport path for user
traffic and PeerLoom-run infrastructure that can observe connection metadata. In an app whose
entire pitch is "your cycle data never touches a server", that deserves the full gate:
proposal, rollback and RCA readiness.

It does **not** touch the wire protocol, the private/shared base split, the invite or pairing
flow, key management or revoke. Old and new peers interoperate: relaying is negotiated per
connection at the socket layer, below everything PearPetal defines.

## Why PearPetal needs this more than most

PearTune measured the punch at ~12% per attempt on a real phone over cellular, each failure
aborting deterministically at ~10.5s with `HOLEPUNCH_ABORTED` (peartune DECISIONS
2026-07-22). Retries turn "never" into "usually, eventually". But 12% is an average - a user
on a genuinely symmetric NAT sits near 0% and simply never connects.

PearTune is phone-to-**host**, where one end is a box on a home network that can usually be
punched. PearPetal is phone-to-**phone**: both device linking and partner sharing put two
mobile devices, often both on carrier CGNAT, on opposite ends of the punch. That is the
hardest case there is, and PearPetal has no always-on node anywhere in its design - no
blind seeder, no host - to soften it. There is nothing else in the system that can rescue a
failed punch, so the relay is the only backstop available.

## Scope

**What changes**

- `src/relay.js` (new). The baked relay public key plus the pure direct-first policy
  function and the small in-memory cache that policy reads. ~110 lines, no I/O of its own.
- `src/bare.js`. Passes `createSwarm` into `createGroupEngine` - the injection seam
  `@peerloom/core` already exposes for exactly this - so the one Hyperswarm is built with a
  `relayThrough` policy. Core is unchanged; no core release is on the critical path.
- `src/petalMethods.js`. `network:get` / `network:set`, backed by a new device-local
  `network` localDb record `{ useRelay, updatedAt }`. Modelled on the existing
  `notifications` record: device-local, never projected to a partner, never synced to the
  owner's other devices.
- `src/ui/App.jsx`. A "Connect anywhere" card in Cycle settings with the privacy toggle and
  copy stating plainly what the relay can and cannot see.
- `package.json`. `z32` promoted from transitive to a direct dependency (it decodes the key).

**What does not change**

- No relay node is built or deployed here. The node exists, is live and is shared by the
  suite (peartune `proposals/2026-07-23-blind-relay.md`, phase 1). PearPetal points at the
  same key: `qshao3eawtzecrt5p7buswr4meyyhw6q6b51qtxazd8wwfdp8uqy`.
- Nothing above the socket. A relayed connection hands back the same UDX stream and the same
  Noise-authenticated `remotePublicKey` a direct one does, so pairing, admission gating,
  Autobase replication and the private/shared base separation are byte-for-byte identical.
- No always-announce change. The relay engages per connection; it neither creates nor
  removes swarm topics, so the topic-accumulation work tracked separately is untouched.

## How direct-first is guaranteed

Hyperswarm 4.17.0 already implements the escalation, so PearPetal builds none of it:

- `_connect` passes `relayThrough: this._maybeRelayConnection(peerInfo.forceRelaying)` into
  `dht.connect` (`node_modules/hyperswarm/index.js:210-214`).
- On a connect error it sets `peerInfo.forceRelaying = true` when `shouldForceRelaying(code)`
  (`:225-227`), and that predicate (`:669`) fires on exactly `HOLEPUNCH_ABORTED`,
  `HOLEPUNCH_DOUBLE_RANDOMIZED_NATS` and `REMOTE_NOT_HOLEPUNCHABLE`.
- We pass `relayThrough` as a **function**, not a bare key, so the user's toggle is read live
  per dial and no reconnect is needed for a change to apply. It returns `null` unless
  `force` (the punch already failed for this peer) or `swarm.dht.randomized` (our own NAT can
  never punch, so waiting to fail costs ~10s per peer for nothing).
- hyperdht's `confirmDirectUpgrade` tears the relay back down if a direct path later appears,
  so a relayed session upgrades itself for free.

Net effect: a peer we can punch is **never** relayed.

## Privacy - stated precisely

The stream stays Noise-encrypted end to end. The relay holds no key to that session, so it
carries ciphertext. It can observe that two public keys are connected and how many bytes
flow. It cannot observe a period date, a symptom, a name or a scope.

This is transient encrypted transit, not storage, and it is a genuine (if small) widening of
the metadata surface. Hence the toggle. It defaults **ON** so the app works for someone who
does not know what a hole-punch is; turning it off gives pure peer-to-peer and accepts that a
network which blocks direct connections will not sync. The Settings copy says both halves.

The fail-safe direction matters: the policy cache reads "not yet hydrated" as **do not
relay**. Relaying for someone who opted out would leak metadata to us; not relaying for the
first few hundred milliseconds costs nothing, because a relay only ever engages after a punch
has already spent ~10s aborting.

## Compat

Nothing on the wire changes, so a 1.0.2 peer and a relay-capable peer connect exactly as
before. If only one end offers the relay, that is still enough: the escalating end puts
`relayThrough: {publicKey, token}` in its handshake and the other end's server relays on that
alone (`hyperdht/lib/server.js:410`), with no configuration of its own. So the backstop works
against already-shipped peers, without waiting for both sides to update.

## Verify

- `npm run verify` green (tests + all three bundles).
- New `test/relay.test.js`: gate ordering (toggle beats NAT, no key beats everything),
  direct-first, randomized-NAT immediate relay, the fail-safe unhydrated cache, hydration
  defaults and that `createRelaySwarm` hands Hyperswarm a function whose direct call returns
  null and whose forced call returns the key.
- New `network:get`/`network:set` case in `test/petalMethods.test.js`: default ON, persistence
  round-trip, empty-patch is not a reset and that the live cache moves with the setting.
- **Hardware gate (owed, not yet done):** two phones on mobile data with wifi off, one pairing
  that fails to punch directly, confirmed to complete via the relay. And the negative: on the
  same LAN, confirm the relay is never used.

## Rollback

Remove the `createSwarm` line from `src/bare.js` and the app is exactly where it was. Set
`RELAY_PUBLIC_KEY_Z = null` in `src/relay.js` to ship a build that can never relay while
keeping the code. Users can opt out individually at any time. The relay node is shared and
outside this repo; if it goes down, nothing routes through it and behavior degrades precisely
to today's - unpunchable pairs stay unreachable, everyone else is unaffected.

## RCA readiness / risks

- **Single shared point.** One relay backs the whole suite. Down means 0%-punch users lose
  the backstop only. Its uptime and abuse posture are owned by the PearTune-side deployment.
- **Metadata disclosure.** Covered above; the mitigation is honest copy plus the toggle, not
  a technical claim of zero knowledge.
- **Open forwarder.** The node forwards for anyone presenting a token. That is PearTune's
  phase-1 accepted risk with caps and stat visibility; PearPetal inherits it unchanged.
- **No relay stats surfaced yet.** PearTune shows `dht.stats.relaying` in its connection
  diagnostics; PearPetal has no diagnostics screen, so an escalation is currently invisible
  to the user and to us. That is the first follow-up if the hardware gate is ambiguous.

## Open questions

- **Promote `src/relay.js` into `@peerloom/core`?** It is app-agnostic and PearTune has a near
  twin. Deliberately NOT done now: two copies of a 110-line pure module is cheaper than a core
  API plus a version bump across the suite, and core already exposes `createSwarm` as the
  seam. Rule of three - promote when a third app adopts it. Tracked in `TODO.md`.
- **Should the toggle be reachable during onboarding**, or is Settings enough? Settings for
  now; onboarding is already long and the default is the working one.
