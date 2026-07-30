// Expo config plugin: the HealthKit READ capability, and nothing more.
//
// Two prebuild-time things the modules/health-read Swift cannot add for itself,
// because `ios/` is generated and any hand edit is wiped by the next prebuild:
//
//   1. `com.apple.developer.healthkit` - without it HKHealthStore refuses at
//      runtime, whatever the Swift says.
//   2. `NSHealthShareUsageDescription` - iOS kills the app outright if it asks to
//      READ health data with no usage string. Note there is deliberately NO
//      `NSHealthUpdateUsageDescription`: that one is required only to WRITE, and
//      PearPetal never writes to Apple Health. Its absence is a structural
//      guarantee, not an oversight - see proposals/2026-07-30-health-import.md.
//
// SIGNING WARNING, the same trap `with-ios-no-associated-domains` documents: the
// wildcard dev profile ("iOS Team Provisioning Profile: *") does NOT include
// HealthKit, so a Release archive with automatic signing fails with
// "Provisioning profile ... doesn't include the com.apple.developer.healthkit
// entitlement" until the capability is enabled on the App ID in the developer
// portal. That is a one-off account change, not a code one.

const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins')

// Shown in the iOS permission sheet. Says what is read and what is done with it,
// because a vague string is both a review risk and a bad answer to a fair question.
const SHARE_REASON =
  'PearPetal can bring your basal body temperature and period days across from Apple Health, so you do not have to type them in twice. It only reads, never writes, and everything stays on your device.'

module.exports = function withIosHealthKit (config) {
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.healthkit'] = true
    // Deliberately not setting `com.apple.developer.healthkit.access`: that key is
    // for clinical health records, which this app does not touch.
    return cfg
  })
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSHealthShareUsageDescription = SHARE_REASON
    delete cfg.modResults.NSHealthUpdateUsageDescription // never write
    return cfg
  })
}
