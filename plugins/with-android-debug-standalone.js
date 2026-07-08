// Expo config plugin: make the Android DEBUG build a standalone, distinctly-ided
// install, durably - android/ is gitignored and regenerated from app.json + config
// plugins on every `expo prebuild`, so a hand-edit to build.gradle is wiped on the
// next prebuild. This plugin is the source of truth for two things:
//
// 1. applicationIdSuffix ".debug" on the debug buildType, so debug installs as
//    com.pearpetal.debug and can coexist with a release com.pearpetal without a
//    signature-mismatch conflict, and a debug build can never masquerade as the
//    release package. The suffix changes only the applicationId, not the namespace
//    (com.pearpetal), so .MainActivity/.MainApplication and all deep-link schemes/
//    hosts resolve unchanged; library FileProviders keyed on ${applicationId}
//    self-adjust to com.pearpetal.debug.provider.
//    (Ported from pearlist/plugins/with-android-debug-app-id.js.)
//
// 2. debuggableVariants = [] in the react {} block, so the DEBUG variant EMBEDS the
//    JS bundle instead of requiring a Metro dev server - the suite convention that
//    test builds are standalone. Without this, the RN default (debuggableVariants =
//    ["debug"]) leaves debug builds Metro-dependent.

const { withAppBuildGradle } = require('expo/config-plugins')

module.exports = function withAndroidDebugStandalone (config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents

    // 1. .debug applicationId suffix on the debug buildType. Anchor on the debug
    // buildType (not the signingConfigs debug block, which opens with storeFile).
    const anchor = /( {4}buildTypes \{\n {8}debug \{\n)/
    if (anchor.test(contents) && !contents.includes('applicationIdSuffix ".debug"')) {
      contents = contents.replace(anchor, '$1            applicationIdSuffix ".debug"\n')
    }

    // 2. Embed the JS bundle in debug too (no Metro): debuggableVariants = [].
    // The `react {` block sits at column 0 in the generated build.gradle.
    if (!/debuggableVariants\s*=\s*\[\s*\]/.test(contents)) {
      contents = contents.replace(/(\nreact \{\n)/, '$1    debuggableVariants = []\n')
    }

    cfg.modResults.contents = contents
    return cfg
  })
}
