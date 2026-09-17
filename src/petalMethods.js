// PearPetal IPC method table. Each handler is (args, ctx) where ctx is the
// engine's method context: { identity, append, bases, createGroup, joinGroup,
// localDb, emit, ... }. Handlers sign their writes with the device identity and
// append { type:'put', ... } ops; the engine's applyOps (applyPetalOp) does the
// merge. Reads pull from the linearized Hyperbee view.
//
// Slice 1 scope (scaffold + private base + own-device linking): the PRIVATE base
// only. A device either creates its private base (cycle:create) or links to an
// existing one on another of the owner's devices (link:join). Partner sharing
// (the separate consent-scoped SHARED base) is a later slice.

const { signValue } = require('@peerloom/core/records')
const { defaultEncodeInvite } = require('@peerloom/core/engine')
const b4a = require('b4a')
const sodium = require('sodium-universal')

const { deviceKey, dayKey, periodKey, phaseKey, predictKey, summaryKey, memberKey, DEVICE_RANGE, DAY_RANGE, PERIOD_RANGE, SUMMARY_RANGE, MEMBER_RANGE } = require('./petalWire')
const { projectionFromRows, pregnancyProjection, cycleStarts, median, addDays, diffDays, todayIso, FLOW_VALUES, BLEEDING_FLOWS, DEFAULT_PERIOD_LEN } = require('./prediction')
const { notificationEvents } = require('./notifications')
const { planImport } = require('./healthImport')
const { parseHealthFile } = require('./healthFiles')
const { TONES: NOTE_TONES, DEFAULT_TONE: DEFAULT_NOTE_TONE } = require('./petalNotes')
const { isDeviceLinkEnabled } = require('./deviceLink')
const ps = require('./privateStore')
const relay = require('./relay')

// Consent scopes (see DECISIONS.md 2026-07-06). Each governs which projection
// fields the OWNER writes to a shared base; the partner structurally never
// receives more than this because the owner never writes it.
const SCOPES = new Set(['phase', 'fertility', 'full'])
// The ONLY symptom tags projected into a `full`-scope summary. Coarse and
// non-clinical; the auditable redaction boundary. Notes / BBT / intimacy and any
// off-list tag are never projected.
const SUMMARY_TAGS = new Set(['cramps', 'headache', 'fatigue', 'bloating', 'tender-breasts', 'nausea', 'backache', 'acne', 'mood-low', 'mood-irritable', 'energy-high', 'libido-high'])
const SUMMARY_WINDOW_DAYS = 21 // how many recent days a `full` share projects
// Petal-dial species (device-local display pref; must stay in sync with
// src/ui/flowers.js). Never crosses the wire.
const FLOWERS = new Set(['rose', 'sakura', 'lotus', 'poppy', 'dahlia'])
// Tracked health conditions (device-local; widen prediction uncertainty + tailor
// copy). Never cross the wire. Must stay in sync with the UI list.
const CONDITIONS = new Set(['pcos', 'endometriosis', 'irregular', 'thyroid'])

function pubkeyHex (ctx) { return b4a.toString(ctx.identity.publicKey, 'hex') }

// --- avatars (content blob store, not inline) -------------------------------
// A profile / share:meta row carries only a tiny { avatarBlob:{key,id},
// avatarHash, avatarType } pointer; the bytes live in the core blob store, which
// replicates to a partner over the shared base (the blob core is in the same
// corestore that store.replicate serves - no core change). Resolved back to a
// data URL for the UI, cached by content hash so a poll does not refetch. Hard
// cap bounds replication + storage (proposal 2026-07-08 open-Q3). Stills are
// downscaled to ~256px in the UI (tiny); animated GIF/WebP are kept RAW so the
// animation survives, so the cap is sized for them (matches PearList's 2MB).
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const avatarCache = new Map()   // contentHash -> data URL
const avatarPending = new Set()  // contentHash currently being fetched

function blobHash (buf) { const out = b4a.alloc(32); sodium.crypto_generichash(out, buf); return b4a.toString(out, 'hex') }

// --- optional password-encrypted backups (proposal 2026-07-10) ---------------
// Seal an export payload under a password: Argon2id (interactive limits) derives
// a secretbox key from the password + a random salt; XSalsa20-Poly1305 encrypts
// the JSON under a random nonce. All KDF params + salt/nonce travel in the file
// so it is self-describing (a later cost bump still decrypts old files). No
// identity/secret key is ever placed in a backup - this protects only the same
// user-entered payload the plaintext export already carries.
function encryptBackup (payload, password) {
  const pw = b4a.from(String(password), 'utf8')
  const salt = b4a.alloc(sodium.crypto_pwhash_SALTBYTES)
  sodium.randombytes_buf(salt)
  const opslimit = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE
  const memlimit = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE
  const key = b4a.alloc(sodium.crypto_secretbox_KEYBYTES)
  sodium.crypto_pwhash(key, pw, salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13)
  const msg = b4a.from(JSON.stringify(payload), 'utf8')
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const ct = b4a.alloc(msg.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ct, msg, nonce, key)
  return {
    app: 'pearpetal',
    version: 1,
    enc: {
      kdf: 'argon2id',
      opslimit,
      memlimit,
      salt: b4a.toString(salt, 'base64'),
      nonce: b4a.toString(nonce, 'base64'),
      cipher: 'xsalsa20poly1305',
      ct: b4a.toString(ct, 'base64'),
    },
  }
}

// Open a wrapper produced by encryptBackup. A failed MAC (wrong password OR a
// tampered file) throws 'wrong password'; decryption completes before any DB
// write in import:data, so a bad password never leaves a partial import.
function decryptBackup (wrapper, password) {
  const e = wrapper && wrapper.enc
  if (!e || e.kdf !== 'argon2id' || e.cipher !== 'xsalsa20poly1305') throw new Error('unsupported backup format')
  let salt, nonce, ct
  try {
    salt = b4a.from(String(e.salt), 'base64')
    nonce = b4a.from(String(e.nonce), 'base64')
    ct = b4a.from(String(e.ct), 'base64')
  } catch { throw new Error('corrupt backup') }
  if (salt.length !== sodium.crypto_pwhash_SALTBYTES || nonce.length !== sodium.crypto_secretbox_NONCEBYTES || ct.length < sodium.crypto_secretbox_MACBYTES) throw new Error('corrupt backup')
  const opslimit = Number.isFinite(e.opslimit) ? e.opslimit : sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE
  const memlimit = Number.isFinite(e.memlimit) ? e.memlimit : sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE
  const key = b4a.alloc(sodium.crypto_secretbox_KEYBYTES)
  sodium.crypto_pwhash(key, b4a.from(String(password), 'utf8'), salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13)
  const msg = b4a.alloc(ct.length - sodium.crypto_secretbox_MACBYTES)
  if (!sodium.crypto_secretbox_open_easy(msg, ct, nonce, key)) throw new Error('wrong password')
  try { return JSON.parse(b4a.toString(msg, 'utf8')) } catch { throw new Error('corrupt backup') }
}
function parseDataUrl (s) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(s))
  if (!m) return null
  return { mime: m[1] || 'application/octet-stream', base64: !!m[2], data: m[3] }
}
// Await the bytes (own blob is local -> fast; a partner's replicates on demand).
async function resolveAvatarAwait (ctx, row) {
  if (row?.avatar) return row.avatar // legacy inline data URL
  if (row?.avatarBlob && row?.avatarHash) {
    if (avatarCache.has(row.avatarHash)) return avatarCache.get(row.avatarHash)
    const bytes = await ctx.blobs.get(row.avatarBlob)
    if (!bytes) return null
    const url = `data:${row.avatarType || 'image/png'};base64,${b4a.toString(bytes, 'base64')}`
    avatarCache.set(row.avatarHash, url)
    return url
  }
  return null
}
// Non-blocking: cached data URL or null, kicking off a background fetch so a
// partner's avatar "pops in" on the next poll instead of stalling a list load.
function resolveAvatarCached (ctx, row) {
  if (row?.avatar) return row.avatar
  if (row?.avatarBlob && row?.avatarHash) {
    if (avatarCache.has(row.avatarHash)) return avatarCache.get(row.avatarHash)
    if (!avatarPending.has(row.avatarHash)) {
      avatarPending.add(row.avatarHash)
      resolveAvatarAwait(ctx, row).catch(() => {}).finally(() => avatarPending.delete(row.avatarHash))
    }
    return null
  }
  return null
}

// Stamp authorship + a fresh updatedAt, then sign. Every write records the
// CURRENT editor as pubkey (proves who made this edit); createdBy is preserved
// by the caller spreading the existing row.
function signRow (ctx, value) {
  return signValue({ ...value, pubkey: pubkeyHex(ctx), updatedAt: Date.now() }, ctx.identity.secretKey)
}

async function putRow (ctx, groupId, key, value) {
  await ctx.append(groupId, { type: 'put', key, value: signRow(ctx, value) })
}

// Why a group's base is not open, when the engine recorded one.
function unmountedReason (ctx, groupId) {
  try { return ctx.engine?.unmounted?.get(groupId) || null } catch { return null }
}

function viewFor (ctx, groupId) {
  const base = ctx.bases.get(groupId)
  if (!base) throw new Error('unknown group: ' + groupId)
  return base
}

// Reading a partner's shared cycle must never wait on their phone. base.update()
// takes in whatever has replicated, and it blocks when the linearizer wants a
// block that has not arrived - which for a viewer usually just means the other
// person's phone is not nearby and awake. That is the normal state of a two-phone
// app, not an error, so bound the wait and read whatever we already hold: a cycle
// from yesterday beats a spinner, and the fresh version lands on the next
// group:updated anyway. Resolves rather than rejects on the bound, so the read
// falls through to the stored view.
const PARTNER_UPDATE_MS = 5000
async function updateOrCarryOn (base, ms = PARTNER_UPDATE_MS) {
  let timer = null
  try {
    await Promise.race([
      base.update(),
      new Promise((resolve) => { timer = setTimeout(resolve, ms) }),
    ])
  } catch {} finally { if (timer) clearTimeout(timer) }
}

// Linearize before reading so a mutate sees the latest committed state.
async function readRow (base, key) {
  await base.update()
  const node = await base.view.get(key)
  return node?.value ?? null
}

// A device can now belong to several bases: exactly one PRIVATE base (kind
// 'private'), zero or more SHARED-OUT bases it created to share its projection
// with a partner ('shared-out'), and zero or more SHARED-IN bases it joined to
// VIEW a partner's projection ('shared-in'). Untagged records are legacy
// slice-1 private bases.
async function allMemberships (ctx) {
  const out = []
  for await (const { value } of ctx.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) {
    if (value && value.groupId) out.push(value)
  }
  return out
}
async function privateMembership (ctx) {
  const all = await allMemberships(ctx)
  return all.find((m) => m.kind === 'private') || all.find((m) => !m.kind) || null
}
async function membershipsByKind (ctx, kind) {
  return (await allMemberships(ctx)).filter((m) => m.kind === kind)
}

async function privateGroupId (ctx) {
  const m = await privateMembership(ctx)
  if (!m) throw new Error('no cycle on this device yet')
  return m.groupId
}

function reencodeInvite (m) {
  return defaultEncodeInvite({
    groupId: m.groupId, groupKey: m.groupKey, encryptionKey: m.encryptionKey,
    bootstrap: m.bootstrap, name: m.name,
  })
}

