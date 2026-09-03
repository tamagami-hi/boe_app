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
#     RS_STATUS_OK    true|false      whether main-worktree status was readable
#     RS_IDENTICAL    true|false      ahead==0 && behind==0
#     RS_CLEAN_SYNC   true|false      identical && dirty==0
#     RS_FETCHED      true|false      whether the origin fetch succeeded
repo_sync_eval() {
    local repo="${1:-$PWD}" line worktree_path status_output
    local g=(git -C "$repo")

    RS_FETCHED=true
    # Never prompt for credentials mid-dashboard: fail the fetch instead.
    GIT_TERMINAL_PROMPT=0 "${g[@]}" fetch -q origin 2>/dev/null || RS_FETCHED=false

    RS_MAIN_WT=""
    worktree_path=""
    while IFS= read -r line; do
        case "$line" in
            worktree\ *) worktree_path="${line#worktree }" ;;
            'branch refs/heads/main') RS_MAIN_WT="$worktree_path"; break ;;
        esac
    done < <("${g[@]}" worktree list --porcelain 2>/dev/null)
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

    RS_STATUS_OK=true
    if status_output="$(git -C "$RS_MAIN_WT" status --porcelain 2>/dev/null)"; then
        RS_DIRTY="$(printf '%s\n' "$status_output" | sed '/^$/d' | wc -l | tr -d ' ')"
    else
        RS_STATUS_OK=false
        RS_DIRTY=1
    fi

    if [[ "$RS_HAS_REMOTE" == true && "$RS_AHEAD" -eq 0 && "$RS_BEHIND" -eq 0 ]]; then
        RS_IDENTICAL=true; else RS_IDENTICAL=false; fi
    if [[ "$RS_IDENTICAL" == true && "$RS_STATUS_OK" == true && "$RS_DIRTY" -eq 0 ]]; then
        RS_CLEAN_SYNC=true; else RS_CLEAN_SYNC=false; fi
    return 0   # populates globals only; never leak a falsy status to `set -e` callers
}

