#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/release_manager/lib/ui.sh"
source "$ROOT_DIR/release_manager/lib/version.sh"
source "$ROOT_DIR/release_manager/lib/production_gate.sh"
source "$ROOT_DIR/release_manager/lib/prod_export.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
origin="$TEST_DIR/origin.git"
repo="$TEST_DIR/operator checkout"
other="$TEST_DIR/other"
dest="$repo/release_manager/build/prod_release"
log="$TEST_DIR/export.log"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone "$origin" "$repo" >/dev/null 2>&1
git -C "$repo" config user.name 'Release Test'
git -C "$repo" config user.email 'release-test@example.invalid'

mkdir -p "$repo/release_manager"
printf 'build/\n.temp/\n' > "$repo/.gitignore"
printf '0.6.5\n' > "$repo/VERSION"
cat > "$repo/release_manager/export.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$*" == '--prod --production-worktree' ]] || exit 90
bundle="$root/release_manager/build/prod_release/0.6.5-20260101T000000Z"
mkdir -p "$bundle"
case "${STUB_EXPORT:-}" in
    fail) exit 7 ;;
    stable|dev)
        jq -n --arg kind "$STUB_EXPORT" --arg sha "$(git -C "$root" rev-parse HEAD)" \
            '{stack: "prod_release", kind: $kind, version: "0.6.5", git_sha: $sha, git_dirty: false}' \
            > "$bundle/manifest.json" ;;
    *) exit 91 ;;
esac
STUB
git -C "$repo" add .gitignore VERSION release_manager/export.sh
git -C "$repo" commit -qm 'chore(release): v0.6.5'
git -C "$repo" tag -a v0.6.5 -m 'Release v0.6.5'
release="$(git -C "$repo" rev-parse HEAD)"
printf '{"records":1}\n' > "$repo/records.json"
git -C "$repo" add records.json
git -C "$repo" commit -qm 'records: 1 record file'
records="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" push -q origin main v0.6.5 >/dev/null 2>&1
git clone "$origin" "$other" >/dev/null 2>&1

printf 'work in progress\n' >> "$repo/VERSION"
: > "$repo/scratch.txt"

worktree_count() {
    git -C "$repo" worktree list --porcelain | grep -c '^worktree '
}

assert_no_leftovers() {
    [[ "$(worktree_count)" == 1 ]] || fail_test "$1: a temporary worktree is still registered"
    [[ ! -e "$(prod_export_worktree_parent "$repo")" ]] \
        || fail_test "$1: the temporary worktree directory was left behind"
    [[ -z "$(ls -A "$dest" 2>/dev/null)" ]] || fail_test "$1: a bundle was staged"
}

export_refused() {
    local label="$1"
    if STUB_EXPORT=stable prod_export_from_production "$repo" "$dest" 3 false > "$log" 2>&1; then
        fail_test "an export ran when $label"
    fi
    assert_no_leftovers "$label"
}

set_production() {
    git -C "$other" push -q --force origin "$1:refs/heads/production" >/dev/null 2>&1
}

export_refused 'origin has no production branch'
grep -qF 'origin has no production branch yet' "$log" || fail_test 'the missing production branch was not named'
grep -qF 'Push a release to production' "$log" || fail_test 'the missing-production refusal does not point at the push menu'

set_production "$records"
export_refused 'the production tip is not a release tag'
grep -qF 'is not exactly a release tag' "$log" || fail_test 'the untagged-tip refusal does not say so'

set_production "$release"
if STUB_EXPORT=fail prod_export_from_production "$repo" "$dest" 3 false > "$log" 2>&1; then
    fail_test 'a failed export at the production tip reported success'
fi
assert_no_leftovers 'failed export'

if STUB_EXPORT=dev prod_export_from_production "$repo" "$dest" 3 false > "$log" 2>&1; then
    fail_test 'a dev-labelled bundle was accepted as the production export'
fi
assert_no_leftovers 'dev-labelled export'

