// PearPetal Bare worklet entry. All the P2P plumbing lives in @peerloom/core;
// this wires PearPetal's private-base merge rules and its method table into the
// engine and starts the IPC loop. The RN shell sends { id, method, args } over
// BareKit IPC; init / group:create / group:join are engine builtins, the
// cycle:* / device:* / day:* / period:* methods come from petalMethods.

const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('./petalWire')
const petalMethods = require('./petalMethods')
const { mintAddWriter, authorizeWriter } = require('./admission')

// Device-link (private base + mnemonic identity + own-device linking) wiring.
// Required here so it is part of the worklet bundle and its native deps resolve
// NOW, even though it stays DORMANT until DEVICE_LINK_ENABLED flips. SLICE 2
// reroutes cycle:create / link:join through it (QR-first, per DECISIONS
// 2026-07-12) and constructs it on the shared runtime. See src/deviceLink.js.
const { DEVICE_LINK_ENABLED } = require('./deviceLink')
// The device-link-backed private store (SLICE 2). Required so it is in the
// worklet bundle; SLICE 2b threads petalMethods' private-base calls through it
// behind the flag. Inert import while the flag is off.
require('./privateStore')
if (DEVICE_LINK_ENABLED) {
  // SLICE 2b threads cycle:create / link / day / period / device roster through
  // ./privateStore here + at the method sites. Inert while the flag is off.
}

const engine = createGroupEngine({
  appId: 'pearpetal',
  applyOps: applyPetalOp,
  methods: petalMethods,
  // Shared-base writer-admission gating (per-person shares Part B): only the
  // owner admits partners; a partner cannot admit a third party. Private-base
  // device linking is unaffected. See src/admission.js.
  mintAddWriter,
  authorizeWriter,
  // Auto-prune old already-applied blocks every 30 min, keeping a generous
  // recent buffer so small logs are untouched.
  retentionInterval: 30 * 60 * 1000,
  retentionKeepRecent: 512,
})

engine.start()
