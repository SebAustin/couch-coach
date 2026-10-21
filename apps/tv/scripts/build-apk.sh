#!/usr/bin/env bash
# Builds a sideloadable Fire OS / Android TV APK (release build signed with the Expo debug keystore)
# and copies it to dist/couch-coach.apk.   Usage: yarn build:apk [--skip-prebuild]
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/android-env.sh
source scripts/android-env.sh

if [ "${1:-}" != "--skip-prebuild" ]; then
  node scripts/sync-shared.mjs
  (cd apps/expo-multi-tv && EXPO_TV=1 CI=1 npx expo prebuild -p android --clean)
fi

# Fire TV sticks are armeabi-v7a (older / Fire OS 7 32-bit userspace) or arm64-v8a; x86 ABIs are only for emulators on Intel.
ARCHS="${REACT_NATIVE_ARCHITECTURES:-armeabi-v7a,arm64-v8a}"   # keep in sync with buildArchs in app.json
(cd apps/expo-multi-tv/android && ./gradlew assembleRelease -PreactNativeArchitectures="$ARCHS")

mkdir -p dist
cp apps/expo-multi-tv/android/app/build/outputs/apk/release/app-release.apk dist/couch-coach.apk
echo "Built: $(pwd)/dist/couch-coach.apk ($(du -h dist/couch-coach.apk | cut -f1))"
if command -v apksigner >/dev/null 2>&1 || [ -x "$ANDROID_HOME/build-tools/36.0.0/apksigner" ]; then
  "${ANDROID_HOME}/build-tools/36.0.0/apksigner" verify --print-certs dist/couch-coach.apk | head -3
fi
