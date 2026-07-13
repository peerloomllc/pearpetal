#!/usr/bin/env bash
# scripts/ios-dev-install.sh
#
# Build PearPetal for iOS device on Tims-Mac-mini.local and install on
# the paired iPhone. Ported from pearlist/scripts/ios-dev-install.sh
# (the proven suite pipeline).
#
# Usage:
#   ./scripts/ios-dev-install.sh                  # full pipeline
#   SKIP_BUILD=1 ./scripts/ios-dev-install.sh     # bundles already fresh
#   SKIP_SYNC=1 ./scripts/ios-dev-install.sh      # already in sync
#   SKIP_INSTALL=1 ./scripts/ios-dev-install.sh   # archive+export only
#
# Required on the Mac mini:
#   - Xcode 16+ with command-line tools
#   - CocoaPods (~/.rbenv or /opt/homebrew via login shell)
#   - Apple Development cert in ~/Library/Keychains/buildkey.keychain
#     (signed under team G79ALD29NA)
#   - Paired iPhone visible to `xcrun devicectl list devices`
#
# One-time setup on the Mac mini (this rsync excludes node_modules, and pod
# install resolves `expo`/`react-native` from node_modules, so the first run
# needs deps present). PearPetal also depends on `@peerloom/core` via
# `file:../peerloom-core` AND `file:../peerloom-device-link`, so BOTH siblings
# must exist on the Mac (a dangling file: symlink makes the Mac's npm install skip
# that dep, so the linked frameworks miss its addons while the Linux-built bundle
# includes it -> iOS worklet SIGABRT at launch, Android tolerant):
#   for sib in peerloom-core peerloom-device-link; do \
#     rsync -az --delete --exclude=node_modules/ --exclude=.git/ \
#       ~/peerloomllc/$sib/ Tims-Mac-mini.local:peerloomllc/$sib/ ; done
#   ssh Tims-Mac-mini.local "bash -lc 'cd peerloomllc/pearpetal && npm install'"
# After that, node_modules survives future rsync --delete runs (it is excluded).
#
# Environment overrides:
#   MAC_MINI         host (default Tims-Mac-mini.local)
#   MAC_REPO_PATH    repo path on Mac mini (default peerloomllc/pearpetal)
#   DEVICE_UDID      iPhone CoreDevice UUID (default Timothy's iPhone SE)
#   TEAM_ID          signing team (default G79ALD29NA)
#   ARCHIVE_PATH     xcarchive output (default /tmp/PearPetal.xcarchive)
#   EXPORT_DIR       IPA output dir (default /tmp/PearPetal-dev)
#   KEYCHAIN_PATH    signing keychain (default ~/Library/Keychains/buildkey.keychain)

set -euo pipefail

MAC_MINI="${MAC_MINI:-Tims-Mac-mini.local}"
MAC_REPO_PATH="${MAC_REPO_PATH:-peerloomllc/pearpetal}"
DEVICE_UDID="${DEVICE_UDID:-E1A6316D-C6A9-510B-9D3E-CD3D85C6DDF5}"
TEAM_ID="${TEAM_ID:-G79ALD29NA}"
ARCHIVE_PATH="${ARCHIVE_PATH:-/tmp/PearPetal.xcarchive}"
EXPORT_DIR="${EXPORT_DIR:-/tmp/PearPetal-dev}"
KEYCHAIN_PATH="${KEYCHAIN_PATH:-~/Library/Keychains/buildkey.keychain}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

# ── 0. Build bundles locally ────────────────────────────────────────────────
# rsync copies assets/* to the Mac mini, but the iOS pipeline never
# rebuilds the JS bundles — Xcode just packages whatever's in assets/.
# Stale bundles would ship to the device silently. Builds bare-ios.bundle
# (worklet, ios preset) and app-ui.bundle (WebView UI); the Android
# universal bare bundle is intentionally skipped here.
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "build bundles locally (bare:ios + ui)"
  cd "$REPO_ROOT"
  npm run build:bare:ios
  npm run build:ui
fi

# ── 0b. Ensure the iOS native project exists ────────────────────────────────
# ios/ is gitignored (regenerated from app.json + config plugins; no custom
# native code). Generate it if missing so this script is self-contained.
if [ ! -d "$REPO_ROOT/ios" ]; then
  step "generate ios/ (expo prebuild)"
  cd "$REPO_ROOT"
  CI=1 npx expo prebuild -p ios --no-install
fi

# ── 1. Sync workspace to Mac mini ───────────────────────────────────────────
if [ "${SKIP_SYNC:-0}" != "1" ]; then
  step "rsync $REPO_ROOT/ -> ${MAC_MINI}:${MAC_REPO_PATH}/"
  rsync -az --delete \
    --exclude='node_modules/' \
    --exclude='ios/Pods/' \
    --exclude='ios/build/' \
    --exclude='ios/PearPetal.xcworkspace/' \
    --exclude='android/build/' \
    --exclude='android/.gradle/' \
    --exclude='android/app/build/' \
    --exclude='.git/' \
    --exclude='.expo/' \
    "$REPO_ROOT/" \
    "${MAC_MINI}:${MAC_REPO_PATH}/"
fi

# ── 1b. npm install on Mac mini (keep node_modules in lockstep) ─────────────
# The iOS build LINKS native-addon frameworks (bare-fs, rocksdb-native, ...)
# from the Mac's node_modules, while the JS worklet bundle is built on the
# dev host and references THAT host's versions. If the two drift, the bundle
# asks for e.g. bare-fs.4.7.2.framework while the Mac linked 4.7.3 ->
# ADDON_NOT_FOUND at engine init. Installing from the (rsynced) package-lock
# keeps the Mac's versions identical to the bundle's. Fast when unchanged.
step "npm install on $MAC_MINI (sync addon versions to the bundle)"
ssh "$MAC_MINI" "bash -lc 'cd $MAC_REPO_PATH && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npm install'" \
  | tail -2

