// Opt-in backup to a PeerLoom Seeder (proposals/2026-10-14-opt-in-seeder.md).
// Off until the user pairs a seeder in Settings.
//
// What goes to a seeder, and how each device knows:
//   - The private log (device-link's personal base). The seeders the owner uses
//     are listed in a `seeders` field on the ownerPrefs record, which syncs across
//     the owner's own devices. Every own device backs the log up to them, paired
//     or not; the seeder accepts the other devices' cores because a paired device
//     registered the base.
//   - A partner share, only when the owner turned the seeder on for it. The owner
//     lists the seeder keys in a `seeders` field on that share's owner-signed
//     share:meta. The partner's app reads it and fetches from those seeders; the
//     partner never pairs.
//
// Both are extra fields on existing rows: an older version keeps them as they are
// and ignores them, so no version's view of a base differs.
//
// A seeder only ever gets core keys and encrypted blocks. PearPetal sends no app
// label at pairing, so the seeder's dashboard lists it under "Other devices".

const b4a = require('b4a')
const { createSeeding } = require('@peerloom/core/seeding')
const { relayingDht } = require('./relay')
const { currentDeviceLink } = require('./deviceLink')

const HEX64 = /^[0-9a-f]{64}$/
const PERSONAL = 'personal:'
const instances = new WeakMap() // engine -> seeding

function cleanKeys (list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter((k) => typeof k === 'string' && HEX64.test(k)))].sort()
}

// The seeders the owner uses for the private log (ownerPrefs.seeders, mirrored
// into localDb `prefs`).
async function ownSeeders (localDb) {
  const prefs = (await localDb.get('prefs').catch(() => null))?.value || null
  return cleanKeys(prefs && prefs.seeders)
}

// The seeders a share uses: share:meta.seeders, written by the owner.
async function shareSeeders (base) {
  try {
    const meta = (await base.view.get('share:meta'))?.value || null
    return cleanKeys(meta && meta.seeders)
  } catch { return [] }
}

function personalId (base) { return PERSONAL + b4a.toString(base.key, 'hex') }

function getSeeding (engine) {
  let s = instances.get(engine)
  if (!s) {
    const wrapped = new WeakMap()
    const dhtOf = (dht) => { if (!wrapped.has(dht)) wrapped.set(dht, relayingDht(dht)); return wrapped.get(dht) }
    s = createSeeding({
      ctx: engine,
      app: null,
      dhtOf,
      seedersFor: (id, base) => (id.startsWith(PERSONAL) ? ownSeeders(engine.localDb) : shareSeeders(base)),
      // The personal base is device-link's, not one of the engine's groups.
      extraBases: async () => {
        const dl = currentDeviceLink()
        const base = dl && dl.personalBase
        return base && base.key ? [[personalId(base), base]] : []
      },
    })
    instances.set(engine, s)
  }
  return s
}

module.exports = { getSeeding, ownSeeders, shareSeeders, cleanKeys, personalId }
