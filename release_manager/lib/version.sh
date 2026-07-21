#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# version.sh — shared semver helpers for the release tooling.
#
# Sourced by status.sh (which CUTS releases: bump → commit → tag → push) and
# export.sh (which only READS the canonical version to label a build). Keeping
# the bump/semver math in one place means the two scripts can never disagree on
# what "the next version" is.
#
# All functions are pure (no repo mutation). The ones that need git take the
# repo dir as an argument. `set -u`-safe throughout.
# ─────────────────────────────────────────────────────────────────────────────

# read_json_version <file> — echo .version from a JSON file, or 0.0.0.
read_json_version() {
    local file="$1"
    if [[ -f "$file" ]]; then
        jq -r '.version // "0.0.0"' "$file" 2>/dev/null || printf '0.0.0\n'
    else
        printf '0.0.0\n'
    fi
}

# assert_semver <version> — exit non-zero unless version is bare X.Y.Z.
assert_semver() {
    local version="$1"
    if [[ ! "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
        printf 'Version must be numeric X.Y.Z, got: %s\n' "$version" >&2
        return 1
    fi
}

# bump_version <version> <patch|minor|major> — echo the bumped X.Y.Z.
bump_version() {
    local version="$1" bump="$2" major minor patch
    assert_semver "$version" || return 1
    IFS=. read -r major minor patch <<<"$version"
    major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-0}"
    case "$bump" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch|"") patch=$((patch + 1)) ;;
        *) printf 'Unsupported bump: %s\n' "$bump" >&2; return 1 ;;
    esac
    printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

# canonical_version <version_file> <active_dir> <repo>
#   The current STABLE version, in priority order:
#     tracked VERSION file → BOE_APP/current-version.json → latest git tag → 0.0.0
canonical_version() {
    local version_file="$1" active_dir="$2" repo="$3" t
    if [[ -s "$version_file" ]]; then
        tr -d '[:space:]' < "$version_file"
    elif [[ -f "$active_dir/current-version.json" ]]; then
        read_json_version "$active_dir/current-version.json"
    else
        t="$(git -C "$repo" describe --tags --abbrev=0 2>/dev/null || true)"
        [[ -n "$t" ]] && printf '%s\n' "${t#v}" || printf '0.0.0\n'
    fi
}

# dev_version <base> <repo>
#   A pre-release label for local-only builds, auto-derived from git so every
#   build is traceable and monotonic without a manual counter:
#     <base>-dev.<commits-since-last-tag>.g<shortsha>[.dirty]
#   Dots (not '+') keep it a valid Docker tag. These never get tagged/pushed
#   and are refused by deploy.sh's ship gate (anything with a '-' is dev).
dev_version() {
    local base="$1" repo="$2" last_tag n sha dirty=""
    last_tag="$(git -C "$repo" describe --tags --abbrev=0 2>/dev/null || true)"
    if [[ -n "$last_tag" ]]; then
        n="$(git -C "$repo" rev-list --count "${last_tag}..HEAD" 2>/dev/null || echo 0)"
    else
        n="$(git -C "$repo" rev-list --count HEAD 2>/dev/null || echo 0)"
    fi
    sha="$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo nogit)"
    [[ -n "$(git -C "$repo" status --porcelain 2>/dev/null)" ]] && dirty=".dirty"
    printf '%s-dev.%s.g%s%s\n' "$base" "$n" "$sha" "$dirty"
}

# on_exact_release_tag <repo> <version> — true if the tree is clean AND HEAD is
# exactly the v<version> tag. This is the condition that lets export.sh stamp a
# STABLE artifact: the build came from the release commit status.sh cut, not from
# in-flight work. deploy.sh independently re-verifies git_sha == origin/main.
on_exact_release_tag() {
    local repo="$1" version="$2" exact
    [[ -z "$(git -C "$repo" status --porcelain 2>/dev/null)" ]] || return 1
    exact="$(git -C "$repo" describe --exact-match --tags HEAD 2>/dev/null || true)"
    [[ "$exact" == "v$version" ]]
}
