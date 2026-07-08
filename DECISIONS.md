# PearPetal - Decisions

Append-only, newest on top. Per Constitution §4.

## 2026-07-08 - Phosphor icons + Manrope font (suite UI consistency)
Tier: T0 (cosmetic / UI-only; no wire, data model, or IPC change).
Context: PearPetal used the system font stack and label-only nav / a text `›`
caret, out of step with PearList and PearGuard, which use Manrope and
`@phosphor-icons/react`.
Choices:
- Font: adopt Manrope, embedded via `src/ui/fonts.js` (copied verbatim from
  PearList, self-contained `FONT_CSS` with weights 300/400/500). `theme.js` sets
  `FONT` to Manrope, base body/input weight 300 (was 400), and injects `FONT_CSS`
  ahead of the theme vars. One central change flows to every screen.
- Icons: add `@phosphor-icons/react` (esbuild tree-shakes to the used glyphs, same
  as PearList). Bottom-nav tabs gain real glyphs - Cycle=`Flower`, Share=
  `ShareNetwork`, Settings=`Gear`, About=`Info` - filled (`weight='fill'`) when
  active. The About accordion caret and the partner drill-in rows use `CaretRight`
  (rotates 90deg on expand), replacing the text `›`.
Verify: `npm run verify` green (32 tests + 3 bundles). On-device on the Pixel 9 +
TCL across Cycle / Share / Settings / About: font unified, nav glyphs render,
active-tab fill + accent, caret rotates on expand.

## 2026-07-07 - Invite/share codes as universal-link URLs (release blocker #2)
Tier: T1 (invite PRESENTATION + deep-link routing; the invite payload/pairing is
unchanged - implements the URL format already approved in the v1 wire protocol).
Context: invites were shown/copied as a raw base64 blob. The approved wire protocol
specifies universal-link URLs under `/petal/` on `peerloomllc.com` (matching the
suite), the foundation for web invite handling + QR (blocker #3).
Choices:
- Wrap the engine's base64 invite blob in a URL with the blob in the `#fragment`:
  device link -> `https://peerloomllc.com/petal/link#<blob>`, partner share ->
  `.../petal/join#<blob>`. The fragment NEVER reaches peerloomllc.com's server (it is
  the secret that grants access); the server only ever needs a static landing page.
- Two paths encode the KIND: `/link` = add this device to your own cycle, `/join` =
  view a partner's shared cycle. A deep link routes by path (isLinkInvite -> link:join
  vs partner:join); a manual paste already knows the mode from the onboarding choice.
- `parseInvite()` accepts any shape (URL #fragment, `?i=` query, after the path, or a
  BARE blob) so old raw codes and hand-typed blobs still work - backwards compatible.
- Added Android intent filters for `/join` (pear) + `/petal/join` (https) so partner
  share links open the app too (only `/link` was registered before).
- GOTCHA (expo-router): a deep link whose path is a file-route miss (`/link`, `/join`)
  renders expo-router's "Unmatched Route" page and never reaches the shell's Linking
  handler. Fix = tiny landing routes `app/link.tsx` + `app/join.tsx` + `app/+not-found.tsx`
  (the https `/petal/*` paths), each just `<Redirect href='/' />`, so expo-router bounces
  back to the shell where `app/index.tsx`'s Linking listeners parse the invite. Confirmed
  on-device: cold-start `pear://pearpetal/link#...` lands on main + toasts the `link:join`
  error ("already tracking a cycle"), proving the full path + routing. Suite pattern (cf.
  pearlist app/join.tsx + +not-found.tsx).
