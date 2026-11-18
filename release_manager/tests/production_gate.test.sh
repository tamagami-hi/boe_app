#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/release_manager/lib/ui.sh"
source "$ROOT_DIR/release_manager/lib/version.sh"
source "$ROOT_DIR/release_manager/lib/production_gate.sh"
UI_INTERACTIVE=false

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
origin="$TEST_DIR/origin.git"
repo="$TEST_DIR/repo"
other="$TEST_DIR/other"
gate_output="$TEST_DIR/gate.out"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$repo" >/dev/null 2>&1
git -C "$repo" config user.name 'Release Test'
git -C "$repo" config user.email 'release-test@example.invalid'

commit_file() {
    printf '%s\n' "$2" > "$repo/$1"
    git -C "$repo" add "$1"
    git -C "$repo" commit -qm "$3"
}

commit_file VERSION 0.6.5 'chore(release): v0.6.5'
git -C "$repo" tag -a v0.6.5 -m 'Release v0.6.5'
v065="$(git -C "$repo" rev-parse HEAD)"
commit_file records.json '{"records":1}' 'records: 1 record file'
records="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" push -q origin main v0.6.5 >/dev/null 2>&1
git -C "$repo" checkout -q --detach v0.6.5

[[ "$(git -C "$repo" rev-parse origin/main)" == "$records" ]] \
    || fail_test 'fixture: origin/main is not ahead of the release tag'

production_release_gate "$repo" 0.6.5 \
    || fail_test 'a clean checkout of the release tag was refused while origin/main is ahead of it'

printf 'local edit\n' >> "$repo/VERSION"
if production_release_gate "$repo" 0.6.5; then
    fail_test 'a modified tracked file passed the production gate'
fi
git -C "$repo" checkout -q -- VERSION
: > "$repo/untracked.txt"
if production_release_gate "$repo" 0.6.5; then
    fail_test 'an untracked file passed the production gate'
fi
rm -f "$repo/untracked.txt"

git -C "$repo" checkout -q main
if production_release_gate "$repo" 0.6.5; then
    fail_test 'HEAD on main, not on the release tag, passed the production gate'
fi
git -C "$repo" checkout -q --detach v0.6.5
git -C "$repo" tag -f -a v0.6.5 -m 'Stale local tag' "$records" >/dev/null
if production_release_gate "$repo" 0.6.5; then
    fail_test 'HEAD on the release commit passed while the local tag names another commit'
fi
git -C "$repo" tag -d v0.6.5 >/dev/null
if production_release_gate "$repo" 0.6.5; then
    fail_test 'a checkout without the local release tag passed the production gate'
fi
git -C "$repo" fetch -q origin tag v0.6.5 >/dev/null 2>&1

git clone "$origin" "$other" >/dev/null 2>&1
git -C "$other" push -q --force origin "$records:refs/tags/v0.6.5" >/dev/null 2>&1
if production_release_gate "$repo" 0.6.5; then
    fail_test 'origin tag pointing at another commit passed the production gate'
fi
git -C "$other" push -q origin :refs/tags/v0.6.5 >/dev/null 2>&1
if production_release_gate "$repo" 0.6.5; then
    fail_test 'a release tag missing on origin passed the production gate'
fi
git -C "$repo" push -q origin v0.6.5 >/dev/null 2>&1
production_release_gate "$repo" 0.6.5 \
    || fail_test 'the restored origin tag was refused'

git -C "$repo" remote set-url origin "$TEST_DIR/unreachable.git"
if production_release_gate "$repo" 0.6.5; then
    fail_test 'an unreachable origin passed the production gate instead of failing closed'
fi
git -C "$repo" remote set-url origin "$origin"

manifest="$TEST_DIR/manifest.json"
dirty_reads() {
    printf '%s\n' "$1" > "$manifest"
    [[ "$(manifest_git_dirty "$manifest")" == "$2" ]] \
        || fail_test "manifest $1 read git_dirty as $(manifest_git_dirty "$manifest"), expected $2"
}
dirty_reads '{"git_dirty": false}' false
dirty_reads '{"git_dirty": true}' true
dirty_reads '{"git_dirty": "false"}' invalid
dirty_reads '{"git_dirty": null}' invalid
dirty_reads '{"git_dirty": 0}' invalid
dirty_reads '{"version": "0.6.5"}' missing
dirty_reads '["not", "an", "object"]' invalid
printf 'not json\n' > "$manifest"
[[ "$(manifest_git_dirty "$manifest")" == invalid ]] || fail_test 'an unreadable manifest did not read as invalid'

