#!/usr/bin/env bash
# apk_ship.test.sh — contract tests for release_manager/lib/apk_ship.sh and the
# APK wiring in export.sh / deploy.sh / status.sh.
#
# All network operations are stubbed: boe_ssh executes the remote command
# locally (the fixture paths.json points at a fake VPS tree under TEST_DIR) and
# rsync is emulated with cp. No real SSH, rsync, build, or deployment happens.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK_SHIP_LIB="$ROOT_DIR/release_manager/lib/apk_ship.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[[ -f "$APK_SHIP_LIB" ]] || fail_test 'APK shipping library is missing'

# shellcheck source=../lib/stacks.sh
source "$ROOT_DIR/release_manager/lib/stacks.sh"
# shellcheck source=../lib/ui.sh
source "$ROOT_DIR/release_manager/lib/ui.sh"
# shellcheck source=../lib/apk_ship.sh
source "$APK_SHIP_LIB"

for helper in apk_contract_destination apk_manifest_artifact \
              apk_validate_local_artifact apk_contract_lock_file \
              apk_retire_remote_variant apk_contract_keep_releases \
              apk_publish_remote_atomic apk_ship_variant apk_ship_release; do
    declare -F "$helper" >/dev/null \
        || fail_test "missing APK helper: $helper"
done

# ── fixtures and stubs ────────────────────────────────────────────────────────

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
APK_DIR="$TEST_DIR/apks"
REMOTE_ROOT="$TEST_DIR/vps"
CALL_LOG="$TEST_DIR/calls.log"
mkdir -p "$APK_DIR" "$REMOTE_ROOT"
: > "$CALL_LOG"

BOE_TEST_CORRUPT_UPLOAD=false
# false|'': no corruption; true: corrupt every upload; anything else: a glob
# matched against the remote destination path (e.g. '*.json.upload').

# Fake SSH: log the command, then run it locally. The fixture paths.json uses
# local absolute paths, so remote scripts (heredocs on stdin) execute as-is.
boe_ssh() {
    printf 'ssh %s\n' "$*" >> "$CALL_LOG"
    bash -c "$*"
}

# Fake rsync: log the transfer, then copy the local file(s) to the destination.
rsync() {
    {
        printf 'rsync'
        printf ' %s' "$@"
        printf '\n'
    } >> "$CALL_LOG"
    local dest="${*: -1}"
    dest="${dest#"${BOE_SSH_ALIAS}":}"
    local src
    for src in "$@"; do
        [[ -f "$src" ]] || continue
        cp -p -- "$src" "$dest" || return 1
        case "$BOE_TEST_CORRUPT_UPLOAD" in
            false|'') ;;
            true) printf 'corruption' >> "$dest" ;;
            *) [[ "$dest" == $BOE_TEST_CORRUPT_UPLOAD ]] && printf 'corruption' >> "$dest" ;;
        esac
    done
}

# make_artifact <outdir> <target> <variant> <version> [jq-sidecar-filter]
make_artifact() {
    local outdir="$1" target="$2" variant="$3" version="$4"
    shift 4 || true
    local apk="$outdir/boe.$target.$variant.$version.apk" sha sidecar
    printf 'APK-BYTES %s %s %s\n' "$target" "$variant" "$version" > "$apk"
    sha="$(sha256sum "$apk" | cut -d' ' -f1)"
    sidecar="${apk%.apk}.json"
    jq -n \
        --arg apk "boe.$target.$variant.$version.apk" \
        --arg target "$target" --arg variant "$variant" --arg version "$version" \
        --arg sha "$sha" \
        '{apk: $apk, target: $target, variant: $variant, version: $version,
          buildLabel: $version,
          gitCommit: "0123456789abcdef0123456789abcdef01234567",
          gitDirty: false, builtAt: "2026-08-03T00:00:00Z", signing: "debug",
          sha256: $sha, sizeBytes: 32}' > "$sidecar"
    if (( $# > 0 )); then
        local tmp; tmp="$(mktemp)"
        jq "$*" "$sidecar" > "$tmp" && mv "$tmp" "$sidecar"
    fi
}

artifact_sha() { sha256sum "$1" | cut -d' ' -f1; }

DEV_PATHS="$TEST_DIR/dev-paths.json"
PROD_PATHS="$TEST_DIR/prod-paths.json"
DEV_STACK_DIR="$REMOTE_ROOT/stack/dev_release"
PROD_STACK_DIR="$REMOTE_ROOT/stack/prod_release"
DEV_BACKUP_ROOT="$REMOTE_ROOT/backup"
PROD_BACKUP_ROOT="$REMOTE_ROOT/backup"
DEV_ROLLBACK_ROOT="$DEV_BACKUP_ROOT/DEV_ROLLBACK"
PROD_ROLLBACK_ROOT="$PROD_BACKUP_ROOT/PROD_ROLLBACK"
DEV_LOCK="$REMOTE_ROOT/locks/dev.lock"
PROD_LOCK="$REMOTE_ROOT/locks/prod.lock"
mkdir -p "$REMOTE_ROOT/locks"

jq -n --arg sd "$DEV_STACK_DIR" --arg br "$DEV_BACKUP_ROOT" --arg rr "$DEV_ROLLBACK_ROOT" \
    --arg lock "$DEV_LOCK" '{
    schema: 3, stack: "dev_release", short: "dev",
    retention: { keep_releases: 4 },
    vps: { stack_dir: $sd, lock_file: $lock },
    backup: { root: $br, rollback_root: $rr },
    apk: { enabled: true, destinations: [
        { variant: "client", current_dir: ($sd + "/dev_apk"),
          rollback_dir: ($rr + "/DEV_APK/client") },
        { variant: "admin", current_dir: ($sd + "/dev_admin_apk"),
          rollback_dir: ($rr + "/DEV_APK/admin") }
    ] }
}' > "$DEV_PATHS"

jq -n --arg sd "$PROD_STACK_DIR" --arg br "$PROD_BACKUP_ROOT" --arg rr "$PROD_ROLLBACK_ROOT" \
    --arg lock "$PROD_LOCK" '{
    schema: 3, stack: "prod_release", short: "prod",
    retention: { keep_releases: 3 },
    vps: { stack_dir: $sd, lock_file: $lock },
    backup: { root: $br, rollback_root: $rr },
    apk: { enabled: true, destinations: [
        { variant: "client", current_dir: ($sd + "/prod_apk"),
          rollback_dir: ($rr + "/APK/client") },
        { variant: "admin", current_dir: ($sd + "/admin_apk"),
          rollback_dir: ($rr + "/APK/admin") }
    ] }
}' > "$PROD_PATHS"

# ── case 1: all four routes use their explicit current + rollback destinations ─

dest="$(apk_contract_destination "$DEV_PATHS" dev client)" \
    || fail_test 'dev client destination was not resolved'
[[ "$dest" == "$DEV_STACK_DIR/dev_apk"$'\t'"$DEV_ROLLBACK_ROOT/DEV_APK/client" ]] \
    || fail_test "dev client routes wrong: $dest"
dest="$(apk_contract_destination "$DEV_PATHS" dev admin)" \
    || fail_test 'dev admin destination was not resolved'
[[ "$dest" == "$DEV_STACK_DIR/dev_admin_apk"$'\t'"$DEV_ROLLBACK_ROOT/DEV_APK/admin" ]] \
    || fail_test "dev admin routes wrong: $dest"
