// The blind-relay client policy (proposal 2026-07-23-blind-relay).
//
// What matters here is the ORDER of the gates: a user who turned the relay off,
// or a build with no relay key, must never relay regardless of what the NAT is
// doing; and a punchable peer must never be relayed even when the relay is on.

const test = require('node:test')
const assert = require('node:assert/strict')
const relay = require('../src/relay')

const KEY = relay.RELAY_PUBLIC_KEY

test('the baked relay key decodes to a 32-byte public key', () => {
  assert.equal(typeof relay.RELAY_PUBLIC_KEY_Z, 'string')
  assert.ok(KEY, 'a relay key is baked into this build')
  assert.equal(KEY.length, 32)
})

test('direct-first: no relay until the punch has actually failed', () => {
  const on = { useRelay: true, relayKey: KEY }
  // The normal case - a first attempt at a peer we have not failed to punch.
  assert.equal(relay.relayThroughFor({ force: false, randomized: false, ...on }), null)
  // Hyperswarm sets force after HOLEPUNCH_ABORTED / DOUBLE_RANDOMIZED_NATS /
  // REMOTE_NOT_HOLEPUNCHABLE. Only then do we offer the relay.
  assert.equal(relay.relayThroughFor({ force: true, randomized: false, ...on }), KEY)
})

test('a double-randomized NAT relays from the first attempt', () => {
  // It can never punch, so waiting for a failure just costs ~10s per peer.
  const k = relay.relayThroughFor({ force: false, randomized: true, useRelay: true, relayKey: KEY })
  assert.equal(k, KEY)
})

test('the privacy toggle wins over every NAT condition', () => {
  for (const force of [true, false]) {
    for (const randomized of [true, false]) {
      const k = relay.relayThroughFor({ force, randomized, useRelay: false, relayKey: KEY })
      assert.equal(k, null, `useRelay:false must never relay (force=${force} randomized=${randomized})`)
    }
  }
})

test('no baked key -> never relays, even forced with the toggle on', () => {
  assert.equal(relay.relayThroughFor({ force: true, randomized: true, useRelay: true, relayKey: null }), null)
})

// --- the in-memory cache the synchronous relayThrough hook reads -----------

test('the cache fails safe: not hydrated means do not relay', async () => {
  relay._resetUseRelay()
  assert.equal(relay.useRelayCached(), null)
  // This is the state during the first moments after the swarm is built. The
  // policy must read it as "no", not as the default "yes".
  assert.equal(relay.relayThroughFor({
    force: true, randomized: false, useRelay: relay.useRelayCached() === true, relayKey: KEY
  }), null)
})

test('hydrate: an absent record is the default ON, an explicit false is off', async () => {
  const db = (value) => ({ get: async () => (value === undefined ? null : { value }) })

  relay._resetUseRelay()
  assert.equal(await relay.hydrateUseRelay(db(undefined)), true) // never set -> on
  assert.equal(relay.useRelayCached(), true)

  relay._resetUseRelay()
  assert.equal(await relay.hydrateUseRelay(db({ useRelay: false })), false)
  assert.equal(relay.useRelayCached(), false)

  relay._resetUseRelay()
  assert.equal(await relay.hydrateUseRelay(db({ useRelay: true })), true)
})

test('hydrate: a store read that throws falls back to the default ON', async () => {
  relay._resetUseRelay()
  const bad = { get: async () => { throw new Error('store is busy') } }
  assert.equal(await relay.hydrateUseRelay(bad), true)
})

test('setUseRelay updates the cache live, no reconnect needed', () => {
  relay._resetUseRelay()
  relay.setUseRelay(false)
  assert.equal(relay.useRelayCached(), false)
  relay.setUseRelay(true)
  assert.equal(relay.useRelayCached(), true)
})

test('createRelaySwarm hands Hyperswarm a direct-first function, not a bare key', async () => {
  // Build the swarm the way the worklet does, then interrogate the policy
  // Hyperswarm stored. Constructing a real Hyperswarm stands up a DHT node, so
  // destroy it again immediately - this asserts the wiring, not the network.
  relay._resetUseRelay()
  const localDb = { get: async () => ({ value: { useRelay: true } }) }
  const swarm = relay.createRelaySwarm({ keyPair: require('hyperdht').keyPair(), localDb })
  try {
    assert.equal(typeof swarm.relayThrough, 'function')
    // Hydration is kicked off by createRelaySwarm; let it land.
    for (let i = 0; i < 50 && relay.useRelayCached() !== true; i++) await new Promise(r => setTimeout(r, 10))
    assert.equal(relay.useRelayCached(), true)
    assert.equal(swarm.relayThrough(false, swarm), null) // direct first
    assert.deepEqual(swarm.relayThrough(true, swarm), KEY) // escalate on failure
  } finally {
    await swarm.destroy()
  }
})
