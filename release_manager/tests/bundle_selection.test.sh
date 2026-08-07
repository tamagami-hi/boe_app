#!/usr/bin/env bash
#
# Bundle selection ordering.
#
# Regression guard for a shipped defect: `deploy.sh` chose "the newest bundle"
# with `sort -V` over the whole directory name, which ranks a dirty prerelease
# above the clean tagged release of the same base version. The effect was that a
# tagged 0.8.3 release, built five minutes after a leftover
# 0.8.3-dev.0.gSHA.dirty export, was passed over — and because the dirty bundle
# carried no apk/ directory, the release's APKs were never published.
#
# The trailing UTC build stamp is the ordering key. These tests pin that, and pin
# that a prerelease no longer outranks its release.

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
build="$TEST_DIR/dev_release"
mkdir -p "$build"

mk() { mkdir -p "$build/$1"; }

# The exact situation observed: a dirty prerelease built at 10:42 and the clean
# tagged release of the same version built at 10:47.
mk '0.8.2-20260806T132829Z'
mk '0.8.3-dev.0.g298a141.dirty-20260807T104213Z'
mk '0.8.3-20260807T104736Z'

newest="$(bundle_dir_newest "$build")"
[[ "$newest" == '0.8.3-20260807T104736Z' ]] \
    || fail_test "newest bundle should be the clean tagged 0.8.3, got '$newest'"

# sort -V must be demonstrably wrong here, or this test proves nothing.
legacy="$(find "$build" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -n1)"
[[ "$legacy" == '0.8.3-dev.0.g298a141.dirty-20260807T104213Z' ]] \
    || fail_test "expected sort -V to mis-rank the prerelease, got '$legacy'"

# Oldest-first ordering is what retention prunes by, so the clean release must
# never be the prune candidate while an older dirty bundle survives.
mapfile -t ordered < <(bundle_dirs_oldest_first "$build")
[[ "${ordered[0]}" == '0.8.2-20260806T132829Z' ]] \
    || fail_test "oldest bundle should be 0.8.2, got '${ordered[0]}'"
[[ "${ordered[1]}" == '0.8.3-dev.0.g298a141.dirty-20260807T104213Z' ]] \
    || fail_test "the dirty 0.8.3 was built before the clean one, got '${ordered[1]}'"
[[ "${ordered[2]}" == '0.8.3-20260807T104736Z' ]] \
    || fail_test "newest should sort last, got '${ordered[2]}'"
(( ${#ordered[@]} == 3 )) || fail_test "expected 3 bundles, listed ${#ordered[@]}"

# Build order wins across differing base versions too: a later 0.9.0 outranks an
# earlier 0.10.0, because "newest" means most recently built, not highest version.
rm -rf "$build"; mkdir -p "$build"
mk '0.10.0-20260101T000000Z'
mk '0.9.0-20260202T000000Z'
newest="$(bundle_dir_newest "$build")"
[[ "$newest" == '0.9.0-20260202T000000Z' ]] \
    || fail_test "newest must be by build stamp, got '$newest'"

# A directory with no recognisable stamp must never mask a real bundle.
rm -rf "$build"; mkdir -p "$build"
mk 'scratch'
mk '0.8.3-20260807T104736Z'
newest="$(bundle_dir_newest "$build")"
[[ "$newest" == '0.8.3-20260807T104736Z' ]] \
    || fail_test "an unstamped directory outranked a real bundle: '$newest'"

# Absent or empty build directories yield nothing rather than erroring, so
# deploy.sh can print its own "no bundle staged" guidance.
rm -rf "$build"; mkdir -p "$build"
[[ -z "$(bundle_dir_newest "$build")" ]] || fail_test 'empty build dir should yield no bundle'
[[ -z "$(bundle_dir_newest "$TEST_DIR/does-not-exist")" ]] \
    || fail_test 'missing build dir should yield no bundle'
[[ -z "$(bundle_path_newest "$TEST_DIR/does-not-exist")" ]] \
    || fail_test 'missing build dir should yield no path'

# bundle_path_newest returns a usable absolute path.
mk '0.8.4-20260808T010203Z'
path="$(bundle_path_newest "$build")"
[[ -d "$path" && "$path" == "$build/0.8.4-20260808T010203Z" ]] \
    || fail_test "bundle_path_newest returned '$path'"

printf 'PASS: bundle selection orders by build stamp, not version sort\n'