// Tag a membership with its base kind ('private' | 'shared-out' | 'shared-in')
// so the several bases a device belongs to stay distinguishable.
async function tagKind (ctx, groupId, kind) {
  const rec = (await ctx.localDb.get('groups:joined:' + groupId))?.value
  if (rec && rec.kind !== kind) await ctx.localDb.put('groups:joined:' + groupId, { ...rec, kind })
}

// Publish this device's roster row (device:{pubkey}) to the private base so the
// owner's other devices can show a friendly device list. No-op until writable
// (a freshly linked device becomes writable once admitted); the UI retries.
async function publishDevice (ctx, onlyGroupId) {
  const prof = (await ctx.localDb.get('deviceProfile'))?.value
  const value = { label: (prof?.label && String(prof.label).slice(0, 64)) || 'This device' }
  const key = deviceKey(pubkeyHex(ctx))
  let published = false
  for (const [groupId, base] of ctx.bases) {
    if (onlyGroupId && groupId !== onlyGroupId) continue
    if (!base.writable) continue
    try { await putRow(ctx, groupId, key, value); published = true } catch {}
  }
  return published
}

// ── PRIVATE-base seam (proposal 2026-07-12-adopt-device-link, SLICE 2b) ──────
// Every private-base access below goes through these wrappers so the whole
// private base can be served either by the legacy @peerloom/core group (flag
// OFF, unchanged) or by @peerloom/device-link's personal base (flag ON, via
// ./privateStore). Partner sharing (shared-out/shared-in bases) is unaffected -
// it always stays on core, so its viewFor/putRow/readRow calls are untouched.

// Does this device have a private base (cycle) yet?
async function privHas (ctx) {
  if (isDeviceLinkEnabled()) return ps.exists(ctx)
  return !!(await privateMembership(ctx))
}
async function requirePrivate (ctx) {
  if (!(await privHas(ctx))) throw new Error('no cycle on this device yet')
}
// Create the private base. Returns { groupId?, inviteKey? } - the device-link
// path has no group invite (linking is QR pairing via link:invite), so those are
// null there.
async function enablePrivate (ctx) {
  if (isDeviceLinkEnabled()) { await ps.enable(ctx); await seedOwnerState(ctx); return { groupId: null, inviteKey: null } }
  const r = await ctx.createGroup({ name: 'PearPetal' })
  await tagKind(ctx, r.groupId, 'private')
  await publishDevice(ctx, r.groupId)
  return { groupId: r.groupId, inviteKey: r.inviteKey }
}
// Sign + write one private-base row (RAW value; signed by the core identity in
// both paths per the coexist decision).
async function privPut (ctx, key, value) {
  if (isDeviceLinkEnabled()) { await ps.put(ctx, key, value); return }
  await putRow(ctx, await privateGroupId(ctx), key, value)
}
// Read one private-base row (linearized/flushed first).
async function privReadRow (ctx, key) {
  if (isDeviceLinkEnabled()) return ps.readRow(ctx, key)
  return readRow(viewFor(ctx, await privateGroupId(ctx)), key)
}
// Collect all rows in a private-base range (DAY_RANGE / PERIOD_RANGE), flushing
// first. Returns an array of raw values (callers filter tombstones).
async function privRows (ctx, range) {
  const out = []
  if (isDeviceLinkEnabled()) {
    await ps.update(ctx)
    for await (const { value } of ps.createReadStream(ctx, range)) out.push(value)
    return out
  }
  const base = viewFor(ctx, await privateGroupId(ctx))
  await base.update()
  for await (const { value } of base.view.createReadStream(range)) out.push(value)
  return out
}
// Publish this device's roster row. The device-link path keeps the roster as
// native deviceMeta (auto-seeded), so there is nothing to publish there.
async function privPublishDevice (ctx, onlyGroupId) {
  if (isDeviceLinkEnabled()) return true
  return publishDevice(ctx, onlyGroupId)
}

// Publish this owner's device-local state (profile name+avatar, and prefs -
// cycle lengths / goal / flower / conditions / birth control) onto the personal
// base so it replicates to devices they later link. Values carry their own
// updatedAt so re-seeding is idempotent under LWW (safe on a linked device too).
// Returns whether anything was published (i.e. the base was writable).
async function seedOwnerState (ctx) {
  if (!isDeviceLinkEnabled()) return false
  let did = false
  const prof = (await ctx.localDb.get('profile').catch(() => null))?.value
  if (prof && (prof.displayName || prof.avatarBlob)) { if (await ps.putProfile(ctx, prof).catch(() => false)) did = true }
  const prefs = (await ctx.localDb.get('prefs').catch(() => null))?.value
  if (prefs && Object.keys(prefs).length) { if (await ps.putPrefs(ctx, prefs).catch(() => false)) did = true }
  return did
}

// One-time-per-worklet boot seed: an EXISTING primary (personal base created
// before owner-state sync existed) never seeded its profile/prefs. Publish them
// once the base is writable. Idempotent (LWW), so harmless if it also runs on a
// linked device.
let _ownerSeeded = false
async function maybeSeedOwnerState (ctx) {
  if (!isDeviceLinkEnabled() || _ownerSeeded || !ctx || !ctx.store) return
  if (await seedOwnerState(ctx).catch(() => false)) _ownerSeeded = true
}
function _resetOwnerSeedForTest () { _ownerSeeded = false }

// ── legacy -> personal migration (proposal decision #3, SLICE 3) ─────────────
// One-time, on the first method call after the device-link flag is on: if this
// device still has a legacy @peerloom/core-group private base but no personal
// base yet, copy its day/period log into a freshly-minted personal base and mark
// it done. Idempotent via a localDb marker. The legacy base is LEFT in place as a
// rollback snapshot (the flag can be turned back off and the old base is intact).
// prefs / profile / notifications / donation live in localDb and are
// path-independent, so only the base-resident cycle rows move; the device roster
// regenerates from device-link deviceMeta as devices re-link (hard-cut, #4).
let _migrationChecked = false
function _resetMigrationForTest () { _migrationChecked = false }

async function migrateIfNeeded (ctx) {
  if (_migrationChecked || !isDeviceLinkEnabled() || !ctx || !ctx.store) return
  _migrationChecked = true
  try {
    if ((await ctx.localDb.get('deviceLink:migrated').catch(() => null))?.value) return
    // Already on a personal base (fresh device-link install) - nothing to move.
    if (await ps.exists(ctx)) { await ctx.localDb.put('deviceLink:migrated', { at: Date.now(), from: null }); return }
    const legacy = await privateMembership(ctx)
    if (!legacy) { await ctx.localDb.put('deviceLink:migrated', { at: Date.now(), from: null }); return }
    const base = ctx.bases.get(legacy.groupId)
    if (!base) { _migrationChecked = false; return } // legacy base not mounted yet; retry next call
    await base.update()
    const days = []; const periods = []
    for await (const { value } of base.view.createReadStream(DAY_RANGE)) if (value) days.push(value)
    for await (const { value } of base.view.createReadStream(PERIOD_RANGE)) if (value) periods.push(value)
    await ps.enable(ctx)
    for (const v of days) {
      const nd = normDate(v.date); if (!nd) continue
      const val = { date: nd.iso, createdBy: v.createdBy || pubkeyHex(ctx), createdAt: v.createdAt || Date.now(), deleted: !!v.deleted }
      if (v.flow !== undefined) val.flow = v.flow
      if (Array.isArray(v.symptoms)) val.symptoms = v.symptoms
      if (Array.isArray(v.mood)) val.mood = v.mood
      if (typeof v.notes === 'string') val.notes = v.notes
      if (typeof v.bbt === 'number') val.bbt = v.bbt
      await ps.put(ctx, dayKey(nd.key), val)
    }
    for (const v of periods) {
      const ns = normDate(v.start); if (!ns) continue
      await ps.put(ctx, periodKey(ns.key), { start: ns.iso, end: v.end ?? null, createdBy: v.createdBy || pubkeyHex(ctx), createdAt: v.createdAt || Date.now(), deleted: !!v.deleted })
    }
    await ctx.localDb.put('deviceLink:migrated', { at: Date.now(), from: legacy.groupId, days: days.length, periods: periods.length })
    await seedOwnerState(ctx) // publish this device's existing profile onto the personal base
  } catch {
    _migrationChecked = false // transient failure - let a later call retry
  }
}

// Validate/normalize a 'YYYY-MM-DD' date to { iso, key(yyyymmdd) }. Fixed-width
// key so lexicographic view scans return chronological order.
function normDate (s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d))
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) return null
  return { iso: `${y}-${mo}-${d}`, key: `${y}${mo}${d}` }
}

// --- projection -------------------------------------------------------------
// Is this date a cycle start that exists only because those days are marked as
// bleeding, with no period row behind it? Uses the projection's own derivation.
async function isInferredStart (ctx, startIso) {
  const days = (await privRows(ctx, DAY_RANGE)).filter((v) => v && !v.deleted)
  const rows = (await privRows(ctx, PERIOD_RANGE)).filter((v) => v && !v.deleted)
  return cycleStarts(days, rows).includes(startIso)
}

// How far a period fill ever reaches, shared by period:log and period:delete so
// the one clears exactly what the other stamped.
const MAX_PERIOD_SPAN = 15
async function periodSpanEnd (ctx, startIso, endIso) {
  if (endIso) return endIso
  const prefs = await getPrefs(ctx)
  const periodLen = Math.max(2, Math.min(10, Number(prefs.avgPeriodLength) || DEFAULT_PERIOD_LEN))
  return addDays(startIso, periodLen - 1)
}

// Clear the FLOW on every day across a period span, leaving symptoms, mood, notes
// and BBT in place - those are observations that still happened, and only the
// bleeding is being retracted. Returns how many days changed.
async function clearFlowAcross (ctx, startIso, endIso) {
  const last = await periodSpanEnd(ctx, startIso, endIso)
  let cleared = 0
  let d = startIso
  for (let i = 0; i < MAX_PERIOD_SPAN && d <= last; i++) {
    const nd = normDate(d)
    const row = await privReadRow(ctx, dayKey(nd.key))
    if (row && !row.deleted && FLOW_VALUES.has(row.flow)) {
      await privPut(ctx, dayKey(nd.key), { ...row, flow: null })
      cleared++
    }
    d = addDays(d, 1)
  }
  return cleared
}

// Read the PRIVATE base's day/period log and derive the shared-base projection
// (phase + predicted dates) via the pure prediction module.
async function getPrefs (ctx) {
  return (await ctx.localDb.get('prefs'))?.value || {}
}

// Device-local notification prefs with defaults. Opt-in: `enabled` defaults
// false (nothing fires until the user turns it on at onboarding or in Settings).
// The two v1 categories default on once enabled.
async function getNotifPrefs (ctx) {
  const n = (await ctx.localDb.get('notifications'))?.value || {}
  return {
    enabled: !!n.enabled,
    discreet: !!n.discreet,
    period: n.period !== false,
    fertility: n.fertility !== false,
    // The daily flower note is opt-in ON TOP of the master switch (default off),
    // so turning reminders on never silently starts a daily push.
    dailyNote: !!n.dailyNote,
    noteTone: NOTE_TONES.includes(n.noteTone) ? n.noteTone : DEFAULT_NOTE_TONE,
    time: typeof n.time === 'string' && /^\d{2}:\d{2}$/.test(n.time) ? n.time : '09:00',
  }
}

