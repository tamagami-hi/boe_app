#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# boe_update.sh — BeOnEdge Android APK builder. Runs ONLY on this computer.
#
# Builds the Capacitor/Vite Android applications and stages them under emu/out/
# so release_manager/export.sh can pick them up and deploy.sh can publish them
# into the VPS APK holder directories.
#
# WHAT CHANGED FROM THE PREVIOUS VERSION, AND WHY
#
#   1. STACK-AWARE TARGETS. It used to have exactly two modes: "dev" meant the
#      local Docker stack at 10.0.2.2, and "release" meant one hardcoded
#      production domain. There are now three deployable stacks, so the target
#      is explicit and the API origin is derived from it:
#         --local   emulator → local Docker backend on the host loopback
#         --dev     dev VPS stack   (https://dev-app.beonedge.in/api)
#         --prod    prod VPS stack  (https://app.beonedge.in/api)
#
#   2. ADMIN VARIANT. Only the client APK could be built; the npm script pins
#      VITE_BEO_APP_TARGET=client and check-android-dist.mjs actively rejects
#      admin chunks. The VPS scaffold has dev_admin_apk / admin_apk holders that
#      nothing populated. Vite is now driven directly so both variants build,
#      and the client-only guard runs only for client builds where it belongs.
#
#   3. SHA-256 IN THE SIDECAR. Image tarballs were checksummed but APKs were
#      not, so a truncated transfer was undetectable. Every APK now records its
#      digest, matching the image manifest contract.
#
#   4. BOUNDED WAITS. The emulator boot poll was an unbounded `until` loop; a
#      hung emulator hung the build forever. It now times out.
#
#   5. NO HOST-SPECIFIC PATHS. ANDROID_HOME defaulted to one developer's home
#      directory. It is now discovered from the standard locations and fails
#      with an actionable message instead of a confusing Gradle error.
#
#   6. FILENAMES CARRY THE VARIANT AND TARGET, so artifacts are unambiguous:
#         boe.<target>.<variant>.<version>.apk
#         e.g. boe.dev.client.0.6.4.apk, boe.prod.admin.1.0.0.apk
#      Previously dev and prod rebuilds of the same version overwrote each other.
#
#   7. HEADLESS-CAPABLE. --no-install skips all emulator interaction so the
#      release pipeline can build APKs without a device attached.
#
# KNOWN LIMITATION IT REPORTS BUT CANNOT FIX ALONE
#   android/app/build.gradle has a single fixed applicationId, no product
#   flavors, static versionCode/versionName, and no release signingConfig.
#   Consequences, both flagged at build time:
#     • dev and prod APKs share an applicationId, so they CANNOT be installed
#       side by side (the deployment plan §16.1 requires that they can);
#     • --prod still produces a debug-signed APK.
#   Fixing these requires editing the Gradle project. See the warnings emitted
#   at the end of a build, and FACTS_VS_PLAN.md §6 item 8.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend_stack"
APP_DIR="$FRONTEND_DIR/app"
ANDROID_DIR="$APP_DIR/android"
GRADLE_APK_DEBUG="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
GRADLE_APK_RELEASE="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
PACKAGE_NAME="com.beonedge.app"
OUT_DIR="$SCRIPT_DIR/out"

# shellcheck source=../release_manager/lib/version.sh
source "$PROJECT_ROOT/release_manager/lib/version.sh"
# shellcheck source=../release_manager/lib/ui.sh
source "$PROJECT_ROOT/release_manager/lib/ui.sh"

# ── arguments ───────────────────────────────────────────────────────────────
TARGET=""
VARIANTS=()
DO_INSTALL=""
KEEP_OUT=6

