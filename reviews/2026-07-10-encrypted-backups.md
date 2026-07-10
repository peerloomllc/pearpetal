# Review - Optional password-encrypted JSON backups (T3)

**Shipped**: `proposals/2026-07-10-encrypted-backups.md`. Export can optionally seal a
backup file under a password; import decrypts it. Crypto runs in the worklet on the
already-bundled `sodium-universal`: Argon2id (`crypto_pwhash`, `ALG_ARGON2ID13`,
interactive limits) derives a secretbox key from the password + a random salt;
XSalsa20-Poly1305 seals the exact existing `{days,periods,prefs}` payload under a random
nonce. The wrapper is self-describing (salt/nonce/KDF params travel in the file). `export:data`
and `import:data` gained an optional `password` (additive, back-compat); decryption
completes before any DB write, so a wrong password never leaves a partial import. No
identity/secret key is ever placed in a backup, and plaintext export/import stays the
default. Shipped alongside (non-crypto, same PR): export saves to a user-picked SAF folder
(prompts each time, overwrites in place), friendly non-technical import errors, export/
import success modals, an onboarding rework (track-vs-view chooser, profile step for
everyone, restore folded into setup), the two-tone PearPetal wordmark, and a System theme
default that reliably follows the OS (`userInterfaceStyle: automatic` + shell-injected OS
scheme).

**Signed off**: Tim, 2026-07-10, by squash-merging PR #55 (Constitution §3). Prepared by
Claude.

**Notes**: Not wire-affecting - no peer reads this file, no Hyperbee/swarm/pairing change;
the T3 tier is on the security-critical (crypto) axis only. Additive and opt-in, so
rollback is a plain revert with no migration (plaintext backups still import; files
encrypted in the interim would need the feature re-applied to open). Forgotten password is
unrecoverable by construction and the UI states this before export. RCA readiness:
decryption happens before any write, so failures surface as "wrong password" on device and
as a failed round-trip in the test rather than a silent partial import; an encrypted export
that cannot open with its own password in prod is an RCA (capture the wrapper header - salt/
nonce/limits, never the password - and reproduce the KDF locally). Verify: `npm run verify`
green (89 tests, incl. `test/backup-encryption.test.js` proving opaque ciphertext, correct-
password reconstruction, wrong-password rejection with no write, and a plaintext round-trip),
plus on-device confirmation on the TCL (encrypted export -> import round trip, folder save,
friendly errors, success modals, onboarding restore, System theme following the OS). iOS
follow-up: the next iPhone build needs a fresh `expo prebuild` (rm -rf ios) to pick up
`userInterfaceStyle: automatic`.