dest="$(apk_contract_destination "$PROD_PATHS" prod client)" \
    || fail_test 'prod client destination was not resolved'
[[ "$dest" == "$PROD_STACK_DIR/prod_apk"$'\t'"$PROD_ROLLBACK_ROOT/APK/client" ]] \
    || fail_test "prod client routes wrong: $dest"
dest="$(apk_contract_destination "$PROD_PATHS" prod admin)" \
    || fail_test 'prod admin destination was not resolved'
[[ "$dest" == "$PROD_STACK_DIR/admin_apk"$'\t'"$PROD_ROLLBACK_ROOT/APK/admin" ]] \
    || fail_test "prod admin routes wrong: $dest"

# ── case 2: routing follows the declared variant, never array position ───────

SWAPPED_PATHS="$TEST_DIR/swapped-paths.json"
jq '.apk.destinations |= reverse' "$DEV_PATHS" > "$SWAPPED_PATHS"
dest="$(apk_contract_destination "$SWAPPED_PATHS" dev client)" \
    || fail_test 'a reordered destinations array broke client resolution'
[[ "$dest" == "$DEV_STACK_DIR/dev_apk"$'\t'"$DEV_ROLLBACK_ROOT/DEV_APK/client" ]] \
    || fail_test 'array position influenced variant routing'

# ── case 2b: routing never infers the variant from a directory basename ──────

RENAMED_PATHS="$TEST_DIR/renamed-paths.json"
jq --arg sd "$DEV_STACK_DIR" \
    '.apk.destinations[0].current_dir = ($sd + "/holder_one")
     | .apk.destinations[1].current_dir = ($sd + "/holder_two")' \
    "$DEV_PATHS" > "$RENAMED_PATHS"
dest="$(apk_contract_destination "$RENAMED_PATHS" dev client)" \
    || fail_test 'a renamed current dir broke client resolution'
[[ "${dest%%$'\t'*}" == "$DEV_STACK_DIR/holder_one" ]] \
    || fail_test 'the client variant was routed by directory basename'

# ── case 3: missing client/admin or duplicate holders fail ───────────────────

ONE_DIR_PATHS="$TEST_DIR/one-dir-paths.json"
jq '.apk.destinations = [.apk.destinations[0]]' "$DEV_PATHS" > "$ONE_DIR_PATHS"
if apk_contract_destination "$ONE_DIR_PATHS" dev client >/dev/null 2>&1; then
    fail_test 'a contract missing the admin destination was accepted'
fi
DUP_PATHS="$TEST_DIR/dup-paths.json"
jq '.apk.destinations = [.apk.destinations[0], .apk.destinations[0]]' "$DEV_PATHS" > "$DUP_PATHS"
if apk_contract_destination "$DUP_PATHS" dev client >/dev/null 2>&1; then
    fail_test 'duplicate APK variants were accepted'
fi
OVERLAP_PATHS="$TEST_DIR/overlap-paths.json"
jq '.apk.destinations[1].current_dir = .apk.destinations[0].current_dir' \
    "$DEV_PATHS" > "$OVERLAP_PATHS"
if apk_contract_destination "$OVERLAP_PATHS" dev client >/dev/null 2>&1; then
    fail_test 'overlapping APK current dirs were accepted'
fi

# ── case 4: wrong stack, schema, target, containment, traversal, unsafe paths ─

BAD_SCHEMA="$TEST_DIR/bad-schema.json"
jq '.schema = 2' "$DEV_PATHS" > "$BAD_SCHEMA"
if apk_contract_destination "$BAD_SCHEMA" dev client >/dev/null 2>&1; then
    fail_test 'a non schema-3 contract was accepted'
fi
BAD_ENABLED="$TEST_DIR/bad-enabled.json"
jq '.apk.enabled = false' "$DEV_PATHS" > "$BAD_ENABLED"
if apk_contract_destination "$BAD_ENABLED" dev client >/dev/null 2>&1; then
    fail_test 'a contract with apk.enabled false was accepted for routing'
fi
BAD_SHORT="$TEST_DIR/bad-short.json"
jq '.short = "prod"' "$DEV_PATHS" > "$BAD_SHORT"
if apk_contract_destination "$BAD_SHORT" dev client >/dev/null 2>&1; then
    fail_test 'a stack/target mismatch was accepted'
fi
BAD_CONTAIN="$TEST_DIR/bad-contain.json"
jq --arg outside "$REMOTE_ROOT/elsewhere/dev_apk" \
    '.apk.destinations[0].current_dir = $outside' "$DEV_PATHS" > "$BAD_CONTAIN"
if apk_contract_destination "$BAD_CONTAIN" dev client >/dev/null 2>&1; then
    fail_test 'an APK holder escaping the stack directory was accepted'
fi
BAD_RB_ESCAPE="$TEST_DIR/bad-rb-escape.json"
jq --arg outside "$REMOTE_ROOT/elsewhere/client" \
    '.apk.destinations[0].rollback_dir = $outside' "$DEV_PATHS" > "$BAD_RB_ESCAPE"
if apk_contract_destination "$BAD_RB_ESCAPE" dev client >/dev/null 2>&1; then
    fail_test 'an APK rollback dir escaping the rollback root was accepted'
fi
BAD_TRAVERSAL="$TEST_DIR/bad-traversal.json"
jq --arg t "$DEV_STACK_DIR/../dev_release/dev_apk" \
    '.apk.destinations[0].current_dir = $t' "$DEV_PATHS" > "$BAD_TRAVERSAL"
if apk_contract_destination "$BAD_TRAVERSAL" dev client >/dev/null 2>&1; then
    fail_test 'a path with traversal was accepted'
fi
BAD_SHALLOW="$TEST_DIR/bad-shallow.json"
jq '.backup.root = "/rb" | .backup.rollback_root = "/rb"' "$DEV_PATHS" > "$BAD_SHALLOW"
if apk_contract_destination "$BAD_SHALLOW" dev client >/dev/null 2>&1; then
    fail_test 'a shallow/unsafe rollback path was accepted'
fi
if apk_contract_destination "$DEV_PATHS" ms client >/dev/null 2>&1; then
    fail_test 'an invalid APK target was accepted'
fi
if apk_contract_destination "$DEV_PATHS" dev tester >/dev/null 2>&1; then
    fail_test 'an unknown APK variant was accepted'
fi

# ── build the standard artifacts: exact 0.6.5 plus retained 0.6.4 and 0.6.6 ──

make_artifact "$APK_DIR" dev client 0.6.5
make_artifact "$APK_DIR" dev admin 0.6.5
make_artifact "$APK_DIR" dev client 0.6.4
make_artifact "$APK_DIR" dev client 0.6.6

# Pre-seed the current holders with a previously published build. Publication
# always writes an APK and its sidecar as a pair, so the fixture seeds both —
# retirement moves the pair, and the archive's checksum manifest must cover it.
mkdir -p "$DEV_STACK_DIR/dev_apk" "$DEV_STACK_DIR/dev_admin_apk"
printf 'old client\n' > "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.4.apk"
printf '{"version":"0.6.4"}\n' > "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.4.json"
printf 'old admin\n'  > "$DEV_STACK_DIR/dev_admin_apk/boe.dev.admin.0.6.4.apk"
printf '{"version":"0.6.4"}\n' > "$DEV_STACK_DIR/dev_admin_apk/boe.dev.admin.0.6.4.json"

# ── case 5: exact version is required; retained artifacts are ignored ────────

