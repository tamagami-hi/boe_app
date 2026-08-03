#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GIT_WORKFLOW_LIB="$ROOT_DIR/release_manager/lib/git_workflow.sh"
STATUS_SCRIPT="$ROOT_DIR/release_manager/status.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[[ -f "$GIT_WORKFLOW_LIB" ]] || fail_test 'Git workflow library is missing'

# shellcheck source=../lib/git_workflow.sh
source "$GIT_WORKFLOW_LIB"

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
chmod 700 "$TEST_DIR"

origin="$TEST_DIR/origin.git"
main_worktree="$TEST_DIR/main"
surface_worktree="$TEST_DIR/surface"
ignored_worktree="$TEST_DIR/ignored-surface"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$main_worktree" >/dev/null 2>&1
git -C "$main_worktree" config user.name 'Release Test'
git -C "$main_worktree" config user.email 'release-test@example.invalid'
printf 'initial\n' > "$main_worktree/shared.txt"
printf 'obsolete\n' > "$main_worktree/obsolete.txt"
printf '.env\n' > "$main_worktree/.gitignore"
git -C "$main_worktree" add shared.txt obsolete.txt .gitignore
git -C "$main_worktree" commit -m 'chore: initial state' >/dev/null
git -C "$main_worktree" push -u origin main >/dev/null 2>&1

git -C "$main_worktree" worktree add -b wt/client "$surface_worktree" main >/dev/null
git -C "$surface_worktree" config user.name 'Release Test'
git -C "$surface_worktree" config user.email 'release-test@example.invalid'
git -C "$main_worktree" worktree add -b feature/not-a-surface "$ignored_worktree" main >/dev/null
printf 'surface change\n' > "$surface_worktree/surface.txt"
printf 'must remain local\n' > "$ignored_worktree/ignored.txt"
printf 'main change\n' > "$main_worktree/main.txt"
mkdir -p "$main_worktree/nested"
printf 'path-safe\n' > "$main_worktree/nested/path with spaces.txt"
printf 'fake-secret\n' > "$main_worktree/.env"
rm "$main_worktree/obsolete.txt"

# Deterministic prompt hooks: exercise the same orchestration without a TTY.
git_workflow_confirm() { return 0; }
git_workflow_prompt_commit_message() {
    printf 'chore(%s): test workflow\n' "$2"
}
git_workflow_review_pull_requests() { return 0; }
git_workflow_merge_pull_requests() { return 0; }

git_workflow_run "$main_worktree" >/dev/null \
    || fail_test 'Git workflow could not prepare a dirty main/worktree release'

[[ -z "$(git -C "$main_worktree" status --porcelain)" ]] \
    || fail_test 'main worktree is still dirty after the Git workflow'
[[ -z "$(git -C "$surface_worktree" status --porcelain)" ]] \
    || fail_test 'surface worktree is still dirty after the Git workflow'
[[ -n "$(git -C "$ignored_worktree" status --porcelain)" ]] \
    || fail_test 'non-wt worktree was unexpectedly staged or committed'

git -C "$main_worktree" cat-file -e 'HEAD:main.txt' 2>/dev/null \
    || fail_test 'main worktree changes were not committed'
git -C "$main_worktree" cat-file -e 'HEAD:surface.txt' 2>/dev/null \
    || fail_test 'surface worktree changes were not integrated into main'
git -C "$main_worktree" cat-file -e 'HEAD:nested/path with spaces.txt' 2>/dev/null \
    || fail_test 'untracked paths containing spaces were not committed safely'
if git -C "$main_worktree" cat-file -e 'HEAD:obsolete.txt' 2>/dev/null; then
    fail_test 'tracked deletion was not committed'
fi
[[ -f "$main_worktree/.env" ]] || fail_test 'ignored environment file was removed'
if git -C "$main_worktree" ls-files --error-unmatch .env >/dev/null 2>&1; then
    fail_test 'ignored environment file was committed'
fi
printf '%s\n' '-----BEGIN PRIVATE KEY-----' > "$main_worktree/private.pem"
if git_workflow_check_sensitive_changes "$main_worktree" >/dev/null 2>&1; then
    fail_test 'sensitive untracked path was accepted for staging'
fi
rm "$main_worktree/private.pem"

main_sha="$(git -C "$main_worktree" rev-parse main)"
remote_sha="$(git -C "$main_worktree" rev-parse origin/main)"
surface_sha="$(git -C "$surface_worktree" rev-parse wt/client)"
[[ "$main_sha" == "$remote_sha" ]] \
    || fail_test 'prepared main was not pushed to origin/main'