STUB_EXPORT=stable prod_export_from_production "$repo" "$dest" 3 false > "$log" 2>&1 \
    || { cat "$log" >&2; fail_test 'a stable export of the production tip failed while main is ahead and this checkout is dirty'; }
[[ "$(worktree_count)" == 1 && ! -e "$(prod_export_worktree_parent "$repo")" ]] \
    || fail_test 'a successful export left its worktree behind'
staged="$dest/0.6.5-20260101T000000Z"
[[ "$(jq -r .git_sha "$staged/manifest.json" 2>/dev/null)" == "$release" ]] \
    || fail_test 'the staged bundle does not record the production tip'
[[ "$(ls -A "$dest")" == "0.6.5-20260101T000000Z" ]] || fail_test 'staging left extra entries in the build directory'
grep -qF 'work in progress' "$repo/VERSION" || fail_test 'the export touched the operator checkout'
rm -rf "$staged"

git -C "$repo" tag -f -a v0.6.5 -m 'Stale local tag' "$records" >/dev/null
export_refused 'the local tag names another commit'
grep -qF 'the local tag v0.6.5 names' "$log" || fail_test 'the stale local tag was not named'
git -C "$repo" tag -d v0.6.5 >/dev/null
git -C "$repo" fetch -q origin tag v0.6.5 >/dev/null 2>&1

git -C "$other" push -q --force origin "$records:refs/tags/v0.6.5" >/dev/null 2>&1
export_refused "origin's tag points away from the production tip"
git -C "$repo" push -q --force origin v0.6.5 >/dev/null 2>&1

git -C "$other" checkout -q --detach "$release"
git -C "$other" commit -q --allow-empty -m 'tagged without a VERSION bump'
git -C "$other" tag -a v0.6.6 -m 'Release v0.6.6'
git -C "$other" push -q origin v0.6.6 >/dev/null 2>&1
set_production "$(git -C "$other" rev-parse HEAD)"
export_refused 'VERSION at the tag does not match it'
grep -qF 'VERSION at v0.6.6 is not 0.6.6' "$log" || fail_test 'the VERSION mismatch was not named'

export BOE_PROD_EXPORT_CHILD=1
[[ "$(prod_export_mode "$repo" false 2>/dev/null)" == parent ]] \
    || fail_test 'an inherited BOE_PROD_EXPORT_CHILD switched --prod away from the worktree build'
if prod_export_mode "$repo" true >/dev/null 2>&1; then
    fail_test 'the worktree build step ran outside .temp/prod-export/'
fi
inside="$repo/.temp/prod-export/v0.6.5.test"
git -C "$repo" worktree add -q --detach "$inside" v0.6.5 >/dev/null 2>&1
[[ "$(prod_export_mode "$inside" true 2>/dev/null)" == child ]] \
    || fail_test 'the worktree build step was refused inside its own detached worktree'
git -C "$inside" checkout -q -b not-detached
if prod_export_mode "$inside" true >/dev/null 2>&1; then
    fail_test 'the worktree build step ran on a branch checkout'
fi
git -C "$repo" worktree remove --force "$inside"
git -C "$repo" branch -q -D not-detached

if real_out="$(bash "$ROOT_DIR/release_manager/export.sh" --prod --production-worktree 2>&1)"; then
    fail_test 'export.sh --production-worktree built outside .temp/prod-export/'
fi
grep -qF 'runs only inside .temp/prod-export/' <<< "$real_out" \
    || fail_test 'export.sh did not refuse the worktree step outside .temp/prod-export/'
if bash "$ROOT_DIR/release_manager/export.sh" --dev --production-worktree >/dev/null 2>&1; then
    fail_test 'export.sh accepted --production-worktree for a development export'
fi
unset BOE_PROD_EXPORT_CHILD
if grep -q 'BOE_PROD_EXPORT_CHILD' "$ROOT_DIR/release_manager/export.sh" "$ROOT_DIR/release_manager/lib/prod_export.sh"; then
    fail_test 'the production export still reads BOE_PROD_EXPORT_CHILD'
fi

printf 'PASS: production exports build origin production tip in a temporary worktree and never leave it behind\n'
