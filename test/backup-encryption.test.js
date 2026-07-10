// Encrypted-backup round trip (proposal 2026-07-10). Exercises the real IPC path:
// export:data with a password produces an opaque wrapper; import:data decrypts it
// with the right password and rejects a wrong one, writing nothing on failure.
// Plaintext (blank-password) export still round-trips.
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
const { addDays, todayIso } = require('../src/prediction')

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

// Seed a device with a distinctive note, a period span, and a pref, then return
// the export payload built with the given options.
const NOTE = 'zz-secret-note-marker-42'
const NOTE_DAY = addDays(todayIso(), -3)
const PERIOD_START = addDays(todayIso(), -30)
async function seed (call) {
  await call('init', {})
  await call('cycle:create', {})
  await call('day:set', { date: NOTE_DAY, flow: 'medium', notes: NOTE })
  await call('period:log', { start: PERIOD_START, end: addDays(PERIOD_START, 4) })
  await call('prefs:set', { avgCycleLength: 31 })
}

test('encrypted export is opaque and round-trips onto a fresh device', async () => {
  const a = driver()
  await seed(a.call)
  const PW = 'correct horse battery staple'
  const wrapper = await call_export(a.call, PW)

  // The wrapper is the encrypted shape, and its serialized form leaks no plaintext.
  assert.ok(wrapper.enc, 'has an enc wrapper')
  assert.equal(wrapper.enc.kdf, 'argon2id')
  assert.equal(wrapper.enc.cipher, 'xsalsa20poly1305')
  assert.equal(wrapper.days, undefined, 'no plaintext days on the wrapper')
  const serialized = JSON.stringify(wrapper)
  assert.ok(!serialized.includes(NOTE), 'note text is not present in the file')
  assert.ok(!serialized.includes(NOTE_DAY), 'a logged date is not present in the file')

  // A fresh device (new identity) imports it with the right password.
  const b = driver()
  await b.call('init', {})
  const r = await b.call('import:data', { data: wrapper, password: PW })
  assert.ok(r.days >= 1 && r.periods >= 1)
  const day = await b.call('day:get', { date: NOTE_DAY })
  assert.equal(day.notes, NOTE, 'note reconstructs after decryption')
  const periods = await b.call('period:getAll', {})
  assert.ok(periods.find(p => p.start === PERIOD_START), 'period span reconstructs')
  const prefs = await b.call('prefs:get', {})
  assert.equal(prefs.avgCycleLength, 31, 'pref reconstructs')

  await a.engine.close(); await b.engine.close()
})

test('a wrong password is rejected and writes nothing', async () => {
  const a = driver()
  await seed(a.call)
  const wrapper = await call_export(a.call, 'the-real-password')

  const b = driver()
  await b.call('init', {})
  await assert.rejects(
    () => b.call('import:data', { data: wrapper, password: 'not-it' }),
    /wrong password/,
  )
  // Nothing was written: decryption fails before any base is created, so the
  // fresh device still has no cycle at all.
  await assert.rejects(() => b.call('day:get', { date: NOTE_DAY }), /no cycle on this device yet/)

  // A missing password on an encrypted file is a clean error too.
  await assert.rejects(() => b.call('import:data', { data: wrapper }), /password required/)

  await a.engine.close(); await b.engine.close()
})

test('blank password still produces a plaintext backup that imports', async () => {
  const a = driver()
  await seed(a.call)
  const plain = await a.call('export:data', {})
  assert.equal(plain.enc, undefined, 'no encryption without a password')
  assert.ok(Array.isArray(plain.days) && plain.days.length >= 1)

  const b = driver()
  await b.call('init', {})
  const r = await b.call('import:data', { data: plain })
  assert.ok(r.days >= 1)
  const day = await b.call('day:get', { date: NOTE_DAY })
  assert.equal(day.notes, NOTE)

  await a.engine.close(); await b.engine.close()
})

// Small helper: export with a password and sanity-check the top-level shape.
async function call_export (call, password) {
  const wrapper = await call('export:data', { password })
  assert.equal(wrapper.app, 'pearpetal')
  return wrapper
}
