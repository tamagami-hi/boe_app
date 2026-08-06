#!/usr/bin/env bash
# paths_contract.test.sh — contract tests for the schema-3 paths.json authority.
#
# Proves:
#   • the three tracked contracts validate, individually and across stacks
#   • every documented failure mode is rejected (fail closed)
#   • changing a contract's roots reroutes stubbed SSH/rsync operations with no
#     shell edit — the JSON is the only path authority
#   • no operational script carries a raw /srv/... path literal
#
# All network operations are stubbed. Nothing touches SSH, rsync, the VPS, or
# any real build.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RM_DIR="$ROOT_DIR/release_manager"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

# shellcheck source=../lib/ui.sh
source "$RM_DIR/lib/ui.sh"
# shellcheck source=../lib/stacks.sh
source "$RM_DIR/lib/stacks.sh"
# shellcheck source=../lib/paths.sh
source "$RM_DIR/lib/paths.sh"
# shellcheck source=../lib/apk_ship.sh
source "$RM_DIR/lib/apk_ship.sh"

for helper in stack_paths_file paths_validate paths_validate_cross_stack \
              paths_get paths_images paths_apk_destinations; do
    declare -F "$helper" >/dev/null || fail_test "missing paths helper: $helper"
done
if declare -F paths_write >/dev/null || declare -F paths_json >/dev/null; then
    fail_test 'path generation helpers still exist — the authority inversion is incomplete'
fi

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

# ── the three real contracts pass ─────────────────────────────────────────────

for s in "${BOE_STACKS[@]}"; do
    f="$(stack_paths_file "$s")"
    [[ -f "$f" ]] || fail_test "tracked contract missing for $s"
    paths_validate "$s" "$f" \
        || fail_test "the tracked $s contract failed validation"
done
paths_validate_cross_stack \
    || fail_test 'the tracked contracts failed cross-stack validation'

# The tracked contracts carry the exact handoff-mandated APK routing.
DEV_CONTRACT="$(stack_paths_file dev_release)"
PROD_CONTRACT="$(stack_paths_file prod_release)"
MS_CONTRACT="$(stack_paths_file monitor_service)"

dest="$(paths_apk_destinations "$DEV_CONTRACT" | awk -F'\t' '$1 == "client" {print $2 "\t" $3}')"
[[ "$dest" == "/srv/dev_stack/BOE_APP/dev_release/dev_apk"$'\t'"/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK/client" ]] \
    || fail_test "dev client APK routing drifted from the contract: $dest"
dest="$(paths_apk_destinations "$DEV_CONTRACT" | awk -F'\t' '$1 == "admin" {print $2 "\t" $3}')"
[[ "$dest" == "/srv/dev_stack/BOE_APP/dev_release/dev_admin_apk"$'\t'"/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK/admin" ]] \
    || fail_test "dev admin APK routing drifted from the contract: $dest"
dest="$(paths_apk_destinations "$PROD_CONTRACT" | awk -F'\t' '$1 == "client" {print $2 "\t" $3}')"
[[ "$dest" == "/srv/dev_stack/BOE_APP/prod_release/prod_apk"$'\t'"/srv/backup/BOE_APP/PROD_ROLLBACK/APK/client" ]] \
    || fail_test "prod client APK routing drifted from the contract: $dest"
dest="$(paths_apk_destinations "$PROD_CONTRACT" | awk -F'\t' '$1 == "admin" {print $2 "\t" $3}')"
[[ "$dest" == "/srv/dev_stack/BOE_APP/prod_release/admin_apk"$'\t'"/srv/backup/BOE_APP/PROD_ROLLBACK/APK/admin" ]] \
    || fail_test "prod admin APK routing drifted from the contract: $dest"
jq -e '.apk.enabled == false and (.apk.destinations | length == 0)
       and (.apk.reserved_current_dir | type == "string")' "$MS_CONTRACT" >/dev/null \
    || fail_test 'the monitoring contract does not honestly represent its missing APK'
jq -e 'has("generated_at") | not' "$DEV_CONTRACT" >/dev/null \
    || fail_test 'a contract still carries the generated_at marker'

# Typed readers work. Three application images: backend, user SPA, admin SPA.
# The marketing site is a separate AWS-hosted project and ships no image here.
[[ "$(paths_images "$DEV_CONTRACT" | wc -l)" == 3 ]] \
    || fail_test 'paths_images did not return the three application images'
[[ "$(paths_get "$DEV_CONTRACT" .vps.stack_dir)" == "/srv/dev_stack/BOE_APP/dev_release" ]] \
    || fail_test 'paths_get returned the wrong stack_dir'
