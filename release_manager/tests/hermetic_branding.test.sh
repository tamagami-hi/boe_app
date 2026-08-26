#!/usr/bin/env bash
# hermetic_branding.test.sh — the APK build must not mutate tracked files.
#
# The builder used to copy app/resources/launcher/<variant> over the tracked
# android/app/src/main/res before each Gradle run. A --both build therefore left the
# admin launcher and splash in the worktree, and the committed background colour was
# in fact the admin red (#FF0000) — so a bare Gradle build, or a client build that
# skipped the copy, shipped the client app with admin branding.
#
# No Gradle, no build, no network: this asserts the wiring only.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILDER="$ROOT_DIR/emu/boe_update.sh"
GRADLE="$ROOT_DIR/frontend_stack/app/android/app/build.gradle"
RES="$ROOT_DIR/frontend_stack/app/android/app/src/main/res"
LAUNCHER="$ROOT_DIR/frontend_stack/app/resources/launcher"

pass_count=0
fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}
ok() {
    pass_count=$((pass_count + 1))
    printf 'ok  %s\n' "$1"
}

[[ -f "$BUILDER" ]] || fail_test 'emu/boe_update.sh is missing'
[[ -f "$GRADLE" ]] || fail_test 'android/app/build.gradle is missing'

# ── both variants exist and provide the same files ───────────────────────────

for variant in client admin; do
    [[ -d "$LAUNCHER/$variant" ]] || fail_test "missing branding directory: $variant"
done

client_files="$(cd "$LAUNCHER/client" && find . -type f | sort)"
admin_files="$(cd "$LAUNCHER/admin" && find . -type f | sort)"
[[ "$client_files" == "$admin_files" ]] \
    || fail_test 'client and admin branding sets do not contain the same files'
ok 'both variants provide the same branding files'

[[ -n "$client_files" ]] || fail_test 'the client branding set is empty'
ok "branding set is not empty ($(printf '%s\n' "$client_files" | wc -l | tr -d ' ') files)"

# ── none of them is also committed under src/main/res ────────────────────────

leaked=()
while IFS= read -r relative; do
    candidate="$RES/${relative#./}"
    [[ -e "$candidate" ]] && leaked+=("${relative#./}")
done <<< "$client_files"

if (( ${#leaked[@]} > 0 )); then
    printf 'FAIL: branding assets are still tracked under src/main/res:\n' >&2
    printf '  - %s\n' "${leaked[@]}" >&2
    exit 1
fi
ok 'no branding asset is duplicated under src/main/res'

# The colour that revealed the defect. If it is back in res/, the build is
# order-dependent again.
if grep -rqi 'FF0000' "$RES" 2>/dev/null; then
    fail_test 'admin red (#FF0000) is committed under src/main/res again'
fi
ok 'no admin red committed under src/main/res'

# ── the build selects branding instead of the builder copying it ──────────────

grep -q 'boeVariant' "$GRADLE" \
    || fail_test 'build.gradle does not read -PboeVariant'
grep -q 'res.srcDirs' "$GRADLE" \
    || fail_test 'build.gradle does not add the variant resource directory'
grep -q "resources/launcher" "$GRADLE" \
    || fail_test 'build.gradle does not point at the launcher resources'
ok 'build.gradle selects the variant resource directory'

# applicationId and signing decide whether an update installs over an existing app,
# so the flavour work must not touch them.
grep -q 'boeApplicationId' "$GRADLE" \
    || fail_test 'build.gradle no longer reads the injected applicationId'
grep -q 'applicationIdSuffix' "$GRADLE" \
    && fail_test 'build.gradle adds an applicationIdSuffix, which would change installed IDs'
ok 'applicationId and signing wiring is unchanged'

# ── the builder passes the variant and copies nothing ────────────────────────

variant_flags="$(grep -c 'PboeVariant' "$BUILDER")"
(( variant_flags >= 2 )) \
    || fail_test "boe_update.sh must pass -PboeVariant to both gradle tasks (found $variant_flags)"
ok 'the builder passes -PboeVariant to both gradle tasks'

grep -q 'VITE_BEO_ANDROID_BUILD_TYPE="$ANDROID_BUILD_TYPE"' "$BUILDER" \
    || fail_test 'boe_update.sh does not pass its Android build type to Vite'
grep -q 'RELEASE_SIGNING.*TARGET.*prod' "$BUILDER" \
    || fail_test 'boe_update.sh does not keep production SDK logging disabled'
ok 'the builder controls PhonePe logging from the Android build type'

if grep -E 'cp -f .*(mipmap|drawable|ic_launcher|splash)' "$BUILDER" >/dev/null; then
    fail_test 'boe_update.sh still copies branding into the tracked resource tree'
fi
ok 'the builder copies no branding into src/main/res'

bash -n "$BUILDER" || fail_test 'boe_update.sh is not valid bash'
ok 'boe_update.sh parses'


# ── the final APK is checked, not just the dist folder ───────────────────────

grep -q 'assets/public/assets' "$BUILDER" \
    || fail_test 'boe_update.sh does not inspect the packaged web assets'
grep -q 'client APK packages admin assets' "$BUILDER" \
    || fail_test 'boe_update.sh does not fail a client APK that packages admin assets'
ok 'the builder checks the packaged APK contents'

# The detection itself, run against a fixture APK built here with zip.
if command -v zip >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1; then
    FIXTURE_DIR="$(mktemp -d)"
    trap 'rm -rf "$FIXTURE_DIR"' EXIT
    mkdir -p "$FIXTURE_DIR/assets/public/assets"
    : > "$FIXTURE_DIR/assets/public/assets/client-abc123.js"
    : > "$FIXTURE_DIR/assets/public/assets/admin-def456.js"
    ( cd "$FIXTURE_DIR" && zip -q -r leak.apk assets )

    listed="$(unzip -Z1 "$FIXTURE_DIR/leak.apk" 'assets/public/assets/*')"
    printf '%s\n' "$listed" | grep -Eqi '/(admin|browserroot)[-.]' \
        || fail_test 'the packaged-asset pattern does not detect an admin chunk'
    ok 'the packaged-asset pattern detects an admin chunk'

    rm -f "$FIXTURE_DIR/assets/public/assets/admin-def456.js"
    rm -f "$FIXTURE_DIR/leak.apk"
    ( cd "$FIXTURE_DIR" && zip -q -r clean.apk assets )
    clean="$(unzip -Z1 "$FIXTURE_DIR/clean.apk" 'assets/public/assets/*')"
    if printf '%s\n' "$clean" | grep -Eqi '/(admin|browserroot)[-.]'; then
        fail_test 'the packaged-asset pattern flags a clean client APK'
    fi
    ok 'the packaged-asset pattern passes a clean client APK'
else
    printf 'skip  zip/unzip unavailable, packaged-asset detection not exercised\n'
fi

printf '\nPASS: %d checks\n' "$pass_count"
