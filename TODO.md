# PearPetal TODO

Open work only. Completed work (dated, with PRs) lives in `DONE.md`; deep
rationale for T2/T3 changes lives in `DECISIONS.md`.

Pruned 2026-07-21 in a full walk-through of every item. Shipped work moved to
`DONE.md`; what is below is what survived. Dropped deliberately, not forgotten:
promoting Play closed testing to production, a dark-mode screenshot set, the
deeper coach-mark onboarding tour, the remaining "cut the scrolling" trims (steps
1 + 4 already made the screen fit), partner notifications, and the swarm-topic
accumulation mitigations B/C. The diagnostics keep-or-revert review closed as
"keep the code as is".

## Verification still owed

- **Hardware-gate the blind relay (owed by PR #95, 2026-07-23).** The code, tests
  and Settings toggle shipped, but the relay has never been exercised on real
  phones. Needed: two devices on mobile data with wifi OFF, a pairing that fails
  to punch directly, confirmed to complete THROUGH the relay - and the negative
  case, two devices on the same LAN confirmed never to relay. Until this runs,
  "PearPetal works off-LAN" is an argument, not a result. See
  `proposals/2026-07-23-blind-relay.md` (Verify).

- **Tap-test the universal links (human test only).** Actually TAP an
  `https://peerloomllc.com/petal/link|join` link on the iPhone and confirm it opens
  PearPetal (iOS UL), and the same on Android (App Links against the live
  `assetlinks.json`). Everything is built, provisioned and deployed; nobody has
  confirmed the tap itself. Note the `with-ios-no-associated-domains` plugin STRIPS
  the entitlement by DEFAULT, so any iOS build that must have UL needs
  `PEARPETAL_ASSOCIATED_DOMAINS=1` at prebuild time.

## Nice-to-have / UX polish

- **No visibility into whether the relay was used.** PearTune surfaces
  `dht.stats.relaying { attempts, successes, aborts }` in its connection
  diagnostics; PearPetal has no diagnostics screen, so an escalation to the relay
  is invisible to the user and to us. Wanted mainly to make the hardware gate
  above unambiguous - without it, "it connected" does not say HOW. T1.
- **Promote `src/relay.js` into `@peerloom/core` (rule of three).** It is
  app-agnostic and PearTune has a near twin (`protocol/relay.js`). Deliberately
  not done in PR #95: two copies of a ~110-line pure module beat a new core API
  plus a version bump across the suite, and core already exposes `createSwarm` as
  the seam. Do it when a THIRD app adopts the relay. Until then, a change to the
  relay key or the policy must be made in both places.
- **`PartnerView` renders raw ISO dates.** `2026-07-23` -> `fmtDate` (`Jul 23`), for
  a nicer app and a nicer store screenshot scene 4. Small and self-contained. T1.

## Device-link follow-up

- **Real unpair (writer-block), not just cosmetic roster remove.** `device:remove`
  currently only hides a device from the roster (device-link `removeDevice` = a
  deviceMeta del). A true unpair would block the writer on the personal base, so a
  removed device can still write today. Likely T2/T3 - write a proposal first.

## Deferred - security / scale

- Migrate `day:`/`period:` retention/paging once logs get long.
- **Pairing/sync degradation after repeated share/revoke/re-share** (BACKBURNER -
  INTERMITTENT; needs repro + root-cause). Observed: the FIRST pair almost always
  connects immediately, but SUBSEQUENT shares/pairings sometimes take an
  indeterminate (occasionally long) time to sync. Not consistently reproducible, so
  deferred; not a launch blocker. Ideally repeated **share -> revoke -> re-share**
  (and multiple concurrent partners) each pair as fast as the first.
  Working theory: swarm topic + connection accumulation. Each share spins up another
  base + swarm topic; soft-revoke deliberately KEEPS the base + swarm alive so the
  tombstone reaches an offline partner, so revoked shares keep announcing and holding
  connections; re-share adds yet another. Mitigation A shipped 2026-07-10 (viewers
  join client-only via a persisted `announce` flag; core PR #14 + app `partner:join`)
  and helps but does not fully fix it. The full background and the rest of the
  mitigation menu - B (auto-sweep soft-revoked shares, blocked on the deferred ack
  channel) and C (announce back-off) - is in
  `proposals/2026-07-09-swarm-topic-accumulation.md`. B and C were dropped from this
  backlog 2026-07-21, but that proposal remains the reference if this is picked up.
  WHEN REVISITED: instrument active topics/connections per share, try to repro on
  hardware with N>=3 sequential shares AND a share/revoke/re-share loop, and find the
  lever (announce back-off, a per-base connection cap, tearing down swarm for revoked
  shares once the tombstone is acked, and/or capping total simultaneous topics).

## Known limitation (deferred) - linked device's writes slow to sync back to founder

Device linking syncs founder->device immediately, but device->founder (the new
device's own edits + roster row) can STALL until a clean reconnect. Confirmed
2026-07-07 (TCL founder + Pixel linked device); converges once a fresh connection
forms. Root cause: connection churn during initial writer admission (the founder
applied `addWriter` twice, interleaved with pair close/open, so the new-writer core
pull stalled). ENVIRONMENTAL (two real Android devices, leave-then-relink); does NOT
reproduce on a clean local testnet (~0.8s). Deferred because multi-device-for-one-user
is minor here (partner sharing does NOT use the B->A writer path and is fully
verified); new-phone migration is better served by export/import. If revisited:
founder re-pulls new writer cores once the connection settles (needs a real-network
churn repro); also `publishDevice` runs only at join+boot (both before writable) so a
device that becomes writable AFTER `link:join` never re-publishes its `device:{pubkey}`
row - add a post-became-writable retry. Release-notes wording: "a linked second device
may need an app reopen to finish syncing its first edits."

## Dev infra / build durability

- **One unexplained test failure, seen once, never reproduced** (2026-07-21). A
  `npm run verify` run came back 114 pass / 1 fail; the failing test name was not
  captured. 23 subsequent runs (11 `npm test`, 12 full `npm run verify`) were all
  115/0, so it is a flake, not a regression. Most likely a timing-sensitive test in
  the P2P/pairing set. If it recurs, run with `--test-reporter=spec` and capture the
  name before chasing it - a flaky test in the merge gate is worse than a slow one.
- **`@peerloom/core` nested node_modules can drift from the app's** (LIKELY SUITE-WIDE).
  Core is file:-symlinked; its own node_modules had version-mismatched native addons vs
  the app's top-level -> iOS `ADDON_NOT_FOUND` at engine init. FIX IN PLACE: `overrides`
  in core's package.json pin the mismatched addons to the app's versions; `ios-dev-
  install.sh` runs `npm install` on the Mac so linked frameworks match. TRADE-OFF: the
  pins must track each app's top-level versions by hand, so they rot silently. PROPER
  FIX: a workspace/hoist setup, or drop core's holepunch devDependencies so versions
  can't drift.
