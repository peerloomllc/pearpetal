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

## Next slices

- **Slice 2 - partner SHARED base.** Separate Autobase per partner link, its own
  encryption key, owner-write-only projection (`phase:current`, `predict:current`,
  `summary:` gated by scope). Partner read-only. Share invite withholds the
  private base key. Consent scope levels (phase / fertility / full).
- **Slice 3 - local prediction.** On-device cycle-length + fertile-window
  estimate from the period history, never written to any base. "computing..."
  state on a freshly linked device.
- **Slice 4 - JSON export / import.** Plain local file download + import
  (recovery + migration). No encryption wrapper, no cloud.
- **Slice 5 - petal-dial UI.** The signature interactive dial driven by
  `phase:current` (menstrual = furled ... fertile = full bloom). Replace the
  plain slice-1 log UI with the designed experience.

## Deferred / later

- Native QR scan + QR render for `link:invite` (slice 1 uses paste/copy).
- iOS Local Network prompt module (faster first-connect; port from PearList).
- Background sync, notifications (only if a use case needs them; a personal
  tracker may not).
- Store assets, icons, release scripts, privacy page (pre-release checklist).
- Migrate `day:`/`period:` retention/paging once logs get long.
