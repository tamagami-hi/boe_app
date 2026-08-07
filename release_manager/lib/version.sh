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

# release_origin_is_approved <repo>
#   Require exactly one fetch URL and one push URL, both pointing at the
#   canonical BeOnEdge repository. Multiple push URLs would make one push write
#   to every configured destination, so cardinality is part of the check.
release_origin_is_approved() {
    local repo="$1" origin_url
    local -a fetch_urls=() push_urls=()
    mapfile -t fetch_urls < <(git -C "$repo" remote get-url --all origin 2>/dev/null)
    mapfile -t push_urls < <(git -C "$repo" remote get-url --push --all origin 2>/dev/null)
    [[ "${#fetch_urls[@]}" -eq 1 && "${#push_urls[@]}" -eq 1 ]] || return 1
    for origin_url in "${fetch_urls[0]}" "${push_urls[0]}"; do
        case "$origin_url" in
            https://github.com/tamagami-hi/boe_app.git|git@github.com:tamagami-hi/boe_app.git) : ;;
            *) return 1 ;;
        esac
    done
}

# bump_version <version> <patch|minor|major> — echo the bumped X.Y.Z.
bump_version() {
    local version="$1" bump="$2" major minor patch
    assert_semver "$version" || return 1
    IFS=. read -r major minor patch <<<"$version"
    major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-0}"
    # 10# forces decimal: a component with a leading zero (0.7.09) is not octal.
    case "$bump" in
        major) major=$((10#$major + 1)); minor=0; patch=0 ;;
        minor) minor=$((10#$minor + 1)); patch=0 ;;
        patch|"") patch=$((10#$patch + 1)) ;;
        *) printf 'Unsupported bump: %s\n' "$bump" >&2; return 1 ;;
    esac
    printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

# canonical_version <version_file> <fallback_dir> <repo>
#   The current STABLE version, in priority order:
#     tracked VERSION file → <fallback_dir>/current-version.json → latest git tag → 0.0.0
#
#   <fallback_dir> is caller-supplied so this works for any stack. The new
#   pipeline passes a per-stack build directory (release_manager/build/<stack>);
#   the old single-stack pipeline passed release_manager/BOE_APP. In practice the
#   tracked VERSION file almost always wins, and the fallback only matters on a
#   fresh clone with no tags.
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

# remote_release_tag_matches <repo> <version> [expected-commit]
#   True only when origin has v<version> and that tag resolves to the expected
#   commit. Annotated and lightweight tags are both supported. Transport errors
#   fail closed, which prevents a local-only tag from becoming a stable bundle.
remote_release_tag_matches() {
    local repo="$1" version="$2" expected="${3:-}" refs direct peeled target
    [[ -n "$expected" ]] || expected="$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)"
    [[ "$expected" =~ ^[0-9a-f]{40}$ ]] || return 1
    refs="$(git -C "$repo" ls-remote --tags origin \
        "refs/tags/v$version" "refs/tags/v$version^{}" 2>/dev/null)" || return 1
    direct="$(awk -v ref="refs/tags/v$version" '$2 == ref { print $1; exit }' <<< "$refs")"
    peeled="$(awk -v ref="refs/tags/v$version^{}" '$2 == ref { print $1; exit }' <<< "$refs")"
    target="${peeled:-$direct}"
    [[ "$target" == "$expected" ]]
}

# remote_release_refs_match <repo> <version> <expected-commit>
#   Resolve live origin/main and the release tag in one ls-remote snapshot and
#   require both to identify the same expected commit.
remote_release_refs_match() {
    local repo="$1" version="$2" expected="$3" refs branch direct peeled target
    [[ "$expected" =~ ^[0-9a-f]{40}$ ]] || return 1
    refs="$(git -C "$repo" ls-remote origin \
        refs/heads/main "refs/tags/v$version" "refs/tags/v$version^{}" 2>/dev/null)" \
        || return 1
    branch="$(awk '$2 == "refs/heads/main" { print $1; exit }' <<< "$refs")"
    direct="$(awk -v ref="refs/tags/v$version" '$2 == ref { print $1; exit }' <<< "$refs")"
    peeled="$(awk -v ref="refs/tags/v$version^{}" '$2 == ref { print $1; exit }' <<< "$refs")"
    target="${peeled:-$direct}"
    [[ "$branch" == "$expected" && "$target" == "$expected" ]]
}


# ── bundle directory ordering ────────────────────────────────────────────────
#
# Staged bundle directories are named "<version>-<YYYYmmddTHHMMSSZ>", and
# "the newest bundle" means the most recently built one.
#
# `sort -V` over the whole directory name gets that wrong as soon as a
# prerelease and its release share a base version. Version sort compares the
# text after the shared "0.8.3-" prefix, where letters outrank digits, so:
#
#   0.8.3-20260807T104736Z                        <- clean, tagged, built 10:47
#   0.8.3-dev.0.g298a141.dirty-20260807T104213Z   <- dirty, built 10:42  ← "newest"
#
# The dirty prerelease wins, which is also backwards from semver precedence (a
# prerelease precedes its release). Observed consequence: `deploy.sh --dev`
# selected the older dirty bundle over the clean tagged release built five
# minutes later, and because that bundle carried no `apk/` directory it
# published no APKs at all — the release's APKs silently never shipped.
#
# The trailing UTC stamp is the authoritative build order and, being ISO-8601
# basic format, sorts correctly as plain text. It is therefore the sort key.
# A directory without a recognisable stamp sorts first, so a malformed name can
# never outrank a real bundle; the name is the tie-breaker so ordering is total
# and stable.

# bundle_dirs_oldest_first <build_dir> — bundle directory NAMES, oldest first.
bundle_dirs_oldest_first() {
    local dir="$1"
    [[ -d "$dir" ]] || return 0
    find "$dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null \
        | awk '{
              n = split($0, part, "-")
              stamp = (part[n] ~ /^[0-9]{8}T[0-9]{6}Z$/) ? part[n] : ""
              printf "%s\t%s\n", stamp, $0
          }' \
        | LC_ALL=C sort -t$'\t' -k1,1 -k2,2 \
        | cut -f2-
}

# bundle_dir_newest <build_dir> — name of the most recently built bundle, if any.
bundle_dir_newest() {
    bundle_dirs_oldest_first "$1" | tail -n1
}

# bundle_path_newest <build_dir> — absolute path of the newest bundle, if any.
bundle_path_newest() {
    local dir="$1" name
    name="$(bundle_dir_newest "$dir")"
    [[ -n "$name" ]] || return 0
    printf '%s/%s\n' "$dir" "$name"
}