if apk_ship_release "$DEV_PATHS" "$APK_DIR" dev >/dev/null 2>&1; then
    fail_test 'shipping without an exact version was accepted'
fi

apk_ship_release "$DEV_PATHS" "$APK_DIR" dev 0.6.5 true >/dev/null \
    || fail_test 'APK release could not be shipped through paths.json'

if grep -qF '0.6.6' "$CALL_LOG"; then
    fail_test 'a retained newer APK was shipped instead of the exact version'
fi
if grep '^rsync' "$CALL_LOG" | grep -qF '0.6.4'; then
    fail_test 'a retained older APK was shipped instead of the exact version'
fi
[[ -f "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk" ]] \
    || fail_test 'client APK was not routed to its dedicated directory'
[[ -f "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.json" ]] \
    || fail_test 'client APK sidecar was not shipped'
[[ -f "$DEV_STACK_DIR/dev_admin_apk/boe.dev.admin.0.6.5.apk" ]] \
    || fail_test 'admin APK was not routed to its dedicated directory'
[[ ! -e "$DEV_STACK_DIR/dev_apk/boe.dev.admin.0.6.5.apk" ]] \
    || fail_test 'admin APK leaked into the client directory'
[[ "$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk")" \
   == "$(artifact_sha "$APK_DIR/boe.dev.client.0.6.5.apk")" ]] \
    || fail_test 'the published client APK digest differs from the validated artifact'

# ── case 10: retirement happens AFTER publish, into variant-specific rollbacks ─

# Retirement moves artifacts out of the holder, so it must not run until the new
# APK is verifiably in place — otherwise a failed publish leaves an empty holder,
# which the in-app update feed reads as "no update available". The previous
# behaviour archived first (by copying), which both left every old version in the
# holder forever and made each snapshot copy the whole holder.
last_transfer_line="$(grep -n '^rsync' "$CALL_LOG" | tail -1 | cut -d: -f1)"
transfer_line="$(grep -n '^rsync' "$CALL_LOG" | head -1 | cut -d: -f1)"
client_retire_line="$(grep -n 'DEV_APK/client' "$CALL_LOG" | tail -1 | cut -d: -f1)"
admin_retire_line="$(grep -n 'DEV_APK/admin' "$CALL_LOG" | tail -1 | cut -d: -f1)"
[[ -n "$last_transfer_line" && -n "$client_retire_line" \
   && "$client_retire_line" -gt "$last_transfer_line" ]] \
    || fail_test 'client retirement did not run after the new artifacts were transferred'
[[ -n "$admin_retire_line" && "$admin_retire_line" -gt "$last_transfer_line" ]] \
    || fail_test 'admin retirement did not run after the new artifacts were transferred'

# The superseded version moved out; the freshly published one stayed.
[[ ! -e "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.4.apk" ]] \
    || fail_test 'the superseded client APK was left in the holder'
[[ -f "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk" ]] \
    || fail_test 'the freshly published client APK was retired by mistake'
[[ ! -e "$DEV_STACK_DIR/dev_admin_apk/boe.dev.admin.0.6.4.apk" ]] \
    || fail_test 'the superseded admin APK was left in the holder'
[[ -f "$DEV_STACK_DIR/dev_admin_apk/boe.dev.admin.0.6.5.apk" ]] \
    || fail_test 'the freshly published admin APK was retired by mistake'

# History is per-version, mirroring DEPLOY_IMAGES/<version>/ for the images.
[[ -f "$DEV_ROLLBACK_ROOT/DEV_APK/client/0.6.4/boe.dev.client.0.6.4.apk" ]] \
    || fail_test 'previous client APK was not archived to the client rollback dir'
[[ -f "$DEV_ROLLBACK_ROOT/DEV_APK/admin/0.6.4/boe.dev.admin.0.6.4.apk" ]] \
    || fail_test 'previous admin APK was not archived to the admin rollback dir'
if find "$DEV_ROLLBACK_ROOT/DEV_APK/client" -name '*admin*' | grep -q .; then
    fail_test 'an admin APK was archived into the client rollback dir'
fi
find "$DEV_ROLLBACK_ROOT/DEV_APK/client" \
    -name 'checksums.sha256' | grep -q . \
    || fail_test 'the APK archive has no checksum manifest'

# ── atomic publication: temp upload, remote digest check, rename into place ──

grep -qF '.boe.dev.client.0.6.5.apk.upload' "$CALL_LOG" \
    || fail_test 'the APK was not uploaded under a temporary filename first'
if find "$REMOTE_ROOT" -name '*.upload' -print -quit | grep -q .; then
    fail_test 'temporary upload files were left behind after publication'
fi
verify_line="$(grep -n "$(artifact_sha "$APK_DIR/boe.dev.client.0.6.5.apk")" "$CALL_LOG" \
    | head -1 | cut -d: -f1)"
[[ -n "$verify_line" && "$verify_line" -gt "$transfer_line" ]] \
    || fail_test 'the remote digest was not verified against the validated value'

# ── case R1: archive retention honours retention.keep_releases ───────────────
#
# The old archive never pruned, and because each snapshot copied the whole
# (ever-growing) holder, archive size grew quadratically with release count —
# 310 MB across 16 snapshots on the dev stack. keep_releases is the declared
# answer in paths.json, so retirement enforces it.

RET_HOLDER="$REMOTE_ROOT/ret_holder"
RET_ARCHIVE="$REMOTE_ROOT/ret_archive"
mkdir -p "$RET_HOLDER" "$RET_ARCHIVE"

# Five already-archived versions, oldest first by mtime.
for v in 0.1.0 0.2.0 0.3.0 0.4.0 0.5.0; do
    mkdir -p "$RET_ARCHIVE/$v"
    printf 'old\n' > "$RET_ARCHIVE/$v/boe.dev.client.$v.apk"
    touch -d "2026-01-0${v:2:1} 00:00:00" "$RET_ARCHIVE/$v"
done
# A live release plus one it supersedes.
printf 'superseded\n' > "$RET_HOLDER/boe.dev.client.0.6.0.apk"
printf '{}\n'         > "$RET_HOLDER/boe.dev.client.0.6.0.json"
printf 'live\n'       > "$RET_HOLDER/boe.dev.client.0.7.0.apk"
printf '{}\n'         > "$RET_HOLDER/boe.dev.client.0.7.0.json"

apk_retire_remote_variant "$RET_HOLDER" "$RET_ARCHIVE" "$DEV_LOCK" 3 0.7.0 >/dev/null \
    || fail_test 'retirement failed on a holder with a superseded version'

# The live release stays; the superseded one is gone from the holder.
[[ -f "$RET_HOLDER/boe.dev.client.0.7.0.apk" ]] \
    || fail_test 'retention removed the live release from the holder'
[[ ! -e "$RET_HOLDER/boe.dev.client.0.6.0.apk" ]] \
    || fail_test 'retention left a superseded APK in the holder'
[[ ! -e "$RET_HOLDER/boe.dev.client.0.6.0.json" ]] \
    || fail_test 'retention left a superseded sidecar in the holder'

# Archive trimmed to keep=3, keeping the newest — including the one just added.
ret_kept="$(find "$RET_ARCHIVE" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tr '\n' ' ')"
[[ "$(find "$RET_ARCHIVE" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 3 ]] \
    || fail_test "archive was not trimmed to keep_releases=3, holds: $ret_kept"
[[ -d "$RET_ARCHIVE/0.6.0" ]] \
    || fail_test "the newly retired version was pruned, holds: $ret_kept"
[[ ! -d "$RET_ARCHIVE/0.1.0" && ! -d "$RET_ARCHIVE/0.2.0" ]] \
    || fail_test "the oldest archives were not pruned, holds: $ret_kept"

# keep_releases comes from the contract, not a constant. The dev fixture declares
# 4 precisely so this cannot pass via the built-in fallback of 3.
[[ "$(apk_contract_keep_releases "$DEV_PATHS")" == 4 ]] \
    || fail_test 'the retention count is not read from paths.json'
NO_RETENTION="$TEST_DIR/no-retention.json"
jq 'del(.retention)' "$DEV_PATHS" > "$NO_RETENTION"
[[ "$(apk_contract_keep_releases "$NO_RETENTION")" == 3 ]] \
    || fail_test 'a contract without retention did not fall back to a bounded default'

# Retirement refuses to run without knowing which version is live, so it can
# never empty the holder by moving the release it was meant to preserve.
if apk_retire_remote_variant "$RET_HOLDER" "$RET_ARCHIVE" "$DEV_LOCK" 3 '' >/dev/null 2>&1; then
    fail_test 'retirement ran without a live version to preserve'
fi

# ── case 15: custom fixture paths prove there is no raw /srv fallback ────────
# The entire happy path above ran against $TEST_DIR paths only. The library
# itself must not contain a hardcoded operational path.
if grep -q '/srv/' "$APK_SHIP_LIB"; then
    fail_test 'apk_ship.sh contains a raw /srv fallback path'
fi

# ── case 9: digest mismatch fails before live replacement is reported ────────

before_sha="$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk")"
BOE_TEST_CORRUPT_UPLOAD=true
if apk_ship_release "$DEV_PATHS" "$APK_DIR" dev 0.6.5 false >/dev/null 2>&1; then
    BOE_TEST_CORRUPT_UPLOAD=false
    fail_test 'a corrupted upload was published successfully'
fi
BOE_TEST_CORRUPT_UPLOAD=false
[[ "$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk")" == "$before_sha" ]] \
    || fail_test 'a failed publication replaced the previous current APK'
rm -f "$DEV_STACK_DIR/dev_apk"/.*.upload "$DEV_STACK_DIR/dev_admin_apk"/.*.upload 2>/dev/null || true

# ── case M1: a corrupt sidecar upload after a good APK upload leaves no split
# state — the APK is never renamed, both temps are removed, live pair intact ──

before_apk_sha="$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk")"
before_sc_sha="$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.json")"
BOE_TEST_CORRUPT_UPLOAD='*.json.upload'
if apk_publish_remote_atomic \
        "$APK_DIR/boe.dev.client.0.6.5.apk" "$APK_DIR/boe.dev.client.0.6.5.json" \
        "$DEV_STACK_DIR/dev_apk" \
        "$(artifact_sha "$APK_DIR/boe.dev.client.0.6.5.apk")" "$DEV_LOCK" >/dev/null 2>&1; then
    BOE_TEST_CORRUPT_UPLOAD=false
    fail_test 'a corrupted sidecar upload was published successfully'
fi
BOE_TEST_CORRUPT_UPLOAD=false
if find "$DEV_STACK_DIR/dev_apk" -name '*.upload' -print -quit | grep -q .; then
    fail_test 'temporary upload files were left behind after a failed pair publish'
fi
[[ "$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk")" == "$before_apk_sha" ]] \
    || fail_test 'the APK was replaced even though its sidecar failed verification'
[[ "$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.json")" == "$before_sc_sha" ]] \
    || fail_test 'the live sidecar was touched by a failed pair publish'

# ── case M3: a mid-release publish failure retires nothing and leaves both
# holders exactly as they were ────────────────────────────────────────────────
#
# Retirement moves artifacts, so it runs only after BOTH variants are published.
# A failed publish must therefore leave the archive untouched and both holders
# still serving their previous release. The earlier copy-based archive ran before
# publishing, so a failure left a snapshot behind and the holder unchanged; the
# guarantee that matters — the holder keeps working — is now stronger, because
# nothing is moved until the new artifacts are verifiably in place.

admin_archives_before="$(find "$DEV_ROLLBACK_ROOT/DEV_APK/admin" -mindepth 1 -maxdepth 1 -type d | wc -l)"
admin_sha_before="$(artifact_sha "$DEV_STACK_DIR/dev_admin_apk/boe.dev.admin.0.6.5.apk")"
client_apk_sha_before="$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk")"
client_archives_before="$(find "$DEV_ROLLBACK_ROOT/DEV_APK/client" -mindepth 1 -maxdepth 1 -type d | wc -l)"
BOE_TEST_CORRUPT_UPLOAD=true
if apk_ship_release "$DEV_PATHS" "$APK_DIR" dev 0.6.5 true >/dev/null 2>&1; then
    BOE_TEST_CORRUPT_UPLOAD=false
    fail_test 'a corrupted upload was published successfully'
fi
BOE_TEST_CORRUPT_UPLOAD=false
admin_archives_after="$(find "$DEV_ROLLBACK_ROOT/DEV_APK/admin" -mindepth 1 -maxdepth 1 -type d | wc -l)"
client_archives_after="$(find "$DEV_ROLLBACK_ROOT/DEV_APK/client" -mindepth 1 -maxdepth 1 -type d | wc -l)"
[[ "$admin_archives_after" -eq "$admin_archives_before" ]] \
    || fail_test 'a failed release retired admin artifacts anyway'
[[ "$client_archives_after" -eq "$client_archives_before" ]] \
    || fail_test 'a failed release retired client artifacts anyway'
[[ "$(artifact_sha "$DEV_STACK_DIR/dev_admin_apk/boe.dev.admin.0.6.5.apk")" == "$admin_sha_before" ]] \
    || fail_test 'the admin holder was modified although only the client publish ran'
[[ "$(artifact_sha "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk")" == "$client_apk_sha_before" ]] \
    || fail_test 'the client holder was modified by a failed publish'
if find "$DEV_STACK_DIR/dev_apk" "$DEV_STACK_DIR/dev_admin_apk" -name '*.upload' -print -quit | grep -q .; then
    fail_test 'temporary upload files were left behind after the failed release ship'
fi
# The archive written by the successful ship earlier covers sidecars as well as
# APKs, so a restored version is verifiable as a pair.
archived_client="$DEV_ROLLBACK_ROOT/DEV_APK/client/0.6.4"
grep -q '\.apk' "$archived_client/checksums.sha256" \
    || fail_test 'the APK archive checksum manifest does not cover the APKs'
grep -q '\.json' "$archived_client/checksums.sha256" \
    || fail_test 'the APK archive checksum manifest does not cover the sidecars'

# ── case 8: remote symlink directories and files fail closed ─────────────────

GOOD_SHA="$(artifact_sha "$APK_DIR/boe.dev.client.0.6.5.apk")"
ln -s "$DEV_STACK_DIR/dev_apk" "$REMOTE_ROOT/evil_holder"
if apk_publish_remote_atomic \
        "$APK_DIR/boe.dev.client.0.6.5.apk" "$APK_DIR/boe.dev.client.0.6.5.json" \
        "$REMOTE_ROOT/evil_holder" "$GOOD_SHA" "$DEV_LOCK" >/dev/null 2>&1; then
    fail_test 'a symlinked remote APK directory was accepted'
fi
mv "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk" "$DEV_STACK_DIR/dev_apk/real.apk"
ln -s /etc/hostname "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk"
if apk_publish_remote_atomic \
        "$APK_DIR/boe.dev.client.0.6.5.apk" "$APK_DIR/boe.dev.client.0.6.5.json" \
        "$DEV_STACK_DIR/dev_apk" "$GOOD_SHA" "$DEV_LOCK" >/dev/null 2>&1; then
    fail_test 'a symlinked remote destination file was replaced'
fi
rm -f "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk" \
      "$DEV_STACK_DIR/dev_apk"/.*.upload
mv "$DEV_STACK_DIR/dev_apk/real.apk" "$DEV_STACK_DIR/dev_apk/boe.dev.client.0.6.5.apk"

# ── case 7: bad sidecars and local symlinks fail validation ──────────────────

V_APK="$APK_DIR/boe.dev.client.0.6.5.apk"
apk_validate_local_artifact "$V_APK" dev client 0.6.5 >/dev/null \
    || fail_test 'a valid artifact was rejected'
if apk_validate_local_artifact "$V_APK" prod client 0.6.5 >/dev/null 2>&1; then
    fail_test 'a wrong-target sidecar was accepted'
fi
if apk_validate_local_artifact "$V_APK" dev admin 0.6.5 >/dev/null 2>&1; then
    fail_test 'a wrong-variant sidecar was accepted'
fi
if apk_validate_local_artifact "$V_APK" dev client 0.6.6 >/dev/null 2>&1; then
    fail_test 'a wrong-version sidecar was accepted'
fi
if apk_validate_local_artifact "$V_APK" dev client 0.6.5 \
        ffffffffffffffffffffffffffffffffffffffff >/dev/null 2>&1; then
    fail_test 'a wrong-commit sidecar was accepted'
fi

# the sidecar commit is JSON input: it must be a plain hex SHA, never a pattern
make_artifact "$APK_DIR" dev client 8.0.5 '.gitCommit = "0123*"'
if apk_validate_local_artifact "$APK_DIR/boe.dev.client.8.0.5.apk" dev client 8.0.5 \
        0123456789abcdef0123456789abcdef01234567 >/dev/null 2>&1; then
    fail_test 'a sidecar commit containing glob characters was accepted'
fi
make_artifact "$APK_DIR" dev client 8.0.6 '.gitCommit = "zzzzzzzz"'
if apk_validate_local_artifact "$APK_DIR/boe.dev.client.8.0.6.apk" dev client 8.0.6 \
        0123456789abcdef0123456789abcdef01234567 >/dev/null 2>&1; then
    fail_test 'a non-hex sidecar commit was accepted'
fi
# a valid short (7-hex) prefix still matches the gated commit
make_artifact "$APK_DIR" dev client 8.0.7 '.gitCommit = "0123456"'
apk_validate_local_artifact "$APK_DIR/boe.dev.client.8.0.7.apk" dev client 8.0.7 \
    0123456789abcdef0123456789abcdef01234567 >/dev/null \
    || fail_test 'a valid short sidecar commit prefix was rejected'

make_artifact "$APK_DIR" dev client 8.0.1
rm "$APK_DIR/boe.dev.client.8.0.1.json"
if apk_validate_local_artifact "$APK_DIR/boe.dev.client.8.0.1.apk" dev client 8.0.1 >/dev/null 2>&1; then
    fail_test 'a missing sidecar was accepted'
fi
make_artifact "$APK_DIR" dev client 8.0.2
printf 'not json\n' > "$APK_DIR/boe.dev.client.8.0.2.json"
if apk_validate_local_artifact "$APK_DIR/boe.dev.client.8.0.2.apk" dev client 8.0.2 >/dev/null 2>&1; then
    fail_test 'a malformed sidecar was accepted'
fi
make_artifact "$APK_DIR" dev client 8.0.3 '.gitDirty = true'
if apk_validate_local_artifact "$APK_DIR/boe.dev.client.8.0.3.apk" dev client 8.0.3 \
        0123456789abcdef0123456789abcdef01234567 prod >/dev/null 2>&1; then
    fail_test 'a dirty sidecar was accepted for production'
fi
make_artifact "$APK_DIR" dev client 8.0.4 'del(.sha256)'
if apk_validate_local_artifact "$APK_DIR/boe.dev.client.8.0.4.apk" dev client 8.0.4 >/dev/null 2>&1; then
    fail_test 'a sidecar without a digest was accepted'
fi
# local symlink APK and sidecar
ln -s "$V_APK" "$APK_DIR/boe.dev.client.9.9.9.apk"
cp "$APK_DIR/boe.dev.client.0.6.5.json" "$APK_DIR/boe.dev.client.9.9.9.json"
if apk_ship_release "$DEV_PATHS" "$APK_DIR" dev 9.9.9 false >/dev/null 2>&1; then
    fail_test 'a symlink APK artifact was accepted'
fi
rm -f "$APK_DIR/boe.dev.client.9.9.9.apk" "$APK_DIR/boe.dev.client.9.9.9.json"
cp "$V_APK" "$APK_DIR/boe.dev.client.9.9.8.apk"
ln -s "$APK_DIR/boe.dev.client.0.6.5.json" "$APK_DIR/boe.dev.client.9.9.8.json"
if apk_ship_release "$DEV_PATHS" "$APK_DIR" dev 9.9.8 false >/dev/null 2>&1; then
    fail_test 'a symlink sidecar was accepted'
fi
rm -f "$APK_DIR/boe.dev.client.9.9.8.apk" "$APK_DIR/boe.dev.client.9.9.8.json"

# ── case 14: production debug/unsigned APK publishing is blocked ─────────────

make_artifact "$APK_DIR" prod client 0.6.5
make_artifact "$APK_DIR" prod admin 0.6.5
prod_err="$(apk_ship_release "$PROD_PATHS" "$APK_DIR" prod 0.6.5 false \
    0123456789abcdef0123456789abcdef01234567 prod 2>&1 >/dev/null)" \
    && fail_test 'a debug-signed APK was published to production'
grep -qi 'debug' <<< "$prod_err" \
    || fail_test 'the production signing rejection has no clear diagnostic'
# a properly release-signed artifact passes the signing gate itself
make_artifact "$APK_DIR" prod client 8.1.0 '.signing = "release"'
apk_validate_local_artifact "$APK_DIR/boe.prod.client.8.1.0.apk" prod client 8.1.0 \
    0123456789abcdef0123456789abcdef01234567 prod >/dev/null \
    || fail_test 'a release-signed production artifact was rejected'

# ── case 6: bundle manifest filename and digest must match the staged file ───

BUNDLE_FIX="$TEST_DIR/bundle"
mkdir -p "$BUNDLE_FIX/apk"
make_artifact "$BUNDLE_FIX/apk" dev client 0.6.5
make_artifact "$BUNDLE_FIX/apk" dev admin 0.6.5
write_manifest() { # <outfile> <client-sha> <client-file>
    jq -n --arg cs "$2" --arg cf "$3" \
        --arg as "$(artifact_sha "$BUNDLE_FIX/apk/boe.dev.admin.0.6.5.apk")" '{
        version: "0.6.5", kind: "dev", stack: "dev_release",
        apk: {
            client: {variant: "client", file: $cf, sha256: $cs,
                     target: "dev", version: "0.6.5",
                     git_sha: "0123456789abcdef0123456789abcdef01234567"},
            admin:  {variant: "admin", file: "boe.dev.admin.0.6.5.apk", sha256: $as,
                     target: "dev", version: "0.6.5",
                     git_sha: "0123456789abcdef0123456789abcdef01234567"}
        }}' > "$1"
}
write_manifest "$BUNDLE_FIX/manifest.json" \
    "$(artifact_sha "$BUNDLE_FIX/apk/boe.dev.client.0.6.5.apk")" \
    "boe.dev.client.0.6.5.apk"

: > "$CALL_LOG"
apk_ship_bundle "$DEV_PATHS" "$BUNDLE_FIX" dev true dev >/dev/null \
    || fail_test 'manifest-bound bundle APKs were not published'

apk_manifest_artifact "$BUNDLE_FIX/manifest.json" client >/dev/null \
    || fail_test 'the manifest client artifact could not be read'
if apk_manifest_artifact "$BUNDLE_FIX/manifest.json" tester >/dev/null 2>&1; then
    fail_test 'a missing manifest variant was accepted'
fi

write_manifest "$TEST_DIR/bad-sha-manifest.json" \
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" \
    "boe.dev.client.0.6.5.apk"
cp "$TEST_DIR/bad-sha-manifest.json" "$BUNDLE_FIX/manifest.json"
if apk_ship_bundle "$DEV_PATHS" "$BUNDLE_FIX" dev false dev >/dev/null 2>&1; then
    fail_test 'a manifest digest that does not match the staged file was accepted'
fi
write_manifest "$BUNDLE_FIX/manifest.json" \
    "$(artifact_sha "$BUNDLE_FIX/apk/boe.dev.client.0.6.5.apk")" \
    "boe.dev.client.0.6.6.apk"
if apk_ship_bundle "$DEV_PATHS" "$BUNDLE_FIX" dev false dev >/dev/null 2>&1; then
    fail_test 'a manifest filename that does not match the exact artifact was accepted'
fi

# ── case C1a: crafted manifest versions and filenames are rejected ───────────
# A tampered bundle manifest must never smuggle shell metacharacters into the
# version or filename: both flow toward a remotely-reparsed command string.

write_manifest "$BUNDLE_FIX/manifest.json" \
    "$(artifact_sha "$BUNDLE_FIX/apk/boe.dev.client.0.6.5.apk")" \
    "boe.dev.client.0.6.5.apk"

jq --arg v '0.6.5$(id)' '.apk.client.version = $v' \
    "$BUNDLE_FIX/manifest.json" > "$TEST_DIR/evil-ver-subshell.json"
if apk_manifest_artifact "$TEST_DIR/evil-ver-subshell.json" client >/dev/null 2>&1; then
    fail_test 'a manifest version embedding a command substitution was accepted'
fi
jq --arg v "0.6.5'; id; echo '" '.apk.client.version = $v' \
    "$BUNDLE_FIX/manifest.json" > "$TEST_DIR/evil-ver-quote.json"
if apk_manifest_artifact "$TEST_DIR/evil-ver-quote.json" client >/dev/null 2>&1; then
    fail_test 'a manifest version embedding a quote breakout was accepted'
fi
jq --arg f 'boe.dev.client.0.6.5.apk"; id; echo "' '.apk.client.file = $f' \
    "$BUNDLE_FIX/manifest.json" > "$TEST_DIR/evil-file-quote.json"
if apk_manifest_artifact "$TEST_DIR/evil-file-quote.json" client >/dev/null 2>&1; then
    fail_test 'a manifest filename embedding a quote breakout was accepted'
fi
jq --arg f 'not-boe.dev.client.0.6.5.apk' '.apk.client.file = $f' \
    "$BUNDLE_FIX/manifest.json" > "$TEST_DIR/evil-file-name.json"
if apk_manifest_artifact "$TEST_DIR/evil-file-name.json" client >/dev/null 2>&1; then
    fail_test 'a manifest filename outside the boe artifact naming was accepted'
fi
# a dev-label version within the strict charset remains valid
jq --arg f 'boe.dev.client.0.6.6-dev.3.gabc1234.apk' --arg v '0.6.6-dev.3.gabc1234' \
    '.apk.client.file = $f | .apk.client.version = $v' \
    "$BUNDLE_FIX/manifest.json" > "$TEST_DIR/devlabel-manifest.json"
apk_manifest_artifact "$TEST_DIR/devlabel-manifest.json" client >/dev/null \
    || fail_test 'a manifest entry with a dev-label version was rejected'
# the shipper itself also refuses the tampered manifest
cp "$TEST_DIR/evil-file-quote.json" "$BUNDLE_FIX/manifest.json"
if apk_ship_bundle "$DEV_PATHS" "$BUNDLE_FIX" dev false dev >/dev/null 2>&1; then
    fail_test 'a crafted manifest filename was shipped'
fi
write_manifest "$BUNDLE_FIX/manifest.json" \
    "$(artifact_sha "$BUNDLE_FIX/apk/boe.dev.client.0.6.5.apk")" \
    "boe.dev.client.0.6.5.apk"

# ── case C1b: remotely-reparsed commands are built with printf %q ────────────

grep -q "printf -v remote_cmd 'bash -s -- %q" "$APK_SHIP_LIB" \
    || fail_test 'remote archive/publish commands are not built with printf %q'
if grep -q "boe_ssh \"bash -s -- '" "$APK_SHIP_LIB"; then
    fail_test 'a remotely-reparsed command still splices raw single-quoted values'
fi
# Functional proof: an artifact filename containing a quote breakout must pass
# through the remote command as inert data — never as shell syntax.
(
    cd "$TEST_DIR" || exit 20
    evil_name="boe.dev.client.9.9.7.apk'; touch pwned; echo '"
    printf 'evil apk\n' > "$evil_name"
    printf 'evil sidecar\n' > 'boe.dev.client.9.9.7.json'
    apk_publish_remote_atomic "$TEST_DIR/$evil_name" "$TEST_DIR/boe.dev.client.9.9.7.json" \
        "$DEV_STACK_DIR/dev_apk" "$(artifact_sha "$TEST_DIR/$evil_name")" "$DEV_LOCK" \
        >/dev/null 2>&1 || exit 23
    [[ ! -e "$TEST_DIR/pwned" ]] || exit 21
    [[ -f "$DEV_STACK_DIR/dev_apk/$evil_name" ]] || exit 22
) || fail_test 'a crafted artifact filename broke out of the remote command quoting'
rm -f "$DEV_STACK_DIR/dev_apk/boe.dev.client.9.9.7.apk'; touch pwned; echo '" \
      "$DEV_STACK_DIR/dev_apk/boe.dev.client.9.9.7.json"

# ── case L1: archive and publish run under the stack's remote lock ───────────

grep -q 'flock -n 9' "$APK_SHIP_LIB" \
    || fail_test 'remote archive/publish do not take the stack lock'
NO_LOCK_PATHS="$TEST_DIR/no-lock-paths.json"
jq 'del(.vps.lock_file)' "$DEV_PATHS" > "$NO_LOCK_PATHS"
if apk_ship_release "$NO_LOCK_PATHS" "$APK_DIR" dev 0.6.5 false >/dev/null 2>&1; then
    fail_test 'a contract without a remote lock file was accepted for shipping'
fi
( exec 9>"$DEV_LOCK"; flock -n 9; sleep 5 ) &
lock_holder=$!
sleep 0.5
if apk_publish_remote_atomic \
        "$APK_DIR/boe.dev.client.0.6.5.apk" "$APK_DIR/boe.dev.client.0.6.5.json" \
        "$DEV_STACK_DIR/dev_apk" \
        "$(artifact_sha "$APK_DIR/boe.dev.client.0.6.5.apk")" "$DEV_LOCK" >/dev/null 2>&1; then
    kill "$lock_holder" 2>/dev/null
    fail_test 'a publish proceeded while the stack lock was held'
fi
if apk_retire_remote_variant "$DEV_STACK_DIR/dev_apk" \
        "$DEV_ROLLBACK_ROOT/DEV_APK/client" "$DEV_LOCK" 3 >/dev/null 2>&1; then
    kill "$lock_holder" 2>/dev/null
    fail_test 'a retirement proceeded while the stack lock was held'
fi
kill "$lock_holder" 2>/dev/null
wait "$lock_holder" 2>/dev/null || true
rm -f "$DEV_STACK_DIR/dev_apk"/.*.upload 2>/dev/null || true
# once the lock is free again, publishing works
apk_publish_remote_atomic \
    "$APK_DIR/boe.dev.client.0.6.5.apk" "$APK_DIR/boe.dev.client.0.6.5.json" \
    "$DEV_STACK_DIR/dev_apk" \
    "$(artifact_sha "$APK_DIR/boe.dev.client.0.6.5.apk")" "$DEV_LOCK" >/dev/null \
    || fail_test 'a publish failed although the stack lock was free'

# ── deploy.sh structure: ordering, failure guard, safe --ship-only ───────────

deploy_script="$ROOT_DIR/release_manager/deploy.sh"

grep -qF 'apk_ship_bundle "$BUNDLE/paths.json" "$BUNDLE"' "$deploy_script" \
    || fail_test 'full deploy does not publish the manifest-bound APK artifacts'

remote_deploy_line="$(grep -n 'REMOTE DEPLOY' "$deploy_script" | head -1 | cut -d: -f1)"
apk_publish_line="$(grep -n 'apk_ship_bundle' "$deploy_script" | tail -1 | cut -d: -f1)"
[[ -n "$remote_deploy_line" && -n "$apk_publish_line" \
   && "$apk_publish_line" -gt "$remote_deploy_line" ]] \
    || fail_test 'full deploy publishes APKs before the VPS archives the previous release'

# case 12: a failed remote deployment publishes no APK
deploy_block="$(sed -n "${remote_deploy_line},${apk_publish_line}p" "$deploy_script")"
grep -q 'REMOTE_RC == 0' <<< "$deploy_block" \
    || fail_test 'APK publication is not guarded on a successful remote deploy'

# case 13: --ship-only uploads but performs no live APK publish
ship_only_block="$(sed -n '/if \[\[ "\$SHIP_ONLY" == true \]\]/,/^fi$/p' "$deploy_script")"
[[ -n "$ship_only_block" ]] || fail_test 'deploy.sh has no --ship-only branch'
if grep -qE 'apk_ship_(release|bundle|variant)' <<< "$ship_only_block"; then
    fail_test '--ship-only publishes APKs into the live directories'
fi

# ── status.sh structure: the APK-only flow gates production before building ──

status_script="$ROOT_DIR/release_manager/status.sh"
grep -qF 'apk_ship_release "$RM_DIR/stacks/$stack/paths.json" "$ROOT_DIR/emu/out" "$target"' \
    "$status_script" || fail_test 'APK-only flow does not ship through the paths.json contract'
action_apk_block="$(sed -n '/^action_apk()/,/^}/p' "$status_script")"
grep -q ' true ' <<< "$(grep 'apk_ship_release' <<< "$action_apk_block")" \
    || fail_test 'APK-only flow does not request a pre-upload archive'
gate_line="$(grep -n 'prepare_release_git' <<< "$action_apk_block" | head -1 | cut -d: -f1)"
build_line="$(grep -n 'boe_update.sh' <<< "$action_apk_block" | head -1 | cut -d: -f1)"
[[ -n "$gate_line" && -n "$build_line" && "$gate_line" -lt "$build_line" ]] \
    || fail_test 'standalone production APK publishing has no pre-build release gate'
tag_line="$(grep -n 'on_exact_release_tag' <<< "$action_apk_block" | head -1 | cut -d: -f1)"
[[ -n "$tag_line" && "$tag_line" -lt "$build_line" ]] \
    || fail_test 'standalone production APK publishing does not require the exact release tag'

# ── deploy re-binds the bundle to the tracked path contract before upload ────

grep -qF 'paths_validate "$STACK" "$BUNDLE/paths.json"' "$deploy_script" \
    || fail_test 'deploy does not re-validate the bundle path contract against the stack'
grep -qF 'TRACKED_PATHS_SHA' "$deploy_script" \
    || fail_test 'deploy does not compare the bundle contract to the tracked contract'

DEPLOY_BUNDLE="$TEST_DIR/deploy-bundle"
mkdir -p "$DEPLOY_BUNDLE"
TRACKED_DEV_PATHS="$ROOT_DIR/release_manager/stacks/dev_release/paths.json"
jq -n '{version: "9.9.9", kind: "dev", git_sha: "unknown", images: {}}' \
    > "$DEPLOY_BUNDLE/manifest.json"
for f in "$(stack_attr dev_release compose)" "$(stack_attr dev_release deploy)" \
         "$(stack_attr dev_release rollback)" _boe_lib.sh _boe_deploy.sh _boe_rollback.sh; do
    : > "$DEPLOY_BUNDLE/$f"
done

# a stale contract (the tracked paths.json changed after export) is rejected
jq '. + {edited_after_export: true}' "$TRACKED_DEV_PATHS" > "$DEPLOY_BUNDLE/paths.json"
# a failing ssh stub on PATH for every real deploy.sh invocation, so a guard
# regression fails offline instead of reaching the VPS
mkdir -p "$TEST_DIR/bin"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TEST_DIR/bin/ssh"
chmod +x "$TEST_DIR/bin/ssh"
stale_out="$(PATH="$TEST_DIR/bin:$PATH" \
    bash "$ROOT_DIR/release_manager/deploy.sh" --dev --bundle "$DEPLOY_BUNDLE" 2>&1)" \
    && fail_test 'a bundle whose paths.json drifted from the tracked contract was deployed'
grep -q 're-export' <<< "$stale_out" \
    || fail_test 'the stale-contract rejection does not tell the operator to re-export'

# an exact copy of the tracked contract passes the binding (and only fails
# later, at the stubbed SSH stage — the failing stub above is still on PATH)
cp "$TRACKED_DEV_PATHS" "$DEPLOY_BUNDLE/paths.json"
fresh_out="$(PATH="$TEST_DIR/bin:$PATH" \
    bash "$ROOT_DIR/release_manager/deploy.sh" --dev --bundle "$DEPLOY_BUNDLE" 2>&1 || true)"
grep -q 'bundle path contract matches' <<< "$fresh_out" \
    || fail_test 'an exact tracked contract did not pass the deploy binding'
grep -q 'cannot reach' <<< "$fresh_out" \
    || fail_test 'deploy did not proceed to the SSH stage with a matching contract'

# ── a bundle image without a recorded digest aborts the deploy ───────────────

DIGEST_BUNDLE="$TEST_DIR/digest-bundle"
mkdir -p "$DIGEST_BUNDLE/images"
printf 'image-bytes\n' > "$DIGEST_BUNDLE/images/backend.tar.gz"
jq -n '{
    version: "9.9.9", kind: "dev", git_sha: "unknown",
    images: {backend: {tag: "boe-dev-backend:9.9.9",
                       archive: "images/backend.tar.gz", sha256: ""}}
}' > "$DIGEST_BUNDLE/manifest.json"
for f in "$(stack_attr dev_release compose)" "$(stack_attr dev_release deploy)" \
         "$(stack_attr dev_release rollback)" _boe_lib.sh _boe_deploy.sh _boe_rollback.sh; do
    : > "$DIGEST_BUNDLE/$f"
