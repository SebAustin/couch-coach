#!/usr/bin/env bash
# Source me:  source apps/tv/scripts/android-env.sh
# Sets up JDK 17 + Android SDK (Homebrew locations on Apple Silicon) for building the Fire OS APK.
# Override any of these before sourcing if your machine differs.
#   brew install openjdk@17
#   brew install --cask android-commandlinetools
BREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"
export JAVA_HOME="${JAVA_HOME:-$BREW_PREFIX/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$BREW_PREFIX/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export EXPO_TV=1
export EXPO_NO_TELEMETRY=1
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# Optional: use Node 22 for Metro if Node >= 25 misbehaves (see .nvmrc / README)
if [ -d "$BREW_PREFIX/opt/node@22/bin" ] && [ "${USE_NODE22:-0}" = "1" ]; then
  export PATH="$BREW_PREFIX/opt/node@22/bin:$PATH"
fi
