# Encrypted JSON backups (optional password)

**Goal** - let a user password-encrypt an exported backup file, and decrypt it on import, so a fertility/menstrual dataset is not sitting in plaintext on disk.

**Tier** - T3 (introduces crypto: a password-based encryption scheme + a new persisted file format). Not wire-affecting: no peer reads this file, no Hyperbee/swarm change. Blast radius is a single device's export file.

## Scope

What changes:
- **Worklet crypto (`src/petalMethods.js`)** - two pure helpers built on the `sodium-universal` already bundled for identity:
  - `encryptBackup(payload, password)`: Argon2id (`crypto_pwhash`, `ALG_ARGON2ID13`, INTERACTIVE limits = 2 ops / 64 MB) derives a 32-byte key from the password + a random 16-byte salt; `crypto_secretbox_easy` (XSalsa20-Poly1305) seals the UTF-8 JSON of the existing payload under a random 24-byte nonce.
  - `decryptBackup(wrapper, password)`: re-derives the key from the stored salt/limits and opens the box; a failed MAC (wrong password or tampering) throws `wrong password`.
- **IPC (additive, back-compat)**:
  - `export:data` gains an optional `password`. With it, returns the encrypted wrapper; without it, returns today's plaintext object (unchanged).
  - `import:data` gains an optional `password`. If the incoming object has an `enc` field it is decrypted first (password required); otherwise the existing plaintext path runs unchanged.
- **UI (`src/ui/App.jsx`, "Your data" settings section)**:
  - Export: an optional password field. Blank = plaintext file (the existing escape hatch). Filled = encrypted backup, with a warning that a forgotten password cannot be recovered.
  - Import: if the picked file is encrypted, a bottom-sheet prompts for the password; a wrong password shows an inline error and leaves the sheet open, with no partial write.

Encrypted wrapper format (the ciphertext seals the *exact* existing `{ app, version, exportedAt, days, periods, prefs }` payload, so decryption feeds straight into today's import logic):

```json
{ "app": "pearpetal", "version": 1,
  "enc": { "kdf": "argon2id", "opslimit": 2, "memlimit": 67108864,
           "salt": "<base64>", "nonce": "<base64>",
           "cipher": "xsalsa20poly1305", "ct": "<base64>" } }
```

What does NOT change:
- Plaintext export/import stays the default and stays fully supported (old backups still import; blank-password exports are still plaintext).
- No identity/secret keys are ever placed in a backup (unchanged from the slice-4 decision). The password protects the same user-entered payload, nothing more.
- No wire protocol, Hyperbee key/value, swarm topic, or pairing change.
- No new dependency (sodium-universal is already imported by the worklet).

## Compat

- **Old peers / old files**: irrelevant to peers (device-local file). An old-code app opening a *new encrypted* file: `import:data` rejects it as "not a PearPetal export" (the plaintext validator sees no `days` array) rather than mis-importing - acceptable, since encryption is opt-in and new. New-code app opening an *old plaintext* file: works unchanged.
- **Params in the wrapper**: `opslimit`/`memlimit`/`salt`/`nonce` travel in the file, so if the Argon2id cost is raised later, existing files still decrypt with their original params.
- Forgotten password is unrecoverable by construction; the UI states this before export.

## Verify

- `npm run verify` green.
- New node test (`test/backup-encryption.test.js`): round-trip an export with a password, assert (a) the serialized wrapper contains no plaintext date/notes substrings, (b) importing with the correct password reconstructs days/periods/prefs, (c) a wrong password throws `wrong password` and writes nothing, (d) a blank-password export still round-trips as plaintext.
- On-device smoke on the TCL: export encrypted, reinstall/fresh identity, import with the password, confirm the log + prediction reconstruct; confirm a wrong password errors cleanly.

## Rollback

Additive and opt-in. Reverting the commit restores plaintext-only export/import with no migration: any plaintext backups still import, and the feature simply disappears. Encrypted files made in the interim would need the feature re-applied to open (documented in the release notes if this ships then reverts).

## RCA readiness

The failure modes are local: a bad KDF/param mismatch surfaces immediately as a failed round-trip in the test and as "wrong password" on device (never a silent partial import - decryption happens before any write). If an encrypted export cannot be decrypted by its own password in prod, that is an RCA: capture the wrapper header (salt/nonce/limits, never the password), reproduce the KDF locally, and root-cause the param or encoding drift.
