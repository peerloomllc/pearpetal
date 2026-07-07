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

const { deviceKey, dayKey, periodKey, DEVICE_RANGE, DAY_RANGE, PERIOD_RANGE } = require('./petalWire')

const FLOW_VALUES = new Set(['spotting', 'light', 'medium', 'heavy'])

function pubkeyHex (ctx) { return b4a.toString(ctx.identity.publicKey, 'hex') }

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

// The private base is the single group this device belongs to in slice 1. Return
// its persisted membership record (or null if this device has no cycle yet).
async function privateMembership (ctx) {
  for await (const { value } of ctx.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) {
    if (value && value.groupId) return value
  }
  return null
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

// Mark a membership as the private base (forward-compat: later slices add
// shared partner bases alongside it, distinguished by this kind field).
async function tagPrivate (ctx, groupId) {
  const rec = (await ctx.localDb.get('groups:joined:' + groupId))?.value
  if (rec && rec.kind !== 'private') await ctx.localDb.put('groups:joined:' + groupId, { ...rec, kind: 'private' })
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

const methods = {
  // --- identity -----------------------------------------------------------
  'identity:get': async (_args, ctx) => ({ pubkey: pubkeyHex(ctx) }),

  // --- cycle lifecycle + device linking ----------------------------------
  // Is this device already tracking a cycle (has a private base)?
  'cycle:status': async (_args, ctx) => {
    const m = await privateMembership(ctx)
    return { hasBase: !!m, groupId: m?.groupId ?? null, pubkey: pubkeyHex(ctx) }
  },

  // Start tracking: create the private base (idempotent - returns the existing
  // one if this device already has a cycle). Own devices later link into it.
  'cycle:create': async (_args, ctx) => {
    const existing = await privateMembership(ctx)
    if (existing) return { groupId: existing.groupId, inviteKey: reencodeInvite(existing), created: false }
    const r = await ctx.createGroup({ name: 'PearPetal' })
    await tagPrivate(ctx, r.groupId)
    await publishDevice(ctx, r.groupId)
    return { groupId: r.groupId, inviteKey: r.inviteKey, created: true }
  },

  // Re-encode the private base invite so the UI can show a QR / copyable code to
  // link another of the owner's devices.
  'link:invite': async (_args, ctx) => {
    const m = await privateMembership(ctx)
    if (!m) throw new Error('start tracking on this device first')
    return { inviteKey: reencodeInvite(m) }
  },

  // Link THIS (fresh) device to the cycle on another of the owner's devices.
  // Refuses if this device already has its own cycle, to avoid a split identity.
  'link:join': async ({ inviteKey }, ctx) => {
    if (typeof inviteKey !== 'string' || !inviteKey.trim()) throw new Error('inviteKey required')
    if (await privateMembership(ctx)) throw new Error('this device is already tracking a cycle')
    const r = await ctx.joinGroup({ inviteKey: inviteKey.trim() })
    await tagPrivate(ctx, r.groupId)
    await publishDevice(ctx, r.groupId)
    return { groupId: r.groupId, writable: r.writable }
  },

  // --- device roster ------------------------------------------------------
  'device:setLabel': async ({ label }, ctx) => {
    if (typeof label !== 'string' || !label.trim()) throw new Error('label required')
    await ctx.localDb.put('deviceProfile', { label: label.trim().slice(0, 64), updatedAt: Date.now() })
    await publishDevice(ctx)
    return { label: label.trim().slice(0, 64) }
  },

  // Retry publishing our roster row (call after link:join once writable).
  'device:publish': async (_args, ctx) => ({ published: await publishDevice(ctx) }),

  'device:getAll': async (_args, ctx) => {
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
    const groupId = await privateGroupId(ctx)
    const base = viewFor(ctx, groupId)
    const existing = await readRow(base, dayKey(nd.key))
    const base0 = (existing && !existing.deleted) ? existing : { date: nd.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
    const patch = {}
    if (flow !== undefined) patch.flow = (flow === null) ? null : (FLOW_VALUES.has(flow) ? flow : (() => { throw new Error('invalid flow') })())
    if (symptoms !== undefined) patch.symptoms = Array.isArray(symptoms) ? symptoms.slice(0, 32).map((s) => String(s).slice(0, 40)) : []
    if (mood !== undefined) patch.mood = Array.isArray(mood) ? mood.slice(0, 16).map((s) => String(s).slice(0, 40)) : []
    if (notes !== undefined) patch.notes = notes ? String(notes).slice(0, 2000) : ''
    if (bbt !== undefined) patch.bbt = (bbt === null) ? null : (Number.isFinite(bbt) ? bbt : (() => { throw new Error('invalid bbt') })())
    await putRow(ctx, groupId, dayKey(nd.key), { ...base0, ...patch, deleted: false })
    return { ok: true, date: nd.iso }
  },

  'day:get': async ({ date }, ctx) => {
    const nd = normDate(date)
    if (!nd) throw new Error('date must be YYYY-MM-DD')
    const base = viewFor(ctx, await privateGroupId(ctx))
    const row = await readRow(base, dayKey(nd.key))
    return (row && !row.deleted) ? row : null
  },

  // Newest first. Slice 1 returns all days; retention/paging is a later concern.
  'day:getAll': async (_args, ctx) => {
    const base = viewFor(ctx, await privateGroupId(ctx))
    await base.update()
    const out = []
    for await (const { value } of base.view.createReadStream(DAY_RANGE)) {
      if (value && !value.deleted) out.push(value)
    }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    return out
  },

  'day:delete': async ({ date }, ctx) => {
    const nd = normDate(date)
    if (!nd) throw new Error('date must be YYYY-MM-DD')
    const groupId = await privateGroupId(ctx)
    const base = viewFor(ctx, groupId)
    const existing = await readRow(base, dayKey(nd.key))
    if (!existing) throw new Error('day not found')
    await putRow(ctx, groupId, dayKey(nd.key), { ...existing, deleted: true })
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
    const groupId = await privateGroupId(ctx)
    const base = viewFor(ctx, groupId)
    const existing = await readRow(base, periodKey(ns.key))
    const base0 = (existing && !existing.deleted) ? existing : { start: ns.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
    await putRow(ctx, groupId, periodKey(ns.key), { ...base0, start: ns.iso, end: endIso, deleted: false })
    return { ok: true }
  },

  'period:getAll': async (_args, ctx) => {
    const base = viewFor(ctx, await privateGroupId(ctx))
    await base.update()
    const out = []
    for await (const { value } of base.view.createReadStream(PERIOD_RANGE)) {
      if (value && !value.deleted) out.push(value)
    }
    out.sort((a, b) => String(b.start).localeCompare(String(a.start)))
    return out
  },
}

module.exports = methods