# ── 2. Pod install on Mac mini ──────────────────────────────────────────────
# UTF-8 env vars are required: bash -lc returns ASCII-8BIT by default on
# this Mac, and CocoaPods' UnicodeNormalize crashes without UTF-8.
step "pod install on $MAC_MINI"
ssh "$MAC_MINI" "bash -lc 'cd $MAC_REPO_PATH/ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install'" \
  | tail -3

# ── 3. Archive + export ─────────────────────────────────────────────────────
# Strip /opt/homebrew/bin from PATH so Apple's openrsync (not Homebrew GNU
# rsync) is used by Xcode's distribution pipeline. Unlock + partition-list so
# codesign over SSH can reach the private key.
#
# `-allowProvisioningUpdates` lets xcodebuild create/download managed profiles
# via the Apple ID signed into Xcode on the Mac (Xcode > Settings > Accounts).
# Needed when the app requests a capability the cached wildcard team profile
# ("iOS Team Provisioning Profile: *") lacks — e.g. Associated Domains for
# Universal Links (PEARPETAL_ASSOCIATED_DOMAINS=1), which needs an EXPLICIT
# com.pearpetal App ID + profile. Without an account signed in, this fails with
# "No Accounts: Add a new account in Accounts settings."
step "archive (Release, generic/platform=iOS, automatic signing)"
ssh "$MAC_MINI" "bash -lc '
  set -euo pipefail
  cd $MAC_REPO_PATH/ios
  security unlock-keychain -p \"\" $KEYCHAIN_PATH
  security list-keychains -s $KEYCHAIN_PATH ~/Library/Keychains/login.keychain-db /Library/Keychains/System.keychain
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k \"\" $KEYCHAIN_PATH >/dev/null 2>&1 || true
  XCODE_PATH=\$(printf %s \"\$PATH\" | sed \"s|/opt/homebrew/bin:||g; s|:/opt/homebrew/bin||g\")
  rm -rf $ARCHIVE_PATH
  PATH=\"\$XCODE_PATH\" xcodebuild \
    -workspace PearPetal.xcworkspace \
    -scheme PearPetal \
    -configuration Release \
    -destination generic/platform=iOS \
    -archivePath $ARCHIVE_PATH \
    DEVELOPMENT_TEAM=$TEAM_ID \
    CODE_SIGN_STYLE=Automatic \
    -allowProvisioningUpdates \
    archive 2>&1 | grep -E \"^error:|ARCHIVE FAILED|ARCHIVE SUCCEEDED\" || true
'"

step "export development IPA"
ssh "$MAC_MINI" "bash -lc '
  set -euo pipefail
  security unlock-keychain -p \"\" $KEYCHAIN_PATH
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k \"\" $KEYCHAIN_PATH >/dev/null 2>&1 || true
  cat > /tmp/PearPetalExportDev.plist << EOF
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>method</key><string>development</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>compileBitcode</key><false/>
  <key>stripSwiftSymbols</key><false/>
</dict>
</plist>
EOF
  cd $MAC_REPO_PATH/ios
  XCODE_PATH=\$(printf %s \"\$PATH\" | sed \"s|/opt/homebrew/bin:||g; s|:/opt/homebrew/bin||g\")
  rm -rf $EXPORT_DIR
  PATH=\"\$XCODE_PATH\" xcodebuild \
    -exportArchive \
    -archivePath $ARCHIVE_PATH \
    -exportPath $EXPORT_DIR \
    -exportOptionsPlist /tmp/PearPetalExportDev.plist \
    -allowProvisioningUpdates \
    OTHER_CODE_SIGN_FLAGS=\"--keychain $KEYCHAIN_PATH\" 2>&1 | tail -3
  ls $EXPORT_DIR/PearPetal.ipa
'"

# ── 4. Install on iPhone from THIS machine via ideviceinstaller ──────────────
# devicectl's install fails with "Authorization is required to install the
# packages" over the wireless CoreDevice link. Instead: pull the IPA from the
# Mac to this host and install over USB with ideviceinstaller (usbmuxd). The
# iPhone must be plugged into THIS machine and trusted (`idevicepair validate`).
# Launch: open the app by hand (libimobiledevice can't launch without a mounted
# Developer Disk Image, which is a hurdle on iOS 17+/26).
LOCAL_IPA="${LOCAL_IPA:-/tmp/PearPetal-dev/PearPetal.ipa}"
if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  step "pull IPA from $MAC_MINI"
  mkdir -p "$(dirname "$LOCAL_IPA")"
  scp "${MAC_MINI}:${EXPORT_DIR}/PearPetal.ipa" "$LOCAL_IPA"

  step "install on iPhone (local ideviceinstaller over USB)"
  if ! idevice_id -l | grep -q .; then
    echo "ERROR: no USB iPhone visible to usbmuxd here. Plug it into THIS machine + tap Trust."; exit 1
  fi
  idevicepair validate >/dev/null 2>&1 || { echo "ERROR: device not paired/trusted; run: idevicepair pair"; exit 1; }
  ideviceinstaller install "$LOCAL_IPA" 2>&1 | tail -5

  step "Open PearPetal on the iPhone by hand (no headless launch without a mounted DDI)."
fi

step "Done. IPA: $EXPORT_DIR/PearPetal.ipa on $MAC_MINI"
