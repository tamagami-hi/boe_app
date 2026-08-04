#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../lib/repo_sync.sh
source "$ROOT_DIR/release_manager/lib/repo_sync.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
origin="$TEST_DIR/origin.git"
repo="$TEST_DIR/main worktree with spaces"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$repo" >/dev/null 2>&1
git -C "$repo" config user.name 'Release Test'
git -C "$repo" config user.email 'release-test@example.invalid'
printf 'initial\n' > "$repo/tracked.txt"
git -C "$repo" add tracked.txt
git -C "$repo" commit -m 'chore: initial state' >/dev/null
git -C "$repo" push -u origin main >/dev/null 2>&1

printf 'dirty\n' >> "$repo/tracked.txt"
repo_sync_eval "$repo"
[[ "$RS_MAIN_WT" == "$repo" ]] || fail_test 'main worktree path was truncated at spaces'
[[ "$RS_STATUS_OK" == true && "$RS_DIRTY" -eq 1 ]] \
    || fail_test 'dirty worktree with spaces was reported clean'
[[ "$RS_CLEAN_SYNC" == false ]] || fail_test 'dirty worktree passed the clean release gate'

grep -qF 'GIT_TERMINAL_PROMPT=0' "$ROOT_DIR/release_manager/lib/repo_sync.sh" \
    || fail_test 'origin fetch can block on a terminal credential prompt'

printf 'PASS: repository sync handles main-worktree paths containing spaces\n'
