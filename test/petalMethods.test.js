// Drive the real engine IPC loop on one peer (init, then the device-local
// methods) and assert the worklet behaviour. Cross-peer replication is covered
// in @peerloom/core's two-peer test; here we only need the local method table.

const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')

const _tmpDirs = []
function tmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearpetal-'))
  _tmpDirs.push(dir)
  return new Corestore(dir)
}
after(() => { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } })

function fakeSwarm () {
  const ee = new EventEmitter()
  ee.left = []
  ee.join = () => ({ flushed: async () => {} })
  ee.leave = (topic) => { ee.left.push(topic) }
  ee.destroy = async () => {}
  return ee
}

// A driver around the engine's IPC loop: feed a method call, await its reply.
function driver () {
  const responses = []
  const read = new EventEmitter()
  const engine = createGroupEngine({
    appId: 'pearpetal', corestore: tmpStore(), createSwarm: fakeSwarm,
    applyOps: applyPetalOp, methods: petalMethods,
  })
  engine.start({ read, write: (buf) => responses.push(JSON.parse(buf.toString())) })
  let nextId = 1
  const call = async (method, args) => {
    const id = nextId++
    read.emit('data', Buffer.from(JSON.stringify({ id, method, args }) + '\n'))
    for (let i = 0; i < 200; i++) {
      const r = responses.find(x => x.id === id)
      if (r) { if (r.error) throw new Error(r.error); return r.result }
      await new Promise(res => setTimeout(res, 10))
    }
    throw new Error('timed out: ' + method)
  }
  return { engine, call }
}

test('donation reminder: fresh is not due, dismiss marks it shown', async () => {
  const { engine, call } = driver()
  await call('init', {})
  const s1 = await call('donation:status', {})
  assert.equal(s1.due, false) // first use just now, 14 days not elapsed
  assert.equal(s1.shown, false)
  assert.equal(typeof s1.firstUseAt, 'number')
  await call('donation:dismiss', {})
  const s2 = await call('donation:status', {})
  assert.equal(s2.shown, true)
  assert.equal(s2.due, false)
  await engine.close()
})

test('donation reminder: due once 14 days have elapsed, then dismiss stops it', async () => {
  const { engine, call } = driver()
  await call('init', {})
  // Seed a first-use 15 days ago (the nudge triggers at 14). Seeding the localDb
  // row directly stands in for "the app has been in use for two weeks".
  const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000
  await engine.localDb.put('donateReminder', { firstUseAt: fifteenDaysAgo, shown: false })

  const due = await call('donation:status', {})
  assert.equal(due.due, true) // 14 days elapsed and not yet shown -> due
  assert.equal(due.shown, false)
  assert.equal(due.firstUseAt, fifteenDaysAgo) // existing first-use is preserved, not reset

  // The UI marks it shown the moment it surfaces, so it never nags twice.
  await call('donation:dismiss', {})
  const after = await call('donation:status', {})
  assert.equal(after.shown, true)
  assert.equal(after.due, false)
  await engine.close()
})
