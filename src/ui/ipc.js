// IPC bridge to the worklet, matching the suite's window.pear = { call, on }
// shape. In a real shell, ReactNativeWebView carries { id, method, args } to the
// worklet and the shell calls window.__pearResponse / window.__pearEvent back.
// In a plain browser (design/dev preview) we fall back to an in-memory mock that
// mirrors the worklet methods, so the screens are fully clickable without a phone.

import { SCREENSHOT_SCENE, screenshotCall, installScreenshotEnv } from './screenshot-fixtures.js'

const inShell = typeof window !== 'undefined' && !!window.ReactNativeWebView

// Screenshot mode: the shell injected a scene number, so drive the UI from
// deterministic fixtures instead of the worklet (or the browser mock), and force
// the light theme + a frozen clock before anything renders.
if (SCREENSHOT_SCENE != null) installScreenshotEnv()

const pending = new Map()
let nextId = 1
const listeners = new Map()
const earlyEvents = []

if (typeof window !== 'undefined') {
  window.__pearResponse = (msg) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  }
  window.__pearEvent = (name, data) => {
    const set = listeners.get(name)
    if (set && set.size) { for (const fn of set) { try { fn(data) } catch {} } }
    else earlyEvents.push([name, data])
  }
}

// Methods that change the on-device prediction. After one lands, ask the shell to
// re-arm the scheduled cycle reminders so they track the fresh projection without
// waiting for the next app foreground (a no-op unless notifications are on).
const RESCHEDULE_AFTER = new Set(['day:set', 'period:log', 'prefs:set', 'import:data', 'cycle:create', 'link:join'])
let _resyncTimer = null
function scheduleNotifResync () {
  if (_resyncTimer) return
  _resyncTimer = setTimeout(() => { _resyncTimer = null; realCall('shell:notifications:sync', {}).catch(() => {}) }, 400)
}

function realCall (method, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve: (r) => { if (RESCHEDULE_AFTER.has(method)) scheduleNotifResync(); resolve(r) }, reject })
    window.ReactNativeWebView.postMessage(JSON.stringify({ id, method, args: args || {} }))
  })
}

export function on (event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(fn)
  for (let i = earlyEvents.length - 1; i >= 0; i--) {
    if (earlyEvents[i][0] === event) { const [, data] = earlyEvents.splice(i, 1)[0]; try { fn(data) } catch {} }
  }
  return () => listeners.get(event)?.delete(fn)
}

export function haptic (kind = 'light') {
  try { const p = call('shell:haptic', { kind }); if (p && p.catch) p.catch(() => {}) } catch {}
}

// --- browser mock ---------------------------------------------------------
// A minimal in-memory model of the private base so the UI is fully clickable in
// a browser preview. index.html?seed lands on a populated log.
const rid = (n = 22) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const MOCK_SELF = 'ab'.repeat(32)
const mock = { base: null, days: new Map(), periods: new Map(), devices: new Map(), deviceLabel: 'This device', shares: new Map(), partners: new Map(), prefs: null, notif: { enabled: false, discreet: false, period: true, fertility: true, time: '09:00' }, network: { useRelay: true } }
const mockProjection = () => {
  const starts = [...mock.periods.keys(), ...[...mock.days.values()].filter((d) => ['light', 'medium', 'heavy'].includes(d.flow)).map((d) => d.date)].sort()
  if (!starts.length) return { known: false, phase: 'follicular' }
  const last = starts[starts.length - 1]
  const next = new Date(new Date(last + 'T00:00:00Z').getTime() + 28 * 86400000).toISOString().slice(0, 10)
  const ov = new Date(new Date(next + 'T00:00:00Z').getTime() - 14 * 86400000).toISOString().slice(0, 10)
  const fs = new Date(new Date(ov + 'T00:00:00Z').getTime() - 5 * 86400000).toISOString().slice(0, 10)
  const fe = new Date(new Date(ov + 'T00:00:00Z').getTime() + 1 * 86400000).toISOString().slice(0, 10)
  return { known: true, phase: 'follicular', dayOfCycle: 6, nextPeriodStart: next, ovulationEst: ov, fertileStart: fs, fertileEnd: fe }
}

function ensureSelfDevice () { mock.devices.set(MOCK_SELF, { pubkey: MOCK_SELF, label: mock.deviceLabel, self: true }) }

