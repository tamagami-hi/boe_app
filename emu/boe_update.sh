#!/usr/bin/env bash
set -euo pipefail

# BeOnEdge client APK builder.
#
#   ./boe_update.sh --dev          (default) build the DEV APK (backend at
#                                  http://10.0.2.2:47502, the local Docker
#                                  stack) and install + launch it on the
#                                  running emulator.
#   ./boe_update.sh --production   build the PRODUCTION APK (backend at
#                                  https://algogon.xyz, baked from
#                                  app/.env.android-prod) and export it to
#                                  emu/out/ for sideloading on real devices.
#                                  Does NOT touch the emulator.

MODE="dev"
case "${1:-}" in
  --dev|"") MODE="dev" ;;
  --production|--prod) MODE="production" ;;
  *)
    echo "Usage: $0 [--dev|--production]" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend_stack"
APP_DIR="$PROJECT_ROOT/frontend_stack/app"
ANDROID_DIR="$APP_DIR/android"
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE_NAME="com.beonedge.app"
OUT_DIR="$SCRIPT_DIR/out"

export ANDROID_HOME="${ANDROID_HOME:-/home/nethunter07/Android/Sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

if [ "$MODE" = "dev" ]; then
  # Dev overrides may come from the shell; default to the local Docker stack.
  export VITE_BEO_API_MODE="${VITE_BEO_API_MODE:-http}"
  export VITE_BEO_API_BASE_URL="${VITE_BEO_API_BASE_URL:-http://10.0.2.2:47502}"
  export VITE_BEO_ONBOARDING_URL="${VITE_BEO_ONBOARDING_URL:-http://10.0.2.2:3100/signup}"
else
  # Production values come from app/.env.android-prod (https://algogon.xyz).
  # Unset any inherited overrides so they cannot leak into the prod build.
  unset VITE_BEO_API_MODE VITE_BEO_API_BASE_URL VITE_BEO_ONBOARDING_URL
fi

# Pin a Gradle-compatible JDK. The system default may be too new (e.g. JDK 25 →
# "Unsupported class file major version 69"); Gradle 8.14 needs JDK <= 21.
# Prefer an explicit JAVA_HOME, else Android Studio's bundled JBR (21), else a
# java-21 install.
if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in /opt/android-studio/jbr /usr/lib/jvm/java-21-openjdk-amd64; do
    if [ -x "$candidate/bin/java" ]; then export JAVA_HOME="$candidate"; break; fi
  done
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd npm
[ "$MODE" = "dev" ] && require_cmd adb

if [ ! -d "$FRONTEND_DIR" ] || [ ! -d "$APP_DIR" ] || [ ! -d "$ANDROID_DIR" ]; then
  echo "Expected frontend workspace and Android project under: $PROJECT_ROOT" >&2
  exit 1
fi

if [ ! -x "$ANDROID_DIR/gradlew" ]; then
  echo "Gradle wrapper is missing or not executable: $ANDROID_DIR/gradlew" >&2
  echo "Run: chmod +x $ANDROID_DIR/gradlew" >&2
  exit 1
fi

EMULATOR_ID=""
if [ "$MODE" = "dev" ]; then
  EMULATOR_ID="$(adb devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"

  if [ -z "$EMULATOR_ID" ]; then
    echo "No running Android emulator detected."
    echo "Start it with:"
    echo "  emulator -avd boe_pixel_api36 -gpu host -no-snapshot-load"
    exit 1
  fi

  echo "Using emulator: $EMULATOR_ID"

  echo "Waiting for emulator to be ready..."
  adb -s "$EMULATOR_ID" wait-for-device

  BOOT_COMPLETED="$(adb -s "$EMULATOR_ID" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  until [ "$BOOT_COMPLETED" = "1" ]; do
    sleep 2
    BOOT_COMPLETED="$(adb -s "$EMULATOR_ID" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  done
fi

echo "Syncing mobile assets into Android project ($MODE)..."
cd "$FRONTEND_DIR"
rm -f "$APK_PATH"
if [ "$MODE" = "production" ]; then
  npm --workspace app run android:sync:prod
else
  npm --workspace app run android:sync
fi

echo "Building APK..."
cd "$ANDROID_DIR"
./gradlew assembleDebug --console=plain

if [ ! -f "$APK_PATH" ]; then
  echo "APK was not created: $APK_PATH" >&2
  exit 1
fi

if [ "$MODE" = "production" ]; then
  mkdir -p "$OUT_DIR"
  STAMP="$(date +%Y%m%d-%H%M)"
  RELEASE_APK="$OUT_DIR/beonedge-algogon-$STAMP.apk"
  cp "$APK_PATH" "$RELEASE_APK"
  echo ""
  echo "Production APK exported: $RELEASE_APK"
  echo "Backend baked in: https://algogon.xyz (from app/.env.android-prod)."
  echo "Sideload it on any Android device (adb install or file transfer)."
  echo ""
  echo "NOTE: this APK is debug-signed (no release keystore is configured in"
  echo "android/app/build.gradle). Fine for sideloading and internal testing;"
  echo "set up a release signingConfig before any Play Store distribution."
  exit 0
fi

echo "API base is baked into the APK as $VITE_BEO_API_BASE_URL (emulator -> host loopback)."
echo "Signup opens $VITE_BEO_ONBOARDING_URL from the APK."

echo "Installing APK..."
adb -s "$EMULATOR_ID" install -r "$APK_PATH"

echo "Launching $PACKAGE_NAME..."
adb -s "$EMULATOR_ID" shell monkey -p "$PACKAGE_NAME" 1 >/dev/null

echo "Done."