if paths_get "$DEV_CONTRACT" .no.such.key >/dev/null 2>&1; then
    fail_test 'paths_get returned a value for a missing key'
fi

# ── failure modes are rejected ────────────────────────────────────────────────

expect_invalid() { # <label> <stack> <file>
    if paths_validate "$2" "$3" >/dev/null 2>&1; then
        fail_test "$1"
    fi
}

fixture() { # <outfile> <jq-filter> — derive a broken contract from the real dev one
    jq "$2" "$DEV_CONTRACT" > "$1"
}

EMPTY_F="$TEST_DIR/empty.json"; : > "$EMPTY_F"
expect_invalid 'an empty contract was accepted' dev_release "$EMPTY_F"
MALFORMED_F="$TEST_DIR/malformed.json"; printf 'not json\n' > "$MALFORMED_F"
expect_invalid 'a malformed contract was accepted' dev_release "$MALFORMED_F"
fixture "$TEST_DIR/schema2.json" '.schema = 2'
expect_invalid 'a schema-2 contract was accepted' dev_release "$TEST_DIR/schema2.json"
fixture "$TEST_DIR/missing-key.json" 'del(.vps.compose_file)'
expect_invalid 'a contract with a missing key was accepted' dev_release "$TEST_DIR/missing-key.json"
fixture "$TEST_DIR/traversal.json" '.vps.images_dir = "/srv/dev_stack/BOE_APP/../etc"'
expect_invalid 'a contract with traversal was accepted' dev_release "$TEST_DIR/traversal.json"
fixture "$TEST_DIR/unsafe-char.json" '.vps.images_dir = "/srv/dev_stack/BOE_APP/bad dir"'
expect_invalid 'a contract with an unsafe character was accepted' dev_release "$TEST_DIR/unsafe-char.json"
fixture "$TEST_DIR/unsafe-meta.json" '.vps.images_dir = "/srv/dev_stack/BOE_APP/$(id)"'
expect_invalid 'a contract with shell metacharacters was accepted' dev_release "$TEST_DIR/unsafe-meta.json"
fixture "$TEST_DIR/stack-containment.json" '.vps.images_dir = "/srv/other/images"'
expect_invalid 'a stack path escaping stack_dir was accepted' dev_release "$TEST_DIR/stack-containment.json"
fixture "$TEST_DIR/backup-containment.json" '.backup.deploy_log = "/srv/dev_stack/BOE_APP/logs"'
expect_invalid 'a backup path escaping backup.root was accepted' dev_release "$TEST_DIR/backup-containment.json"
fixture "$TEST_DIR/mount-containment.json" '.backup.root = "/elsewhere/BOE_APP"'
expect_invalid 'a backup root outside the mount tree was accepted' dev_release "$TEST_DIR/mount-containment.json"
fixture "$TEST_DIR/lock.json" '.vps.lock_file = "/tmp/boe-dev_release.lock"'
expect_invalid 'a lock file outside /run/lock was accepted' dev_release "$TEST_DIR/lock.json"
fixture "$TEST_DIR/dup-apk.json" '.apk.destinations[1].current_dir = .apk.destinations[0].current_dir'
expect_invalid 'duplicate APK directories were accepted' dev_release "$TEST_DIR/dup-apk.json"
fixture "$TEST_DIR/overlap-apk.json" '.apk.destinations[1].current_dir = (.apk.destinations[0].current_dir + "/sub")'
expect_invalid 'overlapping APK directories were accepted' dev_release "$TEST_DIR/overlap-apk.json"
expect_invalid 'a contract was accepted for the wrong stack' prod_release "$DEV_CONTRACT"
fixture "$TEST_DIR/db-mismatch.json" '.vps.database_dir = null'
expect_invalid 'a has_database/database_dir disagreement was accepted' dev_release "$TEST_DIR/db-mismatch.json"
fixture "$TEST_DIR/name-mismatch.json" '.vps.compose_file = "/srv/dev_stack/BOE_APP/dev_release/other.yml"'
expect_invalid 'a filename/absolute-path disagreement was accepted' dev_release "$TEST_DIR/name-mismatch.json"
jq '.apk.enabled = true' "$MS_CONTRACT" > "$TEST_DIR/monitor-apk.json"
expect_invalid 'monitoring was allowed to enable APKs' monitor_service "$TEST_DIR/monitor-apk.json"
fixture "$TEST_DIR/dev-no-apk.json" '.apk.enabled = false | .apk.destinations = []'
expect_invalid 'an application stack was allowed to disable APKs' dev_release "$TEST_DIR/dev-no-apk.json"
fixture "$TEST_DIR/wrong-variant.json" '.apk.destinations[1].variant = "tester"'
expect_invalid 'a contract without exactly client+admin variants was accepted' dev_release "$TEST_DIR/wrong-variant.json"

