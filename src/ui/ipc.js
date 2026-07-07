// IPC bridge to the worklet, matching the suite's window.pear = { call, on }
// shape. In a real shell, ReactNativeWebView carries { id, method, args } to the
// worklet and the shell calls window.__pearResponse / window.__pearEvent back.
// In a plain browser (design/dev preview) we fall back to an in-memory mock that
// mirrors the worklet methods, so the screens are fully clickable without a phone.

const inShell = typeof window !== 'undefined' && !!window.ReactNativeWebView

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

function realCall (method, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
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
const mock = { base: null, days: new Map(), periods: new Map(), devices: new Map(), deviceLabel: 'This device' }

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
  'day:get': async ({ date }) => { const r = mock.days.get(date); return r && !r.deleted ? r : null },
  'day:getAll': async () => [...mock.days.values()].filter((d) => !d.deleted).sort((a, b) => b.date.localeCompare(a.date)),
  'day:delete': async ({ date }) => { const r = mock.days.get(date); if (!r) throw new Error('day not found'); r.deleted = true; return { ok: true } },
  'period:set': async ({ start, end }) => { mock.periods.set(start, { start, end: end || null, deleted: false }); return { ok: true } },
  'period:getAll': async () => [...mock.periods.values()].filter((p) => !p.deleted).sort((a, b) => b.start.localeCompare(a.start)),
  'shell:haptic': async () => ({ ok: true }),
  'shell:share': async ({ text }) => { try { if (navigator.share) await navigator.share({ text }); else alert('Share:\n\n' + text) } catch {} return { ok: true } },
  'shell:openUrl': async ({ url }) => { try { window.open(url, '_blank', 'noopener') } catch {} return { ok: true } },
  'shell:scanQr': async () => { const code = window.prompt ? window.prompt('Paste an invite code (camera scan on device):') : null; return { code: code || null } },
}

let seeded = false
function seedIfRequested () {
  if (seeded) return
  seeded = true
  if (typeof window === 'undefined') return
  if (!/(?:\?|&)seed/.test(window.location.search || '')) return
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

export const call = inShell ? realCall : mockCall
export const isMock = !inShell

if (typeof window !== 'undefined') window.pear = { call, on }
