// src/trace.js records method names and timings to a file, never arguments.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('the trace records each request and reply, and no arguments', () => {
  {
    const trace = require('../src/trace')
    trace._useFsForTest(fs) // bare-fs is the worklet's fs; node's has the same sync calls
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-trace-'))
    trace.mark('before init')
    trace.onIn(JSON.stringify({ id: 1, method: 'init', args: { dataDir: dir } }) + '\n')
    trace.onIn(JSON.stringify({ id: 2, method: 'day:set', args: { date: '2026-10-13', notes: 'SECRET-NOTE' } }) + '\n')
    trace.onOut(JSON.stringify({ id: 1, result: { ok: true } }) + '\n' + JSON.stringify({ event: 'group:updated', data: {} }) + '\n')
    trace.onOut(JSON.stringify({ id: 2, error: 'boom' }) + '\n')
    const log = fs.readFileSync(path.join(dir, 'pearpetal', 'trace.log'), 'utf8')
    assert.match(log, /before init/)
    assert.match(log, /> init #1/)
    assert.match(log, /< init #1 \d+ms/)
    assert.match(log, /event group:updated/)
    assert.match(log, /< day:set #2 \d+ms ERR boom/)
    assert.doesNotMatch(log, /SECRET-NOTE/)
  }
})
