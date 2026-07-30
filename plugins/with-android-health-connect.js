// Expo config plugin: declare the two Health Connect READ permissions, and
// nothing else.
//
// WHY THIS EXISTS: react-native-health-connect ships its own plugin, but that one
// only adds the ACTION_SHOW_PERMISSIONS_RATIONALE intent-filter. The
// `<uses-permission>` entries are ours to declare, and declaring them is the
// whole security posture of this feature:
//
//   READ ONLY, AND ONLY TWO TYPES. There is no WRITE_* permission here, so no
//   write-back path to the health platform EXISTS - not "is not called", does not
//   exist. That is the structural half of the one-way guarantee in
//   proposals/2026-07-30-health-import.md. The other half is the iOS side asking
//   for `toRead` and never `toShare`.
//
// Google's own guidance for the Play Console health declaration is to request the
// minimum data types with a specific user-facing justification, so keeping this
// list to exactly what the import writes is also what gets the declaration
// approved. Anything added here needs a matching justification on the form.
//
// Health Connect is part of the platform from Android 14 (API 34). Below that it
// is a separate app the user may not have, which the shell handles at runtime by
// reporting it unavailable rather than failing.

const { withAndroidManifest } = require('expo/config-plugins')

// Exactly the two the import reads. See src/healthImport.js IMPORTABLE.
const PERMISSIONS = [
  'android.permission.health.READ_MENSTRUATION',
  'android.permission.health.READ_BASAL_BODY_TEMPERATURE',
]

module.exports = function withAndroidHealthConnect (config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    manifest['uses-permission'] = manifest['uses-permission'] || []
    for (const name of PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$?.['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } })
      }
    }
    return cfg
  })
}
