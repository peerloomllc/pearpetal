// PearPetal Bare worklet entry. All the P2P plumbing lives in @peerloom/core;
// this wires PearPetal's private-base merge rules and its method table into the
// engine and starts the IPC loop. The RN shell sends { id, method, args } over
// BareKit IPC; init / group:create / group:join are engine builtins, the
// cycle:* / device:* / day:* / period:* methods come from petalMethods.

const { createGroupEngine } = require('@peerloom/core/engine')
const { applyPetalOp } = require('./petalWire')
const petalMethods = require('./petalMethods')
const { mintAddWriter, authorizeWriter } = require('./admission')

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
