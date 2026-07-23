// The PeerLoom blind relay - PearPetal's client side of it (proposal
// 2026-07-23-blind-relay).
//
// Two phones on mobile networks often cannot hole-punch to each other. When the
// punch aborts, Hyperswarm can retry the SAME connection through a public relay
// node: a box both ends can reach outbound, which forwards the still-Noise-
// encrypted stream. The relay never holds a key to that session, so it carries
// ciphertext plus metadata (which two public keys are talking, and how many
// bytes) and never plaintext cycle data. Transient encrypted transit, never
// storage.
//
// The relay node itself already exists and is deployed - it is shared by the
// whole PeerLoom suite and was built + verified for PearTune (peartune
// proposals/2026-07-23-blind-relay.md). PearPetal adds no infrastructure here;
// it points at the same key.
//
// Direct is ALWAYS tried first. Hyperswarm only sets `force` after a connect
// fails with HOLEPUNCH_ABORTED / HOLEPUNCH_DOUBLE_RANDOMIZED_NATS /
// REMOTE_NOT_HOLEPUNCHABLE (its `shouldForceRelaying`), so a peer we can punch
// is never relayed. hyperdht also tears the relay down again if a direct path
// later appears (`confirmDirectUpgrade`).

const z32 = require('z32')

// The deployed PeerLoom relay's public key (z-base32). Its private seed lives
// only on the relay box. Set to null to build an app that can never relay.
const RELAY_PUBLIC_KEY_Z = 'qshao3eawtzecrt5p7buswr4meyyhw6q6b51qtxazd8wwfdp8uqy'

const RELAY_PUBLIC_KEY = RELAY_PUBLIC_KEY_Z ? z32.decode(RELAY_PUBLIC_KEY_Z) : null

// The localDb key holding this device's network policy. Device-local and never
// projected to a partner or synced to the owner's other devices: which relay a
// phone needs is a property of the network IT is on, not of the cycle log.
const NETWORK_KEY = 'network'

// The policy Hyperswarm calls on every outbound connect. Returns the relay key
// to route through, or null for a direct-only attempt.
//
//   force      - Hyperswarm set forceRelaying on this peer after the direct
//                punch aborted. This is what makes us direct-FIRST.
//   randomized - our own NAT is double-randomized, so a direct punch can never
//                land; relay from the first attempt (Hyperswarm's own default
//                gate is `force || swarm.dht.randomized`).
//   useRelay   - the user's privacy toggle. Off means pure peer-to-peer, and a
//                network that cannot punch simply will not connect.
//   relayKey   - the baked key, or null in a build with no relay configured.
//
// Order matters: the toggle and the is-a-relay-even-configured check gate first,
// so an opted-out user never relays no matter what their NAT is doing.
function relayThroughFor ({ force, randomized, useRelay, relayKey }) {
  if (!useRelay || !relayKey) return null
  return (force || randomized) ? relayKey : null
}

// --- the in-memory policy cache -------------------------------------------
//
// relayThrough is SYNCHRONOUS (Hyperswarm calls it inline per dial) but the
// user's choice lives in localDb, which is async. So the flag is cached here,
// hydrated once when the swarm is built and updated by `network:set`.
//
// `null` means NOT HYDRATED YET, and the policy treats that as "do not relay".
// Failing safe matters more than failing useful: relaying for someone who
// turned it off leaks metadata to us, whereas not relaying for the first few
// hundred milliseconds costs nothing - a relay only ever engages after a punch
// has already spent ~10s aborting.
let _useRelay = null

function setUseRelay (on) { _useRelay = on !== false }

// Exposed for the swarm policy and for tests. undefined/null => not hydrated.
function useRelayCached () { return _useRelay }

// Reset the cache. Tests only - a real worklet hydrates once and lives.
function _resetUseRelay () { _useRelay = null }

async function hydrateUseRelay (localDb) {
  try {
    const v = (await localDb.get(NETWORK_KEY))?.value
    _useRelay = v?.useRelay !== false // absent record => the default, ON
  } catch {
    _useRelay = true
  }
  return _useRelay
}

// The `createSwarm` injection point @peerloom/core's engine already exposes.
// Core builds `new Hyperswarm({ keyPair })` by default; the ONLY thing added
// here is the relayThrough policy, so everything above the socket - pairing,
// replication, the private/shared base split - is byte-for-byte unchanged.
function createRelaySwarm ({ keyPair, localDb }) {
  const Hyperswarm = require('hyperswarm')
  if (localDb) hydrateUseRelay(localDb)
  return new Hyperswarm({
    keyPair,
    relayThrough: (force, swarm) => relayThroughFor({
      force,
      randomized: !!(swarm && swarm.dht && swarm.dht.randomized),
      useRelay: useRelayCached() === true,
      relayKey: RELAY_PUBLIC_KEY
    })
  })
}

module.exports = {
  RELAY_PUBLIC_KEY,
  RELAY_PUBLIC_KEY_Z,
  NETWORK_KEY,
  relayThroughFor,
  setUseRelay,
  useRelayCached,
  hydrateUseRelay,
  createRelaySwarm,
  _resetUseRelay
}
