#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RM_DIR="$ROOT_DIR/release_manager"
CAPACITOR_CONFIG="$ROOT_DIR/frontend_stack/app/capacitor.config.ts"
BUILDER="$ROOT_DIR/emu/boe_update.sh"
GRADLE_BUILD="$ROOT_DIR/frontend_stack/app/android/app/build.gradle"
LOGCAT="$ROOT_DIR/emu/boe_logcat.sh"
SHIP_LIB="$RM_DIR/lib/apk_ship.sh"
APK_MANIFEST_LIB="$RM_DIR/lib/apk_manifest.sh"

pass_count=0
fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}
ok() {
    pass_count=$((pass_count + 1))
    printf 'ok  %s\n' "$1"
}

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

[[ -f "$CAPACITOR_CONFIG" ]] || fail_test 'capacitor.config.ts is missing'
[[ -f "$BUILDER" ]] || fail_test 'emu/boe_update.sh is missing'
[[ -f "$GRADLE_BUILD" ]] || fail_test 'Android app build.gradle is missing'
[[ -x "$LOGCAT" ]] || fail_test 'emu/boe_logcat.sh is missing or not executable'
[[ -f "$APK_MANIFEST_LIB" ]] || fail_test 'release_manager/lib/apk_manifest.sh is missing'

grep -q "loggingBehavior: 'none'" "$CAPACITOR_CONFIG" \
    || fail_test 'capacitor.config.ts does not disable bridge logging'
ok 'capacitor.config.ts disables Capacitor bridge logging'

grep -qF '[[ "$TARGET" == "prod" ]] && ANDROID_BUILD_TYPE="release"' "$BUILDER" \
    || fail_test 'boe_update.sh does not limit release build type to the production target'
grep -qF -- '-PboeSignDebugWithRelease="$RELEASE_SIGNING"' "$BUILDER" \
    || fail_test 'boe_update.sh does not explicitly select release signing for debug updates'
grep -qF 'if [[ "$TARGET" != "local" && "$RELEASE_SIGNING" != true ]]; then' "$BUILDER" \
    || fail_test 'boe_update.sh permits a dev APK to change signing identity'
grep -q 'boeSignDebugWithRelease' "$GRADLE_BUILD" \
    || fail_test 'Gradle does not gate release signing of debug builds on the explicit script property'
ok 'dev APKs stay debuggable while explicitly preserving the installed signing identity'

grep -q 'application-debuggable' "$APK_MANIFEST_LIB" \
    || fail_test 'the APK manifest inspector does not detect the debuggable flag'
grep -q -- '--argjson debuggable' "$BUILDER" \
    || fail_test 'boe_update.sh does not record the measured debuggable flag in the sidecar'
grep -q -- '--arg buildType' "$BUILDER" \
    || fail_test 'boe_update.sh does not record the Android build type in the sidecar'
grep -qF 'if [[ "$ANDROID_BUILD_TYPE" == "release" && "$debuggable" != false ]]; then' "$BUILDER" \
    || fail_test 'boe_update.sh conflates release signing with a non-debuggable release build'
grep -q 'release APK is debuggable' "$BUILDER" \
    || fail_test 'boe_update.sh does not fail a debuggable release APK'
ok 'the builder measures and records the debuggable flag of the final APK'

grep -q '.debuggable == false' "$SHIP_LIB" \
    || fail_test 'apk_ship.sh does not require a non-debuggable production APK'
ok 'the production gate requires a proven non-debuggable APK'

apk="$TEST_DIR/boe.prod.client.9.9.9.apk"
printf 'APK-BYTES prod client 9.9.9\n' > "$apk"
sha="$(sha256sum "$apk" | cut -d' ' -f1)"
sidecar="${apk%.apk}.json"

write_sidecar() {
    jq -n --arg sha "$sha" '{
        apk: "boe.prod.client.9.9.9.apk", target: "prod", variant: "client",
        version: "9.9.9", buildLabel: "9.9.9",
        gitCommit: "0123456789abcdef0123456789abcdef01234567",
        gitDirty: false, builtAt: "2026-08-26T00:00:00Z",
        signing: "release", buildType: "release", debuggable: false,
        sha256: $sha, sizeBytes: 32}' > "$sidecar"
}