Consequences: UI-only + manifest (`app.json`); no wire/payload change; `npm run verify`
green (32 tests + 3 bundles); parse/URL round-trip + link-vs-join routing checked for
all shapes. iOS universal-link OPENING still needs the website apple-app-site-
association + associatedDomains (website-side, separate) - the pear:// scheme + paste
flow work now regardless. Copy buttons relabeled "Copy link". Foundation for QR (#3).

## 2026-07-07 - iOS Local Network prompt module (release blocker #1)
Tier: T1 (device-local permission trigger; no wire / IPC / topic change)
Context: on the 2026-07-07 cross-platform hardware verify, iOS never prompted for
Local Network (no toggle under Settings > PearPetal > Local Network), so same-WiFi
partner + own-device sync could not take the direct LAN path - it only completed
after a manual view re-entry that fell back to the slow DHT relay. iOS only surfaces
the LN prompt the first time an app actually touches the LAN, and modern Hyperswarm
(hyperdht, DHT + UDP holepunch, no Bonjour) never attempts a direct same-subnet
connect on first launch, so the prompt never fires. This is the exact issue PearList
already solved (see pearlist/modules/local-network, PR #21).
Choice: port PearList's iOS-only Expo local module verbatim, renamed for PearPetal
(`modules/local-network`, service type `_pearpetallan._tcp`, queue
`com.pearpetal.localnetwork`, advertised name "PearPetal"). On boot,
`app/index.tsx` calls `requestLocalNetworkPermission()` fire-and-forget (no-op off
iOS via `requireOptionalNativeModule`); the Swift module advertises + browses a
throwaway Bonjour service via the Network framework, which makes iOS evaluate LAN
access and show the prompt, then tears the probe down after ~8s. `app.json` gains
`ios.infoPlist.NSLocalNetworkUsageDescription` + `NSBonjourServices`
(`_hyperswarm._udp`, `_pearpetallan._tcp`); `ios/` regenerated via `expo prebuild`
so Info.plist carries them (ios/ is gitignored, source of truth is app.json).
Alternatives: none seriously - this is the proven suite pattern. Bonjour/mDNS as an
actual discovery transport was out of scope (the probe is throwaway).
Consequences: on PearList this also cut cold first-connect from ~112-147s to ~3.4s
(the same-WiFi holepunch was blocked on the pending LN permission), so expect the
same speedup here. Autolinking confirmed (`expo-modules-autolinking resolve
--platform apple` lists pod `LocalNetwork` -> `LocalNetworkModule`). Still needs
on-hardware confirmation (iPhone shows + user grants the prompt; partner sync takes
the LAN path). LIKELY SUITE-WIDE precedent: PearCircle will want the same module.

## 2026-07-07 - iOS cross-platform bring-up + native-addon-mismatch fix
Tier: T2 (build/dependency + a shared @peerloom/core touch; no wire change)
Context: first time PearPetal's iOS worklet engine actually ran. Engine `init()`
threw `AddonError: ADDON_NOT_FOUND` (rocksdb-native, then bare-fs) so no method
worked; masked because the RN shell's `callRaw('init')` never rejected on an error
response, so the UI loaded over a dead engine. Root cause: `@peerloom/core` is a
`file:`-symlinked dep whose OWN nested `node_modules` (from core's standalone
install) carries a slightly different native-addon version set than the app's
top-level (rocksdb-native 3.17.0 vs 3.17.2, bare-fs 4.7.2 vs 4.7.3, ...). bare-pack
resolves core's requires INTO that nested tree and bundles those versions, while the
iOS build links the app's TOP-LEVEL frameworks; iOS matches addon frameworks by
EXACT version, so it can't find them. Android's `--linked` bundling tolerated it,
which is why it was never caught (prior iOS tests only reached "app launches").
Likely SUITE-WIDE (PearList / PearCircle would hit it once their iOS engines run).
Choices:
- Fix by PINNING core's mismatched native addons to the app's top-level versions via
  `overrides` in `@peerloom/core`'s package.json (`rocksdb-native` 3.17.2, `bare-fs`
  4.7.3). So whether bare-pack bundles core's nested copy or the app's, the framework
  VERSION matches what iOS links. Core keeps its node_modules (its `npm test` and the
  app's Node-run unit tests both still resolve @peerloom/core -> sodium-universal etc.).
  (An earlier attempt moved `peerloom-core/node_modules` aside; rejected because it
  breaks Node-run test resolution for both core AND the app - only bare-pack's
  symlink-logical resolution tolerates it.)
- Added `npm install` on the Mac to `ios-dev-install.sh` so the Mac's LINKED frameworks
  match the dev-host-built bundle's versions (the Mac's rsynced core has no node_modules,
  so it resolves to top-level; the install pins top-level to the lockfile).
- Surface init failures instead of swallowing them: `app/index.tsx` now shows an
  "Engine failed to start" page (and writes `Documents/init-error.txt`) on init
  error; `@peerloom/core` `engine.js` dispatch includes `err.stack` in error
  responses. Kept (genuine improvements over a silently-dead UI).
- iOS build/install workflow: build + archive on the Mac mini, then install from the
  Linux dev box via `ideviceinstaller` over USB (devicectl install fails
  "Authorization required" over the wireless CoreDevice link). See
  `scripts/ios-dev-install.sh`.
Consequences: Android<->iOS cross-platform partner sync VERIFIED on hardware (iPhone
SE iOS 26.4.2 partner <- TCL Android owner, full scope). Verify green (tests + 3
bundles); bundle references the aligned addon versions. TRADE-OFF: the pins must be
kept in lockstep with each app's top-level versions until a proper fix. DURABILITY
FOLLOW-UP (TODO dev-infra): a workspace/hoist setup or dropping core's holepunch
devDeps so versions can't drift. Also surfaced: iOS never prompts for Local Network,
so the LAN peer path is blocked until manually re-entered - the iOS Local Network
prompt module (port from PearList) is now a confirmed v1 release blocker.

## 2026-07-07 - JSON export / import (slice 4)
Tier: T1 (device-local backup/migration; no wire change)
Context: implement the recovery escape hatch resolved at approval (open-Q1): a
plain JSON export/import, no encryption wrapper, no cloud.
Choices:
- `export:data` returns a plain JSON object of the user's data only: day entries
  + period spans + prefs. NO identity/secret keys and NO internal fields (sig,
  pubkey, updatedAt, createdBy) - just what the user entered. So the file is
  portable and carries no device secret.
- `import:data` writes the entries into this device's private base, CREATING one
  if the device has none (the all-devices-lost recovery case). Entries are
  re-signed by the importing device; on a date collision the imported entry wins
  (fresh timestamp). Rejects a file whose `app` !== 'pearpetal'.
- Delivery is shell-mediated on device (`shell:export` writes a file + opens the
  share sheet via expo-sharing; `shell:import` uses expo-document-picker), and
  falls back to a browser Blob download / file input in the WebView preview. The
  worklet only ever produces/consumes the JSON; it never touches the filesystem.
- No encryption wrapper by explicit decision (open-Q1): the plaintext file is the
  user's to store and protect; the UI states this. An optional "encrypt this
  export" is an additive future change, not a redesign.
Consequences: the export doubles as a migration path between devices. Verify:
`npm run verify` green (32 tests); a two-engine smoke test proves the round trip -
export from one device, import onto a FRESH device (new identity), and the log +
prediction + prefs all reconstruct; a non-PearPetal file is rejected. Adds
expo-sharing + expo-document-picker deps (native, exercised on hardware).

## 2026-07-07 - Flower picker: real species for the dial (slice 6)
Tier: T1 (device-local display pref; no wire/data change)
Context: the slice-5 dial was a generic parametric rosette, not a real flower. Add
a choice of real species as a setting.
Choices:
- Each species is a parametric petal PROFILE plugged into the same furl-and-bloom
  engine (`src/ui/flowers.js`): a shape function (round / broad / pointed /
  heart-notched), one or more radial layers (count + size + offset), and a
  signature hue. Not images - so every flower animates identically across the
  cycle and stays crisp at any size.
- COLOR still follows the phase (crimson closed -> the species' rose open), tinted
  per species. This is the deliberate call from the earlier discussion (option 1):
  vary SHAPE, keep the phase color-encoding, and curate species in the warm
  pink-red family so their natural hues are compatible. Rejected: letting each
  flower wear fully natural colors (would drop the phase-as-color signal).
- v1 set: rose, cherry blossom (sakura), lotus, poppy, dahlia. Chosen for
  distinct silhouettes AND cycle/femininity symbolism.
- Stored as device-local `prefs.flower` (default rose), validated against the
  species set on both sides. Never crosses the wire. Backend keeps a duplicated
  key set in `petalMethods.js` in sync with `flowers.js` (noted in code).
Consequences: `flowers.js` is CommonJS so it is both unit-testable under node and
importable by the ESM UI via esbuild interop. Picker lives in cycle-settings with
live thumbnails (`FlowerThumb`). Verify: `npm run verify` green (32 tests, incl.
per-species petal validity + bloom-growth + fallback). Interactive preview updated
with a species selector.

## 2026-07-06 - Petal-dial UI (slice 5)
Tier: T1 (presentation; no wire or data change)
Context: build the signature visual the whole product/name rests on (DECISIONS
2026-07-06 naming entry): an interactive petal dial that furls and blooms across
the cycle.
Choices:
- The flower's petals RE-GEOMETRY with cycle position (petal path length/width
  recompute), not just scale - furled at menstruation, full bloom at ovulation,
  closing toward the next period. Bloom is a curve peaking at the predicted
  ovulation day, so the dial literally encodes the phase.
- Driven entirely by the existing on-device projection (`cycle:prediction`):
  dayOfCycle + cycleLen + predicted ovulation position. No new data, no wire
  change - the slice-3 prediction is the single source. `phase:current`'s four
  values map to the four bloom states as the naming decision intended.
- A ring around the flower is the cycle calendar: a red menstrual arc, a rose
  fertile arc, day ticks, and a lilac "today" marker.
- Design guardrail honored (DECISIONS naming entry): botanical GEOMETRY, muted
  app palette, bloom-in on mount, reduced-motion respected - deliberately NOT the
  pink-cursive period-app cliche. Pure SVG, no deps (`src/ui/PetalDial.jsx`).
- Not-known state shows a furled bud + "Learning your cycle", so the dial is the
  hero from first launch.
Alternatives: scale-only bloom (rejected - reads as a small flower, not a bud);
a separate decorative graphic unrelated to the data (rejected - the dial must be
truthful, driven by the real projection).
Consequences: the dial replaces the plain slice-3 summary header as the main-
screen hero; stats + settings sit below it. An interactive standalone preview was
built to design/verify the visuals. Verify: `npm run verify` green (28 tests +
bundles); the dial is pure presentation over already-tested prediction.

## 2026-07-06 - Local prediction refinement + owner-facing prediction (slice 3)
Tier: T1 (app logic; no wire change - prediction is computed, never stored)
Context: slice-2 shipped a basic calendar projection, and predictions were only
visible to a partner (the owner never saw their own). Refine the algorithm and
surface it to the owner.
Choices:
- Cycle length = MEDIAN of the last up-to-6 usable gaps (robust to the odd
  irregular cycle), not the mean. Falls back to a user pref, then 28.
- Ovulation = BBT-confirmed when a sustained thermal shift is detected this cycle
  (day before the first sustained rise of >=0.2C over a 6-day baseline), else the
  calendar estimate (next period - luteal length). `ovulationSource` says which.
- `confidence` (none/low/medium/high): high when BBT-confirmed OR >=3 tight
  cycles; medium with some history; low on a single start with defaults.
- Device-local `prefs` (avgCycleLength / avgPeriodLength / lutealLength / goal),
  clamped to sane bounds, feed prediction before enough history exists. Changing
  prefs refreshes any partner projections.
- New `cycle:prediction` method computes the projection on demand from the
  private log and returns it to the owner's UI. It is NEVER written to the
  private base - consistent with open-Q2 (predictions never cross the private
  wire; a freshly linked device recomputes and shows "Learning your cycle" until
  it has data).
Alternatives: mean cycle length (rejected - one long/irregular cycle skews it);
writing predictions to the private base for instant cross-device display
(rejected again per open-Q2 - recompute on device instead).
Consequences: `src/prediction.js` is the single pure source of the projection,
used by both the owner UI (`cycle:prediction`) and the partner projection
(`refreshShares`). Not medical/contraception grade - the UI states this. Verify:
28 unit tests (median, BBT override, luteal/cycle prefs, confidence, irregular
handling) + smoke test for cycle:prediction + prefs persistence/clamping.

## 2026-07-06 - Partner shared base (slice 2)
Tier: T3 (new base kind, sharing/consent surface)
Context: implement the per-partner SHARED base from the proposal - a separate
Autobase carrying an owner-written, consent-scoped projection the partner only
reads.
Choices:
- Owner-write-only is enforced in apply by SIGNATURE, not by ACL: `share:meta`
  records the owner pubkey (first-writer claims it, must name itself), and every
  other shared row (`phase:current`, `predict:current`, `summary:{date}`) is
  accepted only if signed by that owner. A partner-signed row is dropped. This is
  what makes the partner read-only (`rowSharedDecision` in `src/petalWire.js`).
- The partner IS admitted as an Autobase writer (the engine's normal pairing) so
  their identity is bound; apply just rejects their writes. Accepted per proposal.
- Scope gates at the WRITER: the owner writes only the fields a scope permits
  (`phase` -> phase + next-period date; `fertility` -> + fertile window; `full` ->
  + redacted per-day summary with a fixed symptom whitelist, never notes/BBT/
  intimacy). The partner structurally cannot receive more than was written.
- The share invite grants ONLY the shared base; it never carries the private base
  or its key. Distinct base, distinct encryption key.
- `refreshShares` recomputes + rewrites the projection after any private-log
  change, so partners stay current.
KNOWN LIMITATIONS (v1, noted honestly, deferred):
- Because the partner is a real writer, they could append an `addWriter` op to
  admit a third party to the SHARED base (the engine processes addWriter from any
  writer). That third party would see only the already-consented projection, not
  the private log, so the leak is bounded - but it is a real gap. Closing it needs
  apply-level addWriter gating in `@peerloom/core` (a core change), out of slice
  scope. Tracked in TODO.
- Prediction on the shared base is a DELIBERATE, CONSENTED exception to the
  open-Q2 rule "predictions never cross the wire": that rule governs the PRIVATE
  base (no prediction replication among your own devices). Sharing predicted dates
  with a partner is the whole point of the fertility scope. Documented so the two
  are not read as contradictory.
- The projection algorithm (`src/prediction.js`) is a basic calendar estimate;
  the real prediction slice refines it.
Consequences: a device now holds several bases (private / shared-out / shared-in),
tagged by `kind` in `groups:joined`; `privateMembership` filters to the private
one. Verify: 24 unit tests (incl. owner-write-only + prediction) + a one-device
owner-side smoke test proving scope gating and the redaction boundary. Real
cross-device partner replication rides the same pairing as device linking and is
still to be exercised on hardware.

## 2026-07-06 - Private base is date-keyed, not per-writer (slice 1)
Tier: T3 (wire schema; amends the approved proposal before any peer ships)
Context: building slice 1 (scaffold + private base + device linking) surfaced that
the approved spec's `day:{pubkey}:{yyyymmdd}` per-writer keyspace is wrong for the
private base. That keyspace is the PearCircle multi-PERSON pattern (writers must
not overwrite each other). On the private base every device is the SAME person, so
per-writer keying produces a separate divergent row per device for the same day,
which the UI would have to merge - the opposite of what you want.
Choice: key `day:` and `period:` by DATE (`day:{yyyymmdd}`), shared across the
owner's own devices, resolved last-writer-wins (deterministic sig tie-break). The
author pubkey is still in the value and proven by the signature. `device:{pubkey}`
stays per-writer keyed (a device may write only its own roster row). Dropped the
`owner` singleton for slice 1 (roster suffices; admission is physical/device-to-
device). Implemented in `src/petalWire.js`; proposal §4 amended to match.
Alternatives: keep per-writer + merge divergent per-device rows in the UI
(rejected - complexity with no benefit when it is all one person); CRDT text merge
for notes (rejected - overkill for v1, LWW is fine for a personal log).
Consequences: partner SHARED base (later slice) keeps owner-write-only semantics
independently; this change is private-base only. v1 is still the floor (no peers
shipped). Unit tests in `test/petalWire.test.js` cover the shared-LWW + per-writer
device rules; a one-device method smoke test exercises the full write/read path.

## 2026-07-06 - Wire protocol v1 approved + open questions resolved
Tier: T3
Context: `proposals/2026-07-06-wire-protocol.md` reached approval (Tim committed it
into the new `pearpetal` repo). Its six open questions needed v1 answers.
Choice (all v1):
  1. Recovery: plain JSON export/import - the full log written to a local JSON
     file on the device (Downloads/Files), importable back. On-demand, never
     automatic, never uploaded, no encryption wrapper (the user owns and protects
     the file, like a manual backup). No cloud/seeder ever. ≥2 linked devices are
     the primary backup; the export doubles as manual migration.
  2. Predictions: never written to any base; recomputed on-device from the log so
     prediction data never crosses the wire. New device shows a brief "computing…".
  3. `full`-scope symptom whitelist (fixed, coarse, non-clinical): cramps,
     headache, fatigue, bloating, tender-breasts, nausea, backache, acne,
     mood-low, mood-irritable, energy-high, libido-high. Notes/BBT/intimacy and
     any off-list tag are never projected. Versioned constant; widening is
     additive v1.x.
  4. Multi-partner: v1 single-partner (keyspace permits N; deferral not preclusion).
  5. Two-way couples mode: v2 (v1 partner read-only; a v2 mutual base is additive).
  6. Block-encryption: always-on, no toggle, both bases from day one; no legacy
     unencrypted tier.
Alternatives: cloud/seeder backup (rejected - breaks the no-server pitch);
replicating predictions for instant display on new devices (rejected - puts
derived sensitive data on the wire for a cosmetic gain); open-ended symptom
projection (rejected - unauditable redaction boundary).
Consequences: implementation must provide the JSON export/import path, an on-device
recompute with a "computing…" state, and enforce the symptom whitelist in the
projection writer (with an apply-branch test asserting off-list tags never appear
in `summary:`). App remains pre-scaffold; these lock v1 before code starts.

## 2026-07-06 - App name = PearPetal (DECIDED)
Tier: T0 (branding, no wire effect)
Context: menstrual / fertility tracker in the Pear* suite. Category rewards a
discreet home-screen name (many users do not want an obvious period app on
screen) over a literal one. Placeholder in APP-IDEAS.md was "PearPetal".
Choice: **PearPetal**. Rationale:
  - "Flowers" is a genuine historical euphemism for menstruation (Middle English
    / Victorian "her flowers" = menses), so the flowering wordplay points right
    at the subject rather than being merely decorative.
  - Discreet and soft on the home screen, which suits the sensitive category.
  - Enables the signature UI (below), which the name reinforces.
Signature UI intent: an interactive **petal dial** modeled on Stardust's
interactive moon-phase dial, but floral instead of celestial. A ring of petals
that furls and blooms across the cycle, tap a petal to open that day's log. It
maps directly onto the wire protocol's four-value `phase:current`:
  - menstrual = petals furled (deep red)
  - follicular = budding / opening
  - fertile / ovulation = full bloom
  - luteal = fading, petals closing
So the dial needs zero protocol change (see `proposals/2026-07-06-wire-protocol.md`).
Design guardrail: keep the metaphor floral but the EXECUTION restrained and
modern (botanical geometry, muted palette, NOT the pink-and-cursive period-app
cliche). The floral-cliche blend-in is the main risk; a clean adult aesthetic is
how we avoid it. Also: we take Stardust's engagement hook (the playable dial) but
NOT its credibility problem - Stardust went viral on a privacy claim it could not
back (caught sharing phone numbers); our P2P two-base design can actually back it.
Alternatives considered: PearMoon (moon-cycle, my earlier rec, dropped in favor
of the flower metaphor + petal dial), PearPetal (too literal), PearBloom (close
sibling, "bloom" reads more active but "petal" is softer and more distinctive),
PearPhase, PearTide, PearLuna, PearFlow (too on-the-nose).
Consequences: repo/folder is `pearpetal/`; bundle id `com.pearpetal`; invite-link
path prefix `/petal/` (per-app prefix convention, avoids host collision on
peerloomllc.com); custom scheme `pear://pearpetal/`. Catalog, proposal, and memory
renamed 2026-07-06.

## 2026-07-06 - Two-base topology as the privacy boundary
Tier: T3
Context: cycle/fertility is the most sensitive data class in the suite. The pitch
is "never touches a server, and you choose exactly what a partner sees." A single
shared Autobase (partner joins, sees everything) breaks the second half.
Choice: split storage into two separate Autobases with independent 32-byte
encryption keys. A PRIVATE base holds the full daily log + period history and
replicates ONLY across the owner's own devices; its enc key never leaves those
devices. A per-partner SHARED base carries only an owner-written, consent-scoped
projection (phase, predicted dates, optional redacted symptom summary). The
partner-share invite deliberately withholds the private base key: that withholding
IS the boundary (mirrors PearCircle's blind-seeder seed invite).
Alternatives: (a) single shared base with field-level ACLs in the apply pass -
rejected, ACLs do not stop a peer replicating the raw encrypted blocks it can
decrypt; structural separation does. (b) partner gets a read replica of the
private base with client-side redaction - rejected, redaction that depends on the
reader's client is not a boundary.
Consequences: partner is READ-ONLY in v1 (writer at the Autobase layer for
identity binding, zero accepted write surface). Predictions are computed
on-device from the private base and never cross the wire. Revocation is
forward-only: it stops future updates and can rotate the enc key, but cannot
unsend blocks the partner already replicated (P2P invariant, UI must state it).
See `proposals/2026-07-06-wire-protocol.md` (T3 draft).

## 2026-07-06 - Build on @peerloom/core
Tier: T3
Context: PearPetal is slated as the append-only-LOG extraction vehicle, built
after PearList lands `@peerloom/core` and before PearCare, mirroring the
PearList-as-list-vehicle logic (APP-IDEAS.md build-order decision 2026-07-06).
Choice: consume `@peerloom/core` (identity, records/signing, pairing, sync) rather
than copy-fork from PearCircle. PearPetal exercises the log data shape and the
local-only-vs-replicated split so PearCare inherits a proven engine.
Alternatives: copy-fork from PearCircle like the three shipped apps - rejected,
the whole point of PearList's extraction was so the next apps stop copy-forking.
Consequences: PearPetal scaffolding depends on `@peerloom/core` being published /
`file:`-linkable first. Any core gap PearPetal surfaces feeds back into the
package before PearCare relies on it.
