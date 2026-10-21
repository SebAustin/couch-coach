#!/usr/bin/env bash
# Installs dist/couch-coach.apk on a connected device/emulator and launches it.
#   yarn install:apk                 -> the only connected device
#   yarn install:apk 192.168.1.50    -> adb connect <ip>:5555 first (Fire TV: Settings > My Fire TV > Developer Options)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
if [ -n "${1:-}" ]; then adb connect "${1}:5555"; fi
adb devices
adb install -r dist/couch-coach.apk
adb shell am start -n dev.sebaustin.couchcoach/.MainActivity
