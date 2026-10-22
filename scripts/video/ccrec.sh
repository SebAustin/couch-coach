#!/system/bin/sh
# Couch Coach demo recorder loop. tv-record.mjs pushes this to /data/local/tmp and starts it with nohup ON the
# Fire TV: a screenrecord started straight from an adb shell dies with that shell when adb drops (TV sleep,
# Wi-Fi blip) and leaves an MP4 without its index. Running the loop on the TV keeps recording through that.
#
#   sh ccrec.sh now                                           print the TV clock, ns since the epoch
#   sh ccrec.sh run <dir> <WxH> <bitRate> <chunkS> [logcat filter...]
#
# run records <dir>/01.mp4, 02.mp4, ... (chunkS seconds each, screenrecord's limit is 180) until <dir>/stop
# exists. Stop: touch <dir>/stop, then SIGINT the pid in <dir>/screenrecord.pid (SIGINT lets the MP4 finish).
# index.txt lines: "clock <date|epochrealtime|seconds>", "pid <n>", "NN <ns> start", "NN <ns> end <exit>",
# "abort <reason>", "done <ns>". logcat.txt: `logcat -v epoch` filtered to audio-player and app tags.
# POSIX sh only (mksh on Fire OS, also runs under macOS sh for the unit test).

set -f # the logcat filter contains "*:S"; never glob it

clock_method() {
  ns=$(date +%s%N 2>/dev/null)
  case "$ns" in
    '' | *[!0-9]*) ;;
    *) if [ ${#ns} -ge 16 ]; then echo date; return; fi ;;
  esac
  if [ -n "$EPOCHREALTIME" ]; then echo epochrealtime; return; fi
  echo seconds
}

now_ns() {
  ns=$(date +%s%N 2>/dev/null)
  case "$ns" in
    '' | *[!0-9]*) ;;
    *) if [ ${#ns} -ge 16 ]; then echo "$ns"; return; fi ;;
  esac
  if [ -n "$EPOCHREALTIME" ]; then
    s=${EPOCHREALTIME%[.,]*}
    f=${EPOCHREALTIME#*[.,]}
    while [ ${#f} -lt 9 ]; do f="${f}0"; done
    echo "$s$f"
    return
  fi
  echo "$(date +%s)000000000"
}

record_loop() {
  dir=$1 size=$2 rate=$3 chunk=$4
  shift 4
  mkdir -p "$dir" || exit 1
  rm -f "$dir/stop" "$dir/screenrecord.pid"
  echo "clock $(clock_method)" >> "$dir/index.txt"
  echo "pid $$" >> "$dir/index.txt"
  trap '' HUP

  logcat -v epoch -T 1 "$@" > "$dir/logcat.txt" 2>&1 &
  lpid=$!

  n=1
  quick=0
  while [ ! -f "$dir/stop" ]; do
    name=$(printf '%02d' "$n")
    began=$(date +%s)
    echo "$name $(now_ns) start" >> "$dir/index.txt"
    # Backgrounded only to learn its pid; screenrecord installs its own SIGINT handler.
    screenrecord --size "$size" --bit-rate "$rate" --time-limit "$chunk" "$dir/$name.mp4" &
    spid=$!
    echo "$spid" > "$dir/screenrecord.pid"
    wait "$spid"
    code=$?
    echo "$name $(now_ns) end $code" >> "$dir/index.txt"
    rm -f "$dir/screenrecord.pid"
    # A recorder that dies at once (bad size, encoder busy) would spin; give up after 3 in a row.
    if [ "$code" -ne 0 ] && [ $(($(date +%s) - began)) -lt 3 ]; then quick=$((quick + 1)); else quick=0; fi
    if [ "$quick" -ge 3 ]; then
      echo "abort screenrecord failed 3 times in a row (exit $code)" >> "$dir/index.txt"
      break
    fi
    n=$((n + 1))
  done

  kill "$lpid" 2>/dev/null
  echo "done $(now_ns)" >> "$dir/index.txt"
}

case "$1" in
  now) now_ns ;;
  run)
    shift
    if [ $# -lt 4 ]; then echo "usage: ccrec.sh run <dir> <WxH> <bitRate> <chunkS> [logcat filter...]" >&2; exit 2; fi
    record_loop "$@"
    ;;
  *) echo "usage: ccrec.sh now | run <dir> <WxH> <bitRate> <chunkS> [logcat filter...]" >&2; exit 2 ;;
esac
