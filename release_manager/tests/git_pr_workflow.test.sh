#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../lib/git_workflow.sh
source "$ROOT_DIR/release_manager/lib/git_workflow.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
chmod 700 "$TEST_DIR"

origin="$TEST_DIR/origin.git"
main_worktree="$TEST_DIR/main"
contributor="$TEST_DIR/contributor"
fake_bin="$TEST_DIR/bin"
mkdir "$fake_bin"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$main_worktree" >/dev/null 2>&1
git -C "$main_worktree" config user.name 'Release Test'
git -C "$main_worktree" config user.email 'release-test@example.invalid'
printf 'initial\n' > "$main_worktree/base.txt"
git -C "$main_worktree" add base.txt
git -C "$main_worktree" commit -m 'chore: initial state' >/dev/null
git -C "$main_worktree" push -u origin main >/dev/null 2>&1

git clone "$origin" "$contributor" >/dev/null 2>&1
git -C "$contributor" config user.name 'Contributor'
git -C "$contributor" config user.email 'contributor@example.invalid'
git -C "$contributor" switch -c contributor/catalog >/dev/null
printf 'approved contribution\n' > "$contributor/contributor.txt"
git -C "$contributor" add contributor.txt
git -C "$contributor" commit -m 'feat: approved contribution' >/dev/null
git -C "$contributor" push -u origin contributor/catalog >/dev/null 2>&1

export FAKE_GH_HEAD_SHA="$(git -C "$contributor" rev-parse HEAD)"
export FAKE_GH_ORIGIN="$origin"
export FAKE_GH_LOG="$TEST_DIR/gh.log"
export FAKE_GH_APPROVED="$TEST_DIR/approved"
initial_main_sha="$(git --git-dir="$origin" rev-parse refs/heads/main)"

printf '%s\n' \
    '#!/bin/sh' \
    'printf "%s\n" "$*" >> "$FAKE_GH_LOG"' \
    'case "${1:-} ${2:-}" in' \
    '  "auth status") exit 0 ;;' \
    '  "pr list")' \
    '    if [ -f "$FAKE_GH_APPROVED" ]; then decision=APPROVED; else decision=REVIEW_REQUIRED; fi' \
    '    printf "1\tcontributor/catalog\tcontributor\t%s\tMERGEABLE\n" "$decision"' \
    '    ;;' \
    '  "pr view")' \
    '    case "$*" in' \
    '      *"--jq .headRefOid"*) printf "%s\n" "$FAKE_GH_HEAD_SHA" ;;' \
    '      *) printf "{\"headRefOid\":\"%s\",\"mergeable\":\"MERGEABLE\",\"files\":[{\"path\":\"contributor.txt\",\"additions\":1,\"deletions\":0}]}\n" "$FAKE_GH_HEAD_SHA" ;;' \
    '    esac' \
    '    ;;' \
    '  "pr checks") exit 0 ;;' \
    '  "pr diff") printf "diff --git a/contributor.txt b/contributor.txt\n" ;;' \
    '  "pr merge") git --git-dir="$FAKE_GH_ORIGIN" update-ref refs/heads/main "$FAKE_GH_HEAD_SHA" ;;' \
    '  "api --method") : > "$FAKE_GH_APPROVED" ;;' \
    '  api\ repos/*) printf "1\n" ;;' \
    '  *) exit 64 ;;' \
    'esac' > "$fake_bin/gh"
chmod 700 "$fake_bin/gh"
PATH="$fake_bin:$PATH"
export PATH

git_workflow_confirm() { return 0; }

git_workflow_review_pull_requests "$main_worktree" >/dev/null \
    || fail_test 'approved PR review workflow failed'

# A contributor push after review must invalidate the stored review/merge pair,
# even when GitHub still reports the PR as APPROVED.
printf 'changed after review\n' > "$contributor/after-review.txt"
git -C "$contributor" add after-review.txt
git -C "$contributor" commit -m 'feat: change after review' >/dev/null
git -C "$contributor" push origin contributor/catalog >/dev/null 2>&1
export FAKE_GH_HEAD_SHA="$(git -C "$contributor" rev-parse HEAD)"
if git_workflow_merge_pull_requests "$main_worktree" >/dev/null 2>&1; then
    fail_test 'PR head changed after review but merge was allowed'
fi
[[ "$(git --git-dir="$origin" rev-parse refs/heads/main)" == "$initial_main_sha" ]] \
    || fail_test 'unreviewed replacement PR head reached origin/main'

# Re-reviewing the displayed replacement patch binds approval to the new SHA.
git_workflow_review_pull_requests "$main_worktree" >/dev/null \
    || fail_test 'replacement PR head could not be reviewed'
git_workflow_merge_pull_requests "$main_worktree" >/dev/null \
    || fail_test 'approved PR was not integrated into origin/main'

[[ "$(git --git-dir="$origin" rev-parse refs/heads/main)" == "$FAKE_GH_HEAD_SHA" ]] \
    || fail_test 'approved PR head did not reach origin/main'
grep -q -- '--repo tamagami-hi/boe_app' "$FAKE_GH_LOG" \
    || fail_test 'GitHub commands were not pinned to the approved repository'
grep -q -- "--match-head-commit $FAKE_GH_HEAD_SHA" "$FAKE_GH_LOG" \
    || fail_test 'PR merge was not pinned to the reviewed head SHA'
grep -q '^pr checks ' "$FAKE_GH_LOG" \
    || fail_test 'required PR checks were not evaluated'
grep -q -- "commit_id=$FAKE_GH_HEAD_SHA" "$FAKE_GH_LOG" \
    || fail_test 'PR approval was not bound to the reviewed head SHA'
sanitized="$(printf 'safe\033]52;c;clipboard\a\roverwrite text\n' | git_workflow_sanitize_terminal)"
[[ "$sanitized" == 'safe]52;c;clipboardoverwrite text' ]] \
    || fail_test 'terminal control bytes were not removed from PR output'
summary="$(printf '{"files":[{"path":"safe\\rspoof.txt","additions":1,"deletions":0}]}\n' \
    | git_workflow_render_file_summary)"
[[ "$summary" == '      safespoof.txt (+1 -0)' ]] \
    || fail_test 'terminal control bytes were not removed from PR file summaries'

printf 'PASS: reviewed PRs are pinned, checked, approved and integrated into origin/main\n'
