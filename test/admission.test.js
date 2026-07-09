// Writer-admission policy (per-person shares Part B). The security-critical logic
// is pure given a base/view, so it unit-tests without an Autobase.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const { generateKeypair } = require('@peerloom/core/identity')
const { signValue } = require('@peerloom/core/records')
const { mintAddWriter, authorizeWriter } = require('../src/admission')

const OWNER = generateKeypair()
const OWNER_PUB = b4a.toString(OWNER.publicKey, 'hex')
const PARTNER = generateKeypair()
const PARTNER_PUB = b4a.toString(PARTNER.publicKey, 'hex')
const WRITER_KEY = 'aa'.repeat(32) // a joiner's Autobase writer-core key (hex)
const THIRD_KEY = 'cc'.repeat(32)
const GID = 'group-123'

// A fake base/view whose share:meta is `meta` (null = a private base).
const fakeView = (meta) => ({ get: async (k) => (k === 'share:meta' && meta ? { value: meta } : null) })
const fakeBase = (meta) => ({ view: fakeView(meta) })
const OWNED = { ownerPubkey: OWNER_PUB, scope: 'phase' }

// --- mint (append side) -----------------------------------------------------

test('mint: private base (no share:meta) -> legacy plain op', async () => {
  const op = await mintAddWriter(WRITER_KEY, { base: fakeBase(null), groupId: GID, identity: OWNER })
  assert.deepEqual(op, { type: 'addWriter', pubkey: WRITER_KEY })
})

test('mint: owner on a shared base signs an admission bound to the writer key + group', async () => {
  const op = await mintAddWriter(WRITER_KEY, { base: fakeBase(OWNED), groupId: GID, identity: OWNER })
  assert.equal(op.type, 'addWriter')
  assert.equal(op.pubkey, WRITER_KEY)
  assert.equal(op.by, OWNER_PUB)
  assert.equal(op.groupId, GID)
  assert.equal(typeof op.sig, 'string')
  // The op the owner mints must be one apply will honour.
  assert.equal(await authorizeWriter(op, { view: fakeView(OWNED), groupId: GID }), true)
})

test('mint: a partner on a shared base declines (returns null) - never admits anyone', async () => {
  const op = await mintAddWriter(THIRD_KEY, { base: fakeBase(OWNED), groupId: GID, identity: PARTNER })
  assert.equal(op, null)
})

// --- authorize (apply side) -------------------------------------------------

test('authorize: private base -> always honour', async () => {
  const op = { type: 'addWriter', pubkey: WRITER_KEY }
  assert.equal(await authorizeWriter(op, { view: fakeView(null), groupId: GID }), true)
})

test('authorize: rejects an unsigned addWriter on a shared base', async () => {
  const op = { type: 'addWriter', pubkey: WRITER_KEY }
  assert.equal(await authorizeWriter(op, { view: fakeView(OWNED), groupId: GID }), false)
})

test('authorize: rejects an op a PARTNER self-signed (by != owner)', async () => {
  // A malicious partner crafts a validly self-signed admission for a third party.
  const forged = signValue({ type: 'addWriter', pubkey: THIRD_KEY, by: PARTNER_PUB, groupId: GID }, PARTNER.secretKey)
  assert.equal(await authorizeWriter(forged, { view: fakeView(OWNED), groupId: GID }), false)
})

test('authorize: rejects a replayed owner cap re-pointed at a different writer key', async () => {
  const op = await mintAddWriter(WRITER_KEY, { base: fakeBase(OWNED), groupId: GID, identity: OWNER })
  const tampered = { ...op, pubkey: THIRD_KEY } // same owner sig, different key -> sig no longer covers it
  assert.equal(await authorizeWriter(tampered, { view: fakeView(OWNED), groupId: GID }), false)
})

test('authorize: rejects an owner cap minted for a DIFFERENT group', async () => {
  const op = await mintAddWriter(WRITER_KEY, { base: fakeBase(OWNED), groupId: 'other-group', identity: OWNER })
  assert.equal(await authorizeWriter(op, { view: fakeView(OWNED), groupId: GID }), false)
})
