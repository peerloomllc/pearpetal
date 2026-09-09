# PearPetal - Done

Chronological log of shipped work, newest first. One line (or few) per item with
its date + PR. Deep rationale for T2/T3 changes lives in `DECISIONS.md`; open
work lives in `TODO.md`.

## 2026-09-09

- **The app can be locked now** (PR pending). The biggest of the three feature gaps from
  the review: nothing biometric or PIN existed anywhere, so anyone holding an unlocked
  phone opened straight into her cycle.
  Face ID / fingerprint with the phone's own passcode as the fallback (`expo-local-
  authentication`), off by default. It lives in the SHELL rather than the WebView UI,
  because only the shell can cover the screen before the first frame is drawn and before
  the OS takes the app-switcher snapshot. Re-locks after about a minute in the background,
  so a share sheet or photo picker does not nag.
  IT CANNOT LOCK ANYONE OUT, by three separate guards: it refuses to arm unless the phone
  can authenticate; it makes you unlock once BEFORE arming, so it never arms on something
  you cannot open; and if enrolment later disappears it switches itself off and lets you in
  rather than stranding you with health data nobody can reach. The setting says plainly
  that this rests on the phone's own unlock, so somebody who knows the passcode still gets
  in - it stops a person picking up an unlocked phone, not one who can unlock it.
  TWO DEFECTS FOUND BY DRIVING THE TCL, both mine, both fixed:
  1. React error #310 - a `useEffect` added BELOW the component's early return, so the
     hook count changed the moment state arrived and the whole Settings screen went down.
     The ErrorBoundary from PR #123 caught it and showed a readable message rather than a
     blank screen, which is that work paying off in the field.
  2. The refusal note rendered inside the COLLAPSED card, so a toggle that refused looked
     like a dead control. Anything worth saying now opens the card, and the note quotes
     the phone's own reason instead of swallowing it into a boolean.
  VERIFIED ON THE TCL (Android 15). By script: the card renders, the prompt appears with
  "Use PIN" offered as the fallback, and cancelling refuses to arm and explains itself
  ("your phone did not accept the unlock (user_cancel)"). By hand, since no script can
  present a fingerprint: armed with a real fingerprint and all three behaviours confirmed -
  the app switcher shows the cover rather than the cycle, a quick trip out to a share sheet
  does NOT re-prompt, and a minute away does. The switcher one was worth proving rather than
  reasoning about: it is a race between our cover going up on 'inactive' and the system
  taking its snapshot. `npm run verify` green, 230 tests.
  ALSO SETTLED: the "Use PIN" button looks left-aligned under a centred title and cannot be
  moved - it is `com.android.systemui:id/button_use_credential`, drawn by the system, the
  same in every app on the phone. See `TODO.md` so it is not raised again.

- **A period logged on the wrong date can be corrected now** (PR pending). The last of the
  three bugs from the review. `period:getAll` and `period:set` existed and NOTHING called
  them, and no delete existed at any layer, so a mistyped start skewed the cycle-length
  median forever with no way back short of reinstalling.
  New: `period:delete`, a `from` argument on `period:log` that MOVES a period rather than
  writing a second row (the row is keyed by its start, which is why a typo was permanent),
  and a "Your periods" section in Cycle Settings listing every period with edit and remove.
  THE SUBTLE PART: deleting the span row alone changes nothing a person can see, because
  `cycleStarts()` derives a start from a run of BLEEDING DAYS as well as from a period row,
  and `period:log` stamps a medium flow across the span. So a delete clears the flow on
  those days too; symptoms, mood, notes and temperatures are kept.
  TWO DEFECTS FOUND BY DRIVING THE TCL, not by the tests, both fixed and now covered:
  1. The list showed only explicit period rows, so it read "No periods logged yet" on a
     phone with a full log and a live prediction on the screen behind it. Starts inferred
     from logged days are now listed, flagged "from the days you logged", and removable
     (which clears the whole run, since clearing only the first day promotes the second).
  2. A one-day inferred bleed rendered as "Jul 16 - ongoing", because a null end means
     ongoing on an explicit row. Inferred runs always carry an end now.
  VERIFIED ON THE TCL (`com.pearpetal.debug`, arm64), driven through uiautomator: the
  section lists the starts, the confirmation names the date and says what it clears, and
  removing one moved the dial from "Luteal day 28, next period Sep 10" to "Menstrual day 2,
  next period Oct 6". `npm run verify` green, 230 tests (10 new).
  NOTE the emulator could not be used: `android/gradle.properties` pins
  `reactNativeArchitectures=arm64-v8a`, so the debug APK carries no x86_64 libraries and
  crashes on an x86_64 AVD with `SoLoaderDSONotFoundError: libreactnative.so`. Rule 15's
  virtual-first needs `-PreactNativeArchitectures=arm64-v8a,x86_64` for an emulator run.

- **A backup now restores everything it saved** (PR pending). Found in the same review pass.
  `export:data` wrote five prefs and no profile, and `import:data` carried a SECOND, shorter
  whitelist of its own, so moving to a new phone silently dropped everything shaping the
  prediction: goal `pregnant` -> `track`, pregnancy dates -> null, conditions
  `["pcos","thyroid"]` -> `[]`, birthControl true -> false, display name "Ada" -> "".
  Days and periods survived, so nothing looked wrong. The App Store text sells backups as
  the way to move phones.
  Fixed at the cause rather than by lengthening two lists: `applyPrefsPatch` is now the
  ONE prefs whitelist that `prefs:set` and `import:data` both go through, `BACKUP_PREFS`
  is the one export list, and `applyProfile` is shared by `profile:set` and the restore, so
  a restore gets the same validation an edit does (avatar size cap and content-hash dedupe
  included). The avatar travels as a data URL, since its blob reference means nothing on the
  phone being restored onto.
  VERIFIED: `npm run verify` green, 220 tests (5 new, covering plain and encrypted backups,
  the profile, the cycle log and a guard that fails if a pref is ever shown to the user but
  left out of the backup). Run against the OLD code to confirm they catch it: 4 of 5 fail.
  An old-format backup still imports, with the new fields simply absent.

- **"Today" is the phone's day now, not UTC's** (PR pending). Found in a review pass. The
  screen read the LOCAL calendar date and the engine read the UTC one, so the two disagreed
  for part of every day anywhere but UTC. East of UTC that refused a core action outright:
  logging a period between local midnight and mid-morning failed with "start is in the
  future", for every user in Japan, Korea, China, Australia and New Zealand, every morning.
  West of UTC the dial counted a day further into the cycle than the calendar did all
  evening, and an ongoing period stamped tomorrow as a bleeding day.
  `todayIso()` in `src/prediction.js` now reads the local calendar date; the date ARITHMETIC
  stays UTC-based on purpose, since it is date-only and UTC keeps it free of DST. The UI also
  states its own day on `period:log`, as a guard against a worklet that comes up without the
  phone's timezone. Confirmed the Bare runtime honours TZ before relying on it.
  VERIFIED: `npm run verify` green, 215 tests (3 new, across five timezones from UTC+14 to
  UTC-11), and the new tests were run against the OLD code to confirm they fail on it, 2 of 3
  failing. The third passes on the old code, which is the UI-supplied date carrying it alone.

- **The viewer's shared list now matches the owner's** (PR #128). Two touches the owner's
  Sharing screen already had and `ViewerHome` never picked up: "Shared with you" is centred
  rather than nudged left, and the share type in each row is capitalised, so a row reads
  "Ada's cycle  Full". The capitalisation is scoped to the share type; "Sharing ended" and
  "Will not open" are left alone so they do not come out title-cased. Seen on the iPhone SE,
  a real paired viewer of a `full` share.

- **The partner-viewer blank screen: found, reproduced and fixed** (PR #127, peerloom-core
  PR #20). Reported since August, survived PR #123's six defences, and hit again on 1.0.5.
  It was a loop we wrote: `partner:view` published the viewer's member row on every call,
  the append changed the view, the view change emitted `group:updated`, and the partner
  screen answered `group:updated` by calling `partner:view`. About eight appends a second
  with nobody touching either phone - 888 rows in 45 seconds. Past 512 rows the retention
  sweep began clearing the viewer's OWN input core, blocks no other device is obliged to
  hold, and the next cold start hung in `init()` forever behind a bare background. Every
  detail of the report falls out of that, including why only a reinstall cured it and why
  a re-pair bought a few more days.
  Six changes across two repos: the row is published only when it changes; `retain()` never
  clears the local input core; `init()` bounds each mount and joins the topic either way;
  reading a partner's cycle falls through to stored data rather than waiting on their phone;
  `partner:repair` rebuilds a broken shared cycle on-device with no new invite; and the boot
  splash says something instead of showing a wordless screen for 45 seconds.
  VERIFIED at the engine level with two real Hyperswarm peers on a DHT testnet, PearPetal's
  own method table and the shipped retention settings, by re-running the reproduction
  against the fix: 888 rows becomes 4, the sweep clears nothing, and a cold start with the
  partner offline goes from hanging forever to `init` in 23ms with the cycle on screen in
  5ms. `npm run verify` green, 212 tests (4 new). NOT yet verified on hardware - see
  `TODO.md`. Rationale in `DECISIONS.md`.

## 2026-08-21

- **Support development is back on the iOS About page** (PR #126). PR #121 hid every donation
  surface on iOS after Apple cited Guideline 3.1.1 on 1.0.4 build 13; this brings back the
  passive half. BACK: the About accordion row, which a person has to go looking for and then
  open. STILL OFF: the two-week nudge, the modal that surfaces itself uninvited, which is the
  surface a reviewer reads as soliciting. Its gate now carries that reason instead of the old
  one (that it pointed at a section which was not there).
  VERIFIED ON THE iOS SIMULATOR (iPhone 17 Pro, iOS 26.5, Release), driven through
  WebDriverAgent rather than read off the source: fresh install, full onboarding, About ->
  "Support development" present and expanding, and the Bitcoin button opens the Lightning
  sheet with the address, the QR option, the on-chain address and the wallet list. Note the
  a11y dump does NOT show that sheet (a WebView overlay), so the screenshot is what proved it -
  a dump alone would have read as "nothing happened".
  Rides a later build; 1.0.4 build 14 is with Apple and shipped with donations hidden.

- **`app/index.tsx` was a BINARY file to git** (PR #125). `sanitizeFilename`'s character class
  held a raw NUL byte rather than an escape, so every diff on the shell read
  `Bin 35998 -> 36840 bytes` with no content, and `grep` skipped the file entirely while
  returning exit code 0 - a search that should hit just looked like a miss. Found while trying
  to review PRs #123 and #124, both of which are unreadable diffs because of it. Escaped to
  `\x00`; the regex is identical, checked against the raw-byte form on path separators,
  padding, an embedded NUL and a plain name. It was the only tracked source file with a NUL.

- **The iOS WebView recovery from PR #123 did not actually recover** (PR #124). Caught by
  testing it rather than trusting it. `onContentProcessDidTerminate` fired correctly, but its
  `reload()` is wrong for this app: the source is an html STRING with
  `baseUrl https://localhost/`, and WKWebView's reload re-requests that URL, which nothing
  serves, so the view sat on the loading spinner forever - one permanent dead end swapped for
  another. Remounting the WebView (bump its `key`) drops the dead view and loads the html
  string again from scratch. Android keeps `reload()`, which works there and is proven in the
  field.
  VERIFIED ON THE iOS SIMULATOR (iPhone 17 Pro, iOS 26.5, Release build) by killing
  `com.apple.WebKit.WebContent` under a running app: with `reload()` it span indefinitely,
  with the remount the app is back on its screen within seconds. That is a real end-to-end
  exercise of the jettison path, not a config read.

## 2026-08-20

