# Apple Health / Health Connect import - feasibility

**Goal** - Answer the question `TODO.md` actually asked: can PearPetal import BBT and cycle
dates from HealthKit (iOS) and Health Connect (Android) **without weakening the privacy
guarantee**? Not how to wire it up - whether it can be wired up at all.

**Tier - T2** if built (a new native surface, a new writer into the private base, and a new
persisted field on `day:` rows). This document is the proposal gate for that work. It is
research only; no code changes with it.

## Verdict

**Yes - but two preconditions have to land first, and one of them is a bug that exists
today whether or not this feature is ever built.**

The import itself is clean: it is a one-way read we fully control, the store paperwork does
not force any claim that contradicts "nothing leaves your phones", and the private base's
date-keyed schema makes de-duplication free. What is NOT clean is where the private base
currently sits on disk.

## Finding 1 (blocker, and already true today): the cycle log is in the OS cloud backup

`app/index.tsx:179` puts the Corestore under `FileSystem.documentDirectory`. Tracing that
through Expo's own source:

- **iOS** - `expo-modules-core/ios/Core/AppContextConfig.swift:10` resolves it to
  `FileManager.default.urls(for: .documentDirectory, ...)`, i.e. `<sandbox>/Documents`.
  iOS includes that directory in **iCloud Backup** by default.
- **Android** - the generated `AndroidManifest.xml` carries `android:allowBackup="true"`
  with no `dataExtractionRules` or `fullBackupContent`, so the app's data directory is
  eligible for **Google Auto Backup** to the user's Drive.

Nothing in this repo sets `NSURLIsExcludedFromBackupKey` or opts out on either platform
(`grep -rn "ExcludedFromBackup"` finds nothing; app.json has no backup config).

So the full private cycle log - every logged day, flow, symptom, note and BBT - is
currently eligible to leave the phone via the platform's own backup, on both platforms, by
default. Meanwhile onboarding tells the user "Private tracking - no accounts, no servers.
Your data stays on your device," and the last onboarding screen says "Your cycle lives only
on your devices."

**Being fair about the severity.** Both backups are encrypted, and neither is a plaintext
upload:

- iCloud Backup is encrypted at rest, and with **Advanced Data Protection** on it is
  end-to-end encrypted. Without ADP (the default), Apple holds the keys and can be
  compelled to produce the backup.
- Android Auto Backup has been client-side encrypted with a key derived from the user's
  lockscreen secret since Android 9, and Google states it cannot read it. It also only runs
  if the user has backup enabled, and caps at 25 MB.

So this is "your data can leave the device in a form a third party might be compelled to
produce", not "your data is sitting in plaintext on a server". That is still not what the
copy promises, and for a menstrual tracker the compelled-production case is precisely the
threat the two-base design exists to answer.

**Why it blocks the import specifically.** App Store Review Guideline **5.1.3** says apps
"may not store personal health information in iCloud." Data read out of HealthKit and
written into a base that iOS then backs up to iCloud is exactly that. Today the data is
user-typed rather than HealthKit-derived, which is why this has not been a review problem;
the moment it comes from HealthKit, it is.

**Fix** (needed regardless, ~half a day): exclude the Corestore directory from backup on
both platforms. Both `ios/` and `android/` are generated, so this belongs in config plugins
next to the existing seven:

- iOS - set `NSURLIsExcludedFromBackupKey` on the data directory, or move the store to
  `Application Support` and exclude it there. Apple's guidance is that only
  non-user-generated content should be excluded from `Documents`, so moving it is the
  cleaner of the two.
- Android - `android:allowBackup="false"`, or keep backup on and exclude the store with
  `dataExtractionRules`. Prefer the targeted exclusion so the user's *settings* can still
  restore.

There is a real cost to name honestly: with the store excluded from backup, a user who
loses their only phone loses their log unless they used the existing recovery phrase or the
JSON export. That trade is already the app's stated position ("your cycle lives only on
your devices"), and the export/restore path already exists - but the fix makes the
consequence real, so the recovery-phrase prompt matters more after it than before.

## Finding 2: the "new trust edge" in the TODO is overstated

The TODO worried that the read has to run in the RN shell, "i.e. a new trust edge into the
private base". The shell is **already** fully trusted: it hosts the worklet, brokers every
IPC message, and can call `day:set` on any date today. A native health module in the shell
is not a new class of access.

What IS new, and worth stating plainly, is a code path that writes to the private base
**without the user having typed it**. The mitigations are UX, not architecture: an explicit
per-import confirmation showing what will be written, and never a background or automatic
sync in v1.

## Finding 3: one-way is entirely within our control

Both platforms separate read from write authorization, and we simply never ask for write:

- **HealthKit** - request only `toRead`, never `toShare`. With no share authorization the
  app *cannot* write back even if a later bug tried to.
- **Health Connect** - declare only `android.permission.health.READ_MENSTRUATION` and
  `READ_BASAL_BODY_TEMPERATURE`. No `WRITE_*` permission in the manifest means no
  write-back path exists.

A HealthKit quirk shapes the UX: **an app cannot tell whether a read permission was
denied**. Apple deliberately makes denial indistinguishable from "there is no such data",
because the denial itself would leak health information. So the import screen can never say
"you denied access" - only "no data found for that range", with a nudge to check Settings.
Worth designing for up front rather than discovering it in QA.

