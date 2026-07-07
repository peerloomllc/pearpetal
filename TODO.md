# PearPetal TODO

Build order and slice status. Newest work at the top of each section.

## Done

- **Slice 1 - scaffold + private base + own-device linking** (2026-07-06)
  - Three-layer app on `@peerloom/core`: RN shell (`app/`), WebView UI
    (`src/ui/`), Bare worklet (`src/bare.js`).
  - Private base: `device:{pubkey}` roster, `day:{yyyymmdd}` log,
    `period:{yyyymmddStart}` spans. Apply rules in `src/petalWire.js`
    (date-keyed shared LWW; per-writer device rows; no-resurrection tombstones).
  - Methods (`src/petalMethods.js`): `cycle:status/create`, `link:invite/join`,
    `device:setLabel/publish/getAll`, `day:set/get/getAll/delete`,
    `period:set/getAll`.
  - Own-device linking reuses the engine's `group:create` / `group:join`
    pairing (invite = base64url payload; QR path is a later slice, paste works).
  - UI: onboarding (start / link device), day editor (flow + symptoms + notes),
    recent days, devices screen with a copyable link code.
  - Verify green: 13 wire unit tests + one-device method smoke test + all three
    bundles build.

- **Slice 2 - partner SHARED base** (2026-07-06)
  - Separate Autobase per partner link, own encryption key. Owner-write-only
    projection enforced by signature (`share:meta` owner claim + owner-signed
    `phase:current` / `predict:current` / `summary:`). Partner is an Autobase
    writer whose rows apply rejects -> read-only.
  - Consent scopes (phase / fertility / full) gate what the owner writes, so the
    partner structurally never receives more. `full` summaries carry only a fixed
    symptom whitelist, never notes/BBT.
  - Share invite grants only the shared base (withholds the private base key).
  - `refreshShares` keeps projections current after each private-log change.
  - UI: Sharing screen (create/scope/list/revoke + copy code), partner viewer
    (join by code, see the scoped projection), viewer-only onboarding path.
  - Basic projection in `src/prediction.js` (pure, unit-tested).

- **Slice 3 - local prediction refinement + owner prediction** (2026-07-06)
  - `src/prediction.js`: median cycle length (robust to irregulars), BBT-confirmed
    ovulation with calendar fallback, confidence rating, prefs support.
  - Device-local `prefs` (avg cycle/period/luteal length, goal), clamped.
  - `cycle:prediction` method + owner UI: a cycle-summary card (phase, cycle day,
    next period countdown, fertile window, ovulation) and a settings screen.
    "Learning your cycle" state before enough history. Never written to any base.
  - 28 unit tests + smoke coverage.

- **Slice 5 - petal-dial UI** (2026-07-06)
  - `src/ui/PetalDial.jsx`: the signature flower whose petals furl/bloom with
    cycle position (peak bloom at ovulation), driven by `cycle:prediction`. Ring
    calendar with menstrual + fertile arcs, day ticks, today marker. Bloom-in on
    mount, reduced-motion respected. Now the main-screen hero.
  - Interactive standalone preview built to design/verify the visuals.

- **Slice 6 - flower picker** (2026-07-07)
  - `src/ui/flowers.js`: five real species (rose, cherry blossom, lotus, poppy,
    dahlia) as parametric petal profiles into the same bloom engine; shape varies,
    phase color-gradient preserved (tinted per species). Device-local
    `prefs.flower`, picker in cycle-settings with live thumbnails.

## Next slices

- **Slice 4 - JSON export / import.** Plain local file download + import
  (recovery + migration). No encryption wrapper, no cloud. (The last core slice.)
- Optional polish: petal dial in the partner view too; ring day-scrub to log a
  past day by tapping its tick; QR for invites; the iOS local-network module.

## Deferred / later

- **Shared-base addWriter gating** (security): a partner is an Autobase writer, so
  they could `addWriter` a third party to the SHARED base (bounded leak: only the
  consented projection, not the private log). Needs apply-level addWriter gating
  in `@peerloom/core`. Flagged in DECISIONS 2026-07-06 slice 2.
- Native QR scan + QR render for `link:invite` / share codes (slices use paste/copy).
- iOS Local Network prompt module (faster first-connect; port from PearList).
- Background sync, notifications (only if a use case needs them; a personal
  tracker may not).
- Store assets, icons, release scripts, privacy page (pre-release checklist).
- Migrate `day:`/`period:` retention/paging once logs get long.
