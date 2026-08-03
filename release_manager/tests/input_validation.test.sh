#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATION_LIB="$ROOT_DIR/release_manager/lib/input_validation.sh"
STATUS_SCRIPT="$ROOT_DIR/release_manager/status.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[[ -f "$VALIDATION_LIB" ]] || fail_test 'input-validation library is missing'
# shellcheck source=../lib/input_validation.sh
source "$VALIDATION_LIB"

is_safe_log_basename 'dev-deploy-20260803T110730Z.log' \
    || fail_test 'valid deploy log basename was rejected'
for unsafe_name in '' '..' '../deploy.log' 'nested/deploy.log' "bad'file.log" $'bad\nfile.log'; do
    if is_safe_log_basename "$unsafe_name"; then
        fail_test "unsafe deploy log basename was accepted: $unsafe_name"
    fi
done

is_safe_absolute_remote_path '/srv/backup/BOE_APP/LOGS/DEV_LOGS' \
    || fail_test 'valid absolute remote path was rejected'
for unsafe_path in '' 'relative/path' '/srv/../etc' "/srv/bad'path" $'/srv/bad\npath'; do
    if is_safe_absolute_remote_path "$unsafe_path"; then
        fail_test "unsafe remote path was accepted: $unsafe_path"
    fi
done

grep -qF 'is_safe_log_basename "$f"' "$STATUS_SCRIPT" \
    || fail_test 'status log action does not validate the operator filename'
grep -qF 'tail -n 80 -- "$dir/$file"' "$STATUS_SCRIPT" \
    || fail_test 'status log action does not pass the remote path as data'

printf 'PASS: remote log inputs reject shell metacharacters and traversal\n'