(
    source "$RM_DIR/lib/ui.sh"
    source "$SHIP_LIB"

    write_sidecar
    apk_validate_local_artifact "$apk" prod client 9.9.9 '' prod >/dev/null 2>&1 \
        || fail_test 'a proven non-debuggable release artifact was rejected'

    write_sidecar
    jq '.debuggable = true' "$sidecar" > "$sidecar.tmp" && mv "$sidecar.tmp" "$sidecar"
    if apk_validate_local_artifact "$apk" prod client 9.9.9 '' prod >/dev/null 2>&1; then
        fail_test 'a debuggable release artifact was accepted for production'
    fi

    write_sidecar
    jq 'del(.debuggable)' "$sidecar" > "$sidecar.tmp" && mv "$sidecar.tmp" "$sidecar"
    if apk_validate_local_artifact "$apk" prod client 9.9.9 '' prod >/dev/null 2>&1; then
        fail_test 'a release artifact without a debuggable measurement was accepted for production'
    fi

    write_sidecar
    jq 'del(.buildType)' "$sidecar" > "$sidecar.tmp" && mv "$sidecar.tmp" "$sidecar"
    if apk_validate_local_artifact "$apk" prod client 9.9.9 '' prod >/dev/null 2>&1; then
        fail_test 'a release artifact without an explicit build type was accepted for production'
    fi
) || exit 1
ok 'the production gate rejects debuggable or incompletely measured artifacts'

AAPT_STUB="$TEST_DIR/aapt"
cat > "$AAPT_STUB" <<'STUB'
#!/usr/bin/env bash
case "${BOE_TEST_AAPT_RESULT:-failure}" in
    debug) printf "package: name='com.beonedge.app'\napplication-debuggable\n" ;;
    release) printf "package: name='com.beonedge.app'\n" ;;
    empty) exit 0 ;;
    malformed) printf 'warning: manifest could not be parsed\n' ;;
    failure) exit 23 ;;
esac
STUB
chmod +x "$AAPT_STUB"
touch "$TEST_DIR/app.apk"
(
    source "$APK_MANIFEST_LIB"
    [[ "$(BOE_TEST_AAPT_RESULT=debug apk_manifest_debuggable "$AAPT_STUB" "$TEST_DIR/app.apk")" == true ]] \
        || fail_test 'a debuggable APK was not identified'
    [[ "$(BOE_TEST_AAPT_RESULT=release apk_manifest_debuggable "$AAPT_STUB" "$TEST_DIR/app.apk")" == false ]] \
        || fail_test 'a non-debuggable APK was not identified'
    if BOE_TEST_AAPT_RESULT=failure apk_manifest_debuggable "$AAPT_STUB" "$TEST_DIR/app.apk" >/dev/null; then
        fail_test 'a failed aapt inspection was reported as non-debuggable'
    fi
    if BOE_TEST_AAPT_RESULT=empty apk_manifest_debuggable "$AAPT_STUB" "$TEST_DIR/app.apk" >/dev/null; then
        fail_test 'an empty aapt inspection was reported as non-debuggable'
    fi
    if BOE_TEST_AAPT_RESULT=malformed apk_manifest_debuggable "$AAPT_STUB" "$TEST_DIR/app.apk" >/dev/null; then
        fail_test 'a malformed aapt inspection was reported as non-debuggable'
    fi
) || exit 1
ok 'APK debuggability inspection fails closed'

if "$LOGCAT" --dump Capacitor:V >/dev/null 2>&1; then
    fail_test 'boe_logcat.sh accepted the Capacitor:V tag'
fi
if "$LOGCAT" --dump 'Capacitor/Console:V' >/dev/null 2>&1; then
    fail_test 'boe_logcat.sh accepted the Capacitor/Console:V tag'
fi
if "$LOGCAT" --dump 'chromium:I' >/dev/null 2>&1; then
    fail_test 'boe_logcat.sh accepted a WebView tag'
fi
if "$LOGCAT" --dump 'WV_CONSOLE_PPE:E' >/dev/null 2>&1; then
    fail_test 'boe_logcat.sh accepted a disguised WebView console tag'
fi
if "$LOGCAT" --dump 'UnreviewedPaymentTag:I' >/dev/null 2>&1; then
    fail_test 'boe_logcat.sh accepted a tag outside its explicit allowlist'
fi
if "$LOGCAT" --dump '*:V' >/dev/null 2>&1; then
    fail_test 'boe_logcat.sh accepted a wildcard filter'
fi
ok 'boe_logcat.sh refuses bridge, WebView and wildcard tags'

STUB_BIN="$TEST_DIR/bin"
mkdir -p "$STUB_BIN"

cat > "$STUB_BIN/adb" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$BOE_TEST_ADB_ARGS_FILE"
printf 'I AndroidRuntime: redirect opened\n'
printf 'D OkHttp: {"accessToken":"secret-value-123","refreshToken":"secret-refresh-456"}\n'
printf 'I OkHttp: Authorization: Bearer abc.def.ghi\n'
printf 'D PaymentFlow: {"token":"secret-payment-token","paymentToken":"secret-payment-token-2"}\n'
printf 'I OkHttp: Authorization: Basic secret-basic-credential\n'
printf 'I OkHttp: X-VERIFY: secret-phonepe-verification\n'
printf 'I OkHttp: Cookie: session=secret-cookie\n'
printf 'D OkHttp: {"clientSecret":"secret-client-value","password":"secret-password"}\n'
STUB
chmod +x "$STUB_BIN/adb"