[[ "$main_sha" == "$surface_sha" ]] \
    || fail_test 'main was not fanned back out to the surface worktree'

grep -qF 'source "$RM_DIR/lib/git_workflow.sh"' "$STATUS_SCRIPT" \
    || fail_test 'status.sh does not load the Git workflow'
grep -qF 'git_workflow_run "$ROOT_DIR"' "$STATUS_SCRIPT" \
    || fail_test 'status.sh does not expose the Git workflow action'
grep -qF '5) Git workflow' "$STATUS_SCRIPT" \
    || fail_test 'interactive status menu does not expose the Git workflow'
grep -qF 'prepare_release_git' "$STATUS_SCRIPT" \
    || fail_test 'release cutting does not invoke Git preparation'
grep -qF 'push --atomic origin' "$STATUS_SCRIPT" \
    || fail_test 'release commit and tag are not pushed atomically'
grep -qF 'release commit failed; no tag or push was attempted' "$STATUS_SCRIPT" \
    || fail_test 'release commit failure is not handled explicitly'
grep -qF 'atomic release push failed; origin was not partially updated' "$STATUS_SCRIPT" \
    || fail_test 'atomic push failure is not handled explicitly'
grep -qF 'stable export remains blocked until the remote tag matches' "$STATUS_SCRIPT" \
    || fail_test 'ambiguous atomic push recovery does not preserve and quarantine the local tag'
prepare_line="$(sed -n '/^action_cut_release()/,/^}/p' "$STATUS_SCRIPT" | grep -n 'prepare_release_git' | head -1 | cut -d: -f1)"
version_line="$(sed -n '/^action_cut_release()/,/^}/p' "$STATUS_SCRIPT" | grep -n 'canonical=.*canonical_version' | head -1 | cut -d: -f1)"
[[ -n "$prepare_line" && -n "$version_line" && "$prepare_line" -lt "$version_line" ]] \
    || fail_test 'release version is calculated before Git synchronization'
if grep -qF 'Atomically push main and v$next to origin?' "$STATUS_SCRIPT"; then
    fail_test 'release can be left locally tagged by declining a second push prompt'
fi
grep -qF 'remote get-url --push --all origin' "$ROOT_DIR/release_manager/lib/version.sh" \
    || fail_test 'release origin validation ignores additional push URLs'
grep -qF 'could not verify whether v$next exists on origin' "$STATUS_SCRIPT" \
    || fail_test 'remote tag lookup transport failures do not block release'
grep -qF 'gitleaks git --staged' "$GIT_WORKFLOW_LIB" \
    || fail_test 'Git workflow does not scan staged content for secrets'

before_prompt_race="$(git -C "$main_worktree" rev-parse HEAD)"
printf 'harmless before prompt\n' > "$main_worktree/prompt-race.txt"
git_workflow_prompt_commit_message() {
    printf '%s\n' 'late sensitive file' > "$1/appeared-during-prompt.pem"
    printf 'chore(%s): prompt race test\n' "$2"
}
if git_workflow_commit_dirty "$main_worktree" main >/dev/null 2>&1; then
    fail_test 'sensitive path appearing during prompting was committed'
fi
[[ "$(git -C "$main_worktree" rev-parse HEAD)" == "$before_prompt_race" ]] \
    || fail_test 'prompt-time sensitive path advanced main'
git -C "$main_worktree" restore --staged -- prompt-race.txt appeared-during-prompt.pem
rm "$main_worktree/prompt-race.txt" "$main_worktree/appeared-during-prompt.pem"
git_workflow_prompt_commit_message() {
    printf 'chore(%s): test workflow\n' "$2"
}

before_failed_commit="$(git -C "$main_worktree" rev-parse HEAD)"
before_failed_push="$(git -C "$main_worktree" rev-parse origin/main)"
hook="$(git -C "$main_worktree" rev-parse --absolute-git-dir)/hooks/pre-commit"
printf '#!/bin/sh\nexit 1\n' > "$hook"
chmod 700 "$hook"
printf 'must not be committed\n' > "$main_worktree/rejected.txt"
if git_workflow_run "$main_worktree" >/dev/null 2>&1; then
    fail_test 'Git workflow reported success after a commit-hook failure'
fi
[[ "$(git -C "$main_worktree" rev-parse HEAD)" == "$before_failed_commit" ]] \
    || fail_test 'commit-hook failure advanced main'
[[ "$(git -C "$main_worktree" rev-parse origin/main)" == "$before_failed_push" ]] \
    || fail_test 'commit-hook failure pushed main'

printf 'PASS: dirty main and surface work are committed, integrated and pushed before release\n'