# Cross-stack: an APK rollback directory reused by another stack is rejected
# (it passes single-contract containment, so only the cross-stack check can
# catch it).
CROSS_DIR="$TEST_DIR/cross"
mkdir -p "$CROSS_DIR"
cp "$DEV_CONTRACT" "$CROSS_DIR/dev_release.json"
cp "$MS_CONTRACT" "$CROSS_DIR/monitor_service.json"
jq '.apk.destinations[0].rollback_dir = "/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK/client"' \
    "$PROD_CONTRACT" > "$CROSS_DIR/prod_release.json"
(
    stack_paths_file() { printf '%s/%s.json\n' "$CROSS_DIR" "$1"; }
    if paths_validate_cross_stack >/dev/null 2>&1; then
        exit 1
    fi
) || fail_test 'an APK directory reused across stacks was accepted'

# Cross-stack: two stacks sharing one vps.stack_dir are rejected. Each
# contract passes single-contract containment (prod's owned paths use distinct
# subdirectory names beneath the shared root), so only the cross-stack
# stack_dir check can catch this.
jq 'walk(if type == "string"
         then gsub("/srv/dev_stack/BOE_APP/prod_release"; "/srv/dev_stack/BOE_APP/dev_release")
         else . end)' "$PROD_CONTRACT" > "$CROSS_DIR/prod_release.json"
paths_validate prod_release "$CROSS_DIR/prod_release.json" \
    || fail_test 'the shared-stack_dir fixture failed single-contract validation'
(
    stack_paths_file() { printf '%s/%s.json\n' "$CROSS_DIR" "$1"; }
    if paths_validate_cross_stack >/dev/null 2>&1; then
        exit 1
    fi
) || fail_test 'a vps.stack_dir shared across stacks was accepted'

# Cross-stack: a stack_dir nested inside another stack's is rejected too.
jq 'walk(if type == "string"
         then gsub("/srv/dev_stack/BOE_APP/prod_release"; "/srv/dev_stack/BOE_APP/dev_release/prod_nested")
         else . end)' "$PROD_CONTRACT" > "$CROSS_DIR/prod_release.json"
paths_validate prod_release "$CROSS_DIR/prod_release.json" \
    || fail_test 'the nested-stack_dir fixture failed single-contract validation'
(
    stack_paths_file() { printf '%s/%s.json\n' "$CROSS_DIR" "$1"; }
    if paths_validate_cross_stack >/dev/null 2>&1; then
        exit 1
    fi
) || fail_test 'a vps.stack_dir nested inside another stack was accepted'

# paths_get refuses a symlinked contract, exactly like paths_validate.
ln -s "$DEV_CONTRACT" "$TEST_DIR/linked-paths.json"
if paths_get "$TEST_DIR/linked-paths.json" .vps.stack_dir >/dev/null 2>&1; then
    fail_test 'paths_get read a contract through a symlink'
fi

# ── authority: changing the JSON reroutes operations, no shell edits ─────────
# Rewrite every path root of the dev contract onto a CUSTOM tree, then run the
# real APK shipping flow against stubbed SSH/rsync. The stubs must see only
# the custom contract values — never a repo-standard path.

CUSTOM_VPS_ROOT="$TEST_DIR/srv/custom/BOE_APP"
CUSTOM_BACKUP_MOUNT="$TEST_DIR/srv/custom_backup"
CUSTOM_BACKUP_ROOT="$CUSTOM_BACKUP_MOUNT/BOE_APP"
CUSTOM_PATHS="$TEST_DIR/custom-paths.json"
jq --arg vroot "$CUSTOM_VPS_ROOT" --arg broot "$CUSTOM_BACKUP_ROOT" --arg bmount "$CUSTOM_BACKUP_MOUNT" '
    walk(if type == "string"
         then gsub("/srv/dev_stack/BOE_APP"; $vroot)
              | gsub("/srv/backup/BOE_APP"; $broot)
              | gsub("/srv/backup"; $bmount)
         else . end)' "$DEV_CONTRACT" > "$CUSTOM_PATHS"

paths_validate dev_release "$CUSTOM_PATHS" \
    || fail_test 'a contract with relocated roots failed validation'