gate_refuses() {
    local label="$1"
    shift
    if production_deploy_gate "$repo" "$@" > "$gate_output" 2>&1; then
        fail_test "deploy gate accepted $label"
    fi
}

gate_refuses 'a release while origin has no production branch' 0.6.5 "$v065" false
grep -qF 'Push a release to production' "$gate_output" \
    || fail_test 'the missing-production refusal does not point at the push menu'

git -C "$repo" push -q origin "$v065:refs/heads/production" >/dev/null 2>&1
production_deploy_gate "$repo" 0.6.5 "$v065" false >/dev/null 2>&1 \
    || fail_test 'deploy gate refused a clean release that is both the production tip and the tag'

gate_refuses 'a development version' 0.6.6-dev.1.gabcdef0 "$v065" false
gate_refuses 'a dirty bundle' 0.6.5 "$v065" true
gate_refuses 'git_dirty as the string "false"' 0.6.5 "$v065" invalid
gate_refuses 'a bundle with no git_dirty record' 0.6.5 "$v065" missing
gate_refuses 'a bundle with no git_sha' 0.6.5 '' false
grep -qF 'no valid git_sha' "$gate_output" || fail_test 'a missing git_sha was not refused as such'
gate_refuses 'a short git_sha' 0.6.5 "${v065:0:12}" false
grep -qF 'no valid git_sha' "$gate_output" || fail_test 'a short git_sha was not refused as such'

git -C "$repo" checkout -q main
commit_file VERSION 0.6.6 'chore(release): v0.6.6'
git -C "$repo" tag -a v0.6.6 -m 'Release v0.6.6'
v066="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" push -q origin main v0.6.6 >/dev/null 2>&1

gate_refuses 'a tagged release that is not the production tip' 0.6.6 "$v066" false
grep -qF "is not origin's production tip" "$gate_output" \
    || fail_test 'the not-production refusal does not name the production tip'

git -C "$repo" push -q origin "$v066:refs/heads/production" >/dev/null 2>&1
production_deploy_gate "$repo" 0.6.6 "$v066" false >/dev/null 2>&1 \
    || fail_test 'deploy gate refused the release production was moved to'
gate_refuses 'the previous release after production moved on' 0.6.5 "$v065" false

git -C "$other" fetch -q origin >/dev/null 2>&1
git -C "$other" push -q --force origin "$v065:refs/tags/v0.6.6" >/dev/null 2>&1
gate_refuses 'a bundle whose origin tag points at another commit' 0.6.6 "$v066" false
grep -qF "origin's v0.6.6 is missing or does not resolve" "$gate_output" \
    || fail_test 'the moved-tag refusal does not name the tag'
git -C "$repo" push -q --force origin v0.6.6 >/dev/null 2>&1
production_deploy_gate "$repo" 0.6.6 "$v066" false >/dev/null 2>&1 \
    || fail_test 'deploy gate refused the restored release tag'

git -C "$repo" remote set-url origin "$TEST_DIR/unreachable.git"
gate_refuses 'a bundle while origin is unreachable' 0.6.6 "$v066" false
git -C "$repo" remote set-url origin "$origin"

grep -qF 'production_deploy_gate "$ROOT_DIR" "$VERSION" "$MANIFEST_SHA" "$MANIFEST_DIRTY" || exit 1' \
    "$ROOT_DIR/release_manager/deploy.sh" \
    || fail_test 'deploy.sh --prod does not stop on the production deploy gate'
grep -qF 'MANIFEST_DIRTY="$(manifest_git_dirty "$BUNDLE/manifest.json")"' "$ROOT_DIR/release_manager/deploy.sh" \
    || fail_test 'deploy.sh does not read git_dirty through manifest_git_dirty'
grep -qF 'production_release_gate "$ROOT_DIR" "$CANONICAL"' "$ROOT_DIR/release_manager/export.sh" \
    || fail_test 'export.sh does not label stable bundles through the production release gate'

printf 'PASS: production deploys need a clean bundle that is both origin production tip and its release tag\n'