const mockMethods = {
  init: async () => ({ ok: true }),
  'identity:get': async () => ({ pubkey: MOCK_SELF }),
  'cycle:status': async () => ({ hasBase: !!mock.base, groupId: mock.base?.groupId ?? null, pubkey: MOCK_SELF }),
  'cycle:create': async () => {
    if (!mock.base) { mock.base = { groupId: rid(), inviteKey: 'mock-' + rid(12) }; ensureSelfDevice() }
    return { groupId: mock.base.groupId, inviteKey: mock.base.inviteKey, created: true }
  },
  'link:invite': async () => { if (!mock.base) throw new Error('start tracking first'); return { inviteKey: mock.base.inviteKey } },
  'link:join': async ({ inviteKey }) => {
    if (!inviteKey) throw new Error('inviteKey required')
    if (mock.base) throw new Error('this device is already tracking a cycle')
    mock.base = { groupId: rid(), inviteKey }; ensureSelfDevice()
    return { groupId: mock.base.groupId, writable: true }
  },
  'device:setLabel': async ({ label }) => { if (!label || !label.trim()) throw new Error('label required'); mock.deviceLabel = label.trim().slice(0, 64); ensureSelfDevice(); return { label: mock.deviceLabel } },
  'device:publish': async () => ({ published: true }),
  'device:getAll': async () => [...mock.devices.values()],
  'day:set': async ({ date, flow, symptoms, mood, notes, bbt }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('date must be YYYY-MM-DD')
    const cur = mock.days.get(date) || { date, createdBy: MOCK_SELF }
    const next = { ...cur }
    if (flow !== undefined) next.flow = flow
    if (symptoms !== undefined) next.symptoms = symptoms
    if (mood !== undefined) next.mood = mood
    if (notes !== undefined) next.notes = notes
    if (bbt !== undefined) next.bbt = bbt
    next.deleted = false; next.pubkey = MOCK_SELF; next.updatedAt = Date.now()
    mock.days.set(date, next)
    return { ok: true, date }
  },
  'cycle:prediction': async () => {
    const pr = mockProjection()
    if (!pr.known) return { known: false, phase: null, confidence: 'none' }
    const today = new Date().toISOString().slice(0, 10)
    return { known: true, phase: pr.phase, dayOfCycle: pr.dayOfCycle, cycleLen: 28, nextPeriodStart: pr.nextPeriodStart, daysUntilNextPeriod: Math.round((new Date(pr.nextPeriodStart) - new Date(today)) / 86400000), ovulationEst: pr.ovulationEst, ovulationSource: 'calendar', fertileStart: pr.fertileStart, fertileEnd: pr.fertileEnd, confidence: 'medium' }
  },
  'prefs:get': async () => ({ avgCycleLength: mock.prefs?.avgCycleLength ?? null, avgPeriodLength: mock.prefs?.avgPeriodLength ?? null, lutealLength: mock.prefs?.lutealLength ?? null, goal: mock.prefs?.goal || 'track', flower: mock.prefs?.flower || 'rose' }),
  'prefs:set': async (patch) => { mock.prefs = { ...(mock.prefs || {}), ...patch }; return { ok: true } },
  'profile:get': async () => ({ displayName: mock.profile?.displayName || '', avatar: mock.profile?.avatar || null }),
  'profile:set': async ({ displayName, avatar }) => { mock.profile = { displayName: displayName || '', avatar: avatar === undefined ? (mock.profile?.avatar || null) : avatar }; return mock.profile },
  'day:get': async ({ date }) => { const r = mock.days.get(date); return r && !r.deleted ? r : null },
  'day:getAll': async () => [...mock.days.values()].filter((d) => !d.deleted).sort((a, b) => b.date.localeCompare(a.date)),
  'day:delete': async ({ date }) => { const r = mock.days.get(date); if (!r) throw new Error('day not found'); r.deleted = true; return { ok: true } },
  'period:set': async ({ start, end }) => { mock.periods.set(start, { start, end: end || null, deleted: false }); return { ok: true } },
  'period:log': async ({ start, end }) => {
    const today = new Date().toISOString().slice(0, 10)
    const ongoing = !end
    const endIso = ongoing ? (today > start ? today : start) : end
    mock.periods.set(start, { start, end: ongoing ? null : endIso, deleted: false })
    let marked = 0; let d = start
    for (let i = 0; i < 15 && d <= endIso && d <= today; i++) {
      const ex = mock.days.get(d)
      if (!(ex && !ex.deleted && ['spotting', 'light', 'medium', 'heavy'].includes(ex.flow))) {
        mock.days.set(d, { ...(ex || {}), date: d, flow: 'medium', deleted: false, pubkey: MOCK_SELF, updatedAt: Date.now() }); marked++
      }
      d = new Date(new Date(d + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
    }
    return { ok: true, start, end: endIso, marked }
  },
  'period:getAll': async () => [...mock.periods.values()].filter((p) => !p.deleted).sort((a, b) => b.start.localeCompare(a.start)),
  'export:data': async () => {
    const days = [...mock.days.values()].filter((d) => !d.deleted).map((d) => { const o = { date: d.date }; if (d.flow !== undefined) o.flow = d.flow; if (d.symptoms && d.symptoms.length) o.symptoms = d.symptoms; if (d.mood && d.mood.length) o.mood = d.mood; if (d.notes) o.notes = d.notes; if (typeof d.bbt === 'number') o.bbt = d.bbt; return o })
    const periods = [...mock.periods.values()].filter((p) => !p.deleted).map((p) => ({ start: p.start, end: p.end ?? null }))
    const p = mock.prefs || {}; const prefs = {};['avgCycleLength', 'avgPeriodLength', 'lutealLength', 'goal', 'flower'].forEach((k) => { if (p[k] != null) prefs[k] = p[k] })
    return { app: 'pearpetal', version: 1, exportedAt: Date.now(), days, periods, prefs }
  },
  'import:data': async ({ data }) => {
    if (!data || data.app !== 'pearpetal' || !Array.isArray(data.days)) throw new Error('not a PearPetal export')
    if (!mock.base) { mock.base = { groupId: rid(), inviteKey: 'mock-' + rid(8) }; ensureSelfDevice() }
    let dc = 0; let pc = 0
    for (const d of data.days) { if (!/^\d{4}-\d{2}-\d{2}$/.test((d && d.date) || '')) continue; mock.days.set(d.date, { ...d, deleted: false, pubkey: MOCK_SELF, updatedAt: Date.now() }); dc++ }
    for (const p of (data.periods || [])) { if (!p || !p.start) continue; mock.periods.set(p.start, { start: p.start, end: p.end || null, deleted: false }); pc++ }
    if (data.prefs) mock.prefs = { ...(mock.prefs || {}), ...data.prefs }
    return { ok: true, days: dc, periods: pc }
  },
  'share:create': async ({ scope }) => {
    if (!['phase', 'fertility', 'full'].includes(scope)) throw new Error('bad scope')
    const groupId = rid(); const inviteKey = 'mock-share-' + scope + '-' + rid(8)
    mock.shares.set(groupId, { groupId, scope, inviteKey, createdAt: Date.now() })
    return { groupId, inviteKey, scope }
  },
  'share:list': async () => [...mock.shares.values()].map((s) => ({ ...s, joiners: s.joiners || [], revoked: !!s.revoked, revokedAt: s.revokedAt || null })).sort((a, b) => a.createdAt - b.createdAt),
  'member:publish': async () => ({ published: 0 }),
  // Soft-close: flag revoked (keep the row) so the "Sharing ended" UI renders.
  'share:revoke': async ({ groupId }) => { const s = mock.shares.get(groupId); if (s) { s.revoked = true; s.revokedAt = Date.now() } return { ok: true, revoked: true } },
  'share:remove': async ({ groupId }) => { mock.shares.delete(groupId); return { ok: true } },
  'share:connected': async () => ({ connected: false }), // no real peers in the browser preview
  'partner:join': async ({ inviteKey }) => {
    if (!inviteKey) throw new Error('inviteKey required')
    const m = /mock-share-(phase|fertility|full)/.exec(inviteKey)
    const scope = m ? m[1] : 'phase'
    const groupId = rid()
    mock.partners.set(groupId, { groupId, scope, ownerPubkey: 'cd'.repeat(32), joinedAt: Date.now() })
    return { groupId }
  },
  'partner:list': async () => [...mock.partners.values()].map((p) => ({ ...p, revoked: !!p.revoked, revokedAt: p.revokedAt || null })).sort((a, b) => a.joinedAt - b.joinedAt),
  'partner:view': async ({ groupId }) => {
    const p = mock.partners.get(groupId); if (!p) throw new Error('not found')
    const proj = mockProjection()
    const phase = { phase: proj.phase, dayOfCycle: proj.dayOfCycle || 6 }
    let predict = null
    if (proj.known) { predict = { nextPeriodStart: proj.nextPeriodStart }; if (p.scope !== 'phase') { predict.fertileStart = proj.fertileStart; predict.fertileEnd = proj.fertileEnd; predict.ovulationEst = proj.ovulationEst } }
    const summary = p.scope === 'full' ? [...mock.days.values()].filter((d) => !d.deleted).slice(0, 8).map((d) => ({ date: d.date, flow: !!d.flow, symptomTags: (d.symptoms || []).filter((s) => ['cramps', 'headache', 'fatigue', 'bloating'].includes(s)) })) : []
    return { scope: p.scope, ownerPubkey: p.ownerPubkey, phase, predict, summary, revoked: !!p.revoked, revokedAt: p.revokedAt || null }
  },
  'partner:leave': async ({ groupId }) => { mock.partners.delete(groupId); return { ok: true } },
  'shell:haptic': async () => ({ ok: true }),
  'shell:share': async ({ text }) => { try { if (navigator.share) await navigator.share({ text }); else alert('Share:\n\n' + text) } catch {} return { ok: true } },
  'shell:openUrl': async ({ url }) => { try { window.open(url, '_blank', 'noopener') } catch {} return { ok: true } },
  // Notifications are inert in the browser preview; keep the prefs so the Settings
  // card is fully clickable (on device the shell owns scheduling + OS permission).
  // The off-LAN relay toggle. `relayConfigured` is true in the mock so the
  // Settings card is visible in a browser preview.
  'network:get': async () => ({ ...mock.network, relayConfigured: true, relayKey: 'mock-relay-key' }),
  'network:set': async (patch) => { mock.network = { ...mock.network, ...patch }; return { ...mock.network, relayConfigured: true, relayKey: 'mock-relay-key' } },
  'network:stats': async () => ({
    useRelay: mock.network.useRelay !== false, relayConfigured: true, randomizedNat: false,
    policy: { dials: 4, direct: 3, offered: 1, suppressed: 0 },
    relaying: { attempts: 1, successes: 1, aborts: 0 },
    punches: { consistent: 2, random: 0, open: 1 },
    connections: 1,
    connects: { client: { opened: 3, closed: 2, attempted: 4 }, server: { opened: 1, closed: 0 } },
  }),
  'shell:notifications:get': async () => ({ ...mock.notif, osGranted: true }),
  'shell:notifications:set': async (patch) => { mock.notif = { ...mock.notif, ...patch }; return { ...mock.notif, osGranted: true, permissionDenied: false } },
  'shell:notifications:sync': async () => ({ ok: true }),
}

let seeded = false
function seedIfRequested () {
  if (seeded) return
  seeded = true
  if (typeof window === 'undefined') return
  if (!/(?:\?|&)seed/.test(window.location.search || '')) return
  // ?seed=viewer: land as a partner (no own cycle) with one shared cycle, to
  // preview viewer mode (Shared / Settings / About shell).
  if (/(?:\?|&)seed=viewer/.test(window.location.search || '')) {
    const gid = rid() // map key must equal groupId (partner:view looks up by key)
    mock.partners.set(gid, { groupId: gid, scope: 'full', ownerPubkey: 'cd'.repeat(32), ownerName: 'Ada', joinedAt: Date.now() })
    return
  }
  mock.base = { groupId: rid(), inviteKey: 'mock-seed' }
  ensureSelfDevice()
  mock.devices.set('cd'.repeat(32), { pubkey: 'cd'.repeat(32), label: 'Tablet', self: false })
  const day = (date, flow, symptoms = []) => mock.days.set(date, { date, flow, symptoms, createdBy: MOCK_SELF, pubkey: MOCK_SELF, updatedAt: Date.now(), deleted: false })
  day('2026-07-06', 'medium', ['cramps'])
  day('2026-07-05', 'heavy', ['cramps', 'fatigue'])
  day('2026-07-04', 'light', ['headache'])
  day('2026-07-03', 'spotting', [])
  mock.periods.set('2026-07-03', { start: '2026-07-03', end: null, deleted: false })
}

async function mockCall (method, args) {
  seedIfRequested()
  const fn = mockMethods[method]
  if (!fn) throw new Error('unknown method: ' + method)
  return fn(args || {})
}

export const call = SCREENSHOT_SCENE != null ? screenshotCall : (inShell ? realCall : mockCall)
export const isMock = !inShell

if (typeof window !== 'undefined') window.pear = { call, on }
