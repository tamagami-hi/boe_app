#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATUS_SCRIPT="$ROOT_DIR/release_manager/status.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

ACTION_LOG="$(mktemp)"
ACTION_TEST_DIR="$(mktemp -d)"
trap 'rm -f "$ACTION_LOG"; rm -rf "$ACTION_TEST_DIR"' EXIT

BOE_STATUS_LIB_ONLY=true source "$STATUS_SCRIPT"

# Leading-zero version components are decimal, not octal — a bump must never
# crash or mis-add on a component like 08 or 09.
[[ "$(bump_version 0.7.09 patch)" == '0.7.10' ]] \
    || fail_test 'patch bump mishandled a leading-zero component'
[[ "$(bump_version 0.08.9 minor)" == '0.9.0' ]] \
    || fail_test 'minor bump mishandled a leading-zero component'
[[ "$(bump_version 09.0.0 major)" == '10.0.0' ]] \
    || fail_test 'major bump mishandled a leading-zero component'

help_output="$(BOE_STATUS_LIB_ONLY=true bash "$STATUS_SCRIPT" --help)"
grep -qF 'Usage: ./release_manager/status.sh' <<< "$help_output" \
    || fail_test 'an inherited BOE_STATUS_LIB_ONLY variable disabled direct execution'
grep -qF 'apk_ship_release' "$STATUS_SCRIPT" \
    || fail_test 'APK-only builds are not connected to VPS artifact shipping'

real_rm_dir="$RM_DIR"
cat > "$ACTION_TEST_DIR/deploy.sh" <<'SCRIPT'
#!/usr/bin/env bash
exit 23
SCRIPT
cat > "$ACTION_TEST_DIR/rollback.sh" <<'SCRIPT'
#!/usr/bin/env bash
for argument in "$@"; do
    [[ "$argument" == --list ]] && exit 0
done
exit 29
SCRIPT
chmod 700 "$ACTION_TEST_DIR/deploy.sh" "$ACTION_TEST_DIR/rollback.sh"
pick_stack() { printf 'dev_release\n'; }
stack_flag() { printf '%s\n' '--dev'; }
latest_bundle() { printf '/tmp/test-bundle\n'; }
RM_DIR="$ACTION_TEST_DIR"

REMOTE_FETCHED=true
deploy_rc=0
action_deploy deploy >/dev/null 2>&1 || deploy_rc=$?
[[ "$deploy_rc" == 23 && "$REMOTE_FETCHED" == false ]] \
    || fail_test 'deploy action masked a child-script failure or retained stale remote state'

REMOTE_FETCHED=true
rollback_rc=0
action_rollback <<< '1' >/dev/null 2>&1 || rollback_rc=$?
[[ "$rollback_rc" == 29 && "$REMOTE_FETCHED" == false ]] \
    || fail_test 'rollback action masked a child-script failure or retained stale remote state'

RM_DIR="$real_rm_dir"

record_action() { printf '%s\n' "$*" >> "$ACTION_LOG"; }
action_git_workflow() { record_action action_git_workflow "$@"; }
action_sync_worktrees() { record_action action_sync_worktrees "$@"; }
action_cut_release() { record_action action_cut_release "$@"; }
action_export() { record_action action_export "$@"; }
action_apk() { record_action action_apk "$@"; }
action_validate_contracts() { record_action action_validate_contracts "$@"; }
action_deploy() { record_action action_deploy "$@"; }
action_rollback() { record_action action_rollback "$@"; }
action_logs() { record_action action_logs "$@"; }
action_containers() { record_action action_containers "$@"; }
action_diagnose() { record_action action_diagnose "$@"; }
action_operator_guide() { record_action action_operator_guide "$@"; }
pause_after_action() { :; }
show_status() { :; }

assert_route() {
    local menu_function="$1" choice="$2" expected="$3" actual
    : > "$ACTION_LOG"
    "$menu_function" <<< "$choice"$'\nb\n' >/dev/null
    actual="$(cat "$ACTION_LOG")"
    [[ "$actual" == "$expected" ]] \
        || fail_test "$menu_function choice $choice routed to '$actual', expected '$expected'"
}

assert_no_route() {
    local menu_function="$1" choice="$2"
    : > "$ACTION_LOG"
    "$menu_function" <<< "$choice"$'\nb\n' >/dev/null
    [[ ! -s "$ACTION_LOG" ]] \
        || fail_test "$menu_function choice $choice unexpectedly invoked an action"
}

assert_route menu_git 1 'action_git_workflow'
assert_route menu_git 2 'action_sync_worktrees'
assert_route menu_git 3 'action_cut_release'

assert_route menu_exports 1 'action_export build'
assert_route menu_exports 2 'action_export restage'
assert_route menu_exports 3 'action_apk'
assert_route menu_exports 4 'action_validate_contracts'

assert_route menu_ship_deploy 1 'action_deploy deploy'
assert_route menu_ship_deploy 2 'action_deploy ship-only'
assert_route menu_ship_deploy 3 'action_deploy force'
assert_route menu_ship_deploy 4 'action_rollback'
assert_route menu_ship_deploy 5 'action_logs'
assert_route menu_ship_deploy 6 'action_containers'
assert_route menu_ship_deploy 7 'action_diagnose'
assert_route menu_ship_deploy 8 'action_operator_guide'

for menu_function in menu_git menu_exports menu_ship_deploy; do
    assert_no_route "$menu_function" x
    assert_no_route "$menu_function" B
done

menu_output="$(menu_main <<< 'q')"
grep -qF '1) Git' <<< "$menu_output" || fail_test 'main menu does not expose Git first'
grep -qF '2) Exports' <<< "$menu_output" || fail_test 'main menu does not expose Exports second'
grep -qF '3) Ship + Deploy' <<< "$menu_output" || fail_test 'main menu does not expose Ship + Deploy third'
if grep -qF 'Cut a release' <<< "$menu_output"; then
    fail_test 'main menu still exposes a nested Git action directly'
fi

for menu_function in menu_git menu_exports menu_ship_deploy; do
    menu_output="$($menu_function <<< 'b')"
    grep -qF 'b) Back' <<< "$menu_output" \
        || fail_test "$menu_function does not expose a Back option"
done

assert_main_route() {
    local choice="$1" expected="$2" actual
    : > "$ACTION_LOG"
    menu_main <<< "$choice"$'\nq\n' >/dev/null
    actual="$(cat "$ACTION_LOG")"
    [[ "$actual" == "$expected" ]] \
        || fail_test "main menu choice $choice routed to '$actual', expected '$expected'"
}

menu_git() { record_action menu_git; }
menu_exports() { record_action menu_exports; }
menu_ship_deploy() { record_action menu_ship_deploy; }
assert_main_route 1 menu_git
assert_main_route 2 menu_exports
assert_main_route 3 menu_ship_deploy

printf 'PASS: status control center routes Git, export, and deployment submenus correctly\n'
