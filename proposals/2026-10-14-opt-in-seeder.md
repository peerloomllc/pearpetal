# Opt-in PeerLoom Seeder for PearPetal

**Status**: Open questions decided by Tim 2026-10-14 (below). Approved when this is merged. Nothing built.

**Goal**: Let a PearPetal user back their cycle log and their partner shares up to a
PeerLoom Seeder they choose, off by default, so their devices and their partner stay
in sync while the phones sleep.

**Tier**: T3. It reverses a locked privacy decision (DECISIONS 2026-07-06: "No
cloud/seeder ever"), adds a field to signed rows in both bases and sends encrypted
health data to a box the app does not control.

## Why now

- The blocker is gone. The private log sat in an unencrypted personal base until
  PR #153 (proposal 2026-10-12-encrypt-private-log), which ruled out a blind seeder.
  Both bases are now block-encrypted.
- Sync today needs two of the same person's devices, or the owner and partner, online
  at the same time. A partner sees a new day only after the owner's phone and theirs
  meet. PearPetal has no always-on node to bridge that (DECISIONS, blind relay entry).
- PeerLoom Seeder is built and paired with by PearCircle, PearCal, PearList and
  PearOffice. PearPetal syncs through @peerloom/core, which already has the seeder
  client (`@peerloom/core/seeding`, used by PearList).

## What the seeder can and cannot see

It cannot:
- Read anything. It gets core keys and encrypted blocks, never an encryption key.
- Tell that the data is a cycle log. PearPetal sends no app label at pairing, so the
  dashboard lists its devices under "Other devices" (the seeder already says why:
  "Apps for private data, such as health trackers, do this on purpose").
- Add a device or a partner. That still needs the owner online.

It can see:
- That a paired device exists, its IP address when it connects, and when.
- How many bases each device backs up, their sizes and when they grow. For a cycle
  tracker, when the log grows says when someone logs. This is the main cost.
- A partner device that fetches a shared base from it.

Whoever runs the seeder sees this. For a seeder the user runs at home, that is the
user. For someone else's seeder, it is that person. The setup screen must say so.

## Scope

1. **Off by default.** No seeder section until the user opens it in Settings. One-line
   warning before pairing: what the seeder sees (above), in plain words.
2. **Same section and modals as the other apps** (pearcircle #247, #248): two-line
   intro, Scan seeder QR, Paste a link instead, Get PeerLoom Seeder, the list, the
   pairing and Stop using modals.
3. **Private log (own devices).** Each device pairs on its own and lists its seeders
   locally. The device-link personal base is not one of the engine's bases, so it is
   registered with blind-peering directly (or `createSeeding` learns to take extra
   bases; decide in review). Every own device backs it up to the seeders any own device
   lists, through a new `seeders` field on that device's own signed row.
4. **Partner shares.** The owner chooses per share whether it uses the seeder (default
   off even when a seeder is paired). The owner lists the seeder keys in a new
   `seeders` field on `share:meta`. The partner's app reads it and fetches from those
   seeders; the partner never pairs.
5. **No retention limit.** Predictions need the whole history, so no `retain` request.
6. **Stop using** drops with the 7-day wait, in sequence (as fixed in pearcircle #249).
7. **No keyring records.** Restore stays the device-link recovery phrase.

Not in scope: any PearPetal-run seeder, any default seeder, iOS background fetch from
the seeder.

## Compat

- `seeders` is an extra field on existing signed rows (`share:meta`, the device row).
  Old versions verify the signature over the whole value and ignore the field, so
  their views do not diverge. A new row kind would be dropped by old versions'
  apply (`rowSharedDecision` rejects unknown namespaces), so none is added.
- An old partner app ignores the field and keeps syncing phone to phone only.
- Needs `blind-peering` and `protomux-wakeup` as dependencies (as PearList), so an
  iOS build must run `pod install` (`ios-dev-install.sh --pods`).

## Verify

- Unit: the `seeders` field round-trips on both rows; old-version apply accepts a row
  carrying it; a partner's app reads it; no app label is sent at pairing.
- Device: owner on the TCL, partner on an emulator, a local PeerLoom Seeder. Owner logs
  a day and goes offline; the partner shows the day from the seeder alone. Same for a
  second own device catching up the private log.
- The seeder dashboard lists the devices under "Other devices" with no app name.
- Stop using: the seeder logs one drop per base, due in 7 days.

## Rollback

Turn the section off in the UI (one flag). Devices stop registering with seeders;
`seeders` fields stay on rows and are ignored. Data already on a seeder is dropped
after its 7-day wait once devices send drops, or by forgetting the device on the
seeder's dashboard.

## Decided 2026-10-14

1. Reverse DECISIONS 2026-07-06: yes, opt-in only. Off by default; the user picks their
   own seeder. PearPetal keeps "no server of ours".
2. Partner shares: yes, chosen per share by the owner.
3. Warning: one plain warning at pairing, saying what the seeder's owner can see. No
   network guessing.
4. Store text and privacy page: add an "unless you add a seeder" line when this ships.

When this ships, add a DECISIONS entry that supersedes item "No cloud/seeder ever" of
2026-07-06.
