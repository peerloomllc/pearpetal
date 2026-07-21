#!/usr/bin/env bash
# scripts/android-debug-install.sh
#
# Build and install the standalone Android DEBUG APK, from a guaranteed-fresh
# android/.
#
# WHY THIS EXISTS: `cd android && ./gradlew assembleDebug` builds against
# whatever android/ happens to be lying around. android/ is gitignored and
# regenerated from app.json + config plugins, so any change to app.json, an icon
# or a plugin since the last prebuild is silently absent from the APK - the build
# succeeds and ships stale assets. That is how the wrong notification glyph
# shipped. release.sh already prebuilds --clean for the release path; this is the
# same guarantee for debug.
#
# It also rebuilds the JS bundles first. Debug builds here are standalone (the
# with-android-debug-standalone plugin sets debuggableVariants = [], so the JS is
# embedded rather than served by Metro), which means a stale assets/*.bundle
# ships to the device just as silently as a stale android/.
#
# Installs as com.pearpetal.debug (applicationIdSuffix ".debug"), so it coexists
# with a production com.pearpetal install.
#
# Usage:
#   ./scripts/android-debug-install.sh              # build + install to the only device
#   ./scripts/android-debug-install.sh pixel        # resolve via adb-find.sh, then install
#   ./scripts/android-debug-install.sh <serial>     # install to a specific device
#   SKIP_BUILD=1 ./scripts/android-debug-install.sh # bundles already fresh
#   SKIP_PREBUILD=1 ./scripts/android-debug-install.sh  # android/ already correct
#   SKIP_INSTALL=1 ./scripts/android-debug-install.sh   # build the APK only
#
# Environment overrides:
#   ABIS   architectures to build (default arm64-v8a, matching the release APK)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUITE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
ABIS="${ABIS:-arm64-v8a}"
APK="$REPO_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
TARGET="${1:-}"

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

# ── 1. JS bundles (worklet + WebView UI) ────────────────────────────────────
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "build bundles (bare:universal + ui)"
  cd "$REPO_ROOT"
  npm run build:bare
  npm run build:ui
fi

# ── 2. Regenerate android/ ──────────────────────────────────────────────────
# --clean, not a plain prebuild: the point is to pick up plugin and app.json
# changes that an incremental prebuild can leave behind.
if [ "${SKIP_PREBUILD:-0}" != "1" ]; then
  step "regenerate android/ (expo prebuild --clean)"
  cd "$REPO_ROOT"
  CI=1 npx expo prebuild -p android --clean --no-install
fi

# ── 3. Assemble ─────────────────────────────────────────────────────────────
step "assembleDebug (${ABIS})"
cd "$REPO_ROOT/android"
./gradlew assembleDebug -PreactNativeArchitectures="$ABIS"

[ -f "$APK" ] || { echo "expected APK not found: $APK" >&2; exit 1; }
step "built $(du -h "$APK" | cut -f1) -> $APK"

# ── 4. Install ──────────────────────────────────────────────────────────────
if [ "${SKIP_INSTALL:-0}" = "1" ]; then
  exit 0
fi

# A bare name (pixel, tcl) goes through the suite's adb-find.sh, which discovers
# the device over mDNS and connects - wifi addresses change on every reconnect,
# so they must never be hardcoded or asked for.
SERIAL="$TARGET"
if [ -n "$TARGET" ] && [ -x "$SUITE_ROOT/adb-find.sh" ] && [[ "$TARGET" != *:* ]] && ! adb devices | grep -q "^${TARGET}[[:space:]]"; then
  step "resolving '$TARGET' via adb-find.sh"
  SERIAL="$("$SUITE_ROOT/adb-find.sh" "$TARGET")"
fi

step "install${SERIAL:+ to $SERIAL}"
if [ -n "$SERIAL" ]; then
  adb -s "$SERIAL" install -r "$APK"
else
  adb install -r "$APK"
fi