usage() {
    cat <<'USAGE'
Usage: ./emu/boe_update.sh (--local | --dev | --prod) [options]

Builds the BeOnEdge Android application(s) into emu/out/.

Target (required, exactly one) — decides the API origin baked into the bundle:
  --local     local Docker backend via the emulator loopback (http://10.0.2.2)
  --dev       development VPS stack   (https://dev-app.beonedge.in/api)
  --prod      production VPS stack    (https://app.beonedge.in/api)

Variant:
  --client       build the user app only (default)
  --admin        build the admin app only
  --both         build both

Options:
  --install      install + launch on the running emulator (default for --local)
  --no-install   never touch a device (default for --dev and --prod)
  --keep N       how many APKs to retain in emu/out/ (default 6)
  --help, -h     this message

Overrides (rarely needed; the target normally supplies these):
  BOE_APK_VERSION        force the version label
  BOE_API_BASE_URL       force the API origin
  BOE_ONBOARDING_URL     force the onboarding URL
  ANDROID_HOME           Android SDK location
  JAVA_HOME              JDK to build with (must be <= 21 for this Gradle)

The API origin is compiled INTO the bundle by Vite, so a different origin needs
a different build — it cannot be changed after the fact.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local|--dev|--prod)
            [[ -z "$TARGET" ]] || { err "only one target may be given"; exit 1; }
            TARGET="${1#--}"; shift ;;
        # Accepted for backward compatibility with the old two-mode interface.
        --production)  TARGET="prod"; shift ;;
        --client)      VARIANTS+=(client); shift ;;
        --admin)       VARIANTS+=(admin);  shift ;;
        --both)        VARIANTS=(client admin); shift ;;
        --install)     DO_INSTALL=true;  shift ;;
        --no-install)  DO_INSTALL=false; shift ;;
        --keep)
            # validated BEFORE assignment: KEEP_OUT is later spliced into
            # arithmetic, where an unvalidated value is an injection vector,
            # and a bare trailing --keep must fail cleanly instead of shifting
            [[ "${2:-}" =~ ^[0-9]+$ ]] \
                || { err "--keep requires a non-negative integer (got: '${2:-<none>}')"; exit 1; }
            KEEP_OUT="$2"; shift 2 ;;
        --help|-h)     usage; exit 0 ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

[[ -n "$TARGET" ]] || { err "a target is required: --local, --dev or --prod"; usage >&2; exit 1; }
(( ${#VARIANTS[@]} > 0 )) || VARIANTS=(client)

# Installing only makes sense for a local build; remote-targeted APKs are for
# distribution, not for the developer's emulator.
if [[ -z "$DO_INSTALL" ]]; then
    [[ "$TARGET" == "local" ]] && DO_INSTALL=true || DO_INSTALL=false
fi

# ── API origins per target ──────────────────────────────────────────────────
# Vite reads these from the shell, and the shell wins over the .env.android*
# files, so the target fully determines the baked origin.
case "$TARGET" in
    local)
        # 10.0.2.2 is the emulator's alias for the host loopback.
        API_BASE="${BOE_API_BASE_URL:-http://10.0.2.2:47502}"
        ONBOARDING="${BOE_ONBOARDING_URL:-http://10.0.2.2:3100/signup}"
        VITE_MODE="android"
        ;;
    dev)
        API_BASE="${BOE_API_BASE_URL:-https://dev-app.beonedge.in/api}"
        ONBOARDING="${BOE_ONBOARDING_URL:-https://dev.beonedge.in/signup}"
        VITE_MODE="android-prod"
        ;;
    prod)
        API_BASE="${BOE_API_BASE_URL:-https://app.beonedge.in/api}"
        ONBOARDING="${BOE_ONBOARDING_URL:-https://beonedge.in/signup}"
        VITE_MODE="android-prod"
        ;;
esac

