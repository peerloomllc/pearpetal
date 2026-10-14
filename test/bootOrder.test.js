// iOS reports the app active at launch, so app:foreground can reach the worklet
// before init. On 2026-10-13 that opened the private log with no store yet, the
// failure was cached, and every private read after it failed for the session: an
// iPhone SE showed an empty cycle screen until the app was swiped away. Requests
// that arrive before init must not break the ones after it.

const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('../src/petalWire')
const petalMethods = require('../src/petalMethods')
const { mintAddWriter, authorizeWriter } = require('../src/admission')
const deviceLink = require('../src/deviceLink')

test('requests that arrive before init do not break the private log', async (t) => {
  deviceLink._setDeviceLinkEnabledForTest(true)
  deviceLink._resetForTest()
  petalMethods._resetMigrationForTest()
  const testnet = await createTestnet(3)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-boot-'))
  const engine = createGroupEngine({
    appId: 'pearpetal',
    corestore: new Corestore(dir),
    createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }),
    applyOps: applyPetalOp,
    methods: petalMethods,
    mintAddWriter,
    authorizeWriter,
  })
  t.after(async () => {
    try { await engine.close() } catch {}
    try { await testnet.destroy() } catch {}
    fs.rmSync(dir, { recursive: true, force: true })
    deviceLink._resetForTest()
    deviceLink._setDeviceLinkEnabledForTest(false)
  })
  const read = new PassThrough()
  const pending = new Map()
  let id = 1
  engine.start({
    read,
    write: (buf) => {
      for (const line of String(buf).split('\n')) {
        if (!line.trim()) continue
        let m
        try { m = JSON.parse(line) } catch { continue }
        if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m) }
      }
    },
  })
  const send = (method, args = {}) => new Promise((resolve) => {
    const i = id++
    pending.set(i, resolve)
    read.write(JSON.stringify({ id: i, method, args }) + '\n')
  })

  // The order the iPhone produced: these land ahead of init.
  const early = [send('app:foreground', { bgMs: 0, platform: 'ios' }), send('day:getAll')]
  await send('init', {})
  await Promise.all(early)

  assert.equal((await send('cycle:create')).error, undefined)
  const iso = new Date().toISOString().slice(0, 10)
  assert.equal((await send('day:set', { date: iso, flow: 'medium' })).error, undefined)
  const days = await send('day:getAll')
  assert.equal(days.error, undefined, 'a private read after init works')
  assert.equal(days.result.length, 1)
})