done
cp "$TRACKED_DEV_PATHS" "$DIGEST_BUNDLE/paths.json"
digest_out="$(bash "$ROOT_DIR/release_manager/deploy.sh" --dev --bundle "$DIGEST_BUNDLE" 2>&1)" \
    && fail_test 'a bundle image without a recorded digest did not abort the deploy'
grep -q 'no checksum recorded' <<< "$digest_out" \
    || fail_test 'the missing-digest abort has no clear diagnostic'
# a corrupt manifest whose image table cannot be parsed aborts too
jq -n '{version: "9.9.9", kind: "dev", git_sha: "unknown", images: ["not-an-object"]}' \
    > "$DIGEST_BUNDLE/manifest.json"
digest_out="$(bash "$ROOT_DIR/release_manager/deploy.sh" --dev --bundle "$DIGEST_BUNDLE" 2>&1)" \
    && fail_test 'a bundle with an unparseable image table did not abort the deploy'

# ── a failed --with-apk build aborts the export (no APK-less bundle) ─────────

export_script="$ROOT_DIR/release_manager/export.sh"
grep -qF 'err "--with-apk was requested but the APK build failed"' "$export_script" \
    || fail_test 'a failed --with-apk build does not abort the export'
if grep -qF 'bundle staged without APKs' "$export_script"; then
    fail_test 'a failed --with-apk build can still stage an APK-less bundle'
