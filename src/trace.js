// A plain-text trace of what the worklet was asked and how long it took, written
// to `<dataDir>/pearpetal/trace.log` so it can be pulled off an iPhone over USB
// (`afcclient --container com.pearpetal -- get /Documents/pearpetal/trace.log`).
//
// Why: on 2026-10-13 an iPhone SE opened to an empty cycle screen (no dial, Today
// "Nothing logged") with the log intact on disk. The same data loads in <80ms in
// node and on the Simulator, and iOS redacts the worklet's console as <private>,
// so there was nothing to read. This records each IPC request (method, how long,
// error) plus a few named startup steps.
//
// It sees method NAMES and timings only, never arguments or results, so no cycle
// data is written. Device-local, never synced, capped at MAX_BYTES.

const MAX_BYTES = 256 * 1024

let fs = null
let file = null
let early = [] // lines from before init told us where the data lives
const pending = new Map() // ipc id -> { method, t0 }
const t00 = Date.now()
let inBuf = ''
let outBuf = ''

function stamp () {
  const d = new Date()
  const p = (x, n = 2) => String(x).padStart(n, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} +${Date.now() - t00}ms`
}

function write (line) {
  if (!file) { if (early.length < 500) early.push(line); return }
  try {
    try { if (fs.statSync(file).size > MAX_BYTES) fs.writeFileSync(file, '') } catch {}
    fs.appendFileSync(file, line + '\n')
  } catch {}
}

function mark (name, extra) {
  let tail = ''
  if (extra !== undefined) { try { tail = ' ' + JSON.stringify(extra) } catch {} }
  write(`${stamp()} ${name}${tail}`)
}

function setDir (dataDir) {
  if (file || typeof dataDir !== 'string' || !dataDir) return
  try {
    fs = fs || require('bare-fs')
    const dir = dataDir.replace(/\/$/, '') + '/pearpetal'
    try { fs.mkdirSync(dir, { recursive: true }) } catch {}
    file = dir + '/trace.log'
    fs.appendFileSync(file, `\n=== worklet start ${new Date(t00).toISOString()} ===\n`)
    const lines = early
    early = []
    for (const l of lines) write(l)
  } catch { file = null }
}

function eachLine (buf, chunk, fn) {
  buf += String(chunk)
  let nl
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    let m
    try { m = JSON.parse(line) } catch { continue }
    fn(m)
  }
  return buf
}

// A request from the shell.
function onIn (chunk) {
  inBuf = eachLine(inBuf, chunk, (m) => {
    if (!m || m.method == null) return
    if (m.method === 'init' && m.args) setDir(m.args.dataDir)
    pending.set(m.id, { method: m.method, t0: Date.now() })
    mark('> ' + m.method + ' #' + m.id)
  })
}

// A reply or an event to the shell.
function onOut (chunk) {
  outBuf = eachLine(outBuf, chunk, (m) => {
    if (!m) return
    if (m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      mark('< ' + p.method + ' #' + m.id + ' ' + (Date.now() - p.t0) + 'ms' + (m.error ? ' ERR ' + String(m.error).slice(0, 160) : ''))
    } else if (m.event) {
      mark('event ' + m.event)
    }
  })
}

// Tests run under node, where bare-fs does not load; they hand in node's fs.
function _useFsForTest (f) { fs = f }

module.exports = { mark, onIn, onOut, setDir, _useFsForTest }