redacted_log="$TEST_DIR/capture.log"
adb_args_file="$TEST_DIR/adb-args"
if BOE_TEST_ADB_ARGS_FILE="$adb_args_file" PATH="$STUB_BIN:$PATH" \
    "$LOGCAT" --dump --out "$redacted_log" AndroidRuntime:V ActivityManager:D >/dev/null 2>&1; then
    fail_test 'a capture containing credentials exited zero'
fi
[[ -f "$redacted_log" ]] || fail_test 'no capture file was written'
grep -qxF '*:S' "$adb_args_file" \
    || fail_test 'adb logcat was not given a default-silent filter'
grep -q 'secret-value-123' "$redacted_log" \
    && fail_test 'an access token value survived redaction'
grep -q 'secret-refresh-456' "$redacted_log" \
    && fail_test 'a refresh token value survived redaction'
grep -q 'Bearer abc.def.ghi' "$redacted_log" \
    && fail_test 'a bearer token survived redaction'
grep -Eq 'secret-payment-token|secret-phonepe-verification|secret-basic-credential|secret-cookie|secret-client-value|secret-password' "$redacted_log" \
    && fail_test 'a payment, authorization, cookie, client secret, or password value survived redaction'
grep -q '\[REDACTED' "$redacted_log" \
    || fail_test 'the redactor never fired on credential-shaped content'
[[ "$(stat -c '%a' "$redacted_log")" == 600 ]] \
    || fail_test 'diagnostic capture permissions are not 600'
ok 'boe_logcat.sh redacts credential-shaped content and flags the capture'

symlink_target="$TEST_DIR/symlink-target.log"
symlink_output="$TEST_DIR/symlink-output.log"
printf 'must remain unchanged\n' > "$symlink_target"
ln -s "$symlink_target" "$symlink_output"
if BOE_TEST_ADB_ARGS_FILE="$adb_args_file" PATH="$STUB_BIN:$PATH" \
    "$LOGCAT" --dump --out "$symlink_output" AndroidRuntime:V >/dev/null 2>&1; then
    fail_test 'a symlink capture destination was accepted'
fi
grep -qxF 'must remain unchanged' "$symlink_target" \
    || fail_test 'a symlink capture destination was overwritten'
ok 'boe_logcat.sh rejects symlink capture destinations'

cat > "$STUB_BIN/adb" <<'STUB'
#!/usr/bin/env bash
printf 'I AndroidRuntime: redirect opened\n'
STUB

clean_log="$TEST_DIR/clean.log"
BOE_TEST_ADB_ARGS_FILE="$adb_args_file" PATH="$STUB_BIN:$PATH" \
    "$LOGCAT" --dump --out "$clean_log" AndroidRuntime:V >/dev/null 2>&1 \
    || fail_test 'a clean capture was rejected'
grep -q 'redirect opened' "$clean_log" \
    || fail_test 'the clean capture lost its content'
ok 'boe_logcat.sh passes clean allowlisted output through'

if BOE_TEST_ADB_ARGS_FILE="$adb_args_file" PATH="$STUB_BIN:$PATH" \
    "$LOGCAT" --dump --seconds 0 --out "$TEST_DIR/zero-seconds.log" AndroidRuntime:V >/dev/null 2>&1; then
    fail_test 'a zero-second diagnostic capture was accepted'
fi
if BOE_TEST_ADB_ARGS_FILE="$adb_args_file" PATH="$STUB_BIN:$PATH" \
    "$LOGCAT" --dump --seconds 301 --out "$TEST_DIR/long-capture.log" AndroidRuntime:V >/dev/null 2>&1; then
    fail_test 'an overlong diagnostic capture was accepted'
fi
if BOE_TEST_ADB_ARGS_FILE="$adb_args_file" PATH="$STUB_BIN:$PATH" \
    "$LOGCAT" --dump --seconds 999999999999999999999999999999999999999999999999999999 \
    --out "$TEST_DIR/overflow-capture.log" AndroidRuntime:V >/dev/null 2>&1; then
    fail_test 'an overflowing diagnostic capture duration was accepted'
fi
ok 'boe_logcat.sh requires a positive bounded capture duration'

bash -n "$BUILDER" || fail_test 'boe_update.sh is not valid bash'
bash -n "$LOGCAT" || fail_test 'boe_logcat.sh is not valid bash'
ok 'both emu scripts parse'

printf '\nPASS: %d checks\n' "$pass_count"
