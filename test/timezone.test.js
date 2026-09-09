// "Today" must be the date on the phone's own wall clock, not UTC.
//
// Regression, 2026-09-09. src/ui/App.jsx read the LOCAL date and
// src/prediction.js read the UTC one, so the two disagreed for part of every day
// anywhere but UTC. East of UTC that made logging a period between local midnight
// and mid-morning fail with "start is in the future" - a core action, refused, for
// every user in Japan, Korea, China, Australia and New Zealand every morning.

const test = require('node:test')
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

const _tmpDirs = []
function driver () {
  const responses = []
  const read = new EventEmitter()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-tz-'))
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
    for (let i = 0; i < 300; i++) {
      const r = responses.find((x) => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise((res) => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call }
}

// Exactly what src/ui/App.jsx computes: the local calendar date.
const pad2 = (n) => String(n).padStart(2, '0')
const uiToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

// Etc/GMT-14 and Etc/GMT+11 are the extremes of the inhabited range, and their
// signs are inverted by POSIX convention: GMT-14 is UTC+14. Whatever the machine
// running the tests is set to, one of these is a different calendar day from UTC.
const ZONES = ['Etc/GMT-14', 'Etc/GMT-9', 'UTC', 'Etc/GMT+6', 'Etc/GMT+11']

test('the worklet and the screen agree on what day it is, in every timezone', () => {
  const original = process.env.TZ
  try {
    for (const tz of ZONES) {
      process.env.TZ = tz
      // Required fresh per zone: the module caches nothing, but the clock read
      // must happen after TZ is set.
      const { todayIso } = require('../src/prediction')
      assert.equal(todayIso(), uiToday(), `worklet and UI disagree in ${tz}`)
    }
  } finally { process.env.TZ = original }
})

test('a period can be logged today from every timezone', async (t) => {
  _setDeviceLinkEnabledForTest(false)
  const original = process.env.TZ
  t.after(() => {
    process.env.TZ = original
    for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }
  })

  for (const tz of ZONES) {
    process.env.TZ = tz
    const { engine, call } = driver()
    await call('init', {})
    await call('cycle:create', {})
    const today = uiToday()
    // No `today` argument: this is the worklet deciding for itself, which is the
    // path the shell's own notification resync takes.
    const r = await call('period:log', { start: today })
    assert.equal(r.ok, true, `period:log refused today in ${tz}`)
    assert.equal(r.start, today)
    // And with the UI stating the day, which is what the app actually sends.
    const r2 = await call('period:log', { start: today, today })
    assert.equal(r2.ok, true, `period:log refused a UI-dated today in ${tz}`)
    await engine.close()
  }
})

test('an ongoing period never marks a day that has not happened yet', async (t) => {
  _setDeviceLinkEnabledForTest(false)
  const original = process.env.TZ
  t.after(() => { process.env.TZ = original })
  process.env.TZ = 'Etc/GMT+11' // UTC-11: local "today" is behind UTC's
  const { engine, call } = driver()
  t.after(async () => { try { await engine.close() } catch {} })
  await call('init', {})
  await call('cycle:create', {})
  const today = uiToday()
  await call('period:log', { start: today, today })
  const days = await call('day:getAll', {})
  for (const d of days) {
    assert.ok(d.date <= today, `marked ${d.date} as bleeding, which is after today (${today})`)
  }
})