- **The blank screen is gone: a stalled engine now says so instead of showing nothing**
  (PR #123). Reported by an iOS partner-viewer: the app opened to a bare dark screen with
  no bottom nav, so About was unreachable; it worked for a few days after each pair, then
  stopped, and only a reinstall plus re-pair brought it back. The screenshot was
  `#140f11` in every pixel, which is our own `--color-surface-base`, so the app was running
  and had painted its background and nothing else. Two places render exactly that: the
  shell while `html` is null, and `App.jsx` while `mode` is null (which also hides the nav).
  Neither could ever recover, because nothing in the chain had a timeout: `callRaw`,
  `realCall`, `boot()` and hypercore itself (`timeout` defaults to 0) all wait forever, and
  a `.catch()` does nothing for a promise that never settles.
  Six changes, each closing one way to end up staring at a background:
  1. `cycle:status` is now LOCAL-ONLY and carries the partner count, so `boot()` makes one
     call that cannot block. It used to follow up with `partner:list`, which does
     `base.update()` per shared base and waits on a peer - a viewer whose partner was
     offline sat there forever. It also read `ps.exists()`, which opens the personal
     Autobase; it reads the `personalMeta:bootstrap` row instead, the same signal
     device-link's own `start()` gates on.
  2. `maybeSeedOwnerState` is no longer awaited in the method wrapper. It is a best-effort
     publish that nothing reads back, and awaiting it put `getDeviceLink -> dl.start()` in
     front of EVERY method including `cycle:status`. `migrateIfNeeded` stays awaited.
  3. Every worklet call is bounded (20s, 180s for pairing/import, and a UI-side backstop),
     so a stall becomes a visible error rather than silence.
  4. A boot watchdog in the shell (45s) covers the rest of the chain - asset reads,
     `Worklet.start`, init - none of which went through `callRaw`.
  5. `onContentProcessDidTerminate` on the WebView. We recovered the Android renderer
     (`onRenderProcessGone`) but had no iOS equivalent, so a WKWebView content process
     jettisoned under memory pressure left a permanently blank view showing the container
     colour - our colour, hence the same symptom.
  6. An `ErrorBoundary` plus window `error`/`unhandledrejection` handlers, so a UI crash
     shows words instead of unmounting to an empty `#root`.
  The failure page and the in-app error screen are written for the person holding the phone
  and quote the raw reason, so the next report arrives with the cause attached.
  Verified: `npm run verify` green, 208 tests (3 new). VERIFIED ON THE ANDROID EMULATOR
  (Pixel_9 AVD, x86_64 - the debug script defaults to arm64-v8a, so an emulator run needs
  `ABIS=x86_64`): clean build boots to onboarding, and a build with `cycle:status`
  deliberately pointed at a non-existent method renders "PearPetal could not start" with a
  Try again button and `unknown method: ...` quoted underneath, where the old code showed
  nothing at all. Not yet exercised on an iOS Simulator or the iPhone SE, and the reporter's
  ROOT CAUSE IS STILL UNCONFIRMED - see the open item in `TODO.md`.
  VERIFIED ON HARDWARE AND ON iOS the same day: the TCL (existing populated install,
  cycle day 9, 10 recent days) upgrades and boots straight into the owner view, which is
  the case that matters - `cycle:status` reading the `personalMeta:bootstrap` row on a
  store that already has data. The iOS Simulator (iPhone 17 Pro, Release) boots to
  onboarding, so the worklet answers on iOS too. Also installed to the Pixel 9 and the
  iPhone SE; neither was driven (rule 6 keeps the Pixel observe-only, and the SE cannot be
  launched headlessly without a mounted DDI), so those two are INSTALLED, NOT VERIFIED.

## 2026-08-11

- **1.0.4 build 14 resubmitted to the App Store after the 3.1.1 rejection** (PR #122 for the
  build-number bump; the fix itself is PR #121). Apple rejected build 13 under Guideline
  3.1.1 - donations collected outside in-app purchase. No version bump: the 1.0.4 record was
  REJECTED, which is editable, and 1.0.1 is still live, so the same record got a fresh
  binary. Sequence: `expo.ios.buildNumber` 13 -> 14, `npm run verify` green, archive +
  altool validate + upload on the Mac mini via `scripts/ios-appstore.sh`, wait for build 14
  to reach VALID, attach to the version record, declare no non-exempt encryption (Tim's
  call, matching every prior build), add an App Review note naming the removed donation
  surfaces, then submit.
  ONE GOTCHA WORTH KEEPING: a new review submission cannot take the version while the
  REJECTED one still holds it - `items-add` fails with "already added to another
  reviewSubmission". Cancel the old submission first
  (`asc review submissions-update --id <old> --canceled=true`), let it reach COMPLETE, then
  add and submit. Now WAITING_FOR_REVIEW, submission 43d74827, submitted 2026-08-11.

- **Donation path hidden on iOS** (PR #121). App Store Review Guideline 3.1.1 does not
  allow collecting donations outside in-app purchase, so on iOS the About page drops the
  "Support development" section and the two-week donation nudge never fires. Android is
  unchanged. One `IS_IOS` gate in `src/ui/App.jsx` reading `window.__pearPlatform`, which
  the shell already injects before the UI bundle runs. "Learn about Bitcoin" stays - it is
  educational, not a solicitation. Verified by `node --test test/*.test.js` (205/205 pass)
  and `npm run build:ui`; not yet exercised on an iOS Simulator.

## 2026-07-31

- **1.0.4 submitted to the App Store, superseding the stuck 1.0.3** (no PR - App Store
  Connect state, not code). 1.0.3 had sat in WAITING_FOR_REVIEW since 2026-07-24 with build
  9 attached, seven days against Apple's usual 24-48h, and Apple allows only one version in
  flight - so nothing could ship until it moved. Checked BEFORE cancelling that it was not
  blocked on anything of ours: the submission item read READY_FOR_REVIEW with `canceled`
  unset, so it was queued, not stalled on a missing answer.
  Done via the App Store Connect REST API, following the rules `release.sh` already encodes
  in its own version-record step: cancel the review submission, wait for the version to land
  in an EDITABLE state (it became DEVELOPER_REJECTED), then RENAME that record 1.0.3 -> 1.0.4
  rather than creating a new one - Apple's supported way to supersede an unreleased version,
  and it preserves the screenshots and listing already on it. Then attached build 13,
  replaced `whatsNew` with the 1.0.4 notes (1907 chars, all ASCII), created a review
  submission, added the version as its item and submitted.
  Final state: 1.0.4 WAITING_FOR_REVIEW, build 13, releaseType AFTER_APPROVAL, so it goes
  live by itself once approved. 1.0.1 remains READY_FOR_SALE until then.
  WHY THE RELEASE SCRIPT COULD NOT DO THIS ITSELF, and it was right not to: `release.sh`
  classifies WAITING_FOR_REVIEW as BLOCKING - "Apple owns it, nothing local can fix it" - and
  skips its metadata and submission steps with one message instead of a cascade of warnings.
  That is why the 1.0.4 run left no version record. The script was not broken; cancelling a
  queued submission is a human decision it deliberately will not make.
  THEN RESUBMITTED with combined notes, same evening, because the first submission's notes
  covered only v1.0.3..v1.0.4 - right for Play, wrong for a store whose live version is
  1.0.1. Cancelled again (the version returns to DEVELOPER_REJECTED within a minute or two),
  replaced `whatsNew` with a 3274-char version spanning both releases, resubmitted.
  Final: 1.0.4 WAITING_FOR_REVIEW, build 13, 3274 chars of notes, AFTER_APPROVAL.
  `metadata/ios/version/1.0.4/en-US.json` updated to match what was actually sent, so the
  repo and App Store Connect do not disagree.
  THE SPAN WAS DECIDED ON CONTENT, not version numbers. The store has published only 1.0 and
  1.0.1; 1.0.2's record was itself renamed to 1.0.3 back on 2026-07-23 for the same
  queue-stall reason, so neither shipped. But 1.0.2's only user-visible change was the
  GrapheneOS WebView resume-freeze, which is Android-only - nothing an iPhone user could
  notice - so spanning 1.0.3..1.0.4 loses nothing. The notes open "This one covers two
  releases" rather than naming versions, which sidesteps the question for the reader.
  Combined notes add Connect anywhere, Connection details, the tidier Settings screen and
  the dial/month-switcher overlap fix to the 1.0.4 entries.

- **The HealthKit WRITE purpose string, and a validate-before-upload gate** (PR #120).
  Build 12 was rejected too, same ITMS-90683, this time naming
  `NSHealthUpdateUsageDescription` - the WRITE string that PR #117 deliberately withheld and
  recorded as "a structural guarantee, not an oversight".
  APPLE IS UNMOVABLE, and their own trigger text says why: "references one or more APIs ...
  OR the app has one or more entitlements that permit such access". The
  `com.apple.developer.healthkit` entitlement permits reading AND writing and has no
  read-only variant, so both strings are required for any app carrying it, whatever the code
  does. `HealthReadModule.swift` calls `requestAuthorization(toShare: nil, read:)` and has no
  `save()` or `delete()` at all - it made no difference.
  HOW IT WAS DIAGNOSED, worth reusing: the build never appeared in App Store Connect - no
  1.0.4 train, nothing in `PROCESSING` after 40 minutes - which is exactly what a validation
  rejection looks like from outside, and is why build 11 was invisible too. Rather than wait
  for the email, `xcrun altool --validate-app` was run against the IPA already uploaded and
  reproduced the rejection in two minutes, naming the key.
  THE GUARANTEE DID NOT CHANGE, only how it is stated - see `DECISIONS.md` 2026-07-31. It
  never rested on the missing key: a purpose string is prompt text, not an authorization,
  and no user can ever see this one because only a write request displays it. Honest cost
  recorded there too - "the key is absent" was checkable in one grep against the IPA, while
  "the app never asks to share" makes an auditor open the Swift.
  PROCESS FIX shipped with it: `ios-appstore.sh` now runs `--validate-app` BEFORE uploading
  and refuses to upload on failure, and the PR #119 preflight now checks both keys. Two
  rejections each cost a 20-minute archive, an upload and a wait for an email a human had to
  read, for an answer Apple gives in two minutes.
  VERIFIED, and the gate proved itself on its first real run: preflight passed with both
  keys, ARCHIVE and EXPORT succeeded, then Apple's validator returned "No errors validating
  archive" - the same check that had rejected 11 and 12 - and only then did the upload
  commit. Build 13 processed to state VALID in App Store Connect and the 1.0.4 train now
  exists, so the ITMS-90683 loop is closed. `npm run verify` green at 205 tests.
  FOUND WHILE CONFIRMING IT, logged in `TODO.md`: iOS is two releases behind. 1.0.1 is what
  App Store users can install; 1.0.3 has been WAITING_FOR_REVIEW since 2026-07-21. No 1.0.4
  version record can be created until that one moves.

## 2026-07-30

- **The App Store build was missing the HealthKit purpose string** (PR #119). The 1.0.4 iOS
  upload bounced with `ITMS-90683: Missing purpose string in Info.plist ... should contain a
  NSHealthShareUsageDescription key`. Android, GitHub and Zapstore all shipped fine; only
  the iOS binary was rejected, during ASC processing rather than review.
  CAUSE: `with-ios-healthkit` gates BOTH the entitlement and the usage string on
  `PEARPETAL_HEALTHKIT` at prebuild time and strips them when unset - correct and
  deliberate, since an unconditional entitlement fails to sign against a profile without the
  capability. But `scripts/app.conf` exported `PEARPETAL_ASSOCIATED_DOMAINS` and never
  `PEARPETAL_HEALTHKIT`, and `ios-appstore.sh` prebuilds from that config on the Mac.
  Confirmed after the fact on the Mac mini: `PlistBuddy` reported the key "Does Not Exist"
  and the entitlements file carried associated-domains alone.
  THE REJECTION IS THE SMALLER HALF, and this is the part worth remembering. Apple's scan
  keys off LINKED SYMBOLS, and `modules/health-read` links HealthKit unconditionally, so the
  binary referenced the APIs whichever way the flag was set. Had review passed it, the iOS
  Health import shipped in #117 would have been DEAD in the App Store build - HKHealthStore
  refuses at runtime without the entitlement the same missing flag stripped. A green archive
  was hiding a broken feature; the ITMS code is what made it visible.
  Fixed three ways: `app.conf` exports the flag; `ios-appstore.sh` now preflights the
  Info.plist straight after prebuild and refuses to archive when `modules/health-read` is in
  the tree with no usage string (the test is "is the module present", not "is the flag set",
  matching what Apple actually scans); iOS buildNumber 11 -> 12, since 11 was uploaded and
  discarded during processing and never became a build record in ASC.
  Verified: a real `expo prebuild -p ios` with the fixed config yields the usage string plus
  entitlements [associated-domains, healthkit], and STILL no `NSHealthUpdateUsageDescription`
  and no `healthkit.access`, so #117's structural read-only guarantee is intact. The ASC API
  confirms App ID `com.pearpetal` (876K75ZSMS) carries the HEALTHKIT capability.
  `npm run verify` green at 205 tests.
  THE PROFILE HALF, done the same evening: the "PearPetal App Store" distribution profile
  (353HK3RAQ7, created 2026-07-10) predated the capability and the API reported it INVALID -
  enabling a capability invalidates existing profiles server-side while a cached local copy
  keeps signing archives, which is why 1.0.4 archived at all. Tim regenerated it in the
  portal; installed on the Mac as `e5eb05eb-ac3a-438a-a585-109533dca388` and the stale file
  deleted, since manual signing matches by NAME and two files claiming one name is how the
  wrong one gets picked. Checked before archiving rather than after: the new profile carries
  `com.apple.developer.healthkit`, has no ProvisionedDevices (a real distribution profile)
  and trusts cert `0A9CD425...`, which is present in the Mac's keychain.
  RESUBMITTED as build 12 (1.0.4). The preflight added above passed on the Mac - its first
  real run - then ARCHIVE and EXPORT succeeded and `asc` committed the upload. Verified on
  the exported IPA itself, not on the intermediate archive: `NSHealthShareUsageDescription`
  present, `NSHealthUpdateUsageDescription` ABSENT, CFBundleVersion 12 / 1.0.4, entitlements
  [associated-domains, healthkit] with `get-task-allow=false`, and the embedded profile is
  the new UUID. Note the .xcarchive still shows `get-task-allow=true`; the export step
  re-signs for distribution, so the archive is the wrong thing to check.
  MAC BUILD-HOST NOTE, cost a wrong instruction first time: `~/peerloomllc/pearpetal` on the
  Mac mini is NOT a git checkout. `release.sh` rsyncs the tree there and then runs
  `ios-appstore.sh` over SSH, despite that script's header saying "not via SSH" - the header
  is stale relative to how the release pipeline actually drives it.

- **The release version-bump commit no longer aborts on a gitignored path** (PR #118).
  Found the hard way mid-release: `scripts/release.sh 1.0.4` died at step 6 with "The
  following paths are ignored by one of your .gitignore files: ios". The step commits the
  version bumps before tagging from an explicit allowlist, and that allowlist carries
  `$XCODE_PROJECT` - tracked in the sibling app the step was ported from, GITIGNORED here
  because `/ios/` is regenerated by `expo prebuild`. `git add` exits 1 on an ignored path
  and `set -euo pipefail` turned that into an abort of the whole release.
  THE COST IS THE POSITION, not the bug: the abort lands after verify, after the bundle
  builds, after the signed APK and AAB, and after the final "ready to publish?" confirm,
  but before the commit, tag and push. So nothing irreversible ran and nothing was
  salvageable either - there is no resume flag, so the run restarts from the top.
  Fixed by filtering the allowlist through `git check-ignore`, logging what was skipped.
  Verified: `bash -n` clean; the loop in isolation under `set -euo pipefail` skips the
  Xcode project, keeps `app.json` and makes `git add --dry-run` succeed where it had
  exited 1; `npm run verify` green at 205 tests. NOT verified by a full release run - the
  next `scripts/release.sh 1.0.4` is that test.

- **1.0.4 release notes written** (no PR - `release_notes.md` is edited in-place by the
  release script and not part of the bump commit). Covers everything since v1.0.3
  (2026-07-23): file import, Apple Health read on iOS, the daily flower note, the cloud
  backup exclusion plus its Settings message, and the two fixes (#107, #108). Deliberately
  omits the release-pipeline work (#102-#104), the merge-rules groundwork (#113) and the
  built-then-dropped Health Connect route (#114) - none of it is visible to a user.
  TWO SHAPE CONSTRAINTS worth remembering, both learned on this pass. Bullets indented 4
  spaces become a CODE BLOCK on the GitHub release, which takes `--notes-file
  release_notes.md` verbatim; 2-space bullets under flush-left section words are the shape
  that renders. And Play truncates at 500 chars on a LINE boundary, so the running order
  and the LENGTH of the first bullet decide what a Play user reads - trimmed the intro and
  bullet one until the cut lands at 482 chars on a complete sentence rather than leaving a
  dangling "New" heading with nothing under it, which is what the shipped 1.0.3 copy did.

- **Apple Health read on iOS** (PR #117). The iOS half, unaffected by the Android story:
  HealthKit has no store gate, so a dev build, TestFlight build and App Store build all get
  the same access. File import stays the primary path and the only one on Android.
  READ ONLY, STRUCTURALLY. `requestAuthorization` is called with `toShare: nil`, so the app
  holds no write authorization at all - not "does not call write", cannot. The config plugin
  adds `NSHealthShareUsageDescription` and deliberately NOT `NSHealthUpdateUsageDescription`,
  which iOS requires only to WRITE; its absence is the guarantee rather than an oversight,
  and it was confirmed in the BUILT app's Info.plist, not just the source.
  A HEALTHKIT QUIRK SHAPES THE UI: an app cannot tell whether a READ was denied, because
  Apple makes refusal indistinguishable from "no such data" - the refusal itself would leak
  health information. So nothing ever reports "denied"; an empty result says "no
  temperatures or period days were found" and points at Health's Sharing settings.
  Nothing about merging is duplicated: the module returns samples shaped exactly like the
  file parsers produce (ISO local dates, Celsius, ascending by timestamp so "first reading
  of a day wins" picks the waking temperature), and the shell hands them to the same
  `health:import`. Apple's "no flow" category is dropped rather than becoming a bleeding
  day, matching the file parser.
  VERIFIED ON THE IPHONE SE, end to end, with Tim driving. The signed binary carries
  `com.apple.developer.healthkit` and NO `healthkit.access` key (so no clinical records).
  The permission sheet appeared and named only the two types. An empty Health app correctly
  reported "nothing found" - which is also what a DENIAL looks like, by Apple's design, and
  the copy is written so it never accuses the user either way. Tim then added a couple of
  basal temperatures and a period day BY HAND in the Health app - something Health Connect
  cannot do, which is exactly what blocked the Android equivalent - and the retry IMPORTED
  THEM. So the non-empty read is proven on iOS.
  Earlier steps that also held: `npm run verify` green at 205 tests, `pod install` links
  `HealthRead` (93 pods, up from 92), and a Release Simulator build compiles the module.
  THE SIGNING DANCE, worth knowing before the next capability is added: enabling HealthKit
  on the App ID invalidates the provisioning profile, and `xcodebuild` over SSH cannot
  regenerate it - it reports "No Accounts: Add a new account in Accounts settings" because
  the login keychain is locked in a non-GUI session, which is why the repo already uses a
  separate `buildkey.keychain` for the CERT. Opening the workspace in the Xcode GUI once
  created the profile; after that SSH builds signed fine.
  BUILD GOTCHA WORTH KNOWING: `pod install` failed with "invalid byte sequence in UTF-8"
  from xcodeproj's plist scanner, and the cause was leftover `ios/build-sim/` output from an
  earlier Debug attempt containing BINARY plists. Deleting the stale build directory fixed
  it. The UTF-8 env vars the repo scripts already set were not the problem.

- **Health import from an exported FILE - the primary path** (PR #116). Per
  `DECISIONS.md` 2026-07-30, after the Health Connect route was dropped: a file the user
  picked needs no permission, no vendor and no network, so it works on every store and
  every ROM and cannot be switched off by someone else's policy.
  `src/healthFiles.js` is pure - text in, samples out - so every format tests without a
  device, a picker or a permission. Apple Health `export.xml` is parsed LINE BY LINE rather
  than as a document, because the real thing runs to hundreds of megabytes; `startDate`
  wins over `creationDate` so a reading written into Health days late still lands on the
  day it was taken; "Unspecified" flow is a bleeding day (medium) while "None" explicitly
  is NOT and must never become one. Generic CSV covers Samsung Health, Fitbit, Oura and
  anything else with a table - comma, semicolon and tab delimiters, quoted fields, a
  per-row unit column. Fahrenheit is converted, and where no unit is given the RANGE
  decides, since a basal temperature is never ~98 in Celsius nor ~36 in Fahrenheit.
  TWO THINGS TESTS CAUGHT: the date column has to be findable by CONTENT, because a German
  export heads it "Datum" and chasing translations is a losing game when the values
  themselves are unambiguous; and the format must be sniffed from content rather than the
  file name, because Android hands back a content:// URI whose name is often meaningless.
  Nothing about merging is duplicated - `health:importFile` parses and then calls the
  existing `health:import`, so gaps-only, per-field provenance and idempotence by date key
  are shared with every source. The shell pre-filters an Apple export to the two record
  types before passing it on, which is safe precisely because the parser is line-oriented.
  VERIFIED END TO END ON THE API 34 EMULATOR, through the REAL system file picker (browse
  to Downloads, tap the file), not a shortcut: a 9-record Apple export landed as 9 days -
  six temperatures on Jul 20-25 and three flow days on Jul 14-16 with intensities intact -
  and the Jul 18 record marked "None" was correctly NOT imported. The app went from
  "Learning your cycle" to a full projection (Luteal day 17, next period Aug 11, fertile
  window, ovulation estimate) computed from the imported data.
  Settings carries forward Tim's Pixel feedback: the message sits under its own button and
  can be tapped away.
  ALSO VERIFIED ON THE TCL (real hardware, Android 15) with a deliberately awkward CSV:
  semicolon-delimited, a GERMAN "Datum" header, and a per-row unit column mixing Fahrenheit
  and Celsius. Result `{format: csv, read: 10, written: 9, added: 9, keptManual: 1}`.
  Reading the rows back off the phone: 97.34F landed as 36.3C and 97.88F as 36.6C while the
  one Celsius row passed through untouched; imported fields carry `{"bbt":"file"}` /
  `{"flow":"file"}`; and a day seeded by hand BEFORE the import (2026-07-15, spotting,
  "typed by hand") survived intact with empty provenance even though the file called that
  day heavy - the gaps-only rule holding on real hardware, not just in a test. The dial went
  from "Learning your cycle" to Fertile day 15 with a next period, window and ovulation
  estimate computed from the imported data.
  The TCL leg did NOT exercise the system file picker - that ROM's DocumentsUI would not
  list a pushed file even after a media scan (its storage view showed "No items"), so the
  CSV was handed to the same `health:importFile` the picker feeds.
  CLOSED ON THE PIXEL: Tim drove the whole thing himself on his own phone - real system
  picker, both files - and BOTH parsers imported correctly, the CSV producing the expected
  9 days. So the complete path (pick a file -> parse -> merge -> log updates) is proven on
  real hardware for both formats, not just stitched together across two devices.
  Note for anyone repeating this: a file pushed with `adb push` is invisible to the picker
  until MediaStore indexes it. `content call --uri content://media/external/file --method
  scan_file --arg /sdcard/Download/<name>` fixes it on a Pixel; the TCL's ROM ignored it.

- **Health import: the merge rules shipped, the Android route was built and then dropped**
  (PR #113 merged; PR #114 closed unmerged).
  SHIPPED (#113), `src/healthImport.js`, pure so it tests without a base or a phone: gaps
  only (never overwrites what the user typed, the same rule `period:log` follows), a
  previous import's own value may be refreshed, implausible temperatures dropped (a stray
  98.6 Fahrenheit would wreck the 0.2 degree BBT shift), real calendar dates enforced
  (2026-07-32 matches the pattern and is not a day), first reading of a day wins because a
  basal temperature is the waking one, and nothing dropped silently. Provenance is per
  FIELD (a `sources` map), not per row, because a day can hold a flow the user typed AND a
  BBT from the platform - a row-level marker would be a lie. Deliberately SOURCE-AGNOSTIC,
  which is why it survived the direction change below unchanged.
  BUILT THEN DROPPED (#114): the Health Connect route. It reached Health Connect, surfaced
  refusals honestly and completed empty reads, and it found three real bugs on the way -
  a crash on first import (the library registers its permission launcher from an Activity
  hook that `expo prebuild` wipes), a failed read reporting itself as SUCCESS (a swallowed
  error told the user "your log is already up to date" when nothing was read), and an
  existing grant being ignored (`requestPermission` returns an empty list when permissions
  are already held, so every read was skipped - that one would have hit real users on their
  SECOND import and every one after).
  WHY IT WAS DROPPED: the permission is not askable at all. A diagnostic build on Tim's
  Pixel logged Android answering `never_ask_again` for both permissions on the FIRST request
  after `pm clear` reset the state, which does not mean "refused before" - it means the
  system will not offer the choice. Ruled out by experiment first: automation, a broken
  Health Connect on the test device, the library's contract (a direct platform request with
  raw permission strings fails identically), installer attribution, and a poisoned
  never-ask-again state. The remaining explanation is a restricted permission only a real
  store install allowlists - and PearPetal ships on Zapstore and GitHub to users
  deliberately avoiding Google, so a Play-gated import serves almost none of them. See
  `DECISIONS.md` 2026-07-30.
  A throwaway writer app was also built (session scratchpad, never in this repo) to seed
  Health Connect, and it wrote 11 records successfully - so seeding was solved; only the
  read side was ever blocked.

- **Users are now told their log is not in the phone's automatic backup** (PR #111).
  PR #110 was the right behaviour but silently changed what a user could expect - someone
  assuming iCloud had their back would have found out the hard way after losing a phone.
  Settings -> Backup & restore now opens by saying the phone's own backup does not include
  the cycle log, that this is deliberate, and that a backup made there is how to keep a
  copy.
  NO OPT-IN TOGGLE, deliberately, after Tim asked whether there should be one. Two
  reasons. (1) The app already has the stronger version: `export:data` already takes a
  password and the UI already exposes it, so a user can make a backup encrypted with
  THEIR passphrase and put it in iCloud Drive or anywhere else - same recovery, without
  handing a fertility dataset to a third party under a key they hold and could be
  compelled to use. (2) It would not be symmetrical: on iOS the exclusion is a runtime
  filesystem flag so a toggle is easy, but on Android the rules are compiled into the APK
  and varying them at runtime needs a custom `BackupAgent`. A switch on one platform only
  is hard to explain in a sentence of copy.
  Release notes deliberately NOT written into `release_notes.md`, which still holds the
  shipped 1.0.3 copy the store is serving; the lines are drafted in `TODO.md`.
  Verified: `npm run verify` green at 163 tests, and the card read back off the emulator
  after installing the build.

- **The private cycle log no longer goes to the OS cloud backup** (PR #110). The gap found
  by the health-import research: the Corestore sits under `FileSystem.documentDirectory`,
  which is iOS `<sandbox>/Documents` (in iCloud Backup by default) and the Android app
  files dir under `android:allowBackup="true"` with no extraction rules. Nothing excluded
  it, so every logged day, flow, symptom, note and BBT was eligible to leave the phone -
  while onboarding promises "no accounts, no servers. Your data stays on your device."
  ANDROID: `plugins/with-android-backup-exclusion.js` writes `data_extraction_rules.xml`
  (API 31+) and `backup_rules.xml` (API 30-) and points the manifest at both. The split is
  deliberate - CLOUD BACKUP excludes the store, DEVICE TRANSFER keeps everything, because
  a direct phone-to-phone move is the same trust boundary device linking already has.
  `allowBackup` stays true so settings still restore.
  iOS: `modules/backup-exclusion` (new Expo module, mirroring `modules/local-network`)
  sets `NSURLIsExcludedFromBackupKey` on `<Documents>/pearpetal`. The shell creates that
  directory BEFORE `init` so the flag is set before any data lands in it, and re-asserts on
  every launch since the flag lives in the filesystem and a restore starts it unset.
  VERIFIED ON THE EMULATOR, and not by reading config: `bmgr backupnow` with the local
  transport ran a real backup, and Android's own agent logged the file list it measured -
  `databases/RKStorage`, two `shared_prefs` files and `files/profileInstalled`, with the
  75 MB `files/pearpetal` store absent. Settings back up; the cycle log does not.
  VERIFIED ON THE iOS SIMULATOR TOO (rule 7): built Release for the Simulator on the Mac
  mini, installed to a throwaway iPhone 17 Pro sim, launched, then read the attribute off
  the real container - `Documents/pearpetal` carries
  `com.apple.metadata:com_apple_backup_excludeItem: com.apple.MobileBackup`, which is
  exactly what NSURLIsExcludedFromBackupKey sets, while `Documents` itself carries none.
  Build note for next time: a DEBUG Simulator build of this app fails to link
  (`facebook::react::Sealable` undefined, from libExpoModulesCore + libRNScreens). The
  repo's own `scripts/ios-screenshots.sh` invocation works - `-configuration Release
  -destination "generic/platform=iOS Simulator" -sdk iphonesimulator
  CODE_SIGNING_ALLOWED=NO`. Use Release for Simulator builds here.
  Honest cost, worth repeating in any user-facing note: after this, losing your only phone
  loses the log unless the user has the recovery phrase or a JSON export. Both already
  exist; this makes them matter more than they did.

- **Apple Health / Health Connect import: researched and answered** (PR #109),
  `proposals/2026-07-30-health-import.md`. The `TODO.md` question was whether the import
  can be done without weakening the guarantee, not how to wire it up.
  ANSWER: yes, with preconditions. The import itself is clean - request READ authorization
  only (so no write-back path can exist even by accident), and the date-keyed `day:` schema
  makes de-duplication structurally free, a real dividend of the 2026-07-06 decision. A
  `source` field for provenance is additive: `rowApplyDecision` validates structure and
  never whitelists fields, and the signature covers the whole value, so it replicates and
  verifies unchanged on an older peer. Store paperwork does not force a contradictory
  claim: both Apple's and Google's definitions of "collect" turn on transmission OFF the
  device, so the existing "Data Not Collected" label stays truthful.
  THE BLOCKER IS SOMETHING ELSE, and it is true today: the private base sits in a directory
  the OS backs up to the cloud on both platforms. Logged in `TODO.md` as its own item.
  App Store guideline 5.1.3 forbids storing personal health information in iCloud, so the
  import cannot ship before that is fixed - but the gap exists regardless of the import.
  Two smaller corrections to the TODO's own framing: the "new trust edge into the private
  base" is overstated (the RN shell already brokers every IPC message and can call
  `day:set` today - what is new is a write the user did not type, which is a UX
  mitigation); and HealthKit deliberately makes a DENIED read indistinguishable from "no
  such data", so the import UI can never say "you denied access", only "no data found".

- **An ongoing period no longer fills every day back to its start** (PR #108). Found
  on the emulator the same session: onboarding asks "When did your last period start?"
  as a HISTORICAL anchor, then called `period:log` with no end - which means "ongoing"
  and stamped medium flow on every day from the start through today. Answering
  "10 days ago" wrote 11 straight days of medium flow, said "Medium flow" for TODAY,
  and left the dial reading "Menstrual - day 11". It is also what made the note/dial
  phase disagreement visible in the first place.
  An ongoing period now fills through today but no further than the user's own average
  period length (clamped 2..10, default 5). The span row still records `end:null`, so
  the end stays honestly unknown and a genuinely long bleed can be logged day by day.
  Unchanged for the case the semantics were written for: a period started two days ago
  and still going marks start, start+1 and today, exactly as before.
  Verified: `npm run verify` green, 163 tests (3 new). RE-VERIFIED ON THE EMULATOR
  through the real onboarding flow from a clean install, same 2026-07-20 answer:
  5 days logged instead of 11, today reads "Nothing logged" instead of "Medium flow",
  and the dial reads "Fertile - day 11" instead of "Menstrual - day 11".

- **A logged flow day now wins over the projection in the daily note** (PR #107).
  Found on the emulator while verifying the note itself: the dial read
  "Menstrual - day 11" while the note spoke from the follicular pool. The dial calls a
  day menstrual whenever flow is logged on it (`projectionFromRows` checks
  `anyFlowDays`), but the note derived its bucket from the projection alone
  (`dayOfCycle <= periodLen`), so a bleed running past the predicted period length
  produced a note contradicting the user's own screen. The log is the ground truth the
  user can see, so it wins: `notifications:schedule` passes the logged flow dates down
  and a day in that set always reads from a menstrual pool. The early/late split
  follows the logged RUN rather than the day of cycle, so a bleed starting mid-cycle
  still gets a day-one voice on day one. `bucketDaysFor` deliberately keeps measuring
  the projection with no flow log - it measures the SHAPE of a typical cycle, and
  logged flow only ever exists for today and the past, never for the future days that
  walk covers.
  Verified: `npm run verify` green, 160 tests (4 new). RE-VERIFIED ON THE EMULATOR on
  the same profile that exposed it - the note fired with the app killed reading "Roots
  first / Nothing blooms while it is busy holding on. This is the holding on."
  (menstrual-late), where the shipped build gave "Digging in" (follicular).

- **Daily flower note: an opt-in garden-voice line each day** (PR #105). PearPetal's
  answer to Stardust's astrology notifications, themed on flowers and seasons. A new
  pure `src/petalNotes.js` carries **159 lines**: two corpora the user picks between
  (Playful and Gentle) across SEVEN sub-phase buckets, plus one line per bucket in each
  of the five picker species' own voices, so the flower on the dial shows up in the
  writing. `cycleSlotOn()` (new, in `src/prediction.js`) places a FUTURE date in the
  cycle, which the existing projection did not - it only reported today. The note
  becomes a `daily-note` category in the list the shell already schedules, so the RN
  shell needed NO change at all.
  SIZING was the real design work, after Tim asked whether a static corpus would go
  stale. It would have: the first draft had 4 phases x 8 lines, and luteal is 13 days of
  a 28-day cycle against a pool of 9, so a line came back INSIDE the same cycle. Fixed by
  splitting each phase into early/late buckets (the PMS week and the week after ovulation
  are not the same week to live through), sizing each pool to the days its bucket covers,
  and making the pick WALK the pool consecutively across cycles instead of indexing off
  the absolute date - the latter lets the pointer wrap mod the pool length between visits
  and collide. The per-cycle advance is measured off the user's own projection, since a
  35-day cycle stretches the follicular stretch far more than the rest. Nothing a user can
  see now repeats inside eight weeks, asserted by walking 56 days of every tone x flower.
  Guardrails, all tested: opt-in on top of the master switch (default off, so an
  upgrade never starts a daily push); 14-day rolling window (3 days at low confidence)
  against iOS's 64-pending-notification cap, plus a hard 56-event cap on the whole
  list; the fertile framing falls back to the follicular/luteal pool on birth control
  or a low-confidence guess rather than announcing a bloom we are guessing at;
  discreet mode neutralises it like every other category; pregnant suppresses it; the
  corpus is deliberately goal-neutral so conceive and avoid users read the same line.
  Design: `proposals/2026-07-30-daily-flower-note.md` (T1, device-local, no wire
  change). Verified: `npm run verify` green, 156 tests (33 new).
  VERIFIED ON THE ANDROID EMULATOR (2026-07-30, recorded in PR #106, `pp_note_a31`, android-31 google_apis
  x86_64, `com.pearpetal.debug`). The Settings row is live and toggling it reveals the
  Playful/Gentle picker. With the app process KILLED the note fired on its own at the
  set time - `tag=pp:daily-note:2026-07-30`, `channel=reminders`, "Spring cleaning /
  Sudden urge to reorganise a cupboard? Botanically on schedule." Discreet then
  neutralised the same note to "PearPetal / You have a reminder. Open the app to view
  it." The low-confidence softening also fired for real: the profile had one logged
  cycle and today sat in the projected fertile window, and the note spoke from the
  follicular pool rather than announcing a bloom.
  THREE THINGS THAT COST TIME, worth knowing next time:
  1. `am force-stop` CANCELS an app's alarms, so a notification test after one always
     fails vacuously. Use `am kill`, which kills the process and leaves alarms armed -
     that is also what a user's swipe-away actually does.
  2. `-gpu swiftshader_indirect` segfaults on this box; `-gpu host` boots fine headless.
  3. Play Store system images are `user` builds needing an on-screen "Allow USB
     debugging" tap, which headless cannot give - adb sits at `unauthorized` forever.
     Use a `google_apis` (non-playstore, userdebug) image instead.
  Also: adb permanently shows a phantom `emulator-5554 offline` on this box because
  podman's `pasta` holds 127.0.0.1:5555. Harmless, but it makes `adb -e` fail with
  "more than one emulator" - address emulators by `-s` explicitly.
  The WebView UI was driven over the Chrome DevTools Protocol (the debug build exposes
  `webview_devtools_remote_<pid>`), not by blind taps: `uiautomator dump` cannot see
  inside the WebView, and CDP gives exact text reads and real clicks.
  FOUND WHILE VERIFYING: the note and the dial disagreed about the phase. Fixed in the
  next entry.

## 2026-07-23

- **App Store release step fixed: submit works from Linux, and a blocked version
  stops the run** (PR #102). The 1.0.3 release run failed twice on App Store
  Connect paperwork while the build itself uploaded fine.
  CAUSE 1: `versions create` was refused with "You cannot create a new version of
  the App in the current state" because 1.0.2 was still `WAITING_FOR_REVIEW`, and
  App Store Connect allows only ONE in-flight version. The script logged a warning
  and carried on, so metadata apply then failed too and the real cause was buried.
  CAUSE 2: `asc publish appstore --submit --confirm` could never have worked from
  this box. It requires `--ipa` because it owns the whole upload-then-submit flow,
  and the `.ipa` only ever exists on the Mac mini. Every release would have hit
  `Error: --ipa is required` at that step.
  FIX: the version-record step now classifies what already exists first - use it
  if the target version is there, offer to RENAME an EDITABLE prior version
  (`DEVELOPER_REJECTED` / `PREPARE_FOR_SUBMISSION` / `REJECTED` /
  `METADATA_REJECTED` / `INVALID_BINARY`), or STOP and name the blocking version
  and its state with the wait-or-cancel commands. Submission drops
  `asc publish appstore` for the lower-level lifecycle, which needs no `.ipa`:
  attach build -> declare export compliance -> validate -> submit, via
  `asc versions attach-build` and `asc review submissions-create` / `items-add` /
  `submissions-submit`.
  THREE MORE BUGS surfaced on the way: the build was never attached to the version
  at all (`asc publish appstore` would have done it, nothing else did); export
  compliance is set per BUILD so a new build always starts unset and Apple blocks
  on it (now detected via `asc validate` and confirmed before declaring, since it
  is a legal declaration); and versioned metadata was only generated when its
  directory was ABSENT, so a retry after a failed run silently shipped the first
  run's release notes even after `release_notes.md` was corrected.
  `release_notes.md` had also picked up literal `##` markdown headings, which the
  App Store renders as raw text - rewritten in the 1.0.1 house style.
  VERIFIED against live App Store Connect, not mocks: the classifier returns
  `exists` for 1.0.3, `blocked` (naming 1.0.3, `WAITING_FOR_REVIEW`) for a
  hypothetical 1.0.4, `rename` for a `DEVELOPER_REJECTED` prior and `create` for a
  clean slate; `_asc_version_id` resolves 1.0.3 and returns empty for 9.9.9;
  `_asc_build_id` resolves builds 8 and 9 with their processing state and returns
  empty for 999; `bash -n` clean.
  SUITE-WIDE: PearList, PearCal and PearGuard all carry the identical broken
  submit step (3 occurrences each; PearCircle is clean). Logged in the
  company-root `TODO.md`.

- **1.0.3 submitted to the App Store** (build 9, 2026-07-23). Done by hand, with
  the script fixed afterwards to make it repeatable. 1.0.2 had sat in
  `WAITING_FOR_REVIEW` since 2026-07-21 carrying the pre-relay build 8 and
  maintenance-release notes; Tim's call was to supersede it rather than wait. So:
  cancelled the 1.0.2 submission (it goes to `DEVELOPER_REJECTED`), renamed that
  version record 1.0.2 -> 1.0.3, attached build 9, declared export compliance
  (`usesNonExemptEncryption: false`, matching builds 2, 7 and 8), applied the
  corrected release notes and submitted. `asc validate` went from 1 blocking error
  to 0 before submission. Ships the blind relay (PR #95), connection details
  (PR #96), the Settings regroup (PR #99) and the Dial/Month overlap fix (PR #98).

- **Settings page regrouped: one idiom, four groups, ~4 screens down to ~1.3**
  (PR #96, Tim's call after reviewing the page on device). The page had three
  competing card styles with no rule - centred-title always-open (flower,
  appearance, tracking-for), left-title-plus-switch always-open (reminders,
  connection) and icon-plus-chevron collapsed (lengths, health, data, recovery,
  devices) - so a user could not predict whether a thing would be open or need a
  tap. Appearance sat permanently expanded taking a third of a screen while
  "Health & birth control", which actually moves predictions, was hidden. The
  cycle settings were split, with "What are you tracking for?" near the top and
  "Cycle lengths" + "Health" five cards later. And the title said "Cycle settings"
  over a page where 7 of 11 cards had nothing to do with the cycle.
  Now: titled **Settings**, profile pinned open at top (it is identity, and the one
  thing a partner sees), then four labelled groups - YOUR CYCLE (tracking for /
  lengths / health), HOW IT LOOKS (appearance + flower merged into one section),
  ALERTS & CONNECTION (reminders / connect anywhere), YOUR DATA (devices /
  recovery phrase / backup & restore). Every row is the same `CollapsibleCard`
  with an icon.
  `CollapsibleCard` gained an optional `right` slot for a control pinned to the
  header outside the expand button - a switch has to be flippable WITHOUT opening
  the section, and it cannot be nested inside the header button (invalid, and the
  click would fire both). `AppearanceCard` split into `ThemeRow` (the segmented
  control, now inside the owner's section) plus the old card wrapper, which the
  VIEWER settings still uses since it has no sections to slot into.
  VERIFIED on the TCL (debug 1.0.2): all four groups render, every section expands
  and collapses with the caret rotating, the flower picker and theme control render
  inside their merged section, and both switches flip without expanding their row.
  `npm test` 131/131.

- **Connection details: make a relayed connection observable** (PR #96): the relay
  shipped in PR #95 with no way to tell "it connected" from "it connected THROUGH the
  relay", which left the off-LAN hardware gate unfalsifiable.
  FINDING that shaped the work: hyperdht keeps `stats.relaying { attempts, successes,
  aborts }` but increments it ONLY in `lib/server.js`, on the side ACCEPTING a
  connection that asked to be relayed. The side that ESCALATED gets no counter, so
  copying PearTune's surface would have read a flat 0 on the phone that was actually
  rescued. So `src/relay.js` now counts its own decisions (`dials` / `direct` /
  `offered` / `suppressed`) in the policy function Hyperswarm calls per dial;
  `offered` is the escalation counter that was missing, and `suppressed` distinguishes
  "the network blocked it" from "you switched the helper off".
  Surfaced via a new `network:stats` method and a collapsed "Connection details"
  panel inside the Settings connection card, polling every 2s while open so the
  numbers move during a live pairing, with a Copy details button for the raw JSON.
  Every hyperdht-sourced field degrades to null rather than throwing when the swarm
  has no dht yet.
  VERIFIED: `npm run verify` green - 131 tests (up from 126: 4 new counter tests in
  `test/relay.test.js` plus a `network:stats` graceful-degradation test in
  `test/petalMethods.test.js`) and all three bundles built.
  VERIFIED ON HARDWARE (2026-07-23, `com.pearpetal.debug` 1.0.2 built and installed
  over USB to BOTH the Pixel 9 Pro `53071FDAP00038` and the TCL `4H65K7MFZXSCSWPR`;
  driven on the TCL per CLAUDE.md rule 6, Pixel install confirmed by
  `dumpsys package` and otherwise left untouched). Settings -> "Connect anywhere"
  renders with the toggle ON, the explainer, and Connection details expanding to real
  live numbers: Connected right now 0, Direct connections tried 4, Times the helper
  was offered 0, Connections we helped relay 0/0.
  THAT IS A RESULT, not just a screenshot. "Direct connections tried" only
  increments INSIDE our `relayThrough` hook, so a non-zero value proves Hyperswarm is
  calling the policy on every outbound dial and the PR #95 wiring is live on a real
  device. And 0 escalations on wifi is exactly the negative case the gate wants: a
  punchable network is never relayed.
  THEN, UNPLANNED, THE POSITIVE CASE APPEARED. While scrolling the Settings page
  the panel moved from `0/0` to **Connections we helped relay 1/1**, with both
  phones running PearPetal on the same wifi. That is hyperdht's own server-side
  counter, so a real remote peer escalated to the DEPLOYED relay node and the
  relayed connection succeeded: the relay works end to end against live
  infrastructure, not just in tests. Caveats recorded honestly - the peer was not
  positively identified (the Pixel is observe-only, so its escalation counter could
  not be read) and it was wifi, not cellular, so a same-LAN hairpin-NAT punch
  failure is the likely trigger.
  STILL OWED: the CARRIER case specifically. Tracked in `TODO.md`.
  Also fixed here: the card's wifi icon was vertically centred, so on a narrow phone
  it floated beside the middle line of the three-line description instead of the
  title. `alignItems: 'flex-start'`; re-verified on the TCL.

- **Off-LAN backstop: adopt the shared PeerLoom blind relay** (PR #95): two phones on
  carrier CGNAT often cannot hole-punch to each other, and PearPetal is phone-to-phone
  on both of its paths (device linking and partner sharing) with no always-on node
  anywhere in its design to soften it. The swarm now offers the already-deployed,
  suite-shared relay as a retry when a direct punch aborts. Rationale, privacy posture
  and the direct-first proof in `DECISIONS.md` 2026-07-23 and
  `proposals/2026-07-23-blind-relay.md`.
  Shipped: `src/relay.js` (baked key + pure policy + the fail-safe cache), a
  `createSwarm` injection in `src/bare.js` through the seam `@peerloom/core` already
  exposed (core unchanged, no core release needed), `network:get`/`network:set` backed
  by a device-local `network` record and a "Connect anywhere" card in Cycle settings.
  `z32` promoted to a direct dependency.
  VERIFIED: `npm run verify` green - 126 tests (up from 115: 10 new in
  `test/relay.test.js` covering gate ordering, direct-first, the randomized-NAT case,
  the fail-safe unhydrated cache and the real `createRelaySwarm` wiring, plus one
  `network:get`/`network:set` round-trip in `test/petalMethods.test.js`) and all three
  bundles built. NOT YET VERIFIED ON HARDWARE - the two-phones-on-cellular gate is
  still owed and is tracked in `TODO.md`.

## 2026-07-23

- **All three devices on merged `main`, iPhone rebuilt with Universal Links**
  (PR #101 for the tracking; the builds themselves are not code changes). After
  merging PRs #95/#96/#98/#99/#100, built and installed from clean `main`:
  Pixel 9 Pro + TCL on `com.pearpetal.debug` 1.0.2 via
  `scripts/android-debug-install.sh`, and the iPhone SE on `com.pearpetal` 1.0.2 via
  `scripts/ios-dev-install.sh` (archive on the Mac mini, `ideviceinstaller` over USB).
  The iOS build was then REDONE with `PEARPETAL_ASSOCIATED_DOMAINS=1` so Universal
  Links survive prebuild. The plugin's own comment warns that keeping the entitlement
  makes a wildcard dev profile fail to sign - it did not, because the profile permits
  `com.apple.developer.associated-domains` (`*`). Verified rather than assumed: the
  entitlement is in the SIGNED binary (present in the code-signature blob, not just
  the declared plist) pointing at `applinks:peerloomllc.com`, and the live
  `apple-app-site-association` returns 200 as `application/json` listing
  `G79ALD29NA.com.pearpetal` for `/petal/link`, `/petal/link/*`, `/petal/join`,
  `/petal/join/*`. The UL tap-test in `TODO.md` is therefore unblocked on iOS;
  Android was not re-checked.
  PROCESS NOTE worth remembering: PR #97 (the Settings regroup, stacked on #96's
  branch) was AUTO-CLOSED by GitHub when that base branch was deleted on merge, and a
  closed PR cannot be retargeted. The commit was rebased onto `main` and reopened as
  #99. If a stacked PR is used again, merge the child first or retarget it BEFORE
  merging the parent.

- **Dial/Month toggle no longer covers the flower and info buttons on a narrow
  phone** (PR #98, reported by Tim on the TCL). The floating view toggle was a FIXED
  240px centred with `left:50% / translateX(-50%)`, and it sits in the same top band
  as the flower-picker thumb (left) and the dial-info button (right). It also carries
  `zIndex:2` against their `zIndex:1`, so where they collided the toggle won.
  The arithmetic, since this is width-dependent and only bites small screens: a 360dp
  phone gives 360 - 2*24 padding = 312px of content, so a centred 240 spans 36..276.
  The flower button occupies 12..46 (left 12 + pad 4 + 26px thumb + 4) and the info
  button 272..300 (right 12 + pad 4 + 20px glyph + 4). That is a 10px overlap on the
  left and 4px on the right. On a 412dp phone content is 364px, the toggle spans
  62..302 and nothing touches - which is why it looked fine everywhere else.
  FIX: the wrapper is now inset `left/right: TOGGLE_SIDE_CLEAR (52)` instead of
  centred at a fixed width, and `ViewToggle` takes `width:100% / maxWidth:240`. 52
  clears the wider button (46) with 6px spare and stays symmetric, so the toggle is
  still centred and still renders at exactly 240 wherever there is room. Nothing
  changes on a wide screen.
  Note the near-miss: `TOGGLE_INSET` already existed as the VERTICAL padding both
  cards use to clear this same toggle. The new constant is `TOGGLE_SIDE_CLEAR` so the
  two meanings cannot be conflated; the build caught the collision.
  VERIFIED on the TCL (720x1600, 320dpi = 360dp wide): flower thumb and info button
  both fully clear in the Dial view, Month view unaffected, toggle still centred.
  `npm run verify` green (126 tests + all bundles).

## 2026-07-21

- **GrapheneOS/Vanadium WebView resume-freeze fix - renderer-kill recovery** (PR #93):
  ported from PearCircle PR #165 per `/home/tim/peerloomllc/WEBVIEW_FREEZE_FIX_PORT.md`.
  Since the 2026-07-19 Vanadium 151 update, Android's cached-app freezer freezes the
  out-of-process WebView renderer while backgrounded and its compositor never re-attaches
  to the new window surface on resume - taps and JS still run, the screen never repaints.
  Only a FRESH render process recovers it; a view-remount does not (it rebinds the same
  pooled stale renderer). Fix in three parts: a generated `WebViewRecoveryModule` Kotlin
  native module calling `WebViewRenderProcess.terminate()` (API 29+, minSdk is 29), an
  `onRenderProcessGone` -> `reload()` handler on the shell's `<WebView>`, and an AppState
  hook that terminates the renderer on resume after a >=20s background. Android-only;
  iOS/WKWebView has no cached-app freezer. Applied defensively - PearPetal was observed
  immune, but Vanadium hits every WebView app.
  Because `android/` is gitignored and regenerated by `expo prebuild`, the Kotlin ships as
  a config plugin (`plugins/with-android-webview-recovery.js`) that writes the module +
  its `ReactPackage` and registers it in `MainApplication.getPackages()`. That differs
  from PearCircle, which checks `android/` in and edits the Kotlin directly.
  VERIFIED on the GrapheneOS Pixel (`com.pearpetal.debug`, Vanadium 151.0.7922.29):
  `npm run verify` green (115 tests), clean `expo prebuild -p android --clean` regenerated
  both Kotlin files and the registration with the other four Android plugins intact,
  `assembleDebug` BUILD SUCCESSFUL. A 30s background -> resume logged
  `[webview] render process gone, didCrash=false -> reload`, spawned a fresh renderer
  (pid 7194 -> 7551), and the app repainted fully (dial, phase, predictions; gfxinfo frames
  advancing). Trade-off: a return after >=20s background costs a ~1-2s WebView reload;
  `WEBVIEW_RECOVERY_MIN_BG_MS` is the tuning knob.
- **Builds always prebuild first, on both platforms** (PR #94): `android/` and `ios/` are
  gitignored and regenerated from `app.json` + config plugins, so building against a
  stale one silently ships old assets - a build that SUCCEEDS and is wrong. It had
  already cost us twice: the wrong notification glyph on Android and the blank app icon
  on iOS for days.
  `scripts/ios-dev-install.sh` prebuilt only `if [ ! -d ios ]`; it now always runs
  `rm -rf ios && expo prebuild`, with a `SKIP_PREBUILD=1` escape hatch, mirroring what
  `ios-appstore.sh` already did. That also makes `PEARPETAL_ASSOCIATED_DOMAINS=1`
  reliable, since the entitlement is decided at prebuild time and a stale `ios/` ignored
  it. New `scripts/android-debug-install.sh` gives the debug path the guarantee
  `release.sh` already had for release: JS bundles -> `expo prebuild --clean` ->
  `assembleDebug` -> install, resolving a device name through the suite's `adb-find.sh`
  (wifi addresses change on every reconnect, so they are never hardcoded). Debug builds
  are standalone, so a stale `assets/*.bundle` ships as silently as a stale `android/` -
  hence rebuilding the bundles too.
  VERIFIED: both scripts pass `bash -n`; `./scripts/android-debug-install.sh pixel` ran
  the full pipeline green (bundles -> clean prebuild -> BUILD SUCCESSFUL in 47s -> 147MB
  APK -> resolved `pixel` -> `Success`).
- **Store release v1.0.1 shipped to all four channels** (2026-07-16, tag `v1.0.1`):
  GitHub Releases, the App Store, Zapstore and Google Play. Carries the device-link
  engine, which had been the default private-base + own-device-linking engine since
  PR #82 but had never reached users. Recorded here 2026-07-21 - it shipped without a
  DONE.md entry at the time.
  CAVEAT worth knowing: the `app.json` version bump (1.0.1 / buildNumber 7 /
  versionCode 1000001) and the rewritten `release_notes.md` were never committed, so the
  `v1.0.1` tag points at a commit whose `app.json` still said 1.0.0. Committed
  retroactively in PR #94. Since PR #87 the About footer stamps its version from
  `app.json` at build time, so an uncommitted bump means `main` builds a wrong-version
  app.
- **Cycle screen fits one phone screen with no scrolling** (2026-07-16, branch
  `feature/cycle-view-bottomsheets`; recorded here 2026-07-21). The screen used to stack
  a ViewToggle + the dial/calendar card + a full inline `DayEditor` card + a "Recent days"
  collapsible, which overflowed a small phone. Two changes did it:
  - `DayEditor` moved out of an inline card into a sheet. A one-line `DaySummaryBar`
    ("Today · Medium flow · 1 symptom" + Log/Edit) stays inline; the full editor opens in
    `DayEditorSheet`, and tapping a dial day or calendar cell opens the same sheet on that
    date, making scrub -> log one gesture. Unplanned bonus: the dial behind the sheet
    live-updates as you tap.
  - Reclaimed the view-toggle row and the `Add period` button. The Dial/Month toggle no
    longer owns a row - it floats top-centre of the card in the band the dial already
    leaves empty, positioned against a wrapper rather than either card so it does not move
    or remount across views (the calendar card takes `paddingTop: 62` to clear it).
    `Add period` / `Adjust period` is GONE from the tracking (`known`) state: day-to-day
    use is logging flow, which starts a period implicitly, so the by-date-range path is a
    correction, not a daily action (Tim's call). It now lives as a "Set period dates ›"
    link at the foot of the day sheet, handed off on the day sheet's CLOSE so the two
    sheets never stack. The learning (`!known`) state keeps its up-front Add period button,
    where it IS the primary action.
  VERIFIED on the Pixel: no scroll on the dial view, Recent days fully visible with ~250px
  to spare on both views, and the log round-trip (open -> chip -> save -> Done -> bar
  updates) confirmed on hardware. Later confirmed to fit on the iPhone SE too (Tim,
  2026-07-21), which retired the three further trims that had been queued as fallbacks.
- **Dial: "tap the flower centre = back to today" made discoverable** (2026-07-16, branch
  `feature/dial-calendar-polish`; recorded here 2026-07-21). Two halves that turned out not
  to overlap: a `DialInfoSheet` line ("Tap the flower's centre to jump back to today"), and
  a "Today" pill drawn at the dial's centre in `PetalDial.jsx` whenever
  `selDay !== dayOfCycle` - i.e. only while scrubbed away, so the flower stays clean when
  the hint would be a no-op. `pointerEvents: none` on the pill, so the tap belongs to the
  svg handler underneath whose `posToDay` already did the right thing. Pixel-VERIFIED:
  scrub to Jul 7 -> pill appears -> tap centre -> back to today, pill gone. The
  pulse-on-first-scrub idea was deliberately NOT built - the pill is self-evident and a
  pulse would be noise on top.
- **Month view: the "Today" button tracks the DAY, not just the month** (2026-07-16;
  recorded here 2026-07-21). Exactly the one-line fix predicted:
  `atToday = isCurrentMonth && selected === today` replaces `isCurrentMonth`.
  TCL-VERIFIED: the current month with Jul 12 selected now shows the button (it did not
  before); on today it stays hidden. The partner view has a dial but no calendar, so there
  was no second site to fix.
- **Month view: smoother left-right transition** (2026-07-16; recorded here 2026-07-21).
  Pixel-VERIFIED frame-by-frame off `screenrecord`, which is the only way to judge this.
  Went further than "slow it down", because slowing the old animation would not have fixed
  it:
  - `MonthGrid` split out of `MonthCalendar` so the outgoing and incoming months can render
    at once; the outgoing one stays mounted for the length of the slide.
  - Both months travel: 340ms on `cubic-bezier(0.22, 1, 0.36, 1)` (decelerating; plain
    `ease` starts slow and reads as a snap at this length).
  - No opacity fade, full-width travel, `overflow: hidden`. The first attempt kept the fade
    and a 38px nudge, and frames showed the two grids superimposed mid-travel with doubled
    dates. Ghosting. They must never overlap: outgoing slides fully out, incoming fully in,
    clipped by the container, like one strip.
  - `useLayoutEffect`, not `useEffect`, to mount the outgoing copy. With `useEffect` the new
    month rendered offscreen at the start of its slide while the outgoing copy had not
    mounted yet -> a one-frame BLANK FLASH that the old fade had been masking. Caught on the
    frame strip; invisible at full speed but real.
  Deferred and still not built: finger-tracking the swipe (`onTouchMove`) so the grid follows
  and settles instead of animating only on release. Bigger change; the caret + swipe both
  look right without it.
- **iOS to-self cycle reminders confirmed on hardware** (Tim, 2026-07-21). The opt-in
  period-due and fertile/ovulation reminders (built 2026-07-09, proposal
  `2026-07-09-notifications`) had been fully verified on the TCL but never on iOS, which was
  the last open item on that feature. Now confirmed on the iPhone; nothing to change.

## 2026-07-16

- **Donations unhidden on iOS - About section + two-week nudge** (PR #88): dropped BOTH
  `isIOS()` gates, so iOS now matches Android exactly (supersedes the 2026-07-08 blocker
  #7 / #8 entries below). The `isIOS` helper had no other callers and went with them;
  `window.__pearPlatform` is now unread by the UI. A DELIBERATE acceptance of App Store
  3.1.1 review risk - flagged twice, accepted by Tim. If Apple ever objects, re-gate the
  NUDGE first (unprompted = the likelier target) and keep the About section. Built +
  installed on the iPhone SE with `PEARPETAL_ASSOCIATED_DOMAINS=1` (UL entitlement
  confirmed intact in the signed archive); **iOS rendering CONFIRMED on device by Tim**.
  DECISIONS 2026-07-16.
- **About version stamped from `app.json` at build time** (PR #87): the footer hard-coded
  `'0.1.0'` while the release was 1.0.0, so the shipped app showed a stale version.
  `scripts/build-ui.mjs` now reads `expo.version` and injects it via an esbuild `define`
  (throws if absent, so a bad `app.json` fails the build); `package.json` synced to 1.0.0.
  `app.json` is the single version of record - a release version bump no longer needs an
  App.jsx edit.
- **Dropped unused `expo-clipboard`** (PR #89): never imported anywhere; every copy path
  uses `navigator.clipboard.writeText` in the WebView with a `shell:share` fallback. Rode
  in on #87 as a pre-existing working-tree change. Next iOS build regenerates a slightly
  smaller pod set.
- **🍎 PearPetal APPROVED + LIVE on the App Store.** Apple's review verdict came back
  approved; v1.0.0 is publicly downloadable at
  `https://apps.apple.com/us/app/pearpetal/id6789721938` (Health & Fitness, free, iOS 15.1+,
  76.3MB, 16+). Submitted 2026-07-11 as build 2 and Waiting for Review since (see below);
  this closes the last item that was "not in our hands" on the iOS channel.
- **App Store badge enabled on the website** (website PR #35): `/pearpetal/`'s App Store
  badge now links to the listing instead of sitting in `coming-soon` (href + `aria-label`
  / `alt` -> the download wording, matching PearList and PearCircle). Squash-merged to
  `main`, auto-deployed via Cloudflare Pages, and live-verified on peerloomllc.com. Google
  Play stays `coming-soon` until the closed-testing promotion lands.

## 2026-07-12

- **🔗 Device-link adoption SHIPPED - `@peerloom/device-link` enabled by default.**
  PearPetal's private base + own-device linking migrated from `@peerloom/core`
  groups to device-link's personal Autobase + SLIP-48 mnemonic identity + pairing.
  Proposal `2026-07-12-adopt-device-link.md` (T3, 6 decisions); design record in
  `DECISIONS.md`. Built behind `DEVICE_LINK_ENABLED` across slices, then flipped on
  (PR #82) after passing the hardware gate (B->A sync + iOS runtime) on TCL + Pixel
  + iPhone. Partner sharing stays on `@peerloom/core`. Rollback = revert one line
  (core-group path retained + tested; migrated devices keep the legacy base).
  - Delivered: QR-first device linking (generate + scan); recovery phrase (SLIP-48);
    one-time legacy->personal migration on first launch; profile (name+avatar) +
    settings (cycle lengths/goal/flower/conditions/BC) sync across own devices;
    live refresh on sync; remove-device; reordered onboarding (link path skips name).
  - PRs: device-link #1 (Tier-2 green + group test), #2 (blank-QR), #3 (bare-path
    iOS ADDON_NOT_FOUND fix), #4 (personalUpdated event); `@peerloom/core` #15
    (expose store/swarm on method ctx); PearPetal #74 (proposal) #75-#81 (slices +
    fixes) #82 (flag flip). `npm run verify` green throughout (115 tests + 3 bundles).
  - New package `@peerloom/device-link` (private repo `peerloomllc/peerloom-device-link`),
    extracted from PearCal; Tier-1 pure modules + Tier-2 `createDeviceLink` engine.

## 2026-07-11

- **🚀 PearPetal 1.0.0 LAUNCHED on every channel.** First public release, live/submitted
  everywhere:
  - **App Store (iOS)**: v1.0.0 (build 2) submitted, Waiting for Review (see 2026-07-10).
  - **GitHub Releases**: `release.sh` published v1.0.0 - the lean 120.8MB arm64 APK +
    sha256, signed with the `pearpetal` key.
  - **Zapstore**: published via `release.sh` (created `zapstore.yaml`, gitignored per suite
    convention; reused the shared PeerLoom `SIGN_WITH` nsec). Nostr launch note posted.
  - **Google Play**: first PeerLoom app on Play. Created the app, filled the store listing
    (from `metadata/listing-play.md` + feature graphic + Android screenshots) and all App
    content declarations (Data safety = No data collected/shared; target 18+; Health app
    declaration; no ads), uploaded the 50.3MB AAB -> **Play App Signing enrolled**, released
    to closed testing.
- **Android App Links complete for Play + direct installs** (website PR #28): Play delivers
  apps signed with Google's app-signing key (not the `pearpetal` upload key), so
  `assetlinks.json` now lists BOTH fingerprints for `com.pearpetal` - the upload key
  (`34:DA...`, GitHub/Zapstore) and Google's Play signing key (`F6:93...`, Play). Live-
  verified on peerloomllc.com. Also deployed the iOS `pear://`->Keet landing-page fix
  (`petal/{link,join}` show a "Get PearPetal" CTA on iOS instead of bouncing to a
  Keet-claimed scheme).
- **APK size audit** (`plugins/with-android-abis.js`, PR #71): 476MB -> 120.8MB by
  restricting the release to `arm64-v8a` (mirrors pearlist; 64-bit required by Play since
  2019). Signed arm64 APK's cert SHA-256 matches the assetlinks fingerprint. Minify left
  off (matches siblings; risky on the Bare native stack). See DONE below / TODO for detail.
- **Official README + MIT LICENSE** (PR #70): replaced the stale "pre-scaffold" README with
  a proper public one; GitHub now shows the MIT license.
- **Store-screenshot pipeline + assets** (PRs #65, #66, #67): a deterministic fixtures
  harness (`src/ui/screenshot-fixtures.js`, 6 scenes off the real prediction) + ported
  capture scripts; captured Android (Pixel_9) + iOS (iPhone 17 Pro Max, 6.9") sets; Play
  feature graphic + 512 icon.
- **iOS Universal Links provisioned end-to-end** (PR #63): explicit `com.pearpetal` App ID
  with Associated Domains, Xcode account on the Mac + `-allowProvisioningUpdates`, App Store
  Connect record. Apple's AASA CDN refreshed ~80min later, so UL is live.

## 2026-07-10

- **iOS v1.0.0 SUBMITTED to the App Store — Waiting for Review**. First submission. Built
  + uploaded via `scripts/ios-appstore.sh` on the Mac mini (prebuild keeping Universal
  Links -> archive signed by the "PearPetal App Store" distribution profile -> export ->
  upload via the shared ASC API key). app.json bumped to 1.0.0 / iOS build 2 (build 1 was a
  0.1.0 test upload). Listing filled from `metadata/listing-appstore.md` (subtitle, promo
  text, description, keywords), 6.9" screenshots from `metadata/ios/screenshots/`, privacy
  = "Data Not Collected", category Health & Fitness, price Free. Now in Apple's review
  queue. REMAINING (iOS): respond to any review feedback; then release. Android release
  (`scripts/release.sh` -> GitHub/Zapstore/Play) not yet run.
- **iOS Universal Links provisioned end-to-end + App Store Connect app created**: registered
  an EXPLICIT `com.pearpetal` App ID in the Apple Developer portal with the **Associated
  Domains** capability (wildcard App IDs can't carry it); created the PearPetal record in App
  Store Connect (bundle id `com.pearpetal`). The headless archive kept failing (still picked
  the wildcard profile; then `No Accounts`) until we signed the PeerLoom Apple ID into Xcode
  on the Mac mini and added `-allowProvisioningUpdates` to `scripts/ios-dev-install.sh`
  (archive + export) so xcodebuild mints the explicit managed profile including the capability.
  Rebuilt with `PEARPETAL_ASSOCIATED_DOMAINS=1` -> the entitlement (`applinks:peerloomllc.com`)
  is signed in; ARCHIVE + EXPORT + install SUCCEEDED on the iPhone SE. Remaining is the human
  tap-a-link confirm. The `with-ios-no-associated-domains` plugin still strips the entitlement
  by default (so no-env dev builds archive without the App ID); set the env to include UL.
- **iOS dev builds unblocked - strip the Associated Domains entitlement**
  (`plugins/with-ios-no-associated-domains.js`): `ios.associatedDomains` (added for
  Universal Links) made every iOS archive fail because the wildcard dev provisioning
  profile can't sign the Associated Domains capability (same class as the aps-environment
  issue). New config plugin deletes `com.apple.developer.associated-domains` from the
  entitlements by DEFAULT (dev), gated so `PEARPETAL_ASSOCIATED_DOMAINS=1` keeps it for a
  future provisioned build. Verified: generated `PearPetal.entitlements` is empty, archive
  + export + USB install SUCCEEDED, iPhone SE got this session's build. Listed FIRST in the
  app.json `plugins` array (entitlement mods run in reverse order). iOS tap-to-open stays
  deferred until an explicit `com.pearpetal` App ID with the capability is provisioned.
- **All three devices on the partner-mode build** (2026-07-10 device pass): rebuilt +
  installed to the TCL + Pixel 9 Pro (Android debug APK, `adb install -r`, both launch
  clean) and the iPhone SE (iOS, via `scripts/ios-dev-install.sh` on the Mac mini). The
  WebView UI is a native build-time asset (`Asset.fromModule(require('assets/app-ui.bundle'))`
  in `app/index.tsx`), so shipping UI changes needs a full native rebuild, not just build:ui.
- **Partner (viewer) mode gets a real shell** (T1, UI-only, no wire change): the viewer
  side was a dead-end screen; now it mirrors the owner shell where it makes sense.
  - **Viewer bottom nav** (Shared / Settings / About). `BottomNav` generalized to take a
    tab set + width-aware active indicator; new `VIEWER_NAV_TABS`. App routes viewer
    `main/settings/about` and Android Back walks viewer sub-screens -> main like the owner.
  - **Scoped `ViewerSettings`**: profile (name + photo, shown to owners they view) +
    appearance (theme). Deliberately omits cycle prefs / reminders / backup - a viewer has
    no private base, so reminders produce no events, there's nothing to export, and
    `PartnerView` hardcodes the flower. Extracted a shared `AppearanceCard` (owner + viewer);
    reused the self-contained `ProfileCard`. About reuses `AboutScreen` as-is.
  - **"View a partner's cycle" entry point** on `ViewerHome`: opens the existing
    `JoinPartnerSheet` (paste link / scan QR), so a viewer can accept invites from more than
    one owner - not just at first install. On join it refreshes the list and opens the new
    partner's cycle.
  - Dev: `?seed=viewer` browser-preview seed in `ipc.js`. verify green (build:ui clean,
    89 tests). ON-DEVICE VERIFIED 2026-07-10 (two-phone: TCL owner <-> Pixel 9 Pro viewer):
    viewer nav + Settings + About + the "View a partner's cycle" join flow all confirmed good.
- **Website: universal links + privacy/support/landing pages** (in the `website/`
  repo; deploy pending). Closes most of the website-side release work and the App
  Store privacy-page requirement.
  - **Privacy page** (`website/pearpetal/privacy.html`) - health-data specific: the
    structural two-base privacy boundary, on-device predictions never crossing the wire,
    optional encrypted backups, per-permission rationale (camera/notifications/network),
    no accounts/tracking/analytics, children's-privacy + not-medical-advice sections.
    Effective 2026-07-10. Plus a **support/FAQ page** and a **`/pearpetal/` app landing
    page** (store badges, GitHub link), mirroring the PearList pattern.
  - **Universal-link tap-to-open**: iOS `apple-app-site-association` gains
    `G79ALD29NA.com.pearpetal` (paths `/petal/link*`, `/petal/join*`); `associatedDomains`
    (`applinks:peerloomllc.com`) added to the iOS `app.json`; `/petal/link` + `/petal/join`
    landing pages reconstruct the `pear://pearpetal/link|join#<blob>` deep link, passing the
    invite blob through the URL #fragment (so it never reaches the server) and auto-opening
    the app. Verified route-by-route against a local clean-URL server (all 200; deep-link
    reconstruction + JSON validity checked).
  - **Android `assetlinks.json`**: added BOTH the RELEASE `com.pearpetal` fingerprint
    (release key generated in `/home/tim/keystore.jks` alias `pearpetal` on 2026-07-10)
    and `com.pearpetal.debug` (shared default debug keystore) so App Links autoVerify for
    both release and on-device `.debug` builds. PearPetal card added to the homepage
    showcase; `icon-pearpetal.png` + `og-pearpetal.jpg` generated from the app art.
  - DEPLOYED to peerloomllc.com 2026-07-10 (website PR #27, app PR #58). Live-verified:
    all pages 200; both `.well-known` files served as `application/json` (the strict
    content-type iOS requires); AASA carries `com.pearpetal`; `assetlinks.json` carries
    the release + debug fingerprints. REMAINING (tracked in TODO): a hardware tap-to-open
    confirm on the next device pass (needs the iOS `associatedDomains` baked in via a fresh
    `rm -rf ios` prebuild).
- **Hardware verification pass - remaining on-device confirmations DONE**: the last
  code-done-needs-confirmation items are now confirmed on real devices.
  - **iOS WebView QR scanner**: the getUserMedia + `jsQR` scanner (Onboarding +
    JoinPartnerSheet) confirmed on iPhone hardware - OS camera prompt -> live scanner ->
    aim-at-QR decode. Closes release blocker #1 (Android was already confirmed 2026-07-09).
  - **iOS Local Network prompt + LAN partner sync**: the LN prompt appears on first
    partner connect on the iPhone and partner sync takes the LAN path (`modules/local-
    network` + boot-time prompt + app.json infoPlist/Bonjour).
  - **Invite/share URL copy-paste across two phones**: copy the
    `https://peerloomllc.com/petal/link|join#<blob>` link on one phone, paste into the
    other -> deep-link routing joins the share (the paste-into-app path; universal-link
    tap-to-open still pending the website `.well-known` files).
  - **User profile - live two-phone owner->partner name display**: owner sets a name,
    partner sees "{name}'s cycle" live (projected via `share:meta`; previously only
    unit-covered - now confirmed with the Pixel as partner).
- **Nice-to-have UX polish shipped + verified**: bottom sheets for day/symptom entry
  (replacing full-screen pushes, reusing the shared `BottomSheet`); a partner-view scoped
  Month calendar (was owner-only); joiner photo avatar in per-person shares (the joiner's
  avatar blob now replicates to the owner via the shared base's blob store - previously an
  initials-only fallback).
- **Optional password-encrypted JSON backups** (T3, proposal + review
  2026-07-10-encrypted-backups, PR #55): export can seal the file under a password.
  Worklet `encryptBackup`/`decryptBackup` on the already-bundled `sodium-universal` -
  Argon2id (`crypto_pwhash`, interactive limits) -> XSalsa20-Poly1305 secretbox over the
  exact `{days,periods,prefs}` payload; self-describing wrapper (salt/nonce/kdf params
  in-file). `export:data`/`import:data` gained an optional `password` (additive);
  decryption completes BEFORE any DB write so a wrong password never partial-imports; no
  identity/secret key is ever in a backup; plaintext stays the default. `test/backup-
  encryption.test.js` (real IPC path). verify green (89 tests). Reviews entry PR #56.
- **Backup export/import UX** (PR #55, #54): export now saves to a real user-picked folder
  via the Android Storage Access Framework (prompts each export, overwrites the same-name
  file), NOT the share sheet (which can't reach Downloads/Files on scoped-storage /
  GrapheneOS); iOS keeps the share sheet. Import errors are mapped to friendly copy (the
  engine serializes `err.stack` over IPC, so match by substring, never show raw). Both
  export and import confirm with a centered success modal (green check + folder / counts)
  instead of a small green line. On-device verified on the TCL end to end (encrypted export
  -> import round trip, folder save, wrong-password message, restore).
- **Onboarding rework** (PR #55): welcome slide -> name/photo step for EVERYONE (moved out
  of the tracking-only wizard so a partner-viewer and a restore-from-backup user set a name
  too; the backup carries no profile; `profile:set` is device-local so it works before any
  base) -> a track-vs-view chooser (device linking hidden/deferred) -> "Track my cycle" runs
  the wizard whose first step offers "Set up my cycle" vs "Restore from a backup" (import
  merges into the just-created base and boots into the populated app). Welcome copy -> "no
  accounts, no servers. Your data stays on your device."; removed the Skip on the name step;
  equal-width partner View/QR buttons.
- **Two-tone PearPetal wordmark** (PR #55): a `Wordmark` component - a petal bloom (echoing
  the dial) + "Pear" in rose (primary) and "Petal" in orchid (accent), theme-var driven so
  light + dark adapt. Replaces the flat single-colour title on welcome / chooser / viewer
  home / About (sizes 34/24/28). Verified in both themes on the TCL.
- **System theme default that follows the OS** (PR #55): default pref is now `system`, and
  `system` now actually tracks the phone. Root cause was `app.json`
  `userInterfaceStyle:"dark"` forcing RN `Appearance.getColorScheme()` to always report dark
  (LIKELY SUITE-WIDE - check sibling apps); fixed to `automatic`. The shell now injects the
  real OS scheme (`window.__pearColorScheme`) into the WebView before the bundle, seeds the
  pre-paint background from it, and pushes live updates via `Appearance.addChangeListener`;
  `theme.js` prefers the injected scheme and re-stamps `data-theme` on OS flips. Verified
  live on the TCL (OS light -> app light, flip to dark -> app dark, no relaunch); iPhone
  rebuilt from a fresh prebuild so `automatic` is baked into Info.plist.
- **Viewers join shared bases client-only** (T3, swarm-accumulation mitigation A;
  proposal 2026-07-09-swarm-topic-accumulation, DECISIONS + review 2026-07-10): fixes the
  pairing slowdown that grows as a device piles up bases. `@peerloom/core` `joinTopic`
  gains a `{server,client}` option + `joinGroup` an `announce` flag (persisted, re-applied
  on init; default true = unchanged); PearPetal `partner:join` passes `announce:false` so a
  partner (pure viewer) joins CLIENT-ONLY and stops redundantly announcing the owner's
  topic. `link:join` keeps the default. Additive + back-compat (no wire/record break).
  Core `npm test` green (43, incl. announce + restart-persistence + two-peer pairing gate);
  app verify green (86 + 3 bundles). Core PR #14. D (Hyperswarm cap) not changed - default
  maxPeers=64 already sane.

## 2026-07-09

- **QR scan + render verified (release blocker #1)** + dead-stub cleanup: the invite
  QR render (`QrImage` via the `qrcode` lib; Sharing + Devices) and scan (`ScannerView`
  via WebView getUserMedia + `jsQR`; Onboarding + JoinPartnerSheet) were already built
  in-WebView - the "stub" the TODO cited (`shell:scanQr`) was unused dead code. Confirmed
  on the TCL: a real invite QR renders, and tapping Scan QR fires the OS CAMERA prompt ->
  grant -> a live scanner (permission wiring: CAMERA in app.json + AndroidManifest;
  NSCameraUsageDescription for iOS; shell grants the WebView camera request). Removed the
  dead `shell:scanQr` from the shell + browser mock. Remaining: a physical aim-at-a-QR
  decode confirm (same jsQR frame path) + the iOS WebView scanner on hardware.
- **First-run onboarding wizard** (release blocker #3; T1, UI-only, no wire change):
  "Start tracking" now creates the private base and hands off to a short, fully
  skippable `SetupWizard` (new root mode `setup`) instead of dropping onto an empty
  "Learning your cycle" dial. Steps: welcome (a decorative blooming dial to show the
  hero) -> name + optional photo (`profile:set`) -> goal incl. pregnancy (`prefs:set`,
  reuses PregnancySetup) -> log your last period (`period:log`, so the dial is
  immediately meaningful) -> reminders opt-in (the folded-in notifications item;
  `shell:notifications:set`, OS prompt only on enable) -> "you're all set" with
  log-a-day + Share-tab tips. Step dots, Back steps through, every step skippable.
  Reuses the existing Settings controls; a viewer who starts their own cycle also
  goes through it. Shape agreed with Tim (guided setup wizard over a coach-mark tour).
  Verify green (85 tests + 3 bundles). ON-DEVICE VERIFIED on the TCL: full walk-through
  (name Maya, goal conceive, period Jun 25, reminders allowed) lands on a POPULATED,
  goal-aware dial (Menstrual day 15, "best chance to conceive", next period Jul 23);
  name + goal confirmed persisted in Settings. Deferred: a deeper interactive
  coach-mark tour of the live menus (deliberately out of scope for v1).
- **Sharing ended (revoke tombstone)** (T2, proposal 2026-07-09-sharing-ended,
  DECISIONS 2026-07-09): when an owner revokes, the partner now sees a calm "sharing
  ended" state on next open instead of silently frozen data. `share:revoke` SOFT-CLOSES
  - writes `revoked:true`+`revokedAt` into the owner-signed `share:meta` (inherits the
  owner-write-only gate, no apply change; distinct `revoked` field, not `deleted`) and
  flags the membership, but keeps the base + swarm alive so the tombstone reaches an
  offline partner on reconnect; `refreshShares`/`refreshShareMeta` skip revoked shares.
  New `share:remove` is the owner "Remove permanently" (old hard teardown). Partner UI:
  a "sharing ended" banner over the dimmed last-known view + Remove; ViewerHome/Sharing
  show "Sharing ended"; owner Sharing gets an "Ended" section. Additive + back-compat.
  Verify green (85 tests + 3 bundles). ON-DEVICE VERIFIED (TCL owner -> Pixel partner, Full scope): join + live sync, revoke soft-close -> partner "sharing ended" banner over dimmed data (live, no reload), partner Remove + owner Remove-permanently clear.
- **Notification tray glyph confirmed monochrome (Android)** (docs/verification only):
  the tray icon had been the colored launcher icon because the built `android/` predated
  the expo-notifications icon config. A fresh `expo prebuild -p android --clean` wired
  `@drawable/notification_icon` (the white silhouette from `monochrome-icon.png`) + the
  `expo.modules.notifications.default_notification_icon` manifest meta-data + tint color
  `#f2789f`; the rebuilt APK shows a correct WHITE monochrome glyph on the TCL (small-icon
  resource is now a drawable, not the mipmap launcher icon). NO source change needed - the
  app.json config was already correct. Also verified the `.debug` standalone config
  survives a clean prebuild (it lives in `with-android-debug-standalone`), retiring the
  "durable debug config" dev-infra item. iOS notifications always use the app icon, so
  there is no monochrome-glyph work there.

- **To-self local notifications v1** (proposal 2026-07-09-notifications, DECISIONS
  2026-07-09): opt-in cycle reminders (period due day-before + day-of; fertile
  window + ovulation), goal-aware + confidence-gated + birth-control-suppressed,
  with a user-configurable "Discreet" mode that hides cycle wording on the lock
  screen. Pure `src/notifications.js` computes the events; worklet
  `notifications:get/set/schedule` own the device-local prefs; the RN shell hands
  the events to expo-notifications as OS-scheduled DATE triggers (delivered even
  when the app is closed - no background execution), rescheduling on boot / app
  foreground / after any prediction-changing edit. Settings "Reminders" card;
  default OFF, OS prompt only on opt-in. No wire change (T1). Verify green (83
  tests + 3 bundles). ON-DEVICE VERIFIED on the TCL (seeded ovulation=today,
  medium confidence): opt-in shows the OS prompt + grant persists (re-enable
  needs no re-prompt); AlarmManager schedules the right dates at the chosen time
  across a 2-cycle horizon; a reminder FIRES while the app is backgrounded with
  the correct descriptive goal-aware content ("Ovulation predicted") AND with the
  discreet wording ("PearPetal") when discreet is on; changing the time reschedules
  all alarms; disabling cancels every scheduled alarm (18 -> 0). Fixed during the
  pass: scheduled (DATE-trigger) notifications need `channelId` on the TRIGGER, not
  just content, else Android routes them to expo's fallback channel - confirmed the
  fix lands them on the custom "reminders" channel. Partner-facing "sharing ended"
  deferred to a T2 proposal.
- **iOS: strip the push entitlement + fix the app icon** (same notifications work):
  the expo-notifications config plugin adds `aps-environment` (Push Notifications) to
  the iOS entitlements, which the wildcard dev provisioning profile cannot sign - a
  fresh `expo prebuild` + Release archive FAILED. PearPetal is local-notifications-only
  (no remote push), so new config plugin `plugins/with-ios-no-aps.js` removes it.
  GOTCHA: iOS entitlements mods run in REVERSE app.json `plugins` order, so this plugin
  is listed BEFORE "expo-notifications" to run after it. Separately fixed a STALE blank
  iOS app icon: `ios/` was generated 2026-07-07 (before the cherry-blossom `icon.png`
  landed 2026-07-08) and `ios-dev-install.sh` only prebuilds when `ios/` is missing, so
  the blank placeholder kept shipping; regenerating `ios/` rebuilds the AppIcon from the
  current art. Both verified on hardware: archive SUCCEEDED + installed on the iPhone SE
  over USB, real icon on the home screen.
- **Pre-paint dark flash fix** (#42): the RN shell reads the WebView's persisted
  resolved theme (AsyncStorage) at boot and paints the loading view / WebView /
  HTML wrapper / status bar to match, so light-theme users no longer flash dark on
  cold start. WebView reports its theme via a new `shell:theme` message.
- **Android Back** (#41): hardware/gesture Back pops the in-app stack instead of
  exiting. A `BackContext` + `useBackHandler` registry lets any overlay (bottom
  sheets, QR scanner, donation modal, onboarding sub-mode) self-register a dismiss
  handler (LIFO); falls through to partner-view / owner-sub-screen -> main; exits
  only at the root. `canBack` gates the shell's Back consumption.
- **Light / Dark / System theme + theme-aware flowers** (#40): Appearance control
  in Settings (persisted, `system` follows the OS live); a `ThemeContext` re-renders
  the flower SVGs; deepened light palettes for rose/sakura/lotus + a warmer furled
  crimson so pale flowers/menstrual state read on white; `html` background painted
  (fixes a dark strip on scroll); uniform flower-picker tiles; collapsible Recents
  (collapsed by default); calmer dial center (flower switcher -> corner icon).
- **Sharing copy tightened** for Part B (#39): the link grants READ to whoever
  holds it, viewers can't edit, and a partner can't re-share access.
- **Share-row truncation fix** (#38): rows show the joiner name alone (the section
  header already says "People you share with") with a 2-line wrap - no more
  "Shared with L..." on narrow screens.
- **Per-person shares Part B - owner-signed writer admission** (core #13 + app #37):
  on a shared base only the owner may admit a writer, proven by an owner signature
  over the joiner's exact writer key + group; a partner can no longer admit a third
  party. Two optional `@peerloom/core` engine hooks (`mintAddWriter` /
  `authorizeWriter`, default legacy so other suite apps are untouched); PearPetal's
  `src/admission.js`. Verified: core two-peer tests + app unit tests + on-device
  re-pair. Proposal `proposals/2026-07-09-addwriter-gating.md`, DECISIONS 2026-07-09.
- **Per-person shares Part A - who joined** (#32): a joiner self-publishes a
  `member:{pubkey}` name row into the shared base; the owner's Sharing rows show
  "Shared with {name}" (or "Someone joined" / "Not joined yet") + a shared-on date
  and live-refresh. Proposal `proposals/2026-07-09-per-person-shares.md`.
- **Flower picker pill / switcher** (#36, then relocated to a dial corner in #40):
  surfaced the flower switcher on the Cycle page instead of only in Settings.
- **Sharing UX + bottom-sheet animation** (#35): revoke made idempotent (fixes the
  "share not found" error) + double-tap guard; QR/Copy/Revoke as inline phosphor
  icon buttons; centered section headings; capitalized scope; a "View a partner's
  cycle" entry (JoinPartnerSheet) for existing owners; a shared `BottomSheet` that
  slides up/down; 3s live poll so rows flip to "Shared with X" in real time.
- **Add / Adjust period button + flow logging** (#30): a Stardust-style
  Add/Adjust-period control opens a date-picker sheet; `period:log` records the
  span AND stamps bleeding flow across it (so the calendar + dial reflect it),
  preserving any per-day intensity.

## 2026-07-08

- **Monthly calendar view** (Stardust blocker #13): Dial/Month toggle; `MonthCalendar`
  color-coded period/fertile/ovulation/logged from a pure `projectCalendar`. Verified
  on the TCL. DECISIONS 2026-07-08.
- **Cycle customization - conditions + birth control** (Stardust blocker #12):
  device-local `prefs.conditions` (PCOS/endometriosis/irregular/thyroid) +
  `prefs.birthControl`; widen the fertile window + cap confidence; BC hides the
  fertile framing. None cross the wire. DECISIONS 2026-07-08.
- **Pregnancy mode + goal-driven tone** (Stardust blocker #11): a `pregnant` goal +
  `prefs.pregnancy`; a gestational `PregnancyView`/`PregnancyDial`; goal tints the
  cycle summary. Owner-only, never projected. DECISIONS 2026-07-08.
- **2-week donation nudge popup** (blocker #8): device-local `donation:status`/`dismiss`,
  shown once, skipped on iOS; routes to About. (iOS skip SUPERSEDED 2026-07-16, PR #88 -
  the nudge now fires on iOS too.)
- **About page + Bitcoin (Lightning) donation** (blocker #7): AboutScreen + the suite
  donation pattern; iOS hides Support development (App Store 3.1.1). (iOS hiding
  SUPERSEDED 2026-07-16, PR #88 - the section now shows on iOS.)
- **User profile - name + avatar** (T2, proposal 2026-07-08-user-profile): device-local
  `profile` + avatar in the blob store; name/avatar projected via `share:meta` so a
  partner sees "{name}'s cycle". DECISIONS 2026-07-08.
- **One canonical "not medical advice" disclaimer** (T0): consolidated onto About.

## 2026-07-07

- **All sync paths VERIFIED on hardware** (TCL + Pixel + iPhone SE): Android<->Android
  device linking + all 3 consent scopes + revoke; Android<->iOS partner (full scope).
  Required a `@peerloom/core` native-addon-mismatch fix for the iOS build.
- **Partner-view blank-until-re-nav fix**: `PartnerView` polls `partner:view` until the
  projection lands (a UI refresh race, not a sync bug).
- **Petal dial in the partner view + ring day-scrub** (blocker #5): PartnerView shows the
  dial; `onDayTap` maps a tapped angle -> cycle day -> date.
- **Safe-area top inset** (blocker #4): shared `screenPadTop` clears the status bar on
  every title screen.
- **iOS Local Network prompt module** (blocker #1, code): `modules/local-network` +
  boot-time prompt + `app.json` infoPlist/Bonjour (forces the LAN path).
- **Invite/share code as a universal-link URL** (blocker #2, code): invites render/copy as
  `https://peerloomllc.com/petal/link|join#<blob>` (blob in the fragment); deep-link routing
  + Android intent filters.
- **App logo / icon + notification-bar icons** (blocker #6, art): cherry-blossom bloom;
  icon/adaptive/monochrome PNGs wired in `app.json`.

## 2026-07-06 / 07 - Core app (slices 1-6)

- Private base (own-device cycle log) + own-device linking.
- Per-partner shared base: owner-write-only, consent-scoped projection (phase /
  fertility / full); partner read-only; invite withholds the private base key.
- On-device prediction (median cycle length, BBT-confirmed ovulation, confidence).
- The signature petal dial (`src/ui/PetalDial.jsx`).
- Flower picker (`src/ui/flowers.js`) - 5 species, device-local pref.
- JSON export/import (plain-file backup + recovery, shell-mediated).
- Built on `@peerloom/core`. Wire protocol v1 (`proposals/2026-07-06-wire-protocol.md`).
