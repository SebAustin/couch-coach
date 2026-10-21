#!/usr/bin/env bash
# Creates (once) and boots an Android TV emulator AVD, headless by default.
#   yarn emulator            -> headless boot, waits until the OS has booted
#   EMULATOR_WINDOW=1 yarn emulator   -> with a window
# Needs: sdkmanager "emulator" "system-images;android-34;android-tv;arm64-v8a"
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
AVD="${AVD_NAME:-couchcoach_tv}"
IMAGE="system-images;android-34;android-tv;arm64-v8a"

if ! avdmanager list avd 2>/dev/null | grep -q "Name: $AVD"; then
  echo "no" | avdmanager create avd -n "$AVD" -k "$IMAGE" -d tv_1080p --force
fi

FLAGS=(-avd "$AVD" -no-snapshot -no-audio -gpu swiftshader_indirect -no-boot-anim)
[ "${EMULATOR_WINDOW:-0}" = "1" ] || FLAGS+=(-no-window)
nohup emulator "${FLAGS[@]}" > "${TMPDIR:-/tmp}/couchcoach-emulator.log" 2>&1 &
echo "emulator pid $! (log: ${TMPDIR:-/tmp}/couchcoach-emulator.log)"
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
echo "booted: $(adb shell getprop ro.product.model | tr -d '\r')"