fi

# ── case H1: export checksums cover every staged file and cannot be skipped ──

grep -qF "find . -type f ! -name 'checksums.sha256'" "$export_script" \
    || fail_test 'export.sh does not generate a full-tree checksum manifest'
if grep 'checksums.sha256' "$export_script" | grep -q '|| true'; then
    fail_test 'export.sh can still ignore a failed checksum generation'
fi
# Run the real generation pipeline out of export.sh against a synthetic bundle.
ck_cmd="$(sed -n '/( cd "\$BUNDLE" && find/,/checksums\.sha256 )$/p' "$export_script")"
[[ -n "$ck_cmd" ]] || fail_test 'could not extract the export checksum pipeline'
CK_DIR="$TEST_DIR/ckbundle"
mkdir -p "$CK_DIR/apk" "$CK_DIR/images" "$CK_DIR/config/prometheus"
printf 'compose\n'   > "$CK_DIR/dev_compose.yml"
printf '{}\n'        > "$CK_DIR/paths.json"
printf '{}\n'        > "$CK_DIR/manifest.json"
printf 'lib\n'       > "$CK_DIR/_boe_lib.sh"
printf 'deploy\n'    > "$CK_DIR/dev_deploy.sh"
printf 'env\n'       > "$CK_DIR/.env.example"
printf 'guide\n'     > "$CK_DIR/DEPLOYING.md"
printf 'apk\n'       > "$CK_DIR/apk/boe.dev.client.1.2.3.apk"
printf 'sidecar\n'   > "$CK_DIR/apk/boe.dev.client.1.2.3.json"
printf 'img\n'       > "$CK_DIR/images/backend.tar.gz"
printf 'prom\n'      > "$CK_DIR/config/prometheus/prometheus.yml"
( BUNDLE="$CK_DIR"; eval "$ck_cmd" ) \
    || fail_test 'the export checksum pipeline failed on a valid bundle'
