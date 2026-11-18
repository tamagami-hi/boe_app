#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/release_manager/lib/ui.sh"
source "$ROOT_DIR/release_manager/lib/version.sh"
source "$ROOT_DIR/release_manager/lib/production_gate.sh"
source "$ROOT_DIR/release_manager/lib/production_push.sh"
UI_INTERACTIVE=false

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
origin="$TEST_DIR/origin.git"
repo="$TEST_DIR/repo"
out="$TEST_DIR/flow.out"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$repo" >/dev/null 2>&1
git -C "$repo" config user.name 'Release Test'
git -C "$repo" config user.email 'release-test@example.invalid'

declare -A sha=()
release() {
    printf '%s\n' "${1#v}" > "$repo/VERSION"
    git -C "$repo" add VERSION
    git -C "$repo" commit -qm "chore(release): $1"
    git -C "$repo" tag -a "$1" -m "Release $1"
    sha[$1]="$(git -C "$repo" rev-parse HEAD)"
}
records() {
    printf '%s\n' "$1" >> "$repo/records.txt"
    git -C "$repo" add records.txt
    git -C "$repo" commit -qm "records: $1"
}

for patch in 1 2 3 4 5 6 7 8 9; do
    release "v0.6.$patch"
    records "after v0.6.$patch"
done
git -C "$repo" tag -a v0.7.0-rc1 -m 'Not a release tag'
git -C "$repo" checkout -q -b side "${sha[v0.6.2]}"
records 'hotfix on a side branch'
side="$(git -C "$repo" rev-parse HEAD)"
release v0.6.20
git -C "$repo" checkout -q main
git -C "$repo" push -q origin main side --tags >/dev/null 2>&1

names() {
    cut -f1 | paste -sd' ' -
}

candidates() {
    production_read_origin "$repo" >/dev/null 2>&1 || fail_test 'origin could not be read'
    production_push_candidates "$repo" | names
}

on_production() {
    production_read_origin "$repo" >/dev/null 2>&1 || fail_test 'origin could not be read'
    production_tags_on_branch "$repo" | names
}

[[ "$(candidates)" == 'v0.6.9 v0.6.8 v0.6.7 v0.6.6 v0.6.5' ]] \
    || fail_test "with no production branch the menu offered '$(candidates)', not the five newest releases on main"
[[ -z "$(on_production)" ]] || fail_test 'a missing production branch listed releases on it'

production_push_flow "$repo" false <<< '1' > "$out" 2>&1 \
    || { cat "$out" >&2; fail_test 'the flow failed without a terminal'; }
grep -qF "git push origin ${sha[v0.6.9]}:refs/heads/production" "$out" \
    || fail_test 'without a terminal the flow did not print the exact push command'
[[ -z "$(git -C "$repo" ls-remote --heads origin refs/heads/production)" ]] \
    || fail_test 'the flow pushed without a terminal'

confirm() { return 0; }
production_push_flow "$repo" true <<< '5' > "$out" 2>&1 \
    || { cat "$out" >&2; fail_test 'confirmed push of v0.6.5 failed'; }
[[ "$(git -C "$repo" ls-remote --heads origin refs/heads/production | cut -f1)" == "${sha[v0.6.5]}" ]] \
    || fail_test 'a confirmed choice did not create production at that release'
grep -qF "origin's production is now v0.6.5" "$out" || fail_test 'the push was not reported after the live check'

production_push_flow "$repo" false <<< 'c' > "$out" 2>&1
grep -qF "production is at v0.6.5 (${sha[v0.6.5]:0:7})" "$out" || fail_test 'the flow did not show the production tip'
grep -qF "v0.6.5 (${sha[v0.6.5]:0:7})  ← tip" "$out" || fail_test 'the tip release is not marked'
[[ "$(on_production)" == 'v0.6.5 v0.6.4 v0.6.3 v0.6.2 v0.6.1' ]] \
    || fail_test "releases on production read '$(on_production)'"
[[ "$(candidates)" == 'v0.6.9 v0.6.8 v0.6.7 v0.6.6' ]] \
    || fail_test "after v0.6.5 the menu offered '$(candidates)'; releases on production must not appear"

production_push_flow "$repo" true <<< '04' > "$out" 2>&1 \
    || { cat "$out" >&2; fail_test 'confirmed push of v0.6.6 failed'; }
[[ "$(git -C "$repo" ls-remote --heads origin refs/heads/production | cut -f1)" == "${sha[v0.6.6]}" ]] \
    || fail_test 'choice 04 did not fast-forward production to v0.6.6'
[[ "$(on_production)" == 'v0.6.6 v0.6.5 v0.6.4 v0.6.3 v0.6.2' ]] \
    || fail_test "releases on production are not the five newest: '$(on_production)'"

if production_push_release "$repo" v0.6.3 "${sha[v0.6.3]}" true > "$out" 2>&1; then
    fail_test 'a push that is not a fast-forward reported success'
fi
[[ "$(git -C "$repo" ls-remote --heads origin refs/heads/production | cut -f1)" == "${sha[v0.6.6]}" ]] \
    || fail_test 'a push that is not a fast-forward moved production'
if grep -nE 'push[^|]*(--force|-f |\+[0-9a-z$"{]+:refs/heads/production)' \
    "$ROOT_DIR/release_manager/lib/production_push.sh"; then
    fail_test 'the production push can force'
fi

git -C "$repo" push -q --force origin "$side:refs/heads/production" >/dev/null 2>&1
[[ -z "$(candidates)" ]] \
    || fail_test "with production on a side branch the menu offered non-descendants: '$(candidates)'"
production_push_flow "$repo" true <<< '1' > "$out" 2>&1
grep -qF 'nothing to push' "$out" || fail_test 'an empty menu did not say there is nothing to push'
[[ "$(git -C "$repo" ls-remote --heads origin refs/heads/production | cut -f1)" == "$side" ]] \
    || fail_test 'an empty menu changed production'
grep -qF "production is at ${side:0:7}, which is not a release tag" "$out" \
    || fail_test 'a production tip without a release tag was not reported'

git -C "$repo" merge -q -s ours --no-ff -m 'merge the hotfix' "$side" >/dev/null
release v0.6.11
git -C "$repo" push -q origin main v0.6.11 >/dev/null 2>&1
[[ "$(candidates)" == 'v0.6.11' ]] \
    || fail_test "after merging the hotfix the menu offered '$(candidates)', not only the descendant v0.6.11"

git -C "$repo" config remote.origin.fetch '+refs/heads/missing:refs/remotes/origin/missing'
if production_push_flow "$repo" true <<< '1' > "$out" 2>&1; then
    fail_test 'the flow went on after the fetch failed'
fi
grep -qF 'releases on main' "$out" && fail_test 'a menu was shown from stale refs after the fetch failed'
grep -qF 'could not fetch from origin' "$out" || fail_test 'the fetch failure was not explained'
git -C "$repo" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'

git -C "$repo" remote set-url origin "$TEST_DIR/unreachable.git"
if production_push_flow "$repo" true <<< '1' > "$out" 2>&1; then
    fail_test 'the flow went on with origin unreachable'
fi
git -C "$repo" remote set-url origin "$origin"

printf 'PASS: the production push menu offers only newer fast-forward releases and never forces\n'
