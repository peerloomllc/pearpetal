// Expo config plugin: strip the iOS `aps-environment` entitlement.
//
// PearPetal uses LOCAL notifications only (period / fertile reminders scheduled
// on-device) - no remote push, consistent with the no-server P2P model. The
// expo-notifications config plugin nonetheless adds the Push Notifications
// capability (`aps-environment`) to the entitlements. The wildcard dev
// provisioning profile ("iOS Team Provisioning Profile: *") does NOT include
// Push, so a Release archive with automatic signing FAILS:
//   error: Provisioning profile ... doesn't include the aps-environment entitlement.
// Local notifications need no push entitlement, so we remove it here. NOTE: iOS
// entitlements mods execute in REVERSE array order, so to run AFTER
// expo-notifications adds `aps-environment` this plugin must be listed BEFORE
// "expo-notifications" in the app.json `plugins` array (verified 2026-07-09).

const { withEntitlementsPlist } = require('expo/config-plugins')

module.exports = function withIosNoAps (config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment']
    return cfg
  })
}
