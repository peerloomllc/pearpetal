// A backup must restore everything it was told it saved.
//
// Regression, 2026-09-09. `export:data` wrote five prefs and no profile, and
// `import:data` carried a SECOND, shorter whitelist of its own. So moving to a new
// phone silently dropped the health context the projection is widened by, and
// switched pregnancy mode off: goal `pregnant` -> `track`, pregnancy dates -> null,
// conditions -> [], birthControl -> false, display name -> "". Days and periods
// survived, so nothing looked wrong. Both paths now share one whitelist
// (applyPrefsPatch / BACKUP_PREFS), which is what stops the two drifting again.

const test = require('node:test')
const { before } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')
const { _setDeviceLinkEnabledForTest } = require('../src/deviceLink')

before(() => _setDeviceLinkEnabledForTest(false))

const _tmpDirs = []
function driver () {
  const responses = []
  const read = new EventEmitter()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-bak-'))
  _tmpDirs.push(dir)
  const engine = createGroupEngine({
    appId: 'pearpetal',
    corestore: new Corestore(dir),
    createSwarm: () => {
      const ee = new EventEmitter()
      ee.join = () => ({ flushed: async () => {} }); ee.leave = () => {}; ee.destroy = async () => {}
      return ee
    },
    applyOps: applyPetalOp,
    methods: petalMethods,
  })
  engine.start({ read, write: (buf) => responses.push(JSON.parse(buf.toString())) })
  let nextId = 1
  const call = async (method, args) => {
    const id = nextId++
    read.emit('data', Buffer.from(JSON.stringify({ id, method, args }) + '\n'))
    for (let i = 0; i < 400; i++) {
      const r = responses.find((x) => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise((res) => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call }
}
function cleanup () { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } }

// A 1x1 PNG, as the UI hands one over.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function seedPhone (call) {
  await call('init', {})
  await call('cycle:create', {})
  await call('day:set', { date: '2026-08-01', flow: 'medium', symptoms: ['cramps'], mood: ['calm'], notes: 'ouch', bbt: 36.4 })
  await call('day:set', { date: '2026-08-02', flow: 'light' })
  await call('period:log', { start: '2026-08-01', end: '2026-08-04' })
  await call('prefs:set', {
    avgCycleLength: 30, avgPeriodLength: 6, lutealLength: 13,
    goal: 'pregnant', flower: 'lotus',
    conditions: ['pcos', 'thyroid'], birthControl: true,
    pregnancy: { lmp: '2026-05-01', dueDate: '2027-02-05' },
  })
  await call('profile:set', { displayName: 'Ada', avatar: TINY_PNG })
}

test('every pref the app can set survives a backup and restore', async (t) => {
  const A = driver(); const B = driver()
  t.after(async () => { for (const e of [A, B]) { try { await e.engine.close() } catch {} } cleanup() })

  await seedPhone(A.call)
  const before = await A.call('prefs:get', {})
  const backup = await A.call('export:data', {})

  await B.call('init', {})
  await B.call('import:data', { data: backup })
  const after = await B.call('prefs:get', {})

  assert.deepEqual(after, before, 'prefs must round trip unchanged')
  // Named explicitly, so the ones that were actually lost cannot regress quietly.
  assert.equal(after.goal, 'pregnant')
  assert.deepEqual(after.pregnancy, { lmp: '2026-05-01', dueDate: '2027-02-05' })
  assert.deepEqual(after.conditions, ['pcos', 'thyroid'])
  assert.equal(after.birthControl, true)
})

test('the profile survives a backup and restore', async (t) => {
  const A = driver(); const B = driver()
  t.after(async () => { for (const e of [A, B]) { try { await e.engine.close() } catch {} } cleanup() })

  await seedPhone(A.call)
  const backup = await A.call('export:data', {})
  await B.call('init', {})
  const r = await B.call('import:data', { data: backup })
  assert.equal(r.profile !== false, true, 'import reports it restored a profile')

  const prof = await B.call('profile:get', {})
  assert.equal(prof.displayName, 'Ada')
  assert.equal(prof.avatar, TINY_PNG, 'the avatar bytes travel, not a blob reference the new phone cannot resolve')
})

test('the cycle log itself still round trips', async (t) => {
  const A = driver(); const B = driver()
  t.after(async () => { for (const e of [A, B]) { try { await e.engine.close() } catch {} } cleanup() })

  await seedPhone(A.call)
  const backup = await A.call('export:data', {})
  await B.call('init', {})
  await B.call('import:data', { data: backup })

  const days = await B.call('day:getAll', {})
  const first = days.find((d) => d.date === '2026-08-01')
  assert.ok(first, 'the logged day came back')
  assert.equal(first.flow, 'medium')
  assert.deepEqual(first.symptoms, ['cramps'])
  assert.equal(first.notes, 'ouch')
  assert.equal(first.bbt, 36.4)
  const periods = await B.call('period:getAll', {})
  assert.equal(periods.some((p) => p.start === '2026-08-01'), true)
})

test('an encrypted backup round trips the same way', async (t) => {
  const A = driver(); const B = driver()
  t.after(async () => { for (const e of [A, B]) { try { await e.engine.close() } catch {} } cleanup() })

  await seedPhone(A.call)
  const before = await A.call('prefs:get', {})
  const sealed = await A.call('export:data', { password: 'correct horse battery staple' })
  assert.ok(sealed.enc, 'the payload is sealed')

  await B.call('init', {})
  await B.call('import:data', { data: sealed, password: 'correct horse battery staple' })
  assert.deepEqual(await B.call('prefs:get', {}), before)
  assert.equal((await B.call('profile:get', {})).displayName, 'Ada')
})

test('BACKUP_PREFS covers every pref prefs:get reports, so nothing added later is dropped', async (t) => {
  // The guard against this bug coming back: a new pref added to applyPrefsPatch and
  // surfaced by prefs:get, but forgotten in BACKUP_PREFS, fails here rather than
  // quietly vanishing on somebody's new phone.
  const A = driver()
  t.after(async () => { try { await A.engine.close() } catch {} cleanup() })
  await seedPhone(A.call)
  const reported = Object.keys(await A.call('prefs:get', {}))
  const backup = await A.call('export:data', {})
  const carried = new Set(Object.keys(backup.prefs))
  const missing = reported.filter((k) => !carried.has(k))
  assert.deepEqual(missing, [], 'these prefs are shown to the user but not backed up')
})