for f in dev_compose.yml paths.json manifest.json _boe_lib.sh dev_deploy.sh \
         .env.example DEPLOYING.md apk/boe.dev.client.1.2.3.apk \
         apk/boe.dev.client.1.2.3.json images/backend.tar.gz \
         config/prometheus/prometheus.yml; do
    grep -qF "./$f" "$CK_DIR/checksums.sha256" \
        || fail_test "export checksums do not cover staged file: $f"
done
( cd "$CK_DIR" && sha256sum -c --quiet checksums.sha256 ) \
    || fail_test 'a freshly generated checksum manifest does not verify'
printf 'tampered\n' >> "$CK_DIR/_boe_lib.sh"
if ( cd "$CK_DIR" && sha256sum -c --quiet checksums.sha256 ) >/dev/null 2>&1; then
    fail_test 'a tampered staged script passed the checksum verification'
fi

# ── case K1: export --keep rejects non-numeric and missing values ────────────

keep_out="$(bash "$export_script" --dev --keep '3; rm -rf /' 2>&1)" \
    && fail_test 'export accepted a --keep value with shell metacharacters'
grep -q -- '--keep requires a positive integer' <<< "$keep_out" \
    || fail_test 'the --keep rejection has no clear diagnostic'
keep_out="$(bash "$export_script" --dev --keep '2>/etc/passwd' 2>&1)" \
    && fail_test 'export accepted a --keep value with redirection syntax'
