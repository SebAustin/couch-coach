#!/usr/bin/env bash
# Installs dist/couch-coach.apk on the running emulator/device, drives the real flow with D-pad key events and a
# synthetic phone (scripts/publish-synthetic.mjs), and saves docs/screenshots/tv-*.png.
#   yarn emulator && yarn build:apk && bash scripts/emulator-screenshots.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
OUT=docs/screenshots
LOG="${TMPDIR:-/tmp}/couchcoach-synthetic.log"
PKG=dev.sebaustin.couchcoach
mkdir -p "$OUT"
shot() { adb exec-out screencap -p > "$OUT/tv-$1.png"; echo "saved tv-$1.png"; }
key() { adb shell input keyevent "$1"; sleep "${2:-1}"; }
DPAD_CENTER=23; DOWN=20; RIGHT=22; LEFT=21; BACK=4; MENU=82

adb install -r dist/couch-coach.apk >/dev/null
adb shell am force-stop $PKG
adb shell pm clear $PKG >/dev/null
adb shell am start -n $PKG/.MainActivity >/dev/null
sleep 14; shot 01-members

for _ in 1 2 3 4 5 6 7 8; do key $RIGHT 0.3; done              # "Add member" is last in focus order
key $DPAD_CENTER 1.5; shot 02-add-member                       # Add member modal
key $DPAD_CENTER 1.5                                           # select the Name field: the TV keyboard opens
adb shell input text "Maya"; sleep 1; shot 03-add-member-typing
key $BACK 1; key $BACK 1.5                                     # Back hides the keyboard, then closes the modal
for _ in 1 2 3 4 5 6 7 8; do key $LEFT 0.3; done              # back to the first Member
key $DPAD_CENTER 7; shot 04-pair                               # real POST /session + QR

# Back from Pair returns to Members
key $BACK 2; shot 05-back-to-members

# Synthetic phone drives Live through the attach deep link
node scripts/publish-synthetic.mjs --wait 6 --reps 5 --faults knees_caving --end --end-delay 22 \
  --cue "Good depth. Your knees drifted in on Reps 2 and 4, so push them out over your toes. Same again, and slow the way down." \
  > "$LOG" 2>&1 &
SYN=$!
for _ in $(seq 1 30); do grep -q "Android TV :" "$LOG" && break; sleep 1; done
LINK=$(grep -o 'couchcoach://attach?[^"]*' "$LOG" | head -1)
adb shell am start -a android.intent.action.VIEW -d "'$LINK'" $PKG >/dev/null
sleep 4; shot 06-live-ready
until grep -q "rep 2 " "$LOG"; do sleep 0.5; done; sleep 1; shot 07-live-fault
key $DOWN 1; shot 08-live-focus
until grep -q "set 1 end" "$LOG"; do sleep 0.5; done; sleep 1.5; shot 09-live-thinking
until grep -q "cue sent" "$LOG"; do sleep 0.5; done; sleep 1.5; shot 10-live-cue
key $MENU 1.5; shot 11-live-debug; key $MENU 0.5
key $BACK 1; key $BACK 1.5; shot 12-live-end-confirm            # first Back dismisses the Cue, second opens the dialog
key $DPAD_CENTER 1                                             # Keep going
until grep -q "control end_session sent" "$LOG"; do sleep 0.5; done; sleep 2; shot 13-recap
wait $SYN || true
