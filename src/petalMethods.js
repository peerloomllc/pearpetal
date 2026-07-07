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

const { deviceKey, dayKey, periodKey, phaseKey, predictKey, summaryKey, DEVICE_RANGE, DAY_RANGE, PERIOD_RANGE, SUMMARY_RANGE } = require('./petalWire')
const { projectionFromRows, addDays, diffDays, todayIso, FLOW_VALUES } = require('./prediction')

// Consent scopes (see DECISIONS.md 2026-07-06). Each governs which projection
// fields the OWNER writes to a shared base; the partner structurally never
// receives more than this because the owner never writes it.
const SCOPES = new Set(['phase', 'fertility', 'full'])
// The ONLY symptom tags projected into a `full`-scope summary. Coarse and
// non-clinical; the auditable redaction boundary. Notes / BBT / intimacy and any
// off-list tag are never projected.
const SUMMARY_TAGS = new Set(['cramps', 'headache', 'fatigue', 'bloating', 'tender-breasts', 'nausea', 'backache', 'acne', 'mood-low', 'mood-irritable', 'energy-high', 'libido-high'])
const SUMMARY_WINDOW_DAYS = 21 // how many recent days a `full` share projects

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
async function computeProjection (ctx) {
  const base = viewFor(ctx, await privateGroupId(ctx))
  await base.update()
  const dayRows = []
  for await (const { value } of base.view.createReadStream(DAY_RANGE)) if (value && !value.deleted) dayRows.push(value)
  const periodRows = []
  for await (const { value } of base.view.createReadStream(PERIOD_RANGE)) if (value && !value.deleted) periodRows.push(value)
  return { proj: projectionFromRows(dayRows, periodRows), dayRows }
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
  const shares = await membershipsByKind(ctx, 'shared-out')
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
    const m = await privateMembership(ctx)
    return { hasBase: !!m, groupId: m?.groupId ?? null, pubkey: pubkeyHex(ctx) }
  },

  // Start tracking: create the private base (idempotent - returns the existing
  // one if this device already has a cycle). Own devices later link into it.
  'cycle:create': async (_args, ctx) => {
    const existing = await privateMembership(ctx)
    if (existing) return { groupId: existing.groupId, inviteKey: reencodeInvite(existing), created: false }
    const r = await ctx.createGroup({ name: 'PearPetal' })
    await tagKind(ctx, r.groupId, 'private')
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
    await tagKind(ctx, r.groupId, 'private')
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
    await refreshShares(ctx).catch(() => {}) // keep any partner projections current
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
    const groupId = await privateGroupId(ctx)
    const base = viewFor(ctx, groupId)
    const existing = await readRow(base, periodKey(ns.key))
    const base0 = (existing && !existing.deleted) ? existing : { start: ns.iso, createdBy: pubkeyHex(ctx), createdAt: Date.now() }
    await putRow(ctx, groupId, periodKey(ns.key), { ...base0, start: ns.iso, end: endIso, deleted: false })
    await refreshShares(ctx).catch(() => {})
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

  // --- partner sharing: OWNER side ---------------------------------------
  // Create a new shared base for a partner at a chosen consent scope, seed it
  // with share:meta + the current projection, and return the share invite. The
  // invite grants ONLY this shared base - never the private base or its key.
  'share:create': async ({ scope }, ctx) => {
    if (!SCOPES.has(scope)) throw new Error('scope must be phase, fertility, or full')
    if (!(await privateMembership(ctx))) throw new Error('start tracking on this device first')
    const r = await ctx.createGroup({ name: 'PearPetal share' })
    const rec = (await ctx.localDb.get('groups:joined:' + r.groupId))?.value || {}
    await ctx.localDb.put('groups:joined:' + r.groupId, { ...rec, kind: 'shared-out', scope })
    // Claim ownership of the shared base (owner-write-only enforcement keys off this).
    await putRow(ctx, r.groupId, 'share:meta', { ownerPubkey: pubkeyHex(ctx), scope, createdAt: Date.now() })
    const { proj, dayRows } = await computeProjection(ctx)
    await writeProjection(ctx, r.groupId, scope, proj, dayRows)
    return { groupId: r.groupId, inviteKey: r.inviteKey, scope }
  },

  'share:list': async (_args, ctx) => {
    const out = []
    for (const m of await membershipsByKind(ctx, 'shared-out')) {
      out.push({ groupId: m.groupId, scope: m.scope || 'phase', inviteKey: reencodeInvite(m), createdAt: m.joinedAt || 0 })
    }
    out.sort((a, b) => a.createdAt - b.createdAt)
    return out
  },

  // Revoke a share: stop announcing/replicating that base and forget it. Forward-
  // only - it cannot unsend the projection blocks the partner already replicated
  // (a P2P invariant; the UI states this).
  'share:revoke': async ({ groupId }, ctx) => {
    const m = (await membershipsByKind(ctx, 'shared-out')).find((x) => x.groupId === groupId)
    if (!m) throw new Error('share not found')
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
    const r = await ctx.joinGroup({ inviteKey: inviteKey.trim() })
    await tagKind(ctx, r.groupId, 'shared-in')
    return { groupId: r.groupId }
  },

  'partner:list': async (_args, ctx) => {
    const out = []
    for (const m of await membershipsByKind(ctx, 'shared-in')) {
      const base = ctx.bases.get(m.groupId)
      let meta = null
      if (base) { try { await base.update(); meta = (await base.view.get('share:meta'))?.value } catch {} }
      out.push({ groupId: m.groupId, ownerPubkey: meta?.ownerPubkey || null, scope: meta?.scope || null, joinedAt: m.joinedAt || 0 })
    }
    out.sort((a, b) => a.joinedAt - b.joinedAt)
    return out
  },

  // Read the scoped projection a partner has shared with us.
  'partner:view': async ({ groupId }, ctx) => {
    const m = (await membershipsByKind(ctx, 'shared-in')).find((x) => x.groupId === groupId)
    if (!m) throw new Error('partner share not found')
    const base = viewFor(ctx, groupId)
    await base.update()
    const meta = (await base.view.get('share:meta'))?.value || null
    const phase = (await base.view.get(phaseKey()))?.value || null
    const predict = (await base.view.get(predictKey()))?.value || null
    const summary = []
    for await (const { value } of base.view.createReadStream(SUMMARY_RANGE)) if (value) summary.push(value)
    summary.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    return { scope: meta?.scope || null, ownerPubkey: meta?.ownerPubkey || null, phase, predict, summary }
  },

  'partner:leave': async ({ groupId }, ctx) => {
    await ctx.localDb.del('groups:joined:' + groupId).catch(() => {})
    await ctx.destroyGroup(groupId).catch(() => {})
    return { ok: true }
  },
}

module.exports = methods
