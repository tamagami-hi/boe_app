#!/usr/bin/env bash

production_release_gate() {
    local repo="$1" version="$2" status head tagged
    status="$(git -C "$repo" status --porcelain 2>/dev/null)" || return 1
    [[ -z "$status" ]] || return 1
    head="$(git -C "$repo" rev-parse --verify -q HEAD 2>/dev/null)" || return 1
    tagged="$(git -C "$repo" rev-parse --verify -q "refs/tags/v$version^{commit}" 2>/dev/null)" || return 1
    [[ "$head" == "$tagged" ]] || return 1
    remote_release_tag_matches "$repo" "$version" "$head"
}

production_parse_tags() {
    awk '
        {
            ref = $2
            peeled = 0
            if (substr(ref, length(ref) - 2) == "^{}") {
                peeled = 1
                ref = substr(ref, 1, length(ref) - 3)
            }
            if (substr(ref, 1, 10) != "refs/tags/") next
            name = substr(ref, 11)
            if (name !~ /^v[0-9]+[.][0-9]+[.][0-9]+$/) next
            if (peeled) p[name] = $1
            else d[name] = $1
        }
        END { for (n in d) printf "%s\t%s\n", n, ((n in p) ? p[n] : d[n]) }
    ' | LC_ALL=C sort -t$'\t' -k1,1Vr
}

production_origin_refs() {
    local repo="$1" refs
    PO_MAIN=""
    PO_PRODUCTION=""
    PO_TAGS=""
    refs="$(GIT_TERMINAL_PROMPT=0 git -C "$repo" ls-remote origin \
        refs/heads/main refs/heads/production 'refs/tags/v*' 2>/dev/null)" || return 1
    PO_MAIN="$(awk '$2 == "refs/heads/main" { print $1; exit }' <<< "$refs")"
    PO_PRODUCTION="$(awk '$2 == "refs/heads/production" { print $1; exit }' <<< "$refs")"
    PO_TAGS="$(production_parse_tags <<< "$refs")"
}

production_tag_at() {
    local commit="$1"
    [[ -n "$commit" ]] || return 0
    awk -F'\t' -v sha="$commit" '$2 == sha { print $1; exit }' <<< "$PO_TAGS"
}

production_release_refs() {
    local repo="$1" version="$2" refs direct peeled
    PR_PRODUCTION=""
    PR_TAG=""
    refs="$(GIT_TERMINAL_PROMPT=0 git -C "$repo" ls-remote origin refs/heads/production \
        "refs/tags/v$version" "refs/tags/v$version^{}" 2>/dev/null)" || return 1
    PR_PRODUCTION="$(awk '$2 == "refs/heads/production" { print $1; exit }' <<< "$refs")"
    direct="$(awk -v ref="refs/tags/v$version" '$2 == ref { print $1; exit }' <<< "$refs")"
    peeled="$(awk -v ref="refs/tags/v$version^{}" '$2 == ref { print $1; exit }' <<< "$refs")"
    PR_TAG="${peeled:-$direct}"
}

production_release_matches() {
    local repo="$1" version="$2" commit="$3"
    [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || return 1
    production_release_refs "$repo" "$version" || return 1
    [[ "$PR_PRODUCTION" == "$commit" && "$PR_TAG" == "$commit" ]]
}

manifest_git_dirty() {
    jq -r 'if has("git_dirty") | not then "missing"
           elif .git_dirty == false then "false"
           elif .git_dirty == true then "true"
           else "invalid" end' "$1" 2>/dev/null || printf 'invalid\n'
}

production_deploy_gate() {
    local repo="$1" version="$2" commit="$3" dirty="$4"
    if [[ "$version" == *-* ]] || ! assert_semver "$version" 2>/dev/null; then
        err "refusing to ship a development build to production: $version"
        err "cut a stable release first: ./release_manager/status.sh"
        return 1
    fi
    if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
        err "bundle manifest has no valid git_sha (${commit:-missing}) — refusing to ship to production"
        return 1
    fi
    if [[ "$dirty" != false ]]; then
        err "bundle git_dirty is ${dirty:-missing}; only a manifest with git_dirty: false ships to production"
        return 1
    fi
    if ! production_release_refs "$repo" "$version"; then
        err "could not read origin's production branch and v$version tag — refusing production deployment"
        return 1
    fi
    if [[ -z "$PR_PRODUCTION" ]]; then
        err "origin has no production branch; push v$version first: status.sh → Git → Push a release to production"
        return 1
    fi
    if [[ "$PR_PRODUCTION" != "$commit" ]]; then
        err "bundle commit ${commit:0:9} is not origin's production tip ${PR_PRODUCTION:0:9}"
        err "push v$version to production first, or export again: ./release_manager/export.sh --prod"
        return 1
    fi
    if [[ "$PR_TAG" != "$commit" ]]; then
        err "origin's v$version is missing or does not resolve to bundle commit ${commit:0:9}"
        return 1
    fi
}
