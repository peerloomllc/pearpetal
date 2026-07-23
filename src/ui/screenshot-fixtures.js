// Screenshot-mode fixtures. Activated when the RN shell injects
// window.__PEARPETAL_SCREENSHOT_SCENE (a scene number) into the WebView HTML
// before this bundle runs. The shell derives that number from a launch deep
// link (pear://pearpetal/screenshot/<N>) or a Documents/screenshot-scene file,
// driven by the capture scripts (scripts/ios-screenshots.sh,
// scripts/android-screenshots.sh).
//
// PearPetal's UI imports a bound `call` from ipc.js, so the swap lives there:
// when a scene is set, ipc.js uses screenshotCall below instead of the real
// worklet bridge, and installScreenshotEnv() forces the light theme and freezes
// the clock so captures are pixel-deterministic. App.jsx applies SCREENSHOT_ROUTE
// after boot to open the right screen/sheet.
//
// Scenes (one deterministic owner, "Maya", frozen at 2026-07-06):
//   1  Cycle dial hero (fertile phase, blooming sakura, predictions)
//   2  Month calendar (period / fertile / ovulation coloring)
//   3  Sharing (scoped, consented partner share + QR)
//   4  Partner view (a read-only shared cycle)
//   5  Flower picker (five species)
//   6  Cycle settings (profile, goal, appearance, reminders)

const { projectionFromRows, pregnancyProjection } = require('../prediction.js')

// Frozen "today" - passed explicitly to the projection so it never reads a clock.
const TODAY = '2026-07-06'
const FROZEN_MS = new Date('2026-07-06T09:41:00Z').getTime()

const SELF = '00'.repeat(32) // this device: Maya
const OWNER = 'ab'.repeat(32) // the partner whose cycle Maya views (scene 4): Ada

// Opaque invite blob (rides in the URL fragment); long enough for a dense QR.
const INVITE = 'pp1KQZ4nR7xW2mB9tD6vY0aH3cJ8fL5gN1sU4pE7qO2iX6yA9zC3bV0dM8kT5wR2nG7hP4oD'

const PROFILE = { displayName: 'Maya', avatar: null, updatedAt: FROZEN_MS }

// Device-local prefs (feed the prediction + theme the dial).
const PREFS = {
  avgCycleLength: 28, avgPeriodLength: 5, lutealLength: 14,
  goal: 'track', flower: 'sakura', pregnancy: null, conditions: [], birthControl: false,
}

// Recent period spans -> ~28-day median, high confidence. Ordered newest first.
const PERIODS = [
  { start: '2026-06-25', end: '2026-06-29' },
  { start: '2026-05-28', end: '2026-06-01' },
  { start: '2026-04-30', end: '2026-05-04' },
  { start: '2026-04-02', end: '2026-04-06' },
]

// Day log: the last period's flow days + a couple of recent symptom days, so the
// day editor and (full-scope) partner summary have real content.
const DAYS = [
  { date: '2026-06-25', flow: 'heavy', symptoms: ['cramps', 'fatigue'] },
  { date: '2026-06-26', flow: 'heavy', symptoms: ['cramps'] },
  { date: '2026-06-27', flow: 'medium', symptoms: [] },
  { date: '2026-06-28', flow: 'light', symptoms: ['headache'] },
  { date: '2026-06-29', flow: 'spotting', symptoms: [] },
  { date: '2026-07-04', flow: null, symptoms: ['bloating'], mood: ['calm'] },
  { date: '2026-07-05', flow: null, symptoms: ['cramps', 'tender breasts'], mood: ['happy'], notes: 'Feeling good today.' },
].map((d) => ({ ...d, deleted: false, pubkey: SELF, updatedAt: FROZEN_MS }))

// One consistent prediction, computed by the real pure projection (frozen today).
const PROJ = projectionFromRows(DAYS, PERIODS, { prefs: PREFS, today: TODAY })
const PRED = { ...PROJ, goal: PREFS.goal, pregnancy: pregnancyProjection(PREFS, TODAY) }

// Whitelisted symptom tags for the full-scope partner summary (recent days only).
const SUMMARY = DAYS
  .filter((d) => d.date >= '2026-06-25')
  .slice(-8)
  .map((d) => ({ date: d.date, flow: !!d.flow, symptomTags: (d.symptoms || []).filter((s) => ['cramps', 'headache', 'fatigue', 'bloating'].includes(s)) }))

