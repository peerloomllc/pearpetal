// Expo config plugin: strip the iOS Associated Domains entitlement for DEV builds.
//
// app.json declares `ios.associatedDomains: ["applinks:peerloomllc.com"]` so an
// https://peerloomllc.com/petal/link|join invite opens the app (Universal Links).
// That adds `com.apple.developer.associated-domains` to the entitlements, which the
// wildcard dev provisioning profile ("iOS Team Provisioning Profile: *") CANNOT
// sign -> a Release archive with automatic signing FAILS:
//   error: ...doesn't include the com.apple.developer.associated-domains entitlement.
// Universal Links need an EXPLICIT `com.pearpetal` App ID with the Associated
// Domains capability enabled in the Apple Developer portal + a matching profile.
// Until that is provisioned, dev builds must drop the entitlement so they archive
// (the pear:// scheme + paste-into-app invites still work; only iOS tap-to-open is
// deferred).
//
// Strips by DEFAULT (dev). Set PEARPETAL_ASSOCIATED_DOMAINS=1 at prebuild time to
// KEEP it, once the App ID is provisioned for a real Universal-Links build.
//
// Same mechanism/ordering caveat as with-ios-no-aps: iOS entitlements mods execute
// in REVERSE app.json `plugins` order, so this is listed FIRST in the array to run
// AFTER expo applies `ios.associatedDomains` (verified against the generated
// ios/PearPetal/PearPetal.entitlements).

const { withEntitlementsPlist } = require('expo/config-plugins')

module.exports = function withIosNoAssociatedDomains (config) {
  if (process.env.PEARPETAL_ASSOCIATED_DOMAINS) return config // keep for a provisioned build
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['com.apple.developer.associated-domains']
    return cfg
  })
}