// Device-local network policy. `useRelay` defaults ON (opt-OUT, unlike
// notifications) so the app connects on networks that cannot hole-punch without
// the user having to know what a hole-punch is. `relayConfigured` tells the UI
// whether this build even has a relay key, so it can hide the row rather than
// offer a toggle that does nothing.
async function getNetworkPrefs (ctx) {
  const n = (await ctx.localDb.get(relay.NETWORK_KEY))?.value || {}
  return {
    useRelay: n.useRelay !== false,
    relayConfigured: !!relay.RELAY_PUBLIC_KEY,
    relayKey: relay.RELAY_PUBLIC_KEY_Z || null,
    updatedAt: n.updatedAt || 0,
  }
}

// The owner's device-local profile (name + avatar pointer). Distinct from
// `deviceProfile` (which names this DEVICE for the roster) - this names the
// PERSON. Never replicated except via the owner-written share:meta projection.
// The single whitelist for user prefs. `prefs:set` and `import:data` both go
// through it, because they used to carry SEPARATE lists and the lists drifted:
// import's goal list was missing 'pregnant' and it knew nothing about conditions,
// birthControl or pregnancy, so restoring a backup silently switched pregnancy
// mode off and dropped the health context the projection is widened by. Anything
// added here is accepted by both paths, by construction.
//
// `patch` is a partial: a key that is absent is left alone, so this merges rather
// than replaces. Returns the next prefs object; it does not write.
const GOALS = new Set(['track', 'conceive', 'avoid', 'pregnant'])
const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
function applyPrefsPatch (cur, patch = {}) {
  const next = { ...cur }
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k)
  const num = (v, lo, hi) => (v === null ? null : (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined))
  if (has('avgCycleLength')) { const v = num(patch.avgCycleLength, 21, 45); if (v !== undefined) next.avgCycleLength = v }
  if (has('avgPeriodLength')) { const v = num(patch.avgPeriodLength, 2, 10); if (v !== undefined) next.avgPeriodLength = v }
  if (has('lutealLength')) { const v = num(patch.lutealLength, 9, 18); if (v !== undefined) next.lutealLength = v }
  if (has('goal') && GOALS.has(patch.goal)) next.goal = patch.goal
  if (has('flower') && FLOWERS.has(patch.flower)) next.flower = patch.flower
  // Health conditions (deduped, whitelisted) + hormonal-birth-control flag.
  if (has('conditions') && Array.isArray(patch.conditions)) next.conditions = [...new Set(patch.conditions.filter((c) => CONDITIONS.has(c)))]
  if (has('birthControl')) next.birthControl = !!patch.birthControl
  // Pregnancy dates (device-local; never projected to a partner). null clears.
  if (has('pregnancy')) {
    const pg = patch.pregnancy
    if (pg === null) delete next.pregnancy
    else if (pg && typeof pg === 'object') {
      const clean = {}
      if (isIsoDate(pg.lmp)) clean.lmp = pg.lmp
      if (isIsoDate(pg.dueDate)) clean.dueDate = pg.dueDate
      if (clean.lmp || clean.dueDate) next.pregnancy = clean
    }
  }
  next.updatedAt = Date.now()
  return next
}

// Every pref a backup carries. Same list both ways, so a field added to
// applyPrefsPatch and to this array survives a round trip.
const BACKUP_PREFS = ['avgCycleLength', 'avgPeriodLength', 'lutealLength', 'goal', 'flower', 'conditions', 'birthControl', 'pregnancy']

async function getProfile (ctx) {
  return (await ctx.localDb.get('profile'))?.value || {}
}
// Store a profile patch: name and/or avatar. Shared by `profile:set` and
// `import:data`, so a restore goes through exactly the validation an edit does
// (including the avatar size cap and the content-hash dedupe). Semantics match
// profile:set - a key that is absent is preserved, an avatar of null clears it.
// Returns true if anything was stored.
async function applyProfile (ctx, patch = {}) {
  const existing = await getProfile(ctx)
  const profile = { ...existing, updatedAt: Date.now() }
  let touched = false
  if (typeof patch.displayName === 'string') { profile.displayName = patch.displayName.trim().slice(0, 64); touched = true }
  if (Object.prototype.hasOwnProperty.call(patch, 'avatar')) {
    touched = true
    if (patch.avatar) {
      const parsed = parseDataUrl(patch.avatar)
      if (!parsed || !parsed.base64) throw new Error('avatar must be a base64 data URL')
      const bytes = b4a.from(parsed.data, 'base64')
      if (bytes.length > AVATAR_MAX_BYTES) throw new Error('That image is too large. Pick a smaller one.')
      const hash = blobHash(bytes)
      let ref = (await ctx.localDb.get('blobref:' + hash))?.value
      if (!ref) { const put = await ctx.blobs.put(bytes); ref = { key: put.key, id: put.id, type: parsed.mime }; await ctx.localDb.put('blobref:' + hash, ref) }
      profile.avatarBlob = { key: ref.key, id: ref.id }; profile.avatarHash = hash; profile.avatarType = ref.type
      avatarCache.set(hash, String(patch.avatar)) // warm cache with the exact bytes we were handed
    } else {
      delete profile.avatarBlob; delete profile.avatarHash; delete profile.avatarType; delete profile.avatar
    }
  }
  if (!touched) return false
  await ctx.localDb.put('profile', profile)
  if (isDeviceLinkEnabled()) await ps.putProfile(ctx, profile).catch(() => {}) // sync name/avatar to the owner's OWN devices
  return profile
}

// The identity fields the owner projects into share:meta. Shared on ALL scopes
// (identity is WHO is sharing, not cycle data - proposal 2026-07-08 open-Q2).
function profileMetaFields (prof) {
  const f = {}
  if (prof?.displayName) f.displayName = String(prof.displayName).slice(0, 64)
  if (prof?.avatarBlob && prof?.avatarHash) { f.avatarBlob = prof.avatarBlob; f.avatarHash = prof.avatarHash; f.avatarType = prof.avatarType || 'image/png' }
  return f
}
// Owner-write the share:meta claim (ownership + scope + identity) for ONE shared
// base. Owner-only is enforced by the apply rule (petalWire rowSharedDecision),
// so the added identity fields inherit that gate. createdAt is preserved across
// updates so the row keeps its original timestamp.
async function writeShareMeta (ctx, groupId, scope, prof, notes) {
  let existing = null
  try { existing = await readRow(viewFor(ctx, groupId), 'share:meta') } catch {}
  await putRow(ctx, groupId, 'share:meta', {
    ownerPubkey: pubkeyHex(ctx), scope,
    // Only written when ON. Absent reads as off, which is what an app built
    // before this change writes and what every existing share already has.
    ...(notes ? { notes: true } : {}),
    createdAt: existing?.createdAt || Date.now(),
    ...profileMetaFields(prof),
  })
}
// Re-project the current profile into every shared-out base's share:meta so
// existing partners get an updated name/avatar. Only writable bases (the owner
// is the writer) are touched. Revoked shares are SKIPPED - rewriting their
// share:meta from the profile would drop the `revoked` tombstone and un-end them.
async function refreshShareMeta (ctx) {
  const prof = await getProfile(ctx)
  for (const m of await membershipsByKind(ctx, 'shared-out')) {
    if (m.revoked) continue
    const base = ctx.bases.get(m.groupId)
    if (!base || !base.writable) continue
    try { await writeShareMeta(ctx, m.groupId, m.scope || 'phase', prof, !!m.notes) } catch {}
  }
}

// Mark a shared-out base's owner-signed share:meta as revoked (the "sharing
// ended" tombstone), preserving the existing owner/scope/identity fields. Owner-
// signed like every other share:meta write, so it inherits the owner-write-only
// apply gate; uses a distinct `revoked` field (NOT `deleted`, which would trip the
// apply resurrection guard). See proposals/2026-07-09-sharing-ended.md.
async function revokeShareMeta (ctx, groupId) {
  const existing = await readRow(viewFor(ctx, groupId), 'share:meta')
  if (!existing) return false
  // Drop the prior signing fields so signRow re-stamps pubkey/updatedAt + a fresh
  // sig (fresh updatedAt makes LWW keep this over the last projection-era meta).
  const { pubkey, updatedAt, sig, ...keep } = existing
  await putRow(ctx, groupId, 'share:meta', { ...keep, revoked: true, revokedAt: Date.now() })
  return true
}

// A JOINER (viewer) self-publishes their display name into a shared-IN base's
// member:{ownPubkey} row, so the OWNER's Sharing screen can show who joined. Only
// when the base is writable (we were admitted as a writer); best-effort otherwise.
// Name only for now - the joiner avatar is a follow-up (proposal 2026-07-09).
// The content fields a member row carries. Everything else on a stored row is
// envelope that signRow stamps fresh every time (pubkey, updatedAt, signature),
// so comparing whole rows would never match.
const MEMBER_FIELDS = ['displayName']
function memberRowUnchanged (existing, val) {
  if (!existing) return false
  return MEMBER_FIELDS.every((k) => (existing[k] ?? null) === (val[k] ?? null))
}
async function publishMember (ctx, groupId) {
  const base = ctx.bases.get(groupId)
  if (!base || !base.writable) return false
  const prof = await getProfile(ctx)
  const val = {}
  if (prof?.displayName) val.displayName = String(prof.displayName).slice(0, 64)
  // Only write when something actually changed. Re-appending an identical row is
  // not free: it changes the linearized view, the view change fires
  // group:updated, the partner screen answers group:updated by calling
  // partner:view, and partner:view lands back here. That loop appended to the
  // shared base about eight times a second for as long as the screen was open,
  // with nobody touching either phone - 888 rows in 45 seconds, none of which a
  // person asked for. Past 512 rows the retention sweep then started clearing
  // this device's own blocks, and the app never opened again (peerloom-core
  // 2026-09-09 fixes that half).
  const key = memberKey(pubkeyHex(ctx))
  const existing = (await base.view.get(key))?.value
  if (memberRowUnchanged(existing, val)) return false
  await putRow(ctx, groupId, key, val)
  return true
}
// Re-publish our member identity into every shared-in base (after a profile change,
// or opportunistically once a freshly-joined base has become writable).
async function refreshMemberIdentity (ctx) {
  let n = 0
  for (const m of await membershipsByKind(ctx, 'shared-in')) {
    try { if (await publishMember(ctx, m.groupId)) n++ } catch {}
  }
  return n
}

async function computeProjection (ctx) {
  const dayRows = (await privRows(ctx, DAY_RANGE)).filter((v) => v && !v.deleted)
  const periodRows = (await privRows(ctx, PERIOD_RANGE)).filter((v) => v && !v.deleted)
  const prefs = await getPrefs(ctx)
  return { proj: projectionFromRows(dayRows, periodRows, { prefs }), dayRows }
}

