// Expo config plugin: the HealthKit READ capability, and nothing more.
//
// Two prebuild-time things the modules/health-read Swift cannot add for itself,
// because `ios/` is generated and any hand edit is wiped by the next prebuild:
//
//   1. `com.apple.developer.healthkit` - without it HKHealthStore refuses at
//      runtime, whatever the Swift says.
//   2. `NSHealthShareUsageDescription` - iOS kills the app outright if it asks to
//      READ health data with no usage string.
//   3. `NSHealthUpdateUsageDescription` - the WRITE string, which Apple's asset
//      validation demands whenever the entitlement is present even though this app
//      never writes. Added 2026-07-31 after it rejected build 12; see the note on
//      UPDATE_REASON below and DECISIONS.md. The read-only guarantee lives in
//      `requestAuthorization(toShare: nil, ...)`, not in the absence of a string.
//
// OFF BY DEFAULT, and that is the whole point. Confirmed on 2026-07-30 by trying:
//
//   error: Provisioning profile "iOS Team Provisioning Profile: com.pearpetal"
//          doesn't include the HealthKit capability.
//
// The entitlement blocks EVERY iOS device build, including ones with nothing to do
// with Health, until the capability is enabled on the App ID at
// developer.apple.com (Certificates, IDs & Profiles -> Identifiers ->
// com.pearpetal -> HealthKit) and the profile is regenerated. That is a one-off
// account change, not a code one - but until it happens, an unconditional
// entitlement means nobody can put ANY build on a phone.
//
// So this follows the same convention `with-ios-no-associated-domains` already
// established: set PEARPETAL_HEALTHKIT=1 at PREBUILD time for a build that needs
// it. Like associated-domains, the env is read when `ios/` is GENERATED, not when
// it is compiled, so a build that skips prebuild carries whatever the last one
// decided.
//
// The file-import path needs none of this and works on every iOS build, which is
// why it is the primary route (DECISIONS.md 2026-07-30).

const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins')

// Shown in the iOS permission sheet. Says what is read and what is done with it,
// because a vague string is both a review risk and a bad answer to a fair question.
const SHARE_REASON =
  'PearPetal can bring your basal body temperature and period days across from Apple Health, so you do not have to type them in twice. It only reads, never writes, and everything stays on your device.'

// Required by Apple's asset validation whenever the HealthKit ENTITLEMENT is
// present, whatever the code does. Their own trigger text is "references one or
// more APIs ... OR the app has one or more entitlements that permit such access",
// and `com.apple.developer.healthkit` permits reading AND writing - Apple ships no
// read-only variant of it. Omitting this key rejected build 12 of 1.0.4 with
// ITMS-90683 naming NSHealthUpdateUsageDescription specifically.
//
// PRESENCE GRANTS NOTHING. A purpose string is text shown in a prompt, not an
// authorization. `HealthReadModule` calls `requestAuthorization(toShare: nil, ...)`
// and contains no save() or delete(), so the app never requests write access and
// never holds any; HealthKit would reject a write even if one were attempted. No
// user will ever read this string, because only a write request displays it and
// the app cannot make one. See DECISIONS.md 2026-07-31.
const UPDATE_REASON =
  'PearPetal never writes anything to Apple Health. It only reads, to bring your own basal body temperature and period days into its log. Apple requires this text to be present even for apps that read only.'

module.exports = function withIosHealthKit (config) {
  // It STRIPS when off rather than merely not adding, and that distinction is the
  // whole reason this works: `expo prebuild` without --clean leaves a previously
  // written key in place, so a plugin that only skips would leave the entitlement
  // behind from the last build that wanted it - and the next device build would
  // fail to sign for no visible reason. Same lesson as
  // with-ios-no-associated-domains, learned the same way.
  const wanted = !!process.env.PEARPETAL_HEALTHKIT

  config = withEntitlementsPlist(config, (cfg) => {
    if (wanted) cfg.modResults['com.apple.developer.healthkit'] = true
    else delete cfg.modResults['com.apple.developer.healthkit']
    // Never set `com.apple.developer.healthkit.access`: that key is for clinical
    // health records, which this app does not touch.
    delete cfg.modResults['com.apple.developer.healthkit.access']
    return cfg
  })
  return withInfoPlist(config, (cfg) => {
    if (wanted) {
      cfg.modResults.NSHealthShareUsageDescription = SHARE_REASON
      cfg.modResults.NSHealthUpdateUsageDescription = UPDATE_REASON
    } else {
      delete cfg.modResults.NSHealthShareUsageDescription
      delete cfg.modResults.NSHealthUpdateUsageDescription
    }
    return cfg
  })
}
