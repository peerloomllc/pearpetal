# Review - Viewers join shared bases client-only (T3)

**Shipped**: Mitigation A from `proposals/2026-07-09-swarm-topic-accumulation.md`.
`@peerloom/core` `joinTopic` takes a `{ server, client }` option and `joinGroup` an
`announce` flag (persisted on the `groups:joined` row, re-applied by `init()`), default
`true`. PearPetal's `partner:join` now passes `announce:false`, so a partner (a pure
viewer of the owner's shared projection) joins the topic CLIENT-ONLY - it connects to
the owner but no longer redundantly announces the owner's topic. `link:join` (own-device
linking) keeps the default (`announce:true`), so linked devices stay mutually
discoverable. Reduces the per-device topic pile-up that was degrading pairing as bases
accumulate; fresh installs were already fast, the win is at high base counts.

**Signed off**: Tim, 2026-07-09, by committing the proposal (Constitution §3). Core
change is `@peerloom/core` PR #14; app change is the PearPetal PR. Prepared by Claude.

**Notes**: Back-compatible - additive optional `announce` field; an old owner still
announces (server) so a new client-only viewer finds it, and old viewers (server+client)
still interoperate. No wire/record-format break, no migration. Suite-wide since it is
core: the adoption gate is re-running PearList's pairing smoke before other apps rely on
it. D (Hyperswarm connection cap) was deliberately NOT changed - the default `maxPeers=64`
is already sane and a lower cap risks rejecting legit peers. C (announce back-off)
deferred (must keep one side discoverable). Verify: core `npm test` green (43, incl. new
announce + restart-persistence tests and the two-peer pairing gate); app `npm run verify`
green (86 + 3 bundles).