// Write the scope-appropriate projection into ONE shared-out base. Scope gates
// what is written (and therefore what the partner can ever replicate):
//   phase     -> phase:current + predict:current (nextPeriodStart only)
//   fertility -> + fertile window / ovulation estimate
//   full      -> + redacted per-day summary (whitelisted symptom tags)
// The day's written NOTE rides on that summary row, and only when this share's
// own `notes` switch is on - a separate consent from the scope, off by default.
// See proposals/2026-09-10-notes-on-a-full-share.md.
async function writeProjection (ctx, groupId, scope, proj, dayRows, shareNotes) {
  await putRow(ctx, groupId, phaseKey(), { phase: proj.phase, dayOfCycle: proj.dayOfCycle })
  if (proj.known) {
    const predict = { nextPeriodStart: proj.nextPeriodStart }
    if (scope !== 'phase') { predict.fertileStart = proj.fertileStart; predict.fertileEnd = proj.fertileEnd; predict.ovulationEst = proj.ovulationEst }
    await putRow(ctx, groupId, predictKey(), predict)
  }
  if (scope === 'full') {
    const cutoff = addDays(todayIso(), -SUMMARY_WINDOW_DAYS)
    const live = new Set()
    for (const d of dayRows) {
      if (diffDays(cutoff, d.date) < 0) continue // older than the window
      live.add(d.date)
      const tags = Array.isArray(d.symptoms) ? d.symptoms.filter((s) => SUMMARY_TAGS.has(s)) : []
      const row = { date: d.date, flow: !!d.flow, symptomTags: tags }
      // Switched off, the field is simply never written. Switching a share OFF
      // rewrites this whole window, so the rows a partner syncs after that carry
      // no note - forward-only, exactly like revocation.
      if (shareNotes && typeof d.notes === 'string' && d.notes) row.note = d.notes.slice(0, 2000)
      await putRow(ctx, groupId, summaryKey(d.date.replace(/-/g, '')), row)
    }
    // A day the owner DELETED must leave the partner's screen too. Nothing used
    // to take it off: this loop only ever wrote the days that still existed, so
    // the old summary row stayed on the shared base for good - and once notes can
    // ride on it, "remove this day" was leaving the note on someone else's phone.
    // Blanked rather than tombstoned, because the apply rule refuses later writes
    // to a tombstoned shared key and that date can be logged again tomorrow.
    // `blank` is filtered out by partner:view; an older partner build shows the
    // day with nothing on it, which is still better than showing what was removed.
    for (const stale of await staleSummaryDates(ctx, groupId, live, cutoff)) {
      await putRow(ctx, groupId, summaryKey(stale.replace(/-/g, '')), { date: stale, blank: true })
    }
  }
}

// Dates that have a summary row on this shared base but no longer have a live day
// row (deleted, or its whole content cleared away), and are still inside the
// window. Rows already blank are skipped, so a person who logs rarely does not
// re-append the same blanks on every save.
async function staleSummaryDates (ctx, groupId, live, cutoff) {
  const out = []
  try {
    for await (const { value } of viewFor(ctx, groupId).view.createReadStream(SUMMARY_RANGE)) {
      const d = value && value.date
      if (!d || value.blank) continue
      if (diffDays(cutoff, d) < 0) continue
      if (!live.has(d)) out.push(d)
    }
  } catch {}
  return out
}

// Recompute the projection and push it to every shared-out base. Best-effort and
// scoped per base. Called after any private-log change so partners stay current.
async function refreshShares (ctx) {
  // Revoked shares are frozen at their last-synced projection - never push more.
  const shares = (await membershipsByKind(ctx, 'shared-out')).filter((m) => !m.revoked)
  if (!shares.length) return
  let projData
  try { projData = await computeProjection(ctx) } catch { return }
  for (const m of shares) {
    const base = ctx.bases.get(m.groupId)
    if (!base || !base.writable) continue
    try { await writeProjection(ctx, m.groupId, m.scope || 'phase', projData.proj, projData.dayRows, !!m.notes) } catch {}
  }
}