CALL_LOG="$TEST_DIR/calls.log"; : > "$CALL_LOG"
boe_ssh() {
    printf 'ssh %s\n' "$*" >> "$CALL_LOG"
    bash -c "$*"
}
rsync() {
    printf 'rsync' >> "$CALL_LOG"; printf ' %s' "$@" >> "$CALL_LOG"; printf '\n' >> "$CALL_LOG"
    local dest="${*: -1}"
    dest="${dest#"${BOE_SSH_ALIAS}":}"
    local src
    for src in "$@"; do
        [[ -f "$src" ]] || continue
        cp -p -- "$src" "$dest" || return 1
    done
}

APK_DIR="$TEST_DIR/apks"; mkdir -p "$APK_DIR"
for variant in client admin; do
    apk="$APK_DIR/boe.dev.$variant.0.6.5.apk"
    printf 'APK-BYTES dev %s 0.6.5\n' "$variant" > "$apk"
    sha="$(sha256sum "$apk" | cut -d' ' -f1)"
    jq -n --arg apk "boe.dev.$variant.0.6.5.apk" --arg variant "$variant" --arg sha "$sha" \
        '{apk: $apk, target: "dev", variant: $variant, version: "0.6.5",
          buildLabel: "0.6.5", gitCommit: "0123456789abcdef0123456789abcdef01234567",
          gitDirty: false, builtAt: "2026-08-03T00:00:00Z", signing: "debug",
          sha256: $sha, sizeBytes: 32}' > "${apk%.apk}.json"
done

apk_ship_release "$CUSTOM_PATHS" "$APK_DIR" dev 0.6.5 true >/dev/null \
    || fail_test 'APK shipping failed against the relocated contract'

grep -qF "$CUSTOM_VPS_ROOT/dev_release/dev_apk" "$CALL_LOG" \
    || fail_test 'stubbed operations did not use the custom client current_dir'
grep -qF "$CUSTOM_BACKUP_ROOT/DEV_ROLLBACK/DEV_APK/client" "$CALL_LOG" \
    || fail_test 'stubbed operations did not use the custom client rollback_dir'
grep -qF "$CUSTOM_VPS_ROOT/dev_release/dev_admin_apk" "$CALL_LOG" \
    || fail_test 'stubbed operations did not use the custom admin current_dir'
grep -qF "$CUSTOM_BACKUP_ROOT/DEV_ROLLBACK/DEV_APK/admin" "$CALL_LOG" \
    || fail_test 'stubbed operations did not use the custom admin rollback_dir'
if grep -qE '/srv/(dev_stack|backup)' "$CALL_LOG"; then
    fail_test 'a repo-standard path leaked into operations driven by a custom contract'
fi

# ── raw-literal scan: clean repo, catches a planted literal ──────────────────

scan_operational() { # <scan-root-rm> <scan-root-repo> [extra files...]
    local rm_dir="$1" repo_dir="$2"; shift 2
    local f hits offenders=""
    while read -r f; do
        [[ -f "$f" ]] || continue
        hits="$(grep -nE '/srv/[A-Za-z0-9_.-]' "$f" | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
        [[ -n "$hits" ]] && offenders+="$f"$'\n'
    done < <(
        find "$rm_dir" -maxdepth 1 -name '*.sh' | sort
        find "$rm_dir/lib" "$rm_dir/stacks" -name '*.sh' | sort
        printf '%s\n' "$repo_dir/emu/boe_update.sh"
        for f in "$@"; do printf '%s\n' "$f"; done
    )
    [[ -z "$offenders" ]] && return 0
    printf '%s' "$offenders"
    return 1
}

scan_offenders="$(scan_operational "$RM_DIR" "$ROOT_DIR")" \
    || fail_test "raw /srv/... literals in operational scripts: $scan_offenders"

PLANTED_DIR="$TEST_DIR/planted" # mirrors the release_manager layout
mkdir -p "$PLANTED_DIR/lib" "$PLANTED_DIR/stacks"
printf 'TARGET="/srv/evil/stack"\n' > "$PLANTED_DIR/lib/evil.sh"
printf '# a comment may show an example: /srv/example/ok\n' > "$PLANTED_DIR/lib/comments_ok.sh"
if scan_operational "$PLANTED_DIR" "$TEST_DIR" >/dev/null 2>&1; then
    fail_test 'the raw-literal scan missed a planted operational path'
fi

printf 'PASS: schema-3 path contracts are the sole authority and validate fail-closed\n'