# A distributed APK must never fall back to cleartext HTTP.
if [[ "$TARGET" != "local" && "$API_BASE" != https://* ]]; then
    err "target '$TARGET' requires an https API origin, got: $API_BASE"
    exit 1
fi
if [[ "$TARGET" != "local" && "$ONBOARDING" != https://* ]]; then
    err "target '$TARGET' requires an https onboarding URL, got: $ONBOARDING"
    exit 1
fi

# ── version identity (shared with the image pipeline) ───────────────────────
APK_VERSION="${BOE_APK_VERSION:-}"
if [[ -z "$APK_VERSION" ]]; then
    APK_VERSION="$(canonical_version "$PROJECT_ROOT/VERSION" \
                                     "$PROJECT_ROOT/release_manager/build/prod_release" \
                                     "$PROJECT_ROOT")"
fi

# export.sh passes a full dev label (0.6.4-dev.18.gSHA.dirty), so accept both a
# bare semver and a pre-release label; only bare semver goes into versionName.
BASE_VERSION="${APK_VERSION%%-*}"
assert_semver "$BASE_VERSION" || { err "cannot derive a semver from '$APK_VERSION'"; exit 1; }

BUILD_LABEL="$APK_VERSION"
if [[ "$APK_VERSION" == "$BASE_VERSION" ]] && ! on_exact_release_tag "$PROJECT_ROOT" "$BASE_VERSION"; then
    BUILD_LABEL="$(dev_version "$BASE_VERSION" "$PROJECT_ROOT")"
fi

GIT_SHA="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY=false
[[ -n "$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null)" ]] && GIT_DIRTY=true

# ── toolchain ───────────────────────────────────────────────────────────────
# Discover the SDK instead of assuming one developer's home directory.
if [[ -z "${ANDROID_HOME:-}" ]]; then
    for candidate in "$HOME/Android/Sdk" "$HOME/android-sdk" /opt/android-sdk /usr/lib/android-sdk; do
        [[ -d "$candidate/platform-tools" ]] && { export ANDROID_HOME="$candidate"; break; }
    done
fi
if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME" ]]; then
    err "Android SDK not found."
    err "Set ANDROID_HOME, e.g.:  ANDROID_HOME=\$HOME/Android/Sdk ./emu/boe_update.sh --dev"
    exit 1
fi
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

# Gradle 8.x rejects newer JDKs with "Unsupported class file major version".
# Prefer Android Studio's bundled JBR, then a system JDK 21/17.
if [[ -z "${JAVA_HOME:-}" ]]; then
    for candidate in /opt/android-studio/jbr \
                     /usr/lib/jvm/java-21-openjdk-amd64 \
                     /usr/lib/jvm/java-17-openjdk-amd64; do
        [[ -x "$candidate/bin/java" ]] && { export JAVA_HOME="$candidate"; break; }
    done
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || { err "missing required command: $1"; exit 1; }
}
require_cmd npm
require_cmd npx
require_cmd node
require_cmd git
require_cmd jq
require_cmd numfmt
require_cmd sha256sum
# `if`, not `[ ... ] && require_cmd adb` — as the last command in a && chain a
# false test would abort the whole script under `set -e`.
if [[ "$DO_INSTALL" == true ]]; then
    require_cmd adb
fi

for d in "$FRONTEND_DIR" "$APP_DIR" "$ANDROID_DIR"; do
    [[ -d "$d" ]] || { err "missing directory: $d"; exit 1; }
done
[[ -x "$ANDROID_DIR/gradlew" ]] || { err "not executable: $ANDROID_DIR/gradlew  (chmod +x it)"; exit 1; }

banner "APK BUILD · target=$TARGET"
field "version"    "$APK_VERSION"
field "label"      "$BUILD_LABEL"
field "variants"   "${VARIANTS[*]}"
field "api base"   "$API_BASE"
field "vite mode"  "$VITE_MODE"
field "commit"     "$GIT_SHA$([[ "$GIT_DIRTY" == true ]] && printf ' (dirty)')"
field "JAVA_HOME"  "${JAVA_HOME:-<system default>}"
field "install"    "$DO_INSTALL"

if [[ "$TARGET" == "prod" && "$GIT_DIRTY" == true ]]; then
    warn "building a PRODUCTION APK from a dirty tree — the label records it, but"
    warn "a distributable build should come from a clean, tagged commit."
fi

# ── emulator readiness (only when installing) ──────────────────────────────
EMULATOR_ID=""
if [[ "$DO_INSTALL" == true ]]; then
    section "EMULATOR"
    EMULATOR_ID="$(adb devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
    if [[ -z "$EMULATOR_ID" ]]; then
        err "no running Android emulator detected."
        err "start one first, e.g.:"
        err "  emulator -avd \$(emulator -list-avds | head -1) -gpu host -no-snapshot-load"
        err "or pass --no-install to build without a device."
        exit 1
    fi
    ok "using $EMULATOR_ID"

    adb -s "$EMULATOR_ID" wait-for-device
    # Bounded: 120s. An emulator that never finishes booting must fail the build.
    boot=""
    for _ in $(seq 1 60); do
        boot="$(adb -s "$EMULATOR_ID" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
        [[ "$boot" == "1" ]] && break
        sleep 2
    done
    [[ "$boot" == "1" ]] || { err "emulator did not finish booting within 120s"; exit 1; }
    ok "emulator booted"
fi

# ── gradle version injection support probe ──────────────────────────────────
# We pass -PboeVersionName / -PboeVersionCode. Gradle only honours them if
# build.gradle reads them. Detect and report rather than silently shipping every
# APK as versionName "1.0".
GRADLE_HONOURS_VERSION=false
if grep -q 'boeVersionName' "$ANDROID_DIR/app/build.gradle" 2>/dev/null; then
    GRADLE_HONOURS_VERSION=true
fi

# versionCode must be a monotonically increasing integer. Derive it from semver.
IFS=. read -r _vmaj _vmin _vpat <<<"$BASE_VERSION"
VERSION_CODE=$(( _vmaj * 10000 + _vmin * 100 + _vpat ))

mkdir -p "$OUT_DIR"

# ── build one variant ───────────────────────────────────────────────────────
build_variant() {
    local variant="$1"
    local apk_name="boe.${TARGET}.${variant}.${BASE_VERSION}.apk"
    local out_apk="$OUT_DIR/$apk_name"

    section "BUILD · $variant" "$apk_name"

    # Vite reads these from the process environment; shell wins over .env files.
    export VITE_BEO_APP_TARGET="$variant"
    export VITE_BEO_API_MODE="http"
    export VITE_BEO_API_BASE_URL="$API_BASE"
    export VITE_BEO_ONBOARDING_URL="$ONBOARDING"

    step "vite build (mode=$VITE_MODE, target=$variant)"
    ( cd "$APP_DIR" && npx --no-install vite build --mode "$VITE_MODE" ) \
        || { err "vite build failed for $variant"; return 1; }

    # The client-only bundle guard exists to keep admin code out of the user
    # app. It is correct for client builds and wrong for admin builds.
    if [[ "$variant" == "client" && -f "$APP_DIR/scripts/check-android-dist.mjs" ]]; then
        step "verifying the client bundle contains no admin chunks"
        ( cd "$APP_DIR" && node scripts/check-android-dist.mjs ) \
            || { err "client bundle guard failed"; return 1; }
        ok "bundle guard passed"
    fi

    step "capacitor sync"
    ( cd "$APP_DIR" && npx --no-install cap sync android ) \
        || { err "cap sync failed"; return 1; }

    # Remove the previous output so a failed build cannot be mistaken for a
    # fresh one — this is the freshness guarantee, in place of a build id.
    rm -f "$GRADLE_APK_DEBUG" "$GRADLE_APK_RELEASE"

    step "gradle assembleDebug"
    ( cd "$ANDROID_DIR" && ./gradlew assembleDebug --console=plain \
        -PboeVersionName="$BUILD_LABEL" -PboeVersionCode="$VERSION_CODE" ) \
        || { err "gradle build failed"; return 1; }

    [[ -f "$GRADLE_APK_DEBUG" ]] || { err "APK not produced: $GRADLE_APK_DEBUG"; return 1; }

    cp "$GRADLE_APK_DEBUG" "$out_apk"

    local sha size
    sha="$(sha256sum "$out_apk" | cut -d' ' -f1)"
    size="$(stat -c %s "$out_apk")"

    # Sidecar manifest, mirroring the image manifest contract (now with sha256).
    jq -n \
        --arg apk "$apk_name" \
        --arg target "$TARGET" \
        --arg variant "$variant" \
        --arg version "$BASE_VERSION" \
        --arg buildLabel "$BUILD_LABEL" \
        --arg apiBaseUrl "$API_BASE" \
        --arg onboardingUrl "$ONBOARDING" \
        --arg applicationId "$PACKAGE_NAME" \
        --arg versionName "$([[ "$GRADLE_HONOURS_VERSION" == true ]] && echo "$BUILD_LABEL" || echo "1.0")" \
        --argjson versionCode "$([[ "$GRADLE_HONOURS_VERSION" == true ]] && echo "$VERSION_CODE" || echo 1)" \
        --arg gitCommit "$GIT_SHA" \
        --argjson gitDirty "$GIT_DIRTY" \
        --arg builtAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg signing "debug" \
        --arg sha256 "$sha" \
        --argjson sizeBytes "$size" \
        '{apk: $apk, target: $target, variant: $variant, version: $version,
          buildLabel: $buildLabel, apiBaseUrl: $apiBaseUrl, onboardingUrl: $onboardingUrl,
          applicationId: $applicationId, versionName: $versionName, versionCode: $versionCode,
          gitCommit: $gitCommit, gitDirty: $gitDirty, builtAt: $builtAt,
          signing: $signing, sha256: $sha256, sizeBytes: $sizeBytes}' \
        > "${out_apk%.apk}.json"

    ok "$apk_name  ($(numfmt --to=iec "$size"))"
    field "sha256" "${sha:0:32}…"

    if [[ "$DO_INSTALL" == true ]]; then
        step "installing on $EMULATOR_ID"
        # Install the artifact we actually published, not the build-tree copy.
        adb -s "$EMULATOR_ID" install -r "$out_apk" >/dev/null \
            || { warn "install failed for $variant"; return 0; }
        adb -s "$EMULATOR_ID" shell monkey -p "$PACKAGE_NAME" 1 >/dev/null 2>&1 || true
        ok "installed and launched"
    fi
}

FAILED=()
for v in "${VARIANTS[@]}"; do
    build_variant "$v" || FAILED+=("$v")
done

# ── retention ───────────────────────────────────────────────────────────────
mapfile -t apks < <(find "$OUT_DIR" -maxdepth 1 -name 'boe.*.apk' -printf '%T@ %p\n' 2>/dev/null | sort -n | cut -d' ' -f2-)
if (( ${#apks[@]} > KEEP_OUT )); then
    for f in "${apks[@]:0:$(( ${#apks[@]} - KEEP_OUT ))}"; do
        rm -f "$f" "${f%.apk}.json"
    done
fi

# ── summary and the honest caveats ─────────────────────────────────────────
banner "APK BUILD COMPLETE"
field "out" "${OUT_DIR#"$PROJECT_ROOT"/}"
for v in "${VARIANTS[@]}"; do
    f="$OUT_DIR/boe.${TARGET}.${v}.${BASE_VERSION}.apk"
    [[ -f "$f" ]] && field "$v" "$(basename "$f")"
done

if (( ${#FAILED[@]} > 0 )); then
    err "failed variants: ${FAILED[*]}"
fi

printf '\n'
warn "This APK is DEBUG-SIGNED. android/app/build.gradle declares no release"
warn "signingConfig, so --prod cannot yet produce a Play-Store-ready artifact."
warn "Fine for sideloading and internal testing."

if [[ "$GRADLE_HONOURS_VERSION" != true ]]; then
    warn ""
    warn "Gradle ignored the injected version: build.gradle still hardcodes"
    warn "versionCode 1 / versionName \"1.0\", so Android will report 1.0 for every"
    warn "build. The real version is recorded in the sidecar JSON only."
    warn "To fix, in android/app/build.gradle defaultConfig:"
    warn "    versionCode  project.hasProperty('boeVersionCode') ? boeVersionCode.toInteger() : 1"
    warn "    versionName  project.hasProperty('boeVersionName') ? boeVersionName : \"1.0\""
fi

warn ""
warn "applicationId is '$PACKAGE_NAME' for every target, so dev and prod APKs"
warn "CANNOT be installed side by side. The deployment plan §16.1 requires that"
warn "they can; that needs Gradle product flavors with an applicationIdSuffix."

(( ${#FAILED[@]} == 0 )) || exit 1
printf '\n'
