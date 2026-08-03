#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../lib/version.sh
source "$ROOT_DIR/release_manager/lib/version.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
origin="$TEST_DIR/origin.git"
repo="$TEST_DIR/repo"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$repo" >/dev/null 2>&1
git -C "$repo" config user.name 'Release Test'
git -C "$repo" config user.email 'release-test@example.invalid'
printf '0.6.5\n' > "$repo/VERSION"
git -C "$repo" add VERSION
git -C "$repo" commit -m 'chore(release): v0.6.5' >/dev/null
git -C "$repo" tag -a v0.6.5 -m 'Release v0.6.5'

on_exact_release_tag "$repo" 0.6.5 \
    || fail_test 'clean local release tag was not recognized'
if remote_release_tag_matches "$repo" 0.6.5; then
    fail_test 'local-only tag was accepted as a remote release'
fi

git -C "$repo" push -u origin main >/dev/null 2>&1
if remote_release_tag_matches "$repo" 0.6.5; then
    fail_test 'origin/main without the release tag was accepted as stable'
fi
if remote_release_refs_match "$repo" 0.6.5 "$(git -C "$repo" rev-parse HEAD)"; then
    fail_test 'live remote refs accepted origin/main without a release tag'
fi

git -C "$repo" push origin v0.6.5 >/dev/null 2>&1
remote_release_tag_matches "$repo" 0.6.5 \
    || fail_test 'matching remote annotated tag was rejected'
remote_release_refs_match "$repo" 0.6.5 "$(git -C "$repo" rev-parse HEAD)" \
    || fail_test 'matching live origin/main and release tag were rejected'

printf 'PASS: stable releases require origin tag and commit equality\n'
