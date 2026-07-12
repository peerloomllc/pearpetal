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
const { projectionFromRows, pregnancyProjection, addDays, diffDays, todayIso, FLOW_VALUES } = require('./prediction')
const { notificationEvents } = require('./notifications')
const { isDeviceLinkEnabled } = require('./deviceLink')
const ps = require('./privateStore')

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

function viewFor (ctx, groupId) {
  const base = ctx.bases.get(groupId)
  if (!base) throw new Error('unknown group: ' + groupId)
  return base
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
  if (isDeviceLinkEnabled()) { await ps.enable(ctx); return { groupId: null, inviteKey: null } }
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
    time: typeof n.time === 'string' && /^\d{2}:\d{2}$/.test(n.time) ? n.time : '09:00',
  }
}

// The owner's device-local profile (name + avatar pointer). Distinct from
// `deviceProfile` (which names this DEVICE for the roster) - this names the
// PERSON. Never replicated except via the owner-written share:meta projection.
async function getProfile (ctx) {
  return (await ctx.localDb.get('profile'))?.value || {}
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
async function writeShareMeta (ctx, groupId, scope, prof) {
  let existing = null
  try { existing = await readRow(viewFor(ctx, groupId), 'share:meta') } catch {}
  await putRow(ctx, groupId, 'share:meta', {
    ownerPubkey: pubkeyHex(ctx), scope,
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
    try { await writeShareMeta(ctx, m.groupId, m.scope || 'phase', prof) } catch {}
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
async function publishMember (ctx, groupId) {
  const base = ctx.bases.get(groupId)
  if (!base || !base.writable) return false
  const prof = await getProfile(ctx)
  const val = {}
  if (prof?.displayName) val.displayName = String(prof.displayName).slice(0, 64)
  await putRow(ctx, groupId, memberKey(pubkeyHex(ctx)), val)
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
//   full      -> + redacted per-day summary (whitelisted symptom tags, no notes)
async function writeProjection (ctx, groupId, scope, proj, dayRows) {
  await putRow(ctx, groupId, phaseKey(), { phase: proj.phase, dayOfCycle: proj.dayOfCycle })
  if (proj.known) {
    const predict = { nextPeriodStart: proj.nextPeriodStart }
    if (scope !== 'phase') { predict.fertileStart = proj.fertileStart; predict.fertileEnd = proj.fertileEnd; predict.ovulationEst = proj.ovulationEst }
    await putRow(ctx, groupId, predictKey(), predict)
  }
  if (scope === 'full') {
    const cutoff = addDays(todayIso(), -SUMMARY_WINDOW_DAYS)
    for (const d of dayRows) {
      if (diffDays(cutoff, d.date) < 0) continue // older than the window
      const tags = Array.isArray(d.symptoms) ? d.symptoms.filter((s) => SUMMARY_TAGS.has(s)) : []
      await putRow(ctx, groupId, summaryKey(d.date.replace(/-/g, '')), { date: d.date, flow: !!d.flow, symptomTags: tags })
    }
  }
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
    try { await writeProjection(ctx, m.groupId, m.scope || 'phase', projData.proj, projData.dayRows) } catch {}
  }
}

const methods = {
  // --- identity -----------------------------------------------------------
  'identity:get': async (_args, ctx) => ({ pubkey: pubkeyHex(ctx) }),

  // --- cycle lifecycle + device linking ----------------------------------
  // Is this device already tracking a cycle (has a private base)?
  'cycle:status': async (_args, ctx) => {
    if (isDeviceLinkEnabled()) return { hasBase: await ps.exists(ctx), groupId: null, pubkey: pubkeyHex(ctx) }
    const m = await privateMembership(ctx)
    return { hasBase: !!m, groupId: m?.groupId ?? null, pubkey: pubkeyHex(ctx) }
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
    const cur = await getPrefs(ctx)
    const next = { ...cur }
    const num = (v, lo, hi) => (v === null ? null : (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined))
    const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    if ('avgCycleLength' in args) { const v = num(args.avgCycleLength, 21, 45); if (v !== undefined) next.avgCycleLength = v }
    if ('avgPeriodLength' in args) { const v = num(args.avgPeriodLength, 2, 10); if (v !== undefined) next.avgPeriodLength = v }
    if ('lutealLength' in args) { const v = num(args.lutealLength, 9, 18); if (v !== undefined) next.lutealLength = v }
    if ('goal' in args && ['track', 'conceive', 'avoid', 'pregnant'].includes(args.goal)) next.goal = args.goal
    if ('flower' in args && FLOWERS.has(args.flower)) next.flower = args.flower
    // Health conditions (deduped, whitelisted) + hormonal-birth-control flag.
    if ('conditions' in args && Array.isArray(args.conditions)) next.conditions = [...new Set(args.conditions.filter((c) => CONDITIONS.has(c)))]
    if ('birthControl' in args) next.birthControl = !!args.birthControl
    // Pregnancy dates (device-local; never projected to a partner). null clears.
    if ('pregnancy' in args) {
      const pg = args.pregnancy
      if (pg === null) delete next.pregnancy
      else if (pg && typeof pg === 'object') {
        const clean = {}
        if (isIso(pg.lmp)) clean.lmp = pg.lmp
        if (isIso(pg.dueDate)) clean.dueDate = pg.dueDate
        if (clean.lmp || clean.dueDate) next.pregnancy = clean
      }
    }
    next.updatedAt = Date.now()
    await ctx.localDb.put('prefs', next)
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
      const { proj } = await computeProjection(ctx)
      return { enabled: true, events: notificationEvents(proj, { notif, goal, today: todayIso() }) }
    } catch { return { enabled: true, events: [] } }
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
    const existing = await getProfile(ctx)
    const profile = { ...existing, updatedAt: Date.now() }
    if (typeof args.displayName === 'string') profile.displayName = args.displayName.trim().slice(0, 64)
    // avatar: key absent -> preserve; null -> clear; data URL -> store in the blob
    // store (deduped by content hash so a name-only edit re-appends nothing).
    if (Object.prototype.hasOwnProperty.call(args, 'avatar')) {
      if (args.avatar) {
        const parsed = parseDataUrl(args.avatar)
        if (!parsed || !parsed.base64) throw new Error('avatar must be a base64 data URL')
        const bytes = b4a.from(parsed.data, 'base64')
        if (bytes.length > AVATAR_MAX_BYTES) throw new Error('That image is too large. Pick a smaller one.')
        const hash = blobHash(bytes)
        let ref = (await ctx.localDb.get('blobref:' + hash))?.value
        if (!ref) { const put = await ctx.blobs.put(bytes); ref = { key: put.key, id: put.id, type: parsed.mime }; await ctx.localDb.put('blobref:' + hash, ref) }
        profile.avatarBlob = { key: ref.key, id: ref.id }; profile.avatarHash = hash; profile.avatarType = ref.type
        avatarCache.set(hash, String(args.avatar)) // warm cache with the exact bytes we were handed
      } else {
        delete profile.avatarBlob; delete profile.avatarHash; delete profile.avatarType; delete profile.avatar
      }
    }
    await ctx.localDb.put('profile', profile)
    await refreshShareMeta(ctx).catch(() => {}) // push the new name/avatar to partners we share WITH
    await refreshMemberIdentity(ctx).catch(() => {}) // update our name on shares we JOINED
    const out = { displayName: profile.displayName || '', updatedAt: profile.updatedAt }
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
    for (const k of ['avgCycleLength', 'avgPeriodLength', 'lutealLength', 'goal', 'flower']) if (p[k] != null) prefs[k] = p[k]
    const payload = { app: 'pearpetal', version: 1, exportedAt: Date.now(), days, periods, prefs }
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
      const cur = await getPrefs(ctx); const next = { ...cur }
      const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined)
      const a = data.prefs
      if (num(a.avgCycleLength, 21, 45) !== undefined) next.avgCycleLength = num(a.avgCycleLength, 21, 45)
      if (num(a.avgPeriodLength, 2, 10) !== undefined) next.avgPeriodLength = num(a.avgPeriodLength, 2, 10)
      if (num(a.lutealLength, 9, 18) !== undefined) next.lutealLength = num(a.lutealLength, 9, 18)
      if (['track', 'conceive', 'avoid'].includes(a.goal)) next.goal = a.goal
      if (FLOWERS.has(a.flower)) next.flower = a.flower
      next.updatedAt = Date.now()
      await ctx.localDb.put('prefs', next)
    }
    await refreshShares(ctx).catch(() => {})
    return { ok: true, days: dCount, periods: pCount }
  },

  // Start tracking: create the private base (idempotent - returns the existing
  // one if this device already has a cycle). Own devices later link into it.
  'cycle:create': async (_args, ctx) => {
    if (isDeviceLinkEnabled()) {
      if (await ps.exists(ctx)) return { groupId: null, inviteKey: null, created: false }
      await ps.enable(ctx)
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

  // --- period spans (explicit start/end markers) --------------------------
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
  // picked are preserved; the span is capped so a bad range can't write forever.
  'period:log': async ({ start, end }, ctx) => {
    const ns = normDate(start)
    if (!ns) throw new Error('start must be YYYY-MM-DD')
    const today = todayIso()
    if (ns.iso > today) throw new Error('start is in the future')
    const ongoing = (end === undefined || end === null || end === '')
    let endIso = ns.iso
    if (!ongoing) {
      const ne = normDate(end); if (!ne) throw new Error('end must be YYYY-MM-DD')
      endIso = ne.iso
      if (endIso < ns.iso) throw new Error('end is before start')
    } else if (today > ns.iso) {
      endIso = today // ongoing: bleed through today
    }
    await requirePrivate(ctx)
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

  'period:getAll': async (_args, ctx) => {
    const out = (await privRows(ctx, PERIOD_RANGE)).filter((v) => v && !v.deleted)
    out.sort((a, b) => String(b.start).localeCompare(String(a.start)))
    return out
  },

  // --- partner sharing: OWNER side ---------------------------------------
  // Create a new shared base for a partner at a chosen consent scope, seed it
  // with share:meta + the current projection, and return the share invite. The
  // invite grants ONLY this shared base - never the private base or its key.
  'share:create': async ({ scope }, ctx) => {
    if (!SCOPES.has(scope)) throw new Error('scope must be phase, fertility, or full')
    if (!(await privHas(ctx))) throw new Error('start tracking on this device first')
    const r = await ctx.createGroup({ name: 'PearPetal share' })
    const rec = (await ctx.localDb.get('groups:joined:' + r.groupId))?.value || {}
    await ctx.localDb.put('groups:joined:' + r.groupId, { ...rec, kind: 'shared-out', scope })
    // Claim ownership of the shared base (owner-write-only enforcement keys off
    // this) + project the owner's identity (name/avatar) so the partner sees a
    // name, not "A partner".
    await writeShareMeta(ctx, r.groupId, scope, await getProfile(ctx))
    const { proj, dayRows } = await computeProjection(ctx)
    await writeProjection(ctx, r.groupId, scope, proj, dayRows)
    return { groupId: r.groupId, inviteKey: r.inviteKey, scope }
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
      out.push({ groupId: m.groupId, scope: m.scope || 'phase', inviteKey: reencodeInvite(m), createdAt: m.joinedAt || 0, joiners, revoked: !!m.revoked, revokedAt: m.revokedAt || null })
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
      if (base) { try { await base.update(); meta = (await base.view.get('share:meta'))?.value } catch {} }
      out.push({ groupId: m.groupId, ownerPubkey: meta?.ownerPubkey || null, ownerName: meta?.displayName || null, ownerAvatar: resolveAvatarCached(ctx, meta), scope: meta?.scope || null, joinedAt: m.joinedAt || 0, revoked: !!meta?.revoked, revokedAt: meta?.revokedAt || null })
    }
    out.sort((a, b) => a.joinedAt - b.joinedAt)
    return out
  },

  // Read the scoped projection a partner has shared with us.
  'partner:view': async ({ groupId }, ctx) => {
    const m = (await membershipsByKind(ctx, 'shared-in')).find((x) => x.groupId === groupId)
    if (!m) throw new Error('partner share not found')
    // Opportunistically (re)publish our identity now that we are likely writable, so
    // the owner sees who joined. Non-blocking - never gate the view on it.
    publishMember(ctx, groupId).catch(() => {})
    const base = viewFor(ctx, groupId)
    await base.update()
    const meta = (await base.view.get('share:meta'))?.value || null
    const phase = (await base.view.get(phaseKey()))?.value || null
    const predict = (await base.view.get(predictKey()))?.value || null
    const summary = []
    for await (const { value } of base.view.createReadStream(SUMMARY_RANGE)) if (value) summary.push(value)
    summary.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    // Non-blocking: never gate the name/phase on the avatar blob fetch (it can
    // take seconds to replicate). Returns the cached avatar or null + kicks off a
    // background fetch; ownerHasAvatar tells the UI to keep polling until it lands.
    const ownerAvatar = resolveAvatarCached(ctx, meta)
    const ownerHasAvatar = !!(meta?.avatarBlob || meta?.avatar)
    return { scope: meta?.scope || null, ownerPubkey: meta?.ownerPubkey || null, ownerName: meta?.displayName || null, ownerAvatar, ownerHasAvatar, phase, predict, summary, revoked: !!meta?.revoked, revokedAt: meta?.revokedAt || null }
  },

  'partner:leave': async ({ groupId }, ctx) => {
    await ctx.localDb.del('groups:joined:' + groupId).catch(() => {})
    await ctx.destroyGroup(groupId).catch(() => {})
    return { ok: true }
  },
}

module.exports = methods
