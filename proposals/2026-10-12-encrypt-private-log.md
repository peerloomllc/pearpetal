# Encrypt the private cycle log

**Status**: Approved by Tim 2026-10-12. Open questions decided the same day: the old
copy stays until the user confirms deleting it (question 1), and PearList keeps
device-link off until this ships (question 2).

**Goal**: Give device-link's personal base, which holds PearPetal's private cycle log,
the block encryption DECISIONS 2026-07-06 promised, and move every existing user's
log onto an encrypted base without losing data.

**Tier**: T3. Key management, a change to the device-link pairing message, a move of
every user's private data and a new swarm topic. Lives here because device-link's
`CLAUDE.md` puts T3 proposals in the consuming app.

## What is wrong today

- DECISIONS 2026-07-06 item 6: "Block-encryption: always-on, no toggle, both bases."
  That held for the old private base, a core group, which core always encrypts.
- The 2026-07-12 move onto device-link (`proposals/2026-07-12-adopt-device-link.md`)
  put the log in device-link's personal base. It is built as
  `new Autobase(ns, bootstrap, { open, apply, valueEncoding })`
  (`peerloom-device-link/src/personal.js:407`) with no `encryptionKey`.
- It is found on the DHT under the raw base key (`personal.js:431`). Core hashes its
  keys into topics (`peerloom-core/src/swarm.js`); device-link does not.
- Every PearPetal release from v1.0.1 (2026-07-16) to v1.0.8 has this. Anyone who learns
  a user's personal base key can replicate and read their day and period rows. The key
  only travels between the user's own devices, so this needs a leaked key, but nothing
  else stands between that key and the cycle log.
- It also rules out a blind seeder for PearPetal (suite
  `proposals/2026-10-12-generic-seeder.md`), which is why this was found.
- PearList ships device-link turned off (`DEVICE_LINK_ENABLED = false`,
  `pearlist/src/deviceLink.js:65`), so no PearList user has a personal base. When it is
  turned on it will hold each space's join keys, so it needs this too.

## Scope

### 1. New personal bases are encrypted (device-link)

- `openPersonalBase` passes an `encryptionKey`. A founder mints it at random (32 bytes,
  as core's `newEncryptionKey`). Autobase keeps it in the local writer core's userData,
  so later opens find it.
- Also kept in localDb `personalMeta:encryptionKey`, next to `personalMeta:bootstrap`.
- Swarm topic becomes `blake2b("peerloom/personal-topic/v1" || baseKey)`, joined only for
  encrypted bases. Old bases keep the raw key so old devices still find them.
- `rotatePersonalBase` (removing a device) mints a fresh key with the fresh base, so a
  removed device learns neither.
- A random key rather than one derived from the recovery phrase. Every linked device
  holds the phrase, and so does a removed device, which could then derive the key for any
  base whose bootstrap it learned.

### 2. Linking sends the key (device-link pairing)

- `hello` gains `caps: ['encBase1']`. `granted` gains `encryptionKey` when the base has one.
- A primary with an encrypted base refuses a `hello` without `encBase1`:
  "Update PearPetal on this phone first." An old app would otherwise open the base
  without the key and read nothing.
- A new secondary paired to an old primary gets no key and opens the base unencrypted,
  as today. Part 3 moves it later.

### 3. Existing users move to an encrypted base (device-link, driven by the app)

Autobase cannot switch an existing base to encrypted (`autobase/lib/boot.js` would set a
key over cores that already hold plain blocks), so each user moves to a fresh base. The
pattern is PearOffice's `moves.js` and PearPetal's own `migrateIfNeeded`
(`petalMethods.js:349-382`).

- **When.** Every device advertises `caps: ['encBase1']` on its own `deviceMeta` row (an
  added field, which old versions store as is). A device moves the log only when every
  device in the roster advertises it. One phone is the common case and moves at once.
  Until all devices are updated nothing moves, so no device is left writing to a base the
  others have left.
- **Who.** Any updated device may start. It appends a `personalMove` op to the old base.
  The first `personalMove` in the linearized order wins; a device that started its own
  copy and sees an earlier one drops its copy and follows. Old versions ignore the op
  type (`personal.js` handles only the types it knows).
- **The copy.** The mover opens a new encrypted base at the next epoch namespace and copies
  every row the app registered (`day:`, `period:`, `ownerPrefs`), `identityProfile` and its
  own `deviceMeta`. Rows keep their original signatures (`signValue` per device), so
  `verifyValue` still passes.
- **Handing over the key.** `personalMove` carries the new bootstrap and the new
  encryption key sealed (`crypto_box_seal`) to each current device's writer key,
  converted to curve25519. The old base is readable by anyone with its key, so the
  new key never goes into it in the clear. Devices already removed get no entry.
- **Following.** A device that sees `personalMove` opens its entry, opens the new base,
  and sends the mover its new writer key over the pairing protocol's `personalWriter` leg
  on the new topic, signed with its old writer key. The mover checks the signer is in the
  old roster and appends `addWriter`. It resends until admitted, as PearOffice's
  `followDevice` does.
- **The old base.** Frozen: after `personalMove`, updated devices stop writing to it and
  stop joining its topic. It stays on disk until the user deletes it. Once the move is
  done, Settings shows "Your log is now encrypted. Delete the old unencrypted copy from
  this phone?" with Delete and Not now. Each phone asks for its own copy. Until then it
  stays readable to anyone with its key, and it is the copy an older version opens.
  `personalMeta:bootstrap` keeps pointing at it; the new base goes in
  `personalMeta:bootstrap2` so an older app version never opens the encrypted base
  without its key.

### Not in scope

- Restoring the log from the recovery phrase. Device-link has no such feature.
- Seeding PearPetal. Once this ships, adding a seeder still means reversing DECISIONS
  2026-07-06 ("No cloud/seeder ever"), which needs its own decision.
- The leftover pre-device-link private core group on disk. It is encrypted already.

## Compat

| Devices | Result |
| --- | --- |
| All on the new version | Log moves to an encrypted base; new links send the key |
| Some still old | Nothing moves; linking a new phone from a new primary still works on the old base |
| Old secondary, new primary with an encrypted base | Link refused with "update first" |
| New secondary, old primary | Links to the unencrypted base as today, moves once both are new |
| Downgrade after the move | Older app opens the old base: data from before the move, nothing after |

## Verify

- Device-link unit tests: `hello` caps, `granted` carries the key, refusal without caps,
  `personalMove` sealing and opening, first-move-wins.
- Integration (`npm run test:integration`): two linked devices on an old unencrypted base,
  both updated, the move runs, both end on the new base with every row, the new base's
  blocks hold no plaintext (scan raw blocks for a known day note, as PearOffice's seeder
  test does), the old base gets no new writes. A removed device cannot open the move.
- PearPetal: `test/deviceLink.test.js` and `privateStore.test.js` over the new base; an
  upgrade test from a v1.0.8 data folder.
- Hardware per rule 15. Moving two linked devices needs two peers: one emulator and the
  TCL. Then an iPhone SE run, since the iOS worklet is where addon and keystore problems
  show.

## Rollback

- Before the move ships to users: revert device-link and the app.
- After: the old base stays on disk until the user deletes it, so an older version still
  opens the pre-move log. Data written after the move would only be in the encrypted base. A
  fix-forward release is the expected path.

## Decided

1. The old unencrypted base is deleted only when the user confirms, per phone (Tim,
   2026-10-12).
2. PearList keeps device-link off until this ships, so it never has an unencrypted
   personal base (Tim, 2026-10-12).