## Finding 4: the store paperwork does not force a contradictory claim

- **iOS** - needs the HealthKit entitlement plus `NSHealthShareUsageDescription`. Apple's
  App Privacy definition of "collect" is *transmitted off the device* in a way we can
  access; an on-device-only read is not collection, so the existing **Data Not Collected**
  label stays truthful. Both are prebuild-time concerns, so like the associated-domains
  entitlement they belong in a config plugin.
- **Android** - Health Connect requires the **Play Console health apps declaration form**,
  declaring the feature ("Period tracking") and justifying each data type. Without it,
  users get an error dialog and the app cannot read at all. Google's guidance is to request
  the minimum data types with specific user-facing justification, which is exactly our
  case. Play Data safety turns on the same transmitted-off-device definition, so it is also
  unchanged.

Neither store asks us to say anything that contradicts the privacy copy - **provided
Finding 1 is fixed first.**

## Finding 5: de-duplication is already free, provenance is additive

`day:` rows are **keyed by date** (`day:{yyyymmdd}`, see the wire protocol), not by author
or by import run. Re-importing the same range overwrites the same keys rather than
appending, so duplicate rows are structurally impossible. That is a real dividend of the
date-keyed decision made on 2026-07-06.

Provenance needs a `source` field (`'manual' | 'healthkit' | 'healthconnect'`) so the user
can tell what they typed from what was imported. `rowApplyDecision` in `src/petalWire.js`
validates *structure* (pubkey, updatedAt, signature, LWW ordering) and never whitelists
fields, and the signature covers the whole value - so an added field replicates and
verifies unchanged on an older peer, which simply ignores it in its UI. **Additive, no
migration.**

The one real hazard is LWW clobbering: an import must never overwrite a day the user
entered by hand. `period:log` already has exactly this rule ("never clobbers a day that
already has a flow"), so the import follows the same precedent - import fills gaps, it does
not overwrite.

## If built: scope

**In** - BBT (`HKQuantityTypeIdentifierBasalBodyTemperature` / `BasalBodyTemperatureRecord`)
and menstrual flow / period dates (`HKCategoryTypeIdentifierMenstrualFlow` /
`MenstruationFlowRecord`, `MenstruationPeriodRecord`). A user-initiated, explicitly
confirmed, one-shot import over a chosen date range. Gaps only, never overwriting.

**Out** - everything else HealthKit exposes (sexual activity, cervical mucus, ovulation
tests, symptoms), any write-back, any background or automatic sync, and anything touching a
shared base. A partner still only ever sees the consent-scoped projection, which is
computed from the private base and does not care where a row came from.

**Libraries** - `react-native-health-connect` (Expo config plugin, actively maintained as
of May 2026) on Android. On iOS, either an established HealthKit wrapper or a small Expo
module of our own - `modules/local-network/` is already the in-repo pattern for exactly
that, and a read-only two-type module is small enough that owning it may beat a dependency.

**Rough size** - the backup fix ~half a day; the import itself a few days per platform,
plus the Play declaration turnaround, which is a review queue and not in our control.

## Compat

Additive. The `source` field replicates to older peers unchanged (Finding 5). No wire
change, no new namespace, no migration. A device that never imports is indistinguishable
from today. The backup-exclusion fix changes no data format - only where the directory
lives and whether the OS copies it.

## Verify

- Unit: the merge rule accepts a `source`-carrying day row and an older-shaped row
  interchangeably; import never overwrites a day with existing user-entered data; a
  re-import of the same range produces no new keys.
- Device (iOS, real phone - the Simulator fakes HealthKit): permission prompt appears,
  data lands, and a denied read is handled as "no data found" rather than an error.
- Device (Android): Health Connect permission flow, and the graceful path when Health
  Connect is absent (it ships in Android 14+; below that it is a separate APK).
- Backup fix: confirm the store directory carries the exclusion on iOS, and that an
  Android backup no longer captures it.

## Rollback

The import is a user-initiated action behind a permission grant; removing it is deleting
the module, the plugin and the button. Imported rows are ordinary day rows and stay valid
with the feature gone. The backup-exclusion fix is independent and should NOT be rolled
back with it.

## Recommendation

1. **Do the backup exclusion now**, as its own T1/T2 change, independent of any import. It
   is a live gap between what the app promises and what the OS does.
2. **Then build the import if it is wanted.** It is genuinely compatible with the model:
   read-only, on-device, additive, and de-duplicated for free by the existing schema.
3. Do not build the import first. Doing so would move health data into a directory the OS
   copies to a cloud, which is both a 5.1.3 review risk and the exact thing the two-base
   split exists to prevent.

## Open questions

- Whether to drop Android backup entirely (`allowBackup="false"`) or keep it and exclude
  only the store. Excluding only the store keeps settings restorable; the simpler flag is
  easier to reason about and to state in the privacy copy.
- Whether the privacy copy should say something explicit about platform backups either way.
  After the fix it is accurate as written; a sentence naming it would be stronger.
- Whether the iOS side is worth a dependency or a ~200-line module of our own, following
  `modules/local-network/`.
