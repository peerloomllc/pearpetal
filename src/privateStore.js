// The device-link-backed implementation of PearPetal's PRIVATE base operations
// (proposals/2026-07-12-adopt-device-link.md, SLICE 2). It exposes exactly the
// operations petalMethods.js performs against the private base today, so SLICE 2b
// can thread the method table through it with a flag branch:
//
//   if (DEVICE_LINK_ENABLED) return dlStore.X(ctx, ...)   // this module
//   else <existing core-group logic>                       // unchanged
//
// Only the PRIVATE base moves to device-link; partner sharing stays on
// @peerloom/core. Identity model = coexist: rows are still signed with the core
// per-device key (signValue below), exactly as the core-group path; the mnemonic
// device-link derives is only the recovery + pairing anchor.
//
// Data model mapping:
//   day:{yyyymmdd} / period:{yyyymmdd}  -> appended to the personal base as
//       { op:'put', type, key, value } records; device-link's apply validates the
//       signature and mirrors each accepted row into localDb (the read surface),
//       reusing PearPetal's own LWW decision. NOTE the op SHAPE differs from the
//       core-group path ({type:'put',...}) - device-link keys put/del off `op.op`
//       and the record type off `op.type`.
//   device:{pubkey}                     -> NOT stored here; the roster is
//       device-link's native deviceMeta (listLinkedDevices / setDeviceNickname).

const b4a = require('b4a')
const { signValue } = require('@peerloom/core/records')
const { getDeviceLink } = require('./deviceLink')

function pubkeyHex (ctx) { return b4a.toString(ctx.identity.publicKey, 'hex') }

// Stamp authorship + a fresh updatedAt, then sign - identical to petalMethods'
// signRow, so a device-link-path row is byte-compatible with the apply gate.
function signRow (ctx, value) {
  return signValue({ ...value, pubkey: pubkeyHex(ctx), updatedAt: Date.now() }, ctx.identity.secretKey)
}

// Which device-link record type a private-base key appends as. Only the
// date-keyed cycle rows go through the record path.
function typeForKey (key) {
  if (typeof key === 'string' && key.startsWith('day:')) return 'day'
  if (typeof key === 'string' && key.startsWith('period:')) return 'period'
  return null
}

// Parse a `pearpetal://pair?topic=..&handshake=..&identity=..&expires=..` URL (as
// minted by device-link's startPairing) into the shape consumePairLink wants.
// Manual query parse - no global URL/URLSearchParams dependency in the Bare
// runtime. Accepts a bare query string or a full URL.
function parsePairUrl (url) {
  const q = String(url == null ? '' : url).split('?')[1] || String(url || '')
  const p = {}
  for (const kv of q.split('&')) {
    const i = kv.indexOf('=')
    if (i < 0) continue
    p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1))
  }
  return { topic: p.topic, handshake: p.handshake, identity: p.identity, expiresMs: Number(p.expires) }
}

// --- lifecycle -------------------------------------------------------------

// Does this device have a personal base yet? (getDeviceLink starts the engine,
// which opens the base if personalMeta:bootstrap was persisted.)
async function exists (ctx) {
  const dl = await getDeviceLink(ctx)
  return dl.isEnabled
}

// Start tracking: mint the personal base (idempotent - device-link's enable()
// no-ops if personalMeta:bootstrap already exists).
async function enable (ctx) {
  const dl = await getDeviceLink(ctx)
  return dl.enable()
}

// --- own-device linking (QR-first, DECISIONS 2026-07-12) -------------------

// Mint a pair link for another of the owner's devices to scan. Returns the URL
// (rendered as a QR by the UI) + expiry.
async function linkInvite (ctx) {
  const dl = await getDeviceLink(ctx)
  if (!dl.isEnabled) throw new Error('start tracking on this device first')
  const p = await dl.startPairing()
  return { inviteKey: p.url, url: p.url, expiresAt: p.expiresAt }
}

// Link THIS (fresh) device by consuming a scanned pair URL. Resolves once paired
// (this device is a writer on the founder's personal base). Refuses if this
// device already has its own cycle, to avoid a split identity.
async function linkJoin (ctx, inviteKey) {
  const dl = await getDeviceLink(ctx)
  if (dl.isEnabled) throw new Error('this device is already tracking a cycle')
  const link = parsePairUrl(inviteKey)
  if (!link.topic || !link.handshake || !link.identity) throw new Error('invalid pair link')
  await dl.consumePairLink(link)
  return { writable: !!(dl.personalBase && dl.personalBase.writable) }
}

// --- reads / writes --------------------------------------------------------

// Flush the personal base's apply (so the mirror reflects the latest appends)
// before a read - the analog of core's `base.update()`.
async function update (ctx) {
  const dl = await getDeviceLink(ctx)
  if (dl.personalBase) await dl.personalBase.update()
}

// Sign + append one private-base row (day/period). Value is RAW (signed here),
// matching petalMethods' putRow. Returns the signed row.
async function put (ctx, key, value) {
  const type = typeForKey(key)
  if (!type) throw new Error('privateStore.put: unsupported key ' + key)
  const dl = await getDeviceLink(ctx)
  const signed = signRow(ctx, value)
  await dl.personalBase.append({ op: 'put', type, key, value: signed })
  return signed
}

// Read one mirrored row (caller has already update()'d if it needs freshness).
async function getRow (ctx, key) {
  return (await ctx.localDb.get(key).catch(() => null))?.value ?? null
}

// update() + read, matching petalMethods' readRow(base, key).
async function readRow (ctx, key) {
  await update(ctx)
  return getRow(ctx, key)
}

// Range scan over the mirrored rows (DAY_RANGE / PERIOD_RANGE). Same async
// iterable shape as base.view.createReadStream. Caller update()s first.
function createReadStream (ctx, range) {
  return ctx.localDb.createReadStream(range)
}

// --- device roster (device-link native deviceMeta) ------------------------

// Map device-link's linked-device roster to the { pubkey, label, self } shape the
// UI's device:getAll returns (writerKey stands in for pubkey; nickname for label).
async function listDevices (ctx) {
  const dl = await getDeviceLink(ctx)
  const rows = await dl.listLinkedDevices()
  return rows.map((r) => ({ pubkey: r.writerKey, label: r.nickname || 'Device', self: !!r.self }))
}

async function setDeviceLabel (ctx, label) {
  const dl = await getDeviceLink(ctx)
  await dl.setDeviceNickname(String(label).slice(0, 64))
}

module.exports = {
  typeForKey,
  parsePairUrl,
  exists,
  enable,
  linkInvite,
  linkJoin,
  update,
  put,
  getRow,
  readRow,
  createReadStream,
  listDevices,
  setDeviceLabel,
}