// An outgoing share (scene 3) and the partner Maya views (scene 4).
const SHARES = [
  { groupId: 'sh1', scope: 'full', createdAt: FROZEN_MS - 3 * 86400000, inviteKey: INVITE, revoked: false, joiners: [{ name: 'Sam' }] },
]
const PARTNER_VIEW = {
  scope: 'full', ownerPubkey: OWNER, ownerName: 'Ada', ownerAvatar: null,
  phase: { phase: PRED.phase, dayOfCycle: PRED.dayOfCycle },
  predict: { nextPeriodStart: PRED.nextPeriodStart, fertileStart: PRED.fertileStart, fertileEnd: PRED.fertileEnd, ovulationEst: PRED.ovulationEst },
  summary: SUMMARY, revoked: false, revokedAt: null,
}

const NOTIF = { enabled: true, discreet: false, period: true, fertility: true, time: '09:00', osGranted: true, permissionDenied: false }

// Per-scene routing the UI applies after boot (see App.jsx).
const ROUTES = {
  1: {},
  2: { view: 'calendar' },
  3: { screen: 'share' },
  4: { partner: 'demo' },
  5: { sheet: 'flower' },
  6: { screen: 'settings' },
}

const P = (v) => Promise.resolve(v)
const clone = (v) => JSON.parse(JSON.stringify(v))

// Deterministic replacement for ipc.js's real bridge. Read methods return canned
// data; mutations/shell calls are inert (resolve to a benign value).
function screenshotCall (method, args = {}) {
  switch (method) {
    case 'cycle:status': return P({ hasBase: true, groupId: 'me', pubkey: SELF })
    case 'cycle:prediction': return P(clone(PRED))
    case 'prefs:get': return P({ ...PREFS })
    case 'profile:get': return P({ ...PROFILE })
    case 'day:getAll': return P(clone(DAYS).sort((a, b) => b.date.localeCompare(a.date)))
    case 'day:get': return P(clone(DAYS.find((d) => d.date === args.date) || null))
    case 'period:getAll': return P(clone(PERIODS))
    case 'device:getAll': return P([{ pubkey: SELF, label: 'This phone', self: true }])
    case 'device:publish': return P({ ok: true })
    case 'share:list': return P(clone(SHARES))
    case 'partner:list': return P([])
    case 'partner:view': return P(clone(PARTNER_VIEW))
    case 'notifications:get':
    case 'shell:notifications:get': return P({ ...NOTIF })
    // Deliberately reported as "no relay in this build" so the Settings
    // connection card stays out of the store screenshots and the existing
    // frozen scenes keep their layout.
    case 'network:get': return P({ useRelay: true, relayConfigured: false, relayKey: null, updatedAt: 0 })
    case 'donation:status': return P({ due: false, shown: true, firstUseAt: FROZEN_MS })
    case 'shell:navState':
    case 'shell:theme': return P({ ok: true })
    default: return P(null)
  }
}

// Freeze Date so any relative-time rendering is deterministic across runs.
function freezeDate () {
  const OrigDate = window.Date
  const FrozenDate = function (...a) { return a.length === 0 ? new OrigDate(FROZEN_MS) : new OrigDate(...a) }
  FrozenDate.now = () => FROZEN_MS
  FrozenDate.parse = OrigDate.parse
  FrozenDate.UTC = OrigDate.UTC
  FrozenDate.prototype = OrigDate.prototype
  window.Date = FrozenDate
}

export const SCREENSHOT_SCENE =
  (typeof window !== 'undefined' && Number.isInteger(window.__PEARPETAL_SCREENSHOT_SCENE))
    ? window.__PEARPETAL_SCREENSHOT_SCENE
    : null

export const SCREENSHOT_ROUTE = SCREENSHOT_SCENE != null ? (ROUTES[SCREENSHOT_SCENE] || {}) : null

export { screenshotCall }

// Prepare a clean capture: force the light theme (the pale-flower palette was
// tuned for white) and freeze the clock. Called once by ipc.js at import when a
// scene is active.
export function installScreenshotEnv () {
  try { window.localStorage.setItem('pearpetal:theme', 'light') } catch {}
  // Each scene cold-launches sharing one WebView localStorage, so reset the
  // dial/calendar toggle to 'dial' - otherwise scene 2 (calendar) leaks its
  // view into later scenes' backgrounds. Scene 2's route re-selects calendar.
  try { window.localStorage.setItem('pearpetal:cycleView', 'dial') } catch {}
  freezeDate()
}