const methods = {
  // --- identity -----------------------------------------------------------
  'identity:get': async (_args, ctx) => ({ pubkey: pubkeyHex(ctx) }),

  // Whether the device-link private-base path is active (drives whether the UI
  // shows the recovery-phrase + device-linking surfaces). False in production
  // until the flag flips, so those surfaces stay hidden.
  'deviceLink:status': async (_args, _ctx) => ({ enabled: isDeviceLinkEnabled() }),

  // --- cycle lifecycle + device linking ----------------------------------
  // Is this device already tracking a cycle (has a private base)?
  //
  // THE WHOLE UI IS GATED ON THIS CALL. App.jsx renders nothing at all until
  // cycle:status comes back (mode stays null, which is a bare background with no
  // nav), so anything that can block here blanks the app with no way out. Keep it
  // to LOCAL reads only:
  //  - `ps.exists` would route through getDeviceLink -> dl.start() -> Autobase
  //    ready(), which can wait on a peer. `personalMeta:bootstrap` is the same
  //    signal start() itself gates on and is a plain localDb row.
  //  - `partners` is counted here from localDb too, so the viewer boot path no
  //    longer needs partner:list (which does base.update() per shared base).
  // See the blank-screen post-mortem in DECISIONS.md.
  'cycle:status': async (_args, ctx) => {
    const partners = (await membershipsByKind(ctx, 'shared-in')).length
    if (isDeviceLinkEnabled()) {
      const boot = (await ctx.localDb.get('personalMeta:bootstrap').catch(() => null))?.value
      return { hasBase: !!(boot && boot.key), groupId: null, pubkey: pubkeyHex(ctx), partners }
    }
    const m = await privateMembership(ctx)
    return { hasBase: !!m, groupId: m?.groupId ?? null, pubkey: pubkeyHex(ctx), partners }
  },

  // The owner's own on-device projection (phase + predicted dates). Computed
  // from the private log, never written to any base. Returns { known:false }
  // when there is not enough history yet (the UI shows a "computing" hint).
  'cycle:prediction': async (_args, ctx) => {
    const prefs = await getPrefs(ctx)
    const goal = prefs.goal || 'track'
    const pregnancy = pregnancyProjection(prefs, todayIso())
    if (!(await privHas(ctx))) return { known: false, phase: null, confidence: 'none', goal, pregnancy }
    try { const { proj } = await computeProjection(ctx); return { ...proj, goal, pregnancy } } catch { return { known: false, phase: null, confidence: 'none', goal, pregnancy } }
  },

  // --- prefs (device-local, feed prediction) ------------------------------
  'prefs:get': async (_args, ctx) => {
    const p = await getPrefs(ctx)
    return { avgCycleLength: p.avgCycleLength ?? null, avgPeriodLength: p.avgPeriodLength ?? null, lutealLength: p.lutealLength ?? null, goal: p.goal || 'track', flower: p.flower || 'rose', pregnancy: p.pregnancy || null, conditions: Array.isArray(p.conditions) ? p.conditions : [], birthControl: !!p.birthControl }
  },
  'prefs:set': async (args = {}, ctx) => {
    const next = applyPrefsPatch(await getPrefs(ctx), args)
    await ctx.localDb.put('prefs', next)
    if (isDeviceLinkEnabled()) await ps.putPrefs(ctx, next).catch(() => {}) // sync settings to the owner's OWN devices
    await refreshShares(ctx).catch(() => {}) // prefs change the projection partners see
    return { ok: true }
  },

  // --- notifications (device-local; OS-scheduled local reminders) ----------
  // Prefs live here (never cross the wire, like `prefs`); the RN shell reads
  // `notifications:schedule` and hands the events to expo-notifications. See
  // proposals/2026-07-09-notifications.md. Master `enabled` is the app-level
  // intent; the shell separately reflects the actual OS permission grant.
  'notifications:get': async (_args, ctx) => getNotifPrefs(ctx),
  'notifications:set': async (args = {}, ctx) => {
    const cur = await getNotifPrefs(ctx)
    const next = { ...cur }
    if ('enabled' in args) next.enabled = !!args.enabled
    if ('discreet' in args) next.discreet = !!args.discreet
    if ('period' in args) next.period = !!args.period
    if ('fertility' in args) next.fertility = !!args.fertility
    if ('dailyNote' in args) next.dailyNote = !!args.dailyNote
    if ('noteTone' in args && NOTE_TONES.includes(args.noteTone)) next.noteTone = args.noteTone
    if ('time' in args && typeof args.time === 'string' && /^\d{1,2}:\d{2}$/.test(args.time)) {
      const [h, m] = args.time.split(':').map(Number)
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) next.time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
    next.updatedAt = Date.now()
    await ctx.localDb.put('notifications', next)
    return next
  },
  // The concrete OS notifications to schedule now, computed from the on-device
  // projection + the notif prefs (goal-aware, confidence-gated, BC-suppressed,
  // discreet-vs-descriptive). Returns [] when off or the projection is not
  // trustworthy. The shell converts { dateIso, hour, minute } to a local instant.
  'notifications:schedule': async (_args, ctx) => {
    const notif = await getNotifPrefs(ctx)
    if (!notif.enabled) return { enabled: false, events: [] }
    const prefs = await getPrefs(ctx)
    const goal = prefs.goal || 'track'
    if (!(await privHas(ctx))) return { enabled: true, events: [] }
    try {
      const { proj, dayRows } = await computeProjection(ctx)
      // Days the user actually logged flow on. The dial calls those menstrual, so
      // the daily note has to as well - see bucketOn in petalNotes.
      const flowDays = new Set(dayRows.filter((d) => FLOW_VALUES.has(d.flow)).map((d) => d.date))
      return { enabled: true, events: notificationEvents(proj, { notif, goal, flower: prefs.flower, flowDays, today: todayIso() }) }
    } catch { return { enabled: true, events: [] } }
  },

  // --- network (device-local; the off-LAN relay privacy toggle) -----------
  // Whether this device may retry a FAILED hole-punch through the shared
  // PeerLoom blind relay. Device-local like `notifications`: never projected to
  // a partner and deliberately not synced to the owner's other devices, since
  // it describes the network this phone is on. Default ON so pairing and sync
  // just work; off means pure peer-to-peer. See src/relay.js.
  'network:get': async (_args, ctx) => getNetworkPrefs(ctx),
  'network:set': async (args = {}, ctx) => {
    const cur = await getNetworkPrefs(ctx)
    const next = { useRelay: 'useRelay' in args ? !!args.useRelay : cur.useRelay, updatedAt: Date.now() }
    await ctx.localDb.put(relay.NETWORK_KEY, next)
    // Update the in-memory cache the swarm's relayThrough hook reads, so the
    // change applies to the very next connect with no reconnect or restart.
    relay.setUseRelay(next.useRelay)
    return getNetworkPrefs(ctx)
  },

  // How connections are actually being made on this device. Exists mainly so
  // "it connected" can be told apart from "it connected THROUGH THE RELAY" -
  // without this, the off-LAN hardware verification is unfalsifiable.
  //
  // The two relay numbers come from opposite ends of a connection and are NOT
  // interchangeable. `offered` is ours: how many times WE escalated a dial that
  // had already failed to punch. `relaying` is hyperdht's, and it only counts on
  // the ACCEPTING side (lib/server.js), so it stays 0 on a device that was
  // rescued by the relay and moves on the device that carried the other end.
  // Both are needed to see a relayed pairing whole.
  //
  // Process-lifetime counters, deliberately not persisted: they answer "what is
  // this session doing", and a stale count across restarts would mislead.
  'network:stats': async (_args, ctx) => {
    const swarm = ctx.swarm || null
    const dht = swarm?.dht || null
    const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null)
    return {
      useRelay: relay.useRelayCached() === true,
      relayConfigured: !!relay.RELAY_PUBLIC_KEY,
      // Our own NAT is double-randomized, i.e. a direct punch can never work
      // and every connection relays from the first attempt.
      randomizedNat: !!dht?.randomized,
      policy: relay.relayStats(),
      relaying: clone(dht?.stats?.relaying),
      punches: clone(dht?.stats?.punches),
      connections: swarm?.connections?.size ?? 0,
      connects: clone(swarm?.stats?.connects),
    }
  },

  // --- profile (device-local; name + avatar projected to partners) --------
  // Stored in localDb as { displayName, avatarBlob?, avatarHash?, avatarType?,
  // updatedAt }. Avatar bytes live in the content blob store (not inline); reads
  // resolve them back to a data URL. See proposals/2026-07-08-user-profile.md.
  'profile:get': async (_args, ctx) => {
    const p = await getProfile(ctx)
    const out = { displayName: p.displayName || '', updatedAt: p.updatedAt || 0 }
    const avatar = await resolveAvatarAwait(ctx, p) // own blob is local -> fast
    if (avatar) out.avatar = avatar
    return out
  },
  'profile:set': async (args = {}, ctx) => {
    const profile = (await applyProfile(ctx, args)) || (await getProfile(ctx))
    await refreshShareMeta(ctx).catch(() => {}) // push the new name/avatar to partners we share WITH
    await refreshMemberIdentity(ctx).catch(() => {}) // update our name on shares we JOINED
    const out = { displayName: profile.displayName || '', updatedAt: profile.updatedAt || 0 }
    const avatar = await resolveAvatarAwait(ctx, profile)
    if (avatar) out.avatar = avatar
    return out
  },

  // --- donation reminder (device-local) -----------------------------------
  // Suite pattern: nudge once after 2 weeks of use. Tracks first use + whether
  // shown. Never crosses the wire. The UI additionally gates this off on iOS
  // (App Store 3.1.1, no external donation links).
  'donation:status': async (_args, ctx) => {
    let row = (await ctx.localDb.get('donateReminder'))?.value
    if (!row) { row = { firstUseAt: Date.now(), shown: false }; await ctx.localDb.put('donateReminder', row) }
    const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000
    return { due: !row.shown && (Date.now() - row.firstUseAt >= FOURTEEN_DAYS), shown: !!row.shown, firstUseAt: row.firstUseAt }
  },
  'donation:dismiss': async (_args, ctx) => {
    const row = (await ctx.localDb.get('donateReminder'))?.value || { firstUseAt: Date.now() }
    row.shown = true
    await ctx.localDb.put('donateReminder', row)
    return { ok: true }
  },

  // --- export / import (device-local backup + migration) ------------------
  // Return the full cycle log as a plain JSON object. The shell writes this to a
  // local file the user saves themselves. No secrets (no identity/keys), no
  // internal fields - just the data the user entered. Never uploaded anywhere.
  'export:data': async ({ password } = {}, ctx) => {
    const days = []; const periods = []
    if (await privHas(ctx)) {
      for (const v of await privRows(ctx, DAY_RANGE)) {
        if (!v || v.deleted) continue
        const d = { date: v.date }
        if (v.flow !== undefined) d.flow = v.flow
        if (Array.isArray(v.symptoms) && v.symptoms.length) d.symptoms = v.symptoms
        if (Array.isArray(v.mood) && v.mood.length) d.mood = v.mood
        if (v.notes) d.notes = v.notes
        if (typeof v.bbt === 'number') d.bbt = v.bbt
        days.push(d)
      }
      for (const v of await privRows(ctx, PERIOD_RANGE)) {
        if (!v || v.deleted) continue
        periods.push({ start: v.start, end: v.end ?? null })
      }
    }
    const p = await getPrefs(ctx)
    const prefs = {}
    for (const k of BACKUP_PREFS) if (p[k] != null) prefs[k] = p[k]
    // The profile travels too. It is what a partner sees, and a restore that drops
    // it leaves the person nameless to everyone they share with. The avatar goes as
    // a data URL rather than its blob reference: the bytes live in THIS device's
    // blob store, so the reference means nothing on the phone being restored onto.
    const prof = await getProfile(ctx)
    const profile = {}
    if (prof?.displayName) profile.displayName = prof.displayName
    const ownAvatar = await resolveAvatarAwait(ctx, prof).catch(() => null)
    if (ownAvatar) profile.avatar = ownAvatar
    const payload = { app: 'pearpetal', version: 1, exportedAt: Date.now(), days, periods, prefs, profile }
    // A non-empty password seals the payload; blank keeps the plaintext file.
    return (password != null && String(password).length) ? encryptBackup(payload, password) : payload
  },

  // Import a previously exported JSON object into this device's private base
  // (creating one if this device has none - the recovery case). Entries are
  // re-signed by this device; on a date collision the imported entry wins
  // (fresh timestamp). Returns how many rows were written.
  'import:data': async ({ data, password }, ctx) => {
    // Encrypted backups carry an `enc` wrapper; decrypt (password required) into
    // the same plaintext shape before the existing import logic runs. Decryption
    // happens before any write, so a wrong password never leaves a partial import.
    if (data && data.enc) {
      if (password == null || !String(password).length) throw new Error('password required')
      data = decryptBackup(data, password)
    }
    if (!data || data.app !== 'pearpetal' || !Array.isArray(data.days)) throw new Error('not a PearPetal export')
    if (!(await privHas(ctx))) await enablePrivate(ctx)
    let dCount = 0; let pCount = 0
    for (const d of data.days) {
      const nd = normDate(d && d.date)
      if (!nd) continue
      const val = { date: nd.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now(), deleted: false }
      if (d.flow === null || FLOW_VALUES.has(d.flow)) val.flow = d.flow ?? null
      if (Array.isArray(d.symptoms)) val.symptoms = d.symptoms.slice(0, 32).map((s) => String(s).slice(0, 40))
      if (Array.isArray(d.mood)) val.mood = d.mood.slice(0, 16).map((s) => String(s).slice(0, 40))
      if (typeof d.notes === 'string') val.notes = d.notes.slice(0, 2000)
      if (typeof d.bbt === 'number') val.bbt = d.bbt
      await privPut(ctx, dayKey(nd.key), val)
      dCount++
    }
    for (const pr of (data.periods || [])) {
      const ns = normDate(pr && pr.start)
      if (!ns) continue
      const end = pr.end && normDate(pr.end) ? normDate(pr.end).iso : null
      await privPut(ctx, periodKey(ns.key), { start: ns.iso, end, createdBy: pubkeyHex(ctx), createdAt: Date.now(), deleted: false })
      pCount++
    }
    if (data.prefs && typeof data.prefs === 'object') {
      // Same whitelist prefs:set uses, so nothing the app can set is dropped here.
      const next = applyPrefsPatch(await getPrefs(ctx), data.prefs)
      await ctx.localDb.put('prefs', next)
      if (isDeviceLinkEnabled()) await ps.putPrefs(ctx, next).catch(() => {})
    }
    let profileRestored = false
    if (data.profile && typeof data.profile === 'object') {
      profileRestored = await applyProfile(ctx, data.profile).catch(() => false)
    }
    await refreshShares(ctx).catch(() => {})
    await refreshShareMeta(ctx).catch(() => {})   // a restored name reaches partners
    await refreshMemberIdentity(ctx).catch(() => {})
    return { ok: true, days: dCount, periods: pCount, profile: profileRestored }
  },

  // Start tracking: create the private base (idempotent - returns the existing
  // one if this device already has a cycle). Own devices later link into it.
  'cycle:create': async (_args, ctx) => {
    if (isDeviceLinkEnabled()) {
      if (await ps.exists(ctx)) return { groupId: null, inviteKey: null, created: false }
      await ps.enable(ctx)
      await seedOwnerState(ctx)
      return { groupId: null, inviteKey: null, created: true }
    }
    const existing = await privateMembership(ctx)
    if (existing) return { groupId: existing.groupId, inviteKey: reencodeInvite(existing), created: false }
    const r = await enablePrivate(ctx)
    return { groupId: r.groupId, inviteKey: r.inviteKey, created: true }
  },

  // Mint a link/QR the UI shows to link another of the owner's devices. Core-group
  // path re-encodes the private base invite; device-link path mints a fresh
  // `pearpetal://pair?...` pair URL (QR-first, DECISIONS 2026-07-12).
  'link:invite': async (_args, ctx) => {
    if (isDeviceLinkEnabled()) { await requirePrivate(ctx); return ps.linkInvite(ctx) }
    const m = await privateMembership(ctx)
    if (!m) throw new Error('start tracking on this device first')
    return { inviteKey: reencodeInvite(m) }
  },

  // Link THIS (fresh) device to the cycle on another of the owner's devices.
  // Refuses if this device already has its own cycle, to avoid a split identity.
  'link:join': async ({ inviteKey }, ctx) => {
    if (typeof inviteKey !== 'string' || !inviteKey.trim()) throw new Error('inviteKey required')
    if (isDeviceLinkEnabled()) {
      if (await ps.exists(ctx)) throw new Error('this device is already tracking a cycle')
      return ps.linkJoin(ctx, inviteKey.trim())
    }
    if (await privateMembership(ctx)) throw new Error('this device is already tracking a cycle')
    const r = await ctx.joinGroup({ inviteKey: inviteKey.trim() })
    await tagKind(ctx, r.groupId, 'private')
    await publishDevice(ctx, r.groupId)
    return { groupId: r.groupId, writable: r.writable }
  },

  // --- device roster ------------------------------------------------------
  'device:setLabel': async ({ label }, ctx) => {
    if (typeof label !== 'string' || !label.trim()) throw new Error('label required')
    const clean = label.trim().slice(0, 64)
    if (isDeviceLinkEnabled()) { await ps.setDeviceLabel(ctx, clean); return { label: clean } }
    await ctx.localDb.put('deviceProfile', { label: clean, updatedAt: Date.now() })
    await publishDevice(ctx)
    return { label: clean }
  },

  // Retry publishing our roster row (call after link:join once writable).
  'device:publish': async (_args, ctx) => ({ published: await privPublishDevice(ctx) }),

  // Remove a linked device from the roster (device-link path only). Cosmetic: it
  // hides the device from listLinkedDevices; a full unpair/writer-block is a later
  // concern.
  'device:remove': async ({ pubkey }, ctx) => {
    if (!isDeviceLinkEnabled()) throw new Error('device removal is only available with device-link')
    if (typeof pubkey !== 'string' || !pubkey) throw new Error('pubkey required')
    await ps.removeDevice(ctx, pubkey)
    return { ok: true }
  },

  // The device-link recovery phrase (SLIP-48 mnemonic), for the "save your
  // recovery phrase" UI. Only available on the device-link path with a personal
  // base; { available:false } otherwise (the UI then shows nothing). Anchor only
  // (decision #5): the phrase recovers identity + re-pairs; data recovery still
  // needs a backup file.
  'recovery:getPhrase': async (_args, ctx) => {
    if (!isDeviceLinkEnabled() || !(await ps.exists(ctx))) return { available: false, phrase: null }
    const phrase = await ps.getRecoveryPhrase(ctx)
    return { available: !!phrase, phrase: phrase || null }
  },

  'device:getAll': async (_args, ctx) => {
    if (isDeviceLinkEnabled()) return ps.listDevices(ctx)
    const base = viewFor(ctx, await privateGroupId(ctx))
    await base.update()
    const self = pubkeyHex(ctx)
    const out = []
    for await (const { value } of base.view.createReadStream(DEVICE_RANGE)) {
      if (value && value.pubkey) out.push({ pubkey: value.pubkey, label: value.label || 'Device', self: value.pubkey === self })
    }
    return out
  },

  // --- day log ------------------------------------------------------------
  // Upsert one day's entry. Any field omitted is left untouched; flow accepts a
  // FLOW_VALUES string or null (clear). symptoms/mood are string arrays; notes
  // is capped free text; bbt is a number or null.
  'day:set': async ({ date, flow, symptoms, mood, notes, bbt }, ctx) => {
    const nd = normDate(date)
    if (!nd) throw new Error('date must be YYYY-MM-DD')
    await requirePrivate(ctx)
    const existing = await privReadRow(ctx, dayKey(nd.key))
    const base0 = (existing && !existing.deleted) ? existing : { date: nd.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
    const patch = {}
    if (flow !== undefined) patch.flow = (flow === null) ? null : (FLOW_VALUES.has(flow) ? flow : (() => { throw new Error('invalid flow') })())
    if (symptoms !== undefined) patch.symptoms = Array.isArray(symptoms) ? symptoms.slice(0, 32).map((s) => String(s).slice(0, 40)) : []
    if (mood !== undefined) patch.mood = Array.isArray(mood) ? mood.slice(0, 16).map((s) => String(s).slice(0, 40)) : []
    if (notes !== undefined) patch.notes = notes ? String(notes).slice(0, 2000) : ''
    if (bbt !== undefined) patch.bbt = (bbt === null) ? null : (Number.isFinite(bbt) ? bbt : (() => { throw new Error('invalid bbt') })())
    await privPut(ctx, dayKey(nd.key), { ...base0, ...patch, deleted: false })
    await refreshShares(ctx).catch(() => {}) // keep any partner projections current
    return { ok: true, date: nd.iso }
  },

  // --- Apple Health / Health Connect import ---------------------------------
  // The shell reads the platform (a native module, read authorization only) and
  // hands the samples here already normalised: ISO dates, BBT in Celsius, sorted
  // ascending. The merge rules live in src/healthImport.js and are pure - gaps
  // only, never overwriting what the user typed, provenance recorded per FIELD.
  // See proposals/2026-07-30-health-import.md.
  //
  // Nothing here writes back to the platform, and nothing touches a shared base:
  // a partner still only sees the consent-scoped projection, which is recomputed
  // from the private base and does not care where a row came from.
  // Parse a file the user exported from another health app, then merge it. The
  // shell reads the picked file and passes its TEXT; parsing is pure
  // (src/healthFiles.js) so every format is tested without a device or a picker.
  // Files are the PRIMARY import path - see DECISIONS.md 2026-07-30.
  'health:importFile': async ({ text, format } = {}, ctx) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('no file contents')
    const parsed = parseHealthFile(text, format ? { format } : {})
    if (!parsed.format) return { ok: false, reason: 'unrecognised' }
    if (!parsed.samples.length) return { ok: true, format: parsed.format, written: 0, added: 0, updated: 0, keptManual: 0, unchanged: 0, read: 0 }
    const res = await methods['health:import']({ samples: parsed.samples, source: 'file' }, ctx)
    return { ...res, format: parsed.format, read: parsed.samples.length }
  },

  'health:import': async ({ samples, source } = {}, ctx) => {
    if (!['healthkit', 'healthconnect', 'file'].includes(source)) throw new Error('source must be healthkit, healthconnect or file')
    await requirePrivate(ctx)
    const existing = {}
    for (const v of await privRows(ctx, DAY_RANGE)) if (v && !v.deleted) existing[v.date] = v
    const plan = planImport(existing, samples, { source, today: todayIso() })
    for (const w of plan.writes) {
      const nd = normDate(w.date)
      if (!nd) continue
      const row = await privReadRow(ctx, dayKey(nd.key))
      const base0 = (row && !row.deleted) ? row : { date: nd.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
      await privPut(ctx, dayKey(nd.key), {
        ...base0, ...w.patch,
        sources: { ...(base0.sources || {}), ...w.sources },
        deleted: false,
      })
    }
    if (plan.writes.length) await refreshShares(ctx).catch(() => {})
    // The written count is what the UI reports; the rest explains what was left
    // alone, so an import that changes nothing can say WHY.
    return {
      ok: true, source,
      written: plan.writes.length,
      added: plan.added, updated: plan.updated, keptManual: plan.keptManual,
      unchanged: plan.unchanged, invalid: plan.invalid, future: plan.future, overflow: plan.overflow,
    }
  },

  'day:get': async ({ date }, ctx) => {
    const nd = normDate(date)
    if (!nd) throw new Error('date must be YYYY-MM-DD')
    const row = await privReadRow(ctx, dayKey(nd.key))
    return (row && !row.deleted) ? row : null
  },

  // Newest first. Slice 1 returns all days; retention/paging is a later concern.
  'day:getAll': async (_args, ctx) => {
    const out = (await privRows(ctx, DAY_RANGE)).filter((v) => v && !v.deleted)
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    return out
  },

  'day:delete': async ({ date }, ctx) => {
    const nd = normDate(date)
    if (!nd) throw new Error('date must be YYYY-MM-DD')
    await requirePrivate(ctx)
    const existing = await privReadRow(ctx, dayKey(nd.key))
    if (!existing) throw new Error('day not found')
    await privPut(ctx, dayKey(nd.key), { ...existing, deleted: true })
    await refreshShares(ctx).catch(() => {})
    return { ok: true }
  },

  // The cycles this log actually contains, and what they add up to.
  //
  // Derived from cycleStarts(), the SAME function the projection uses, so the
  // history screen and the dial can never tell a person two different stories
  // about how long her cycles are. The 15..60 day filter and the median are the
  // projection's too (projectionFromRows), for the same reason: a screen that
  // said "usually 31 days" while the dial predicted from 28 would be worse than
  // no screen.
  //
  // Nothing here is written anywhere. It is computed on demand from the log, like
  // every other prediction, and never crosses the wire.
  'cycle:history': async (_args, ctx) => {
    const dayRows = (await privRows(ctx, DAY_RANGE)).filter((v) => v && !v.deleted)
    const periodRows = (await privRows(ctx, PERIOD_RANGE)).filter((v) => v && !v.deleted)
    const starts = cycleStarts(dayRows, periodRows) // ascending
    const bleeding = new Set(dayRows.filter((d) => BLEEDING_FLOWS.has(d.flow)).map((d) => d.date))
    const explicitEnd = new Map(periodRows.filter((p) => p.end).map((p) => [p.start, p.end]))

    const cycles = []
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i]
      const nextStart = starts[i + 1] || null
      // The last start has no cycle length yet: it is the one she is in.
      const length = nextStart ? diffDays(start, nextStart) : null
      // Period length: the explicit end when there is one, else the run of
      // bleeding days from the start.
      let end = explicitEnd.get(start) || start
      if (!explicitEnd.has(start)) while (bleeding.has(addDays(end, 1))) end = addDays(end, 1)
      cycles.push({
        start,
        nextStart,
        length,
        periodLength: bleeding.has(start) || explicitEnd.has(start) ? diffDays(start, end) + 1 : null,
        current: !nextStart,
      })
    }
    cycles.reverse() // newest first, which is the order the screen reads in

    // Same band the projection trusts. A 3-day or 90-day "cycle" is a logging
    // slip, and averaging it in would move the number the app predicts from.
    const usable = cycles.map((c) => c.length).filter((n) => n != null && n >= 15 && n <= 60)
    const periodLens = cycles.map((c) => c.periodLength).filter((n) => n != null && n >= 1 && n <= 15)
    const stats = {
      cycles: cycles.length,
      completed: cycles.filter((c) => c.length != null).length,
      usable: usable.length,
      medianLength: usable.length ? median(usable) : null,
      shortest: usable.length ? Math.min(...usable) : null,
      longest: usable.length ? Math.max(...usable) : null,
      // How much they vary. The projection calls high confidence at a spread of
      // 4 days or less over 3+ cycles, so the screen uses the same threshold
      // rather than inventing its own idea of "regular".
      variation: usable.length >= 2 ? Math.max(...usable) - Math.min(...usable) : null,
      regular: usable.length >= 3 && (Math.max(...usable) - Math.min(...usable)) <= 4,
      medianPeriodLength: periodLens.length ? median(periodLens) : null,
    }
    // What the DIAL actually predicts from, which is not always the same number.
    // projectionFromRows clamps the cycle length to 21..45 before using it, so a
    // median outside that band is capped. Both numbers are true and they mean
    // different things - her cycles really did run that long, and the app will not
    // project that far from thin evidence - so the screen shows hers and says when
    // the prediction is capped, rather than quietly showing one and implying the
    // other.
    stats.predictsFrom = stats.medianLength == null ? null : Math.max(21, Math.min(45, stats.medianLength))
    return { cycles, stats }
  },

  // Erase everything this phone holds. Irreversible, and there is no account and
  // no server, so nothing can bring it back but a backup file.
  //
  // ORDER MATTERS. The device-local database is cleared FIRST and the files are
  // deleted afterwards (by the shell), because the database is what the app reads
  // on boot: identity, memberships, prefs, the recovery mnemonic. Clear that and
  // the app is a fresh install even if the file delete then fails half way. The
  // other order would leave a phone that still thinks it has a cycle and can no
  // longer open it.
  //
  // The engine is closed at the end so the shell can delete the store directory
  // without RocksDB writing back into it. The worklet is finished after this: the
  // shell shows a terminal screen and the person reopens the app.
  'data:erase': async (_args, ctx) => {
    let groups = 0
    for (const m of await allMemberships(ctx)) {
      // Leaves the swarm topic and closes the base as well as forgetting it.
      await ctx.destroyGroup(m.groupId).catch(() => {})
      groups++
    }
    // Every device-local key, not a list of the ones we remember writing. A
    // hand-maintained list is how a forgotten key survives an erase, and on this
    // app a survivor could be the cycle prefs or the recovery mnemonic.
    const keys = []
    try { for await (const { key } of ctx.localDb.createReadStream()) keys.push(key) } catch {}
    for (const k of keys) await ctx.localDb.del(k).catch(() => {})
    // Anything cached in this process, so nothing can be served from memory
    // between the erase and the restart.
    avatarCache.clear(); avatarPending.clear()
    _resetOwnerSeedForTest(); _resetMigrationForTest()
    await ctx.engine.close().catch(() => {})
    return { ok: true, groups, keys: keys.length }
  },

  // --- period spans (explicit start/end markers) --------------------------

  // Remove a period that did not happen, or was logged on the wrong date.
  //
  // The span row alone is not enough. `cycleStarts()` derives a start from EITHER
  // a period row or a run of bleeding days, and period:log stamps a medium flow
  // across the span, so deleting only the row leaves the inferred start behind and
  // the prediction unchanged - which is the whole reason someone is deleting it.
  // So the flow on those days is cleared too, and only the flow: symptoms, mood,
  // notes and BBT are separate observations that still happened. Pass
  // keepDays: true to leave the day rows alone.
  //
  // The span cleared matches what period:log fills: start..end, and for a span
  // with no end, start..start+avgPeriodLength-1, both capped at MAX_PERIOD_SPAN.
  'period:delete': async ({ start, keepDays }, ctx) => {
    const ns = normDate(start)
    if (!ns) throw new Error('start must be YYYY-MM-DD')
    await requirePrivate(ctx)
    const existing = await privReadRow(ctx, periodKey(ns.key))
    const live = existing && !existing.deleted
    // An INFERRED start has no row to tombstone: it exists only because those days
    // are marked as bleeding, so clearing them IS the removal. Refusing here would
    // leave exactly the starts a person most wants to correct untouchable.
    if (!live && !(await isInferredStart(ctx, ns.iso))) throw new Error('period not found')
    if (live) await privPut(ctx, periodKey(ns.key), { ...existing, deleted: true })
    let cleared = 0
    if (!keepDays) cleared = await clearFlowAcross(ctx, ns.iso, live ? existing.end : null)
    // Clearing the first day of an inferred run is not enough on its own: the day
    // after it then becomes the start. Walk the whole run.
    if (!keepDays && !live) {
      let d = ns.iso
      for (let i = 0; i < MAX_PERIOD_SPAN; i++) {
        const nd = normDate(d)
        const row = await privReadRow(ctx, dayKey(nd.key))
        if (!row || row.deleted || !FLOW_VALUES.has(row.flow)) break
        await privPut(ctx, dayKey(nd.key), { ...row, flow: null })
        cleared++
        d = addDays(d, 1)
      }
    }
    await refreshShares(ctx).catch(() => {})
    return { ok: true, cleared }
  },

  'period:set': async ({ start, end }, ctx) => {
    const ns = normDate(start)
    if (!ns) throw new Error('start must be YYYY-MM-DD')
    let endIso = null
    if (end !== undefined && end !== null) {
      const ne = normDate(end)
      if (!ne) throw new Error('end must be YYYY-MM-DD')
      endIso = ne.iso
    }
    await requirePrivate(ctx)
    const existing = await privReadRow(ctx, periodKey(ns.key))
    const base0 = (existing && !existing.deleted) ? existing : { start: ns.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
    await privPut(ctx, periodKey(ns.key), { ...base0, start: ns.iso, end: endIso, deleted: false })
    await refreshShares(ctx).catch(() => {})
    return { ok: true }
  },

  // Log a period the way the rest of the app understands one: as a span of
  // bleeding days. The calendar and dial key off logged flow (an explicit
  // period-span row alone anchors prediction but paints no days), so this stamps a
  // default 'medium' flow across start..(end||today) AND records the span row. It
  // never clobbers a day that already has a flow, so per-day intensities the user
  // picked are preserved; the span is capped so a bad range can't write forever, and
  // an ONGOING period fills no further than the user's own average period length.
  // `from` moves a period that was logged on the wrong start date. The row is
  // keyed BY its start, so without this an edited start writes a second row and
  // leaves the first one anchoring the cycle exactly as before. The old span is
  // retracted flow and all, then the new one is stamped, so the days end up
  // consistent with the corrected dates - at the cost of any per-day intensity
  // inside the old span, which goes back to medium. The UI says so before saving.
  'period:log': async ({ start, end, from, today: todayArg }, ctx) => {
    const ns = normDate(start)
    if (!ns) throw new Error('start must be YYYY-MM-DD')
    // The caller may state which day it is for them, and the UI does. Both sides
    // read the device clock and now agree, so this is a belt and braces against a
    // worklet that comes up without the phone's timezone: the screen is the side
    // that definitely knows what day the person thinks it is, and being wrong here
    // rejects a real period as "in the future".
    const today = (todayArg && normDate(todayArg)?.iso) || todayIso()
    if (ns.iso > today) throw new Error('start is in the future')
    const ongoing = (end === undefined || end === null || end === '')
    let endIso = ns.iso
    if (!ongoing) {
      const ne = normDate(end); if (!ne) throw new Error('end must be YYYY-MM-DD')
      endIso = ne.iso
      if (endIso < ns.iso) throw new Error('end is before start')
    } else if (today > ns.iso) {
      // Ongoing: bleed through today, but no further than a period actually lasts.
      // "When did your last period start?" at onboarding is a HISTORICAL anchor, not
      // a claim of still bleeding - answering "10 days ago" used to stamp 11 straight
      // days of medium flow and leave the dial reading "Menstrual - day 11" (found on
      // the emulator 2026-07-30). The span row still records end:null, so the end
      // stays honestly unknown and the user can log the extra days if a bleed really
      // does run long.
      const prefs = await getPrefs(ctx)
      const periodLen = Math.max(2, Math.min(10, Number(prefs.avgPeriodLength) || DEFAULT_PERIOD_LEN))
      const capped = addDays(ns.iso, periodLen - 1)
      endIso = today < capped ? today : capped
    }
    await requirePrivate(ctx)
    // Moving an existing period: retract the old span first, so the start it
    // anchored stops counting as a cycle start.
    const nf = from ? normDate(from) : null
    if (nf && nf.iso !== ns.iso) {
      const oldRow = await privReadRow(ctx, periodKey(nf.key))
      if (oldRow && !oldRow.deleted) {
        await privPut(ctx, periodKey(nf.key), { ...oldRow, deleted: true })
        await clearFlowAcross(ctx, nf.iso, oldRow.end)
      }
    }
    // Record the explicit span (start anchors the cycle; end marks its length).
    const existingP = await privReadRow(ctx, periodKey(ns.key))
    const p0 = (existingP && !existingP.deleted) ? existingP : { start: ns.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
    await privPut(ctx, periodKey(ns.key), { ...p0, start: ns.iso, end: ongoing ? null : endIso, deleted: false })
    // Stamp bleeding flow across the span (capped), preserving existing flow days.
    const MAX_SPAN = 15
    let marked = 0; let d = ns.iso
    for (let i = 0; i < MAX_SPAN && d <= endIso && d <= today; i++) {
      const nd = normDate(d)
      const existing = await privReadRow(ctx, dayKey(nd.key))
      const hasFlow = existing && !existing.deleted && FLOW_VALUES.has(existing.flow)
      if (!hasFlow) {
        const base0 = (existing && !existing.deleted) ? existing : { date: nd.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
        await privPut(ctx, dayKey(nd.key), { ...base0, flow: 'medium', deleted: false })
        marked++
      }
      d = addDays(d, 1)
    }
    await refreshShares(ctx).catch(() => {})
    return { ok: true, start: ns.iso, end: endIso, marked }
  },

  // Every cycle start, explicit or not.
  //
  // A period row is only one of the two ways a cycle start comes about:
  // cycleStarts() ALSO reads a run of bleeding days, so somebody who logs flow day
  // by day on the calendar has starts anchoring their predictions with no period
  // row behind them. Returning only the rows made this list claim "no periods
  // logged yet" on a phone with a full log and a live prediction on the screen
  // behind it - it showed none of what it said it showed. Inferred starts come
  // back flagged, and the UI says which is which.
  'period:getAll': async (_args, ctx) => {
    const rows = (await privRows(ctx, PERIOD_RANGE)).filter((v) => v && !v.deleted)
    const days = (await privRows(ctx, DAY_RANGE)).filter((v) => v && !v.deleted)
    const explicit = new Set(rows.map((r) => r.start))
    const out = rows.map((r) => ({ ...r, inferred: false }))
    // The same derivation the projection runs, so this list and the prediction
    // cannot disagree about what counts as a start.
    for (const start of cycleStarts(days, rows)) {
      if (explicit.has(start)) continue
      // How far the bleeding actually runs, so the row can show a real span.
      const bleeding = new Set(days.filter((d) => BLEEDING_FLOWS.has(d.flow)).map((d) => d.date))
      let end = start
      while (bleeding.has(addDays(end, 1))) end = addDays(end, 1)
      // `end` is always set for an inferred run, including a one-day one. A null end
      // means ONGOING on an explicit row, and a single logged bleeding day is not
      // an ongoing period - it read "Jul 16 - ongoing" on the TCL.
      out.push({ start, end, inferred: true })
    }
    out.sort((a, b) => String(b.start).localeCompare(String(a.start)))
    return out
  },

  // --- partner sharing: OWNER side ---------------------------------------
  // Create a new shared base for a partner at a chosen consent scope, seed it
  // with share:meta + the current projection, and return the share invite. The
  // invite grants ONLY this shared base - never the private base or its key.
  'share:create': async ({ scope, notes }, ctx) => {
    if (!SCOPES.has(scope)) throw new Error('scope must be phase, fertility, or full')
    // The notes switch is a Full-scope thing only. Silently accepting it on a
    // narrower scope would leave the record claiming a consent the projection
    // never acts on, which is the kind of disagreement this app cannot afford.
    if (notes && scope !== 'full') throw new Error('notes can only be shared on a full share')
    if (!(await privHas(ctx))) throw new Error('start tracking on this device first')
    const r = await ctx.createGroup({ name: 'PearPetal share' })
    const rec = (await ctx.localDb.get('groups:joined:' + r.groupId))?.value || {}
    await ctx.localDb.put('groups:joined:' + r.groupId, { ...rec, kind: 'shared-out', scope, notes: !!notes })
    // Claim ownership of the shared base (owner-write-only enforcement keys off
    // this) + project the owner's identity (name/avatar) so the partner sees a
    // name, not "A partner".
    await writeShareMeta(ctx, r.groupId, scope, await getProfile(ctx), !!notes)
    const { proj, dayRows } = await computeProjection(ctx)
    await writeProjection(ctx, r.groupId, scope, proj, dayRows, !!notes)
    return { groupId: r.groupId, inviteKey: r.inviteKey, scope, notes: !!notes }
  },

  // Turn the written notes on or off for ONE share that already exists. The only
  // method that edits a live share's consent (scope itself is still fixed at
  // creation), so it is deliberately narrow: one share, one boolean, owner only.
  //
  // Turning it ON re-projects the whole window, so the notes on the last
  // SUMMARY_WINDOW_DAYS days go with it - the days the partner can already see
  // fill in rather than starting blank. The UI says that before it happens.
  // Turning it OFF rewrites the same window without the note field, so a partner
  // who syncs after the change no longer has them; one who never syncs again
  // keeps what their device already replicated. Forward-only, like revocation.
  'share:setNotes': async ({ groupId, notes }, ctx) => {
    const m = (await membershipsByKind(ctx, 'shared-out')).find((x) => x.groupId === groupId)
    if (!m) throw new Error('share not found')
    if (m.revoked) throw new Error('this share has ended')
    if ((m.scope || 'phase') !== 'full') throw new Error('notes can only be shared on a full share')
    const on = !!notes
    const rec = (await ctx.localDb.get('groups:joined:' + groupId))?.value || {}
    await ctx.localDb.put('groups:joined:' + groupId, { ...rec, notes: on })
    await writeShareMeta(ctx, groupId, m.scope, await getProfile(ctx), on)
    const { proj, dayRows } = await computeProjection(ctx)
    await writeProjection(ctx, groupId, m.scope, proj, dayRows, on)
    return { groupId, notes: on }
  },

  // Which days' notes a partner can read, so the owner's own screens can mark
  // them. Owner-only and device-local: nothing here is written anywhere.
  //
  // Two sources, unioned. The days writeProjection will send (a note, inside the
  // window, while any live share has notes on), read from the private log so the
  // mark does not lag the projection. And any note already sitting on a live
  // shared base, which covers a day that has since aged out of the window: the
  // row was never rewritten, so the partner still has it.
  //
  // `windowStart` lets the day editor say whether a note typed now would be sent.
  'share:notedDates': async (_args, ctx) => {
    const live = (await membershipsByKind(ctx, 'shared-out')).filter((m) => !m.revoked && (m.scope || 'phase') === 'full')
    const windowStart = addDays(todayIso(), -SUMMARY_WINDOW_DAYS)
    const notesOn = live.some((m) => m.notes)
    const dates = new Set()
    if (notesOn) {
      for (const d of (await privRows(ctx, DAY_RANGE))) {
        if (d && !d.deleted && typeof d.notes === 'string' && d.notes && diffDays(windowStart, d.date) >= 0) dates.add(d.date)
      }
    }
    for (const m of live) {
      try {
        for await (const { value } of viewFor(ctx, m.groupId).view.createReadStream(SUMMARY_RANGE)) {
          if (value && !value.blank && value.note && value.date) dates.add(value.date)
        }
      } catch {}
    }
    return { notesOn, windowStart, dates: [...dates].sort() }
  },

  'share:list': async (_args, ctx) => {
    const self = pubkeyHex(ctx)
    const out = []
    for (const m of await membershipsByKind(ctx, 'shared-out')) {
      // Who has joined this share? Read the base's member:{pubkey} rows (self-signed
      // by each joiner); skip our own. Names are self-attested until the core
      // addWriter gating (proposal 2026-07-09 Part B) lands.
      const joiners = []
      const base = ctx.bases.get(m.groupId)
      if (base) {
        try {
          await base.update()
          for await (const { value } of base.view.createReadStream(MEMBER_RANGE)) {
            if (value && value.pubkey && value.pubkey !== self && !value.deleted) {
              joiners.push({ pubkey: value.pubkey, name: value.displayName || null })
            }
          }
        } catch {}
      }
      out.push({ groupId: m.groupId, scope: m.scope || 'phase', notes: !!m.notes, inviteKey: reencodeInvite(m), createdAt: m.joinedAt || 0, joiners, revoked: !!m.revoked, revokedAt: m.revokedAt || null })
    }
    out.sort((a, b) => a.createdAt - b.createdAt)
    return out
  },

  // Is a partner CURRENTLY connected to this shared base? True as soon as a remote
  // peer is replicating the base's cores (i.e. they scanned + reached us) - the
  // earliest, most reliable "connected" signal, well ahead of the joiner's identity
  // row replicating back (which is subject to the known joiner->owner sync lag). Used
  // by the share-QR sheet to auto-dismiss on connection. A shared-out base only ever
  // has PARTNERS as peers (own devices live on the private base), so any peer = a
  // partner connected.
  'share:connected': async ({ groupId }, ctx) => {
    const base = ctx.bases.get(groupId)
    if (!base) return { connected: false }
    // Check every core this base replicates so we catch a peer at the earliest
    // moment (a joining partner pulls the system/oplog core before the writer
    // core). A shared-out base only ever has partners as peers.
    const cores = []
    const add = (c) => { if (c && typeof c.peers !== 'undefined') cores.push(c) }
    add(base.local)
    try { for (const w of base.activeWriters) if (w) add(w.core) } catch {}
    try { add(base.system && base.system.core) } catch {}
    try { add(base.view && base.view.core) } catch {}
    for (const c of cores) {
      try { if (c.peers && c.peers.length > 0) return { connected: true } } catch {}
    }
    return { connected: false }
  },

  // Revoke a share (SOFT-CLOSE): write the "sharing ended" tombstone into the
  // owner-signed share:meta and flag the membership revoked so we stop projecting
  // to it, but KEEP the base + swarm alive so the tombstone still reaches a partner
  // who was offline at revoke time (it replicates whenever they next reconnect).
  // Forward-only: it cannot unsend the projection blocks the partner already has (a
  // P2P invariant). "Remove permanently" (share:remove) is the hard teardown. See
  // proposals/2026-07-09-sharing-ended.md.
  'share:revoke': async ({ groupId }, ctx) => {
    // Idempotent: a double-fire or a group:updated-triggered reload racing the tap
    // is success, not an error.
    const m = (await membershipsByKind(ctx, 'shared-out')).find((x) => x.groupId === groupId)
    if (!m) return { ok: true, already: true }
    if (m.revoked) return { ok: true, already: true }
    try { await revokeShareMeta(ctx, groupId) } catch {}
    const rec = (await ctx.localDb.get('groups:joined:' + groupId))?.value || m
    await ctx.localDb.put('groups:joined:' + groupId, { ...rec, revoked: true, revokedAt: Date.now() })
    return { ok: true, revoked: true }
  },

  // Remove a share PERMANENTLY: stop announcing/serving that base and forget it
  // locally (the pre-soft-close revoke behaviour). Use after a share has ended to
  // clean up the lingering base - accepts that a partner who never reconnected will
  // not have received the tombstone.
  'share:remove': async ({ groupId }, ctx) => {
    const m = (await membershipsByKind(ctx, 'shared-out')).find((x) => x.groupId === groupId)
    if (!m) return { ok: true, already: true }
    await ctx.localDb.del('groups:joined:' + groupId).catch(() => {})
    await ctx.destroyGroup(groupId).catch(() => {})
    return { ok: true }
  },

  // --- partner sharing: VIEWER side --------------------------------------
  // Join a partner's shared base from their share invite to VIEW their scoped
  // projection. Read-only: this device never writes cycle rows to it (and the
  // owner-write-only apply rule would reject them anyway).
  'partner:join': async ({ inviteKey }, ctx) => {
    if (typeof inviteKey !== 'string' || !inviteKey.trim()) throw new Error('inviteKey required')
    // A partner is a pure VIEWER of the owner's shared base - it only ever connects
    // to the owner, so join CLIENT-ONLY (announce:false). This avoids every viewer
    // redundantly announcing the owner's topic, cutting the per-device topic pile-up
    // that degrades pairing as bases accumulate (proposal 2026-07-09-swarm-topic-accumulation).
    // Device linking (link:join) keeps the default announce:true (own devices stay
    // mutually discoverable).
    const r = await ctx.joinGroup({ inviteKey: inviteKey.trim(), announce: false })
    await tagKind(ctx, r.groupId, 'shared-in')
    // Tell the owner who joined (best-effort; may be too early if we are not yet a
    // writer - partner:view + member:publish re-attempt once writable).
    await publishMember(ctx, r.groupId).catch(() => {})
    return { groupId: r.groupId }
  },

  // Re-publish this viewer's member identity into every shared-in base. The UI
  // calls this on group:updated / when opening a partner view, so a join that was
  // not yet writable at partner:join time still reaches the owner once it is.
  'member:publish': async (_args, ctx) => ({ published: await refreshMemberIdentity(ctx) }),

  'partner:list': async (_args, ctx) => {
    const out = []
    for (const m of await membershipsByKind(ctx, 'shared-in')) {
      const base = ctx.bases.get(m.groupId)
      let meta = null
      if (base) { try { await updateOrCarryOn(base); meta = (await base.view.get('share:meta'))?.value } catch {} }
      // A shared cycle whose base did not open is a real state a person can be
      // in, not a missing row: say so, so the UI can offer to reconnect instead
      // of showing an empty card or failing later with 'unknown group'.
      out.push({ groupId: m.groupId, available: !!base, unavailableReason: base ? null : (unmountedReason(ctx, m.groupId) || 'this shared cycle could not be opened'), ownerPubkey: meta?.ownerPubkey || null, ownerName: meta?.displayName || null, ownerAvatar: resolveAvatarCached(ctx, meta), scope: meta?.scope || null, joinedAt: m.joinedAt || 0, revoked: !!meta?.revoked, revokedAt: meta?.revokedAt || null })
    }
    out.sort((a, b) => a.joinedAt - b.joinedAt)
    return out
  },

  // Read the scoped projection a partner has shared with us.
  'partner:view': async ({ groupId }, ctx) => {
    const m = (await membershipsByKind(ctx, 'shared-in')).find((x) => x.groupId === groupId)
    if (!m) throw new Error('partner share not found')
    // Opportunistically (re)publish our identity now that we are likely writable, so
    // the owner sees who joined. Non-blocking - never gate the view on it, and it
    // no-ops unless the name actually changed (see publishMember).
    publishMember(ctx, groupId).catch(() => {})
    const base = ctx.bases.get(groupId)
    if (!base) {
      const e = new Error(unmountedReason(ctx, groupId) || 'this shared cycle could not be opened')
      e.repairable = true
      throw e
    }
    await updateOrCarryOn(base)
    const meta = (await base.view.get('share:meta'))?.value || null
    const phase = (await base.view.get(phaseKey()))?.value || null
    const predict = (await base.view.get(predictKey()))?.value || null
    const summary = []
    for await (const { value } of base.view.createReadStream(SUMMARY_RANGE)) if (value && !value.blank) summary.push(value)
    summary.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    // Non-blocking: never gate the name/phase on the avatar blob fetch (it can
    // take seconds to replicate). Returns the cached avatar or null + kicks off a
    // background fetch; ownerHasAvatar tells the UI to keep polling until it lands.
    const ownerAvatar = resolveAvatarCached(ctx, meta)
    const ownerHasAvatar = !!(meta?.avatarBlob || meta?.avatar)
    return { scope: meta?.scope || null, notes: !!meta?.notes, ownerPubkey: meta?.ownerPubkey || null, ownerName: meta?.displayName || null, ownerAvatar, ownerHasAvatar, phase, predict, summary, revoked: !!meta?.revoked, revokedAt: meta?.revokedAt || null }
  },

  // Rebuild a shared cycle whose base will not open. Nothing of the person's own
  // lives in a shared-in base - it is a read-only copy of their partner's
  // projection - so throwing the local copy away and re-syncing costs nothing but
  // the download, and needs no new invite from the partner: everything the invite
  // carried is still in the membership record. See @peerloom/core `namespace`.
  'partner:repair': async ({ groupId }, ctx) => {
    const m = (await membershipsByKind(ctx, 'shared-in')).find((x) => x.groupId === groupId)
    if (!m) throw new Error('partner share not found')
    const attempt = Number(String(m.namespace || '').split(':r')[1] || 0) + 1
    await ctx.destroyGroup(groupId).catch(() => {})
    const r = await ctx.joinGroup({ inviteKey: reencodeInvite(m), announce: false, namespace: groupId + ':r' + attempt })
    await tagKind(ctx, r.groupId, 'shared-in')
    await publishMember(ctx, r.groupId).catch(() => {})
    return { groupId: r.groupId, attempt }
  },

  'partner:leave': async ({ groupId }, ctx) => {
    await ctx.localDb.del('groups:joined:' + groupId).catch(() => {})
    await ctx.destroyGroup(groupId).catch(() => {})
    return { ok: true }
  },
}

// Run the one-time legacy->personal migration before the first private-base
// access. migrateIfNeeded is a cheap no-op after the first call (and instant when
// the flag is off), so wrapping every handler is free and needs no post-init hook
// (which onEvent would otherwise cost us its IPC event forwarding).
// maybeSeedOwnerState is deliberately NOT awaited. It is a best-effort publish of
// this device's profile/prefs onto the personal base, nothing reads its result
// back in the same call, and it routes through getDeviceLink -> dl.start(), which
// opens an Autobase and can wait on a peer. Awaiting it put that wait in front of
// EVERY method including cycle:status, which the whole UI is gated on - one stall
// there and the app is a blank screen forever. migrateIfNeeded stays awaited: it
// moves the cycle log, so a read must not run before it finishes.
const wrapped = {}
for (const name of Object.keys(methods)) {
  const fn = methods[name]
  wrapped[name] = (args, ctx) => migrateIfNeeded(ctx).then(() => {
    maybeSeedOwnerState(ctx).catch(() => {})
    return fn(args, ctx)
  })
}
wrapped._resetMigrationForTest = _resetMigrationForTest

module.exports = wrapped