keep_out="$(bash "$export_script" --dev --keep 0 2>&1)" \
    && fail_test 'export accepted --keep 0'
keep_out="$(bash "$export_script" --dev --keep 2>&1)" \
    && fail_test 'export accepted a bare trailing --keep'
grep -q -- '--keep requires a positive integer' <<< "$keep_out" \
    || fail_test 'the bare --keep rejection has no clear diagnostic'

# ── the deploy-time remote archiver never dereferences symlinks ───────────────
# Runs the real boe_deploy_archive_apks from _boe_deploy.sh against a local
# fixture holder that contains one regular APK/sidecar and two symlinks.
(
    source "$ROOT_DIR/release_manager/stacks/_shared/_boe_lib.sh"
    source "$ROOT_DIR/release_manager/stacks/_shared/_boe_deploy.sh"
    M6_DIR="$(mktemp -d)"
    trap 'rm -rf "$M6_DIR"' EXIT
    holder="$M6_DIR/holder"
    rb="$M6_DIR/rollback/client"
    mkdir -p "$holder"
    printf 'real apk\n' > "$holder/real.apk"
    printf 'real sidecar\n' > "$holder/real.json"
    ln -s /etc/hostname "$holder/evil.apk"
    ln -s /etc/hostname "$holder/evil.json"
    BOE_PATHS_FILE="$M6_DIR/paths.json"
    jq -n --arg h "$holder" --arg r "$rb" \
        '{apk: {destinations: [{variant: "client", current_dir: $h, rollback_dir: $r}]}}' \
        > "$BOE_PATHS_FILE"
    boe_deploy_archive_apks "1.2.3" >/dev/null
    [[ -f "$rb/pre-deploy-1.2.3/real.apk" ]] || exit 11
    [[ -f "$rb/pre-deploy-1.2.3/real.json" ]] || exit 12
    [[ ! -e "$rb/pre-deploy-1.2.3/evil.apk" ]] || exit 13
    [[ ! -e "$rb/pre-deploy-1.2.3/evil.json" ]] || exit 14
    ! grep -q evil "$rb/pre-deploy-1.2.3/checksums.sha256" || exit 15
) || fail_test 'the deploy-time APK archiver kept or dereferenced a symlinked artifact'

printf 'PASS: APKs and sidecars ship to paths.json client/admin directories\n'
