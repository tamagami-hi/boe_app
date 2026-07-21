#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# repo_sync.sh — shared local-main ↔ remote-main comparison for release tooling.
#
# Sourced by export.sh and deploy.sh. The product rule it encodes:
#   • only local main is pushed to remote main
#   • remote main is the VPS deploy source
#   • a build may only SHIP to the VPS when the artifact's commit == origin/main
#
# All references are `set -u`-safe. Nothing here changes the repo.
# ─────────────────────────────────────────────────────────────────────────────

# repo_sync_eval <repo_dir>
#   Fetches origin (best-effort) and populates these globals (no printing):
#     RS_HAS_REMOTE   true|false      origin/main exists
#     RS_MAIN_WT      path            worktree checked out to main (for dirty check)
#     RS_LOCAL_SHA    short sha       refs/heads/main
#     RS_REMOTE_SHA   short sha       refs/remotes/origin/main
#     RS_LOCAL_FULL   full sha        refs/heads/main
#     RS_REMOTE_FULL  full sha        refs/remotes/origin/main
#     RS_AHEAD        int             commits local main has that remote lacks
#     RS_BEHIND       int             commits remote main has that local lacks
#     RS_DIRTY        int             uncommitted changes in the main worktree
#     RS_IDENTICAL    true|false      ahead==0 && behind==0
#     RS_CLEAN_SYNC   true|false      identical && dirty==0
#     RS_FETCHED      true|false      whether the origin fetch succeeded
repo_sync_eval() {
    local repo="${1:-$PWD}"
    local g=(git -C "$repo")

    RS_FETCHED=true
    "${g[@]}" fetch -q origin 2>/dev/null || RS_FETCHED=false

    RS_MAIN_WT="$("${g[@]}" worktree list --porcelain 2>/dev/null \
        | awk '/^worktree /{p=$2} /^branch refs\/heads\/main$/{print p; exit}')"
    [[ -n "${RS_MAIN_WT:-}" ]] || RS_MAIN_WT="$repo"

    RS_LOCAL_FULL="$("${g[@]}" rev-parse refs/heads/main 2>/dev/null || echo '')"
    RS_LOCAL_SHA="$("${g[@]}" rev-parse --short refs/heads/main 2>/dev/null || echo '?')"

    if "${g[@]}" rev-parse --verify --quiet refs/remotes/origin/main >/dev/null 2>&1; then
        RS_HAS_REMOTE=true
        RS_REMOTE_FULL="$("${g[@]}" rev-parse refs/remotes/origin/main 2>/dev/null || echo '')"
        RS_REMOTE_SHA="$("${g[@]}" rev-parse --short refs/remotes/origin/main 2>/dev/null || echo '?')"
        RS_AHEAD="$("${g[@]}" rev-list --count origin/main..main 2>/dev/null || echo 0)"
        RS_BEHIND="$("${g[@]}" rev-list --count main..origin/main 2>/dev/null || echo 0)"
    else
        RS_HAS_REMOTE=false; RS_REMOTE_FULL=''; RS_REMOTE_SHA='-'; RS_AHEAD=0; RS_BEHIND=0
    fi

    RS_DIRTY="$(git -C "$RS_MAIN_WT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

    if [[ "$RS_HAS_REMOTE" == true && "$RS_AHEAD" -eq 0 && "$RS_BEHIND" -eq 0 ]]; then
        RS_IDENTICAL=true; else RS_IDENTICAL=false; fi
    if [[ "$RS_IDENTICAL" == true && "$RS_DIRTY" -eq 0 ]]; then
        RS_CLEAN_SYNC=true; else RS_CLEAN_SYNC=false; fi
    return 0   # populates globals only; never leak a falsy status to `set -e` callers
}

# repo_sync_notice [indent] — prints a human notice from the RS_* globals.
repo_sync_notice() {
    local pad="${1:-   }"
    local b d g y r x
    b=$'\033[1m'; d=$'\033[2m'; g=$'\033[32m'; y=$'\033[33m'; r=$'\033[31m'; x=$'\033[0m'
    [[ -t 1 ]] || { b=''; d=''; g=''; y=''; r=''; x=''; }

    printf '%s%slocal main %s%s  ↔  remote main %s%s\n' "$pad" "$d" "$RS_LOCAL_SHA" "$x" "$RS_REMOTE_SHA" "$x"
    [[ "$RS_FETCHED" == true ]] || printf '%s%s! could not fetch origin — comparison may be stale%s\n' "$pad" "$y" "$x"

    if [[ "$RS_HAS_REMOTE" != true ]]; then
        printf '%s%s! origin/main not found — cannot compare%s\n' "$pad" "$y" "$x"; return 0
    fi
    if [[ "$RS_IDENTICAL" == true ]]; then
        if [[ "$RS_DIRTY" -eq 0 ]]; then
            printf '%s%s✓ in sync — local and remote main are identical%s\n' "$pad" "$g" "$x"
        else
            printf '%s%s✓ commits identical, but %s uncommitted change(s) in the main worktree%s\n' "$pad" "$y" "$RS_DIRTY" "$x"
        fi
    else
        [[ "$RS_AHEAD"  -gt 0 ]] && printf '%s%s↑ local is AHEAD of remote by %s commit(s) — push to remote main%s\n' "$pad" "$y" "$RS_AHEAD" "$x"
        [[ "$RS_BEHIND" -gt 0 ]] && printf '%s%s↓ local is BEHIND remote by %s commit(s) — pull/rebase from remote main%s\n' "$pad" "$r" "$RS_BEHIND" "$x"
        [[ "$RS_DIRTY"  -gt 0 ]] && printf '%s%s● %s uncommitted change(s) in the main worktree%s\n' "$pad" "$y" "$RS_DIRTY" "$x"
    fi
    return 0
}
