// Shared-base writer-admission policy (per-person shares, Part B). Plugged into
// the @peerloom/core engine as its mintAddWriter (append side) + authorizeWriter
// (apply side) hooks. See proposals/2026-07-09-addwriter-gating.md + DECISIONS.
//
// The problem: on a SHARED base the joiner is admitted as an Autobase writer, and
// a writer can append addWriter - so a partner could admit a THIRD party to the
// owner's consented projection. The fix: on a shared base, only the OWNER may
// admit, proven by an owner signature over the exact writer key being added. A
// partner (a writer, but not the owner) mints nothing and cannot forge the sig.
//
// The PRIVATE base (the owner's own linked devices) is UNGATED - it has no
// share:meta, so both hooks fall through to legacy behaviour and any of the
// owner's devices may admit the next one.

const b4a = require('b4a')
const { signValue, verifyValueWithSigner } = require('@peerloom/core/records')

// A base is a SHARED base iff its view carries an owner claim (share:meta with an
// ownerPubkey). The private base never has one.
function sharedOwner (metaValue) {
  return metaValue && typeof metaValue.ownerPubkey === 'string' ? metaValue.ownerPubkey : null
}

// APPEND side: build the addWriter op for a paired joiner, or return null to
// decline. Runs on whichever writer received the joiner's pair hello.
async function mintAddWriter (writerKey, { base, groupId, identity }) {
  let meta = null
  try { meta = (await base.view.get('share:meta'))?.value } catch {}
  const owner = sharedOwner(meta)
  if (!owner) return { type: 'addWriter', pubkey: writerKey } // private base: unchanged
  const myPub = b4a.toString(identity.publicKey, 'hex')
  if (owner !== myPub) return null // I am a partner on a shared base: never admit anyone
  // I am the owner: sign an admission bound to THIS writer key + group, so no
  // partner can replay it for a different key.
  return signValue({ type: 'addWriter', pubkey: writerKey, by: myPub, groupId }, identity.secretKey)
}

// APPLY side: gate whether an addWriter op is honoured. Deterministic - every
// peer (owner, joiner, any future writer) runs the same check over the same
// replicated view, so an unauthorized addWriter is dropped identically.
async function authorizeWriter (op, { view, groupId }) {
  let meta = null
  try { meta = (await view.get('share:meta'))?.value } catch {}
  const owner = sharedOwner(meta)
  if (!owner) return true // private base: unchanged (owner devices admit each other)
  // Shared base: require an owner signature over this exact writer key + group.
  return !!(op &&
    typeof op.pubkey === 'string' &&
    op.by === owner &&
    op.groupId === groupId &&
    verifyValueWithSigner(op, 'by'))
}

module.exports = { mintAddWriter, authorizeWriter }
