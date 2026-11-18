#!/usr/bin/env bash

PRODUCTION_MENU_SIZE=5

production_on_branch() {
    local repo="$1" commit="$2" tip="$3"
    [[ -n "$tip" ]] || return 1
    git -C "$repo" merge-base --is-ancestor "$commit" "$tip" 2>/dev/null
}

production_read_origin() {
    local repo="$1" output sha
    if ! output="$(GIT_TERMINAL_PROMPT=0 git -C "$repo" fetch -q --no-tags origin 2>&1)"; then
        err "could not fetch from origin, so no release list is shown from stale refs:"
        err "  $(tail -n1 <<< "$output" | LC_ALL=C tr -d '\000-\010\013-\037\177')"
        return 1
    fi
    if ! production_origin_refs "$repo"; then
        err "could not read origin's branches and tags (git ls-remote failed)"
        return 1
    fi
    [[ -n "$PO_MAIN" ]] || { err "origin has no main branch"; return 1; }
    for sha in "$PO_MAIN" ${PO_PRODUCTION:+"$PO_PRODUCTION"}; do
        git -C "$repo" cat-file -e "$sha^{commit}" 2>/dev/null \
            || { err "origin moved while it was being read; try again"; return 1; }
    done
}

production_tags_on_branch() {
    local repo="$1" tag sha shown=0
    [[ -n "$PO_PRODUCTION" ]] || return 0
    while IFS=$'\t' read -r tag sha; do
        [[ -n "$tag" ]] || continue
        production_on_branch "$repo" "$sha" "$PO_PRODUCTION" || continue
        printf '%s\t%s\n' "$tag" "$sha"
        shown=$((shown + 1))
        (( shown < PRODUCTION_MENU_SIZE )) || break
    done <<< "$PO_TAGS"
}

production_push_candidates() {
    local repo="$1" tag sha shown=0
    while IFS=$'\t' read -r tag sha; do
        [[ -n "$tag" ]] || continue
        git -C "$repo" merge-base --is-ancestor "$sha" "$PO_MAIN" 2>/dev/null || continue
        if [[ -n "$PO_PRODUCTION" ]]; then
            production_on_branch "$repo" "$sha" "$PO_PRODUCTION" && continue
            git -C "$repo" merge-base --is-ancestor "$PO_PRODUCTION" "$sha" 2>/dev/null || continue
        fi
        printf '%s\t%s\n' "$tag" "$sha"
        shown=$((shown + 1))
        (( shown < PRODUCTION_MENU_SIZE )) || break
    done <<< "$PO_TAGS"
}

production_show() {
    local repo="$1" tip_tag tag sha mark
    if [[ -z "$PO_PRODUCTION" ]]; then
        warn "production does not exist yet on origin; the release you choose creates it"
        return 0
    fi
    tip_tag="$(production_tag_at "$PO_PRODUCTION")"
    if [[ -n "$tip_tag" ]]; then
        ok "production is at $tip_tag (${PO_PRODUCTION:0:7})"
    else
        warn "production is at ${PO_PRODUCTION:0:7}, which is not a release tag"
    fi
    info "newest releases on production:"
    while IFS=$'\t' read -r tag sha; do
        [[ -n "$tag" ]] || continue
        mark=""
        [[ "$sha" == "$PO_PRODUCTION" ]] && mark="  ← tip"
        printf '     %s (%s)%s\n' "$tag" "${sha:0:7}" "$mark"
    done < <(production_tags_on_branch "$repo")
}

production_push_command() {
    printf 'git push origin %s:refs/heads/production\n' "$1"
}

production_push_release() {
    local repo="$1" tag="$2" sha="$3" ask="$4" live
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { err "not a commit id: $sha"; return 1; }
    printf '\n'
    if [[ "$ask" != true ]] || ! confirm "Push $tag (${sha:0:7}) onto production?"; then
        info "production was not changed. To push $tag yourself, run:"
        info "  $(production_push_command "$sha")"
        return 0
    fi
    if ! GIT_TERMINAL_PROMPT=0 git -C "$repo" push origin "$sha:refs/heads/production"; then
        err "the push failed or was refused; production is unchanged"
        return 1
    fi
    live="$(GIT_TERMINAL_PROMPT=0 git -C "$repo" ls-remote --heads origin refs/heads/production 2>/dev/null \
        | awk '$2 == "refs/heads/production" { print $1; exit }')"
    if [[ "$live" != "$sha" ]]; then
        err "origin's production reads ${live:-nothing}, not ${sha:0:7}; check it before exporting"
        return 1
    fi
    ok "origin's production is now $tag (${sha:0:7})"
    info "next: ./release_manager/export.sh --prod"
}

production_push_flow() {
    local repo="$1" ask="$2" choice line n=0
    local -a candidates=()
    section "PUSH A RELEASE TO PRODUCTION" "production exports build only from origin's production branch"
    production_read_origin "$repo" || return 1
    production_show "$repo"
    mapfile -t candidates < <(production_push_candidates "$repo")
    if (( ${#candidates[@]} == 0 )); then
        info "no release tag on origin's main is newer than production; nothing to push"
        return 0
    fi
    printf '\n   releases on main, not yet on production:\n'
    for line in "${candidates[@]}"; do
        n=$((n + 1))
        printf '   %d) %s (%s)\n' "$n" "${line%%$'\t'*}" "$(cut -c1-7 <<< "${line##*$'\t'}")"
    done
    printf '   c) cancel\n'
    printf '\n%s   ➜ release to push [1-%d]: %s' "$c_bold" "$n" "$c_rst"
    read -r choice || choice=""
    if [[ ! "$choice" =~ ^[0-9]+$ ]] || (( 10#$choice < 1 || 10#$choice > n )); then
        warn "cancelled; production is unchanged"
        return 0
    fi
    line="${candidates[$((10#$choice - 1))]}"
    production_push_release "$repo" "${line%%$'\t'*}" "${line##*$'\t'}" "$ask"
}
