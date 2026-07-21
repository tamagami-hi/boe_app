#!/usr/bin/env bash

# BeOnEdge release & collaboration console — run from anywhere inside the repo.
#
# The dashboard is organised into four sections, always shown in this order:
#
#   1. MAIN — REMOTE   origin/main: the canonical version that deploys to the VPS.
#   2. MAIN — LOCAL    where you INTEGRATE contributor work into your local main,
#                      test on your local deployment, then push → remote main.
#                      (only local main is ever pushed to remote main.)
#   3. CONTRIBUTORS    open PRs into main — review + APPROVE them here.
#   4. OTHERS          worktree surfaces, local release/build, live VPS version.
#
# The DEFAULT run is report-only: it shows status + next steps and changes
# nothing. Sections 1–4 are STATUS-ONLY; every action is consolidated into the
# trailing "DO THIS NEXT" pipeline, run in dependency order: commit surface work
# (with a message prompt) → sync surfaces → merge contributor work → integrate
# surfaces into local main → sync local↔remote main → cut release → build →
# deploy → ship. Pass --interactive (on a terminal) to be prompted y/N before
# each step; §3 still prompts to approve PRs. Without --interactive, or when
# piped / --read-only, the equivalent commands are printed instead of run.
#
# Flags (default = --all):
#   --main            sections 1 + 2 (remote + local main).
#   --contributors    section 3 (PR review/approval).  alias: --prs
#   --others [pem]    section 4 (surfaces + release + VPS version).
#   --git             only the worktree-surfaces part of OTHERS.
#   --local           only the local-release part of OTHERS.
#   --vps <pem>       live VPS-deployed version (needs the SSH .pem key path).
#   --read-only       never prompt / never change anything (report-only).
#   --all [pem]       everything, in order (the default).
#
# Examples:
#   ./release_manager/status.sh
#   ./release_manager/status.sh --main
#   ./release_manager/status.sh --contributors
#   ./release_manager/status.sh --all resources/credentials/cli_app.pem
#   ./release_manager/status.sh --main --read-only

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$ROOT" ]] || { echo "Not inside a git repo." >&2; exit 1; }
# Anchor to the main worktree (the one holding release_manager/ + the main branch).
MAIN_WORKTREE="$(git worktree list --porcelain | awk '/^worktree /{p=$2} /^branch refs\/heads\/main$/{print p; exit}')"
[[ -n "$MAIN_WORKTREE" ]] || MAIN_WORKTREE="$ROOT"
RM="$MAIN_WORKTREE/release_manager"

# Shared release-tooling libraries (resolved from THIS script's location so the
# console can be run from anywhere in the repo). repo_sync = local↔remote main
# comparison; version = the semver math behind cutting a release.
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=lib/repo_sync.sh
source "$LIB_DIR/repo_sync.sh"
# shellcheck source=lib/version.sh
source "$LIB_DIR/version.sh"
# Tracked source of truth for the project version (status.sh writes it on a cut).
VERSION_FILE="$MAIN_WORKTREE/VERSION"

# VPS deployment target. The .pem key comes from --vps/--others/--all <pem> (or SHIP_KEY env).
VPS_HOST="${SHIP_HOST:-13.207.69.165}"
VPS_USER="${SHIP_USER:-ubuntu}"
VPS_DIR="${SHIP_REMOTE_DIR:-BOE_APP}"
VPS_KEY="${SHIP_KEY:-}"

c_bold=$'\033[1m'; c_dim=$'\033[2m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_red=$'\033[31m'; c_rst=$'\033[0m'
hdr() { printf '\n%s── %s ─────────────────────────────────────────%s\n' "$c_bold" "$1" "$c_rst"; }
# cell <text> <width> [color] — pads VISIBLE text to width, then colors it,
# so ANSI codes never break column alignment.
cell() { local t="$1" w="$2" col="${3:-}"; printf '%s%-*s%s' "$col" "$w" "$t" "${col:+$c_rst}"; }
count() { git -C "$MAIN_WORKTREE" rev-list --count "$1" 2>/dev/null || echo 0; }

usage() {
    cat <<'USAGE'
Usage: ./release_manager/status.sh [--interactive] [--main] [--contributors]
                                   [--others] [--git] [--local] [--vps <pem>]
                                   [--read-only] [--all [pem]]

BeOnEdge release & collaboration console. With no flags, shows everything (--all).

The DEFAULT run is report-only: it prints status + "what to do next" and never
changes the repo. Add --interactive to act on those steps (needs a terminal).

  --interactive   prompt y/N to EXECUTE: sync local↔remote main, merge contributor
   (-i)           work, approve PRs, and cut a release. Default is report-only.
  --main          MAIN remote (deploy source) + MAIN local (sync / integrate).
  --contributors  open PRs into main — review + approve (alias: --prs).
  --others [pem]  worktree surfaces + local release + live VPS version.
  --git           only worktree-surfaces (subset of --others).
  --local         only local-release (subset of --others).
  --vps <pem>     live VPS-deployed version (SSH query; needs the .pem key path).
  --read-only     force report-only even with --interactive (the default anyway).
  --all [pem]     all sections in order (default). Optional trailing .pem queries VPS.

INTERACTIVE actions (with --interactive on a terminal): pull/push to fully sync
local↔remote main, merge contributor work, approve PRs, and cut a release when
main is clean + in sync. Only local main is ever pushed to remote main.

VPS host/user/dir default to the algogon.xyz target and can be overridden with
SHIP_HOST / SHIP_USER / SHIP_REMOTE_DIR. SHIP_KEY may supply the .pem instead of --vps.
USAGE
}

# ── argument parsing ──────────────────────────────────────────────────────────
SHOW_MAIN=false; SHOW_CONTRIB=false; SHOW_GIT=false; SHOW_LOCAL=false; SHOW_VPS=false
READ_ONLY=false
RUN=false          # --interactive/-i: opt IN to y/N execution. Default is report-only.
take_pem() { # consume an optional trailing .pem path after a flag; echoes shift count
    if [[ $# -ge 1 && "${1:-}" != -* && -n "${1:-}" ]]; then VPS_KEY="$1"; return 0; fi
    return 1
}
while [[ $# -gt 0 ]]; do
    case "$1" in
        --main)               SHOW_MAIN=true; shift ;;
        --contributors|--prs) SHOW_CONTRIB=true; shift ;;
        --others)
            SHOW_GIT=true; SHOW_LOCAL=true; SHOW_VPS=true
            if take_pem "${2:-}"; then shift 2; else shift; fi ;;
        --git)    SHOW_GIT=true; shift ;;
        --local)  SHOW_LOCAL=true; shift ;;
        --vps)
            SHOW_VPS=true
            if [[ $# -lt 2 || "${2:-}" == -* ]]; then
                printf -- '--vps requires a path to the SSH .pem key, e.g. --vps resources/credentials/cli_app.pem\n' >&2
                exit 1
            fi
            VPS_KEY="$2"; shift 2 ;;
        --interactive|-i) RUN=true; shift ;;
        --read-only) READ_ONLY=true; shift ;;
        --all)
            SHOW_MAIN=true; SHOW_CONTRIB=true; SHOW_GIT=true; SHOW_LOCAL=true; SHOW_VPS=true
            if take_pem "${2:-}"; then shift 2; else shift; fi ;;
        --help|-h) usage; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
    esac
done
# No section flags → show everything.
if [[ "$SHOW_MAIN" == false && "$SHOW_CONTRIB" == false && "$SHOW_GIT" == false \
   && "$SHOW_LOCAL" == false && "$SHOW_VPS" == false ]]; then
    SHOW_MAIN=true; SHOW_CONTRIB=true; SHOW_GIT=true; SHOW_LOCAL=true; SHOW_VPS=true
fi

# ── interactivity ──────────────────────────────────────────────────────────────
# The default run is REPORT-ONLY: it shows status + "what to do next" and never
# changes anything. Execution (merge / sync / push / approve / cut release) is
# opt-in via --interactive, and still needs a real terminal to prompt on.
INTERACTIVE=false
if [[ "$RUN" == true && "$READ_ONLY" != true && -t 0 && -t 1 ]]; then INTERACTIVE=true; fi
if [[ "$RUN" == true && "$INTERACTIVE" != true ]]; then
    printf '%s--interactive given but no terminal to prompt on — showing read-only status.%s\n' "$c_yel" "$c_rst" >&2
fi

confirm() { # $1 = prompt. returns 0 only on an explicit yes.
    local ans
    [[ "$INTERACTIVE" == true ]] || return 1
    printf '%s    ➜ %s [y/N] %s' "$c_bold" "$1" "$c_rst" >/dev/tty
    read -r ans </dev/tty || return 1
    [[ "$ans" == [yY] || "$ans" == [yY][eE][sS] ]]
}
# ask_run <confirm-prompt> <display-cmd> <argv...>
#   interactive+yes → run it; interactive+no → skipped; non-interactive → print "run: ...".
ask_run() {
    local prompt="$1" disp="$2"; shift 2
    if [[ "$INTERACTIVE" == true ]]; then
        if confirm "$prompt"; then
            printf '      %s$ %s%s\n' "$c_dim" "$disp" "$c_rst"
            if "$@"; then printf '      %s✓ done%s\n' "$c_grn" "$c_rst"
            else printf '      %s✗ failed — resolve manually%s\n' "$c_red" "$c_rst"; fi
        else
            printf '      %s· skipped%s\n' "$c_dim" "$c_rst"
        fi
    else
        printf '      %srun: %s%s\n' "$c_dim" "$disp" "$c_rst"
    fi
}

# ask_commit <worktree> <surface-name> — commit ALL changes in a surface worktree.
#   interactive: confirm, then prompt for the commit message (Enter = a sensible
#                default), then `git add -A && git commit`.
#   read-only:   print the equivalent command.
ask_commit() {
    local wt="$1" name="$2" msg
    if [[ "$INTERACTIVE" != true ]]; then
        printf '      %scd %s && git add -A && git commit -m "feat(%s): ..."%s\n' "$c_dim" "$wt" "$name" "$c_rst"
        return 0
    fi
    if ! confirm "Commit all uncommitted changes in $name?"; then
        printf '      %s· skipped%s\n' "$c_dim" "$c_rst"; return 0
    fi
    printf '%s    ➜ Commit message for %s [Enter = "chore(%s): update working tree"]: %s' \
        "$c_bold" "$name" "$name" "$c_rst" >/dev/tty
    read -r msg </dev/tty || msg=""
    [[ -z "$msg" ]] && msg="chore($name): update working tree"
    printf '      %s$ (cd %s && git add -A && git commit -m "%s")%s\n' "$c_dim" "$wt" "$msg" "$c_rst"
    if ( cd "$wt" && git add -A && git commit -q -m "$msg" ); then
        printf '      %s✓ committed%s\n' "$c_grn" "$c_rst"
    else
        printf '      %s✗ commit failed — resolve manually%s\n' "$c_red" "$c_rst"
    fi
}

# merge_into_main <ref> — merge a ref into local main, surviving a dirty main
# worktree. Git refuses a merge that would overwrite uncommitted local edits
# ("Your local changes ... would be overwritten by merge"). This helper computes
# the overlap between main's dirty files and the files the merge touches; only
# when they overlap does it stash (incl. untracked) around the merge and restore
# afterwards. No overlap → plain merge, local edits untouched.
merge_into_main() {
    local ref="$1" overlap stashed=0
    if [[ -n "$(git -C "$MAIN_WORKTREE" status --porcelain)" ]]; then
        overlap="$(comm -12 \
            <(git -C "$MAIN_WORKTREE" diff --name-only "main...$ref" 2>/dev/null | sort -u) \
            <(git -C "$MAIN_WORKTREE" status --porcelain | awk '{print $NF}' | sort -u))"
        if [[ -n "$overlap" ]]; then
            printf '      %slocal edits overlap %s file(s) the merge touches — auto-stashing around the merge%s\n' \
                "$c_yel" "$(printf '%s\n' "$overlap" | wc -l | tr -d ' ')" "$c_rst"
            git -C "$MAIN_WORKTREE" stash push -u -q -m "status.sh auto-stash before merging $ref" || return 1
            stashed=1
        fi
    fi
    if ! git -C "$MAIN_WORKTREE" merge --no-edit "$ref"; then
        if [[ "$stashed" -eq 1 ]]; then
            printf '      %smerge needs manual resolution — your local edits are SAFE in the stash.%s\n' "$c_yel" "$c_rst"
            printf '      %safter resolving: git -C %s stash pop%s\n' "$c_dim" "$MAIN_WORKTREE" "$c_rst"
        fi
        return 1
    fi
    if [[ "$stashed" -eq 1 ]]; then
        if git -C "$MAIN_WORKTREE" stash pop -q; then
            printf '      %s✓ local edits restored on top of the merge%s\n' "$c_grn" "$c_rst"
        else
            printf '      %s✗ merged, but restoring your local edits hit conflicts — fix the conflicted files,%s\n' "$c_red" "$c_rst"
            printf '        %sthen: git -C %s stash drop   (your edits stay in the stash until then)%s\n' "$c_dim" "$MAIN_WORKTREE" "$c_rst"
            return 1
        fi
    fi
    return 0
}

# cut_release — cargo-release style: bump VERSION → commit → tag vX.Y.Z → push
# main + tag to origin. Interactive only; refuses unless on a clean, in-sync main.
# This is the ONLY place a release is cut; export.sh merely labels a build from it.
cut_release() {
    local current next bump ans tagref
    current="$(canonical_version "$VERSION_FILE" "$RM/BOE_APP" "$MAIN_WORKTREE")"
    printf '%saction:%s cut a release — current version %s%s%s\n' "$c_bold" "$c_rst" "$c_grn" "$current" "$c_rst"

    # Ask the bump level (or skip). Empty / anything else = skip, so a plain
    # status check never accidentally tags.
    printf '%s    ➜ Cut a new release? bump [p]atch / [m]inor / [M]ajor, Enter to skip: %s' "$c_bold" "$c_rst" >/dev/tty
    read -r ans </dev/tty || return 0
    case "$ans" in
        p|patch)  bump=patch ;;
        m|minor)  bump=minor ;;
        M|major)  bump=major ;;
        *) printf '      %s· skipped%s\n' "$c_dim" "$c_rst"; return 0 ;;
    esac

    next="$(bump_version "$current" "$bump")" || { printf '      %s✗ bad current version: %s%s\n' "$c_red" "$current" "$c_rst"; return 1; }
    tagref="v$next"
    if git -C "$MAIN_WORKTREE" rev-parse -q --verify "refs/tags/$tagref" >/dev/null; then
        printf '      %s✗ tag %s already exists — nothing cut%s\n' "$c_red" "$tagref" "$c_rst"; return 1
    fi

    confirm "Cut $tagref ($current → $next): write VERSION, commit, tag, push main + tag?" || {
        printf '      %s· skipped%s\n' "$c_dim" "$c_rst"; return 0; }

    printf '      %s$ bump VERSION → %s, commit, tag %s, push%s\n' "$c_dim" "$next" "$tagref" "$c_rst"
    if printf '%s\n' "$next" > "$VERSION_FILE" \
       && git -C "$MAIN_WORKTREE" add -- "$VERSION_FILE" \
       && git -C "$MAIN_WORKTREE" commit -q -m "chore(release): $tagref" \
       && git -C "$MAIN_WORKTREE" tag -a "$tagref" -m "release $tagref" \
       && git -C "$MAIN_WORKTREE" push -q origin main \
       && git -C "$MAIN_WORKTREE" push -q origin "$tagref"; then
        printf '      %s✓ released %s — commit + tag pushed to origin%s\n' "$c_grn" "$tagref" "$c_rst"
        printf '      %snext: build the shippable bundle → %s/release_manager/export.sh%s\n' "$c_dim" "$MAIN_WORKTREE" "$c_rst"
    else
        printf '      %s✗ release failed mid-way. If a local commit/tag was made but not pushed, undo with:%s\n' "$c_red" "$c_rst"
        printf '        %sgit -C %s reset --hard HEAD~1 && git -C %s tag -d %s%s\n' "$c_dim" "$MAIN_WORKTREE" "$MAIN_WORKTREE" "$tagref" "$c_rst"
        return 1
    fi
}

# ── shared state (surfaces + contributor branches) ─────────────────────────────
# Populated by the display sections and consumed by the trailing DO THIS NEXT
# pipeline. Initialised here so they always exist under `set -u`.
S_NAME=(); S_PATH=(); S_BR=(); S_DIRTY=(); S_AHEAD=(); S_BEHIND=()
CB_NAME=(); CB_AHEAD=()
need_commit=0; need_merge=0; need_sync=0

# collect_surfaces — (re)scan worktree surfaces into the S_* arrays and the
# need_* flags. Idempotent (resets first) so it can be re-run after commits/merges
# to refresh the ahead/behind counts mid-pipeline.
collect_surfaces() {
    S_NAME=(); S_PATH=(); S_BR=(); S_DIRTY=(); S_AHEAD=(); S_BEHIND=()
    need_commit=0; need_merge=0; need_sync=0
    local wpath wbranch name dirty ahead behind
    while IFS=$'\t' read -r wpath wbranch; do
        [[ "$wbranch" == "main" || -z "$wbranch" ]] && continue
        name="${wbranch#wt/}"
        dirty="$(git -C "$wpath" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
        ahead="$(count "main..$wbranch")"
        behind="$(count "$wbranch..main")"
        S_NAME+=("$name"); S_PATH+=("$wpath"); S_BR+=("$wbranch")
        S_DIRTY+=("$dirty"); S_AHEAD+=("$ahead"); S_BEHIND+=("$behind")
        [[ "$dirty" -gt 0 ]] && need_commit=1
        [[ "$ahead" -gt 0 ]] && need_merge=1
        [[ "$behind" -gt 0 ]] && need_sync=1
    done < <(git worktree list --porcelain | awk '
        /^worktree /{p=$2} /^branch /{b=$2; sub("refs/heads/","",b); print p"\t"b}')
    return 0   # never inherit a falsy trailing-&& status into `set -e` callers
}

# ── header ───────────────────────────────────────────────────────────────────
printf '%s═══ BeOnEdge — release & collaboration console ═══%s\n' "$c_bold" "$c_rst"
if [[ "$INTERACTIVE" == true ]]; then
    printf '%sinteractive: y/N prompts will act on your repo (sync, push, approve, cut release)%s\n' "$c_dim" "$c_rst"
else
    printf '%sread-only (default): showing status + next steps. Re-run with --interactive to act.%s\n' "$c_dim" "$c_rst"
fi

# One repo_sync pass fetches origin once and populates RS_* (local↔remote main
# ahead/behind, dirty, in-sync). Every section reads from it, so the dashboard is
# internally consistent and there is a single source of truth for remote state.
repo_sync_eval "$MAIN_WORKTREE"
local_branch="$(git -C "$MAIN_WORKTREE" symbolic-ref --short -q HEAD || echo '?')"
has_remote_main="$RS_HAS_REMOTE"
# Scan surfaces up-front so every section (and the trailing pipeline) is consistent.
[[ "$SHOW_GIT" == true ]] && collect_surfaces

# ── 1. MAIN — REMOTE ───────────────────────────────────────────────────────────
if [[ "$SHOW_MAIN" == true ]]; then
    hdr "1 · MAIN — REMOTE (origin/main → deploys to the VPS)"
    if [[ "$has_remote_main" == true ]]; then
        printf 'origin/main tip  : %s\n' "$(git -C "$MAIN_WORKTREE" log -1 --format='%h  %s  (%cr)' origin/main 2>/dev/null)"
        printf 'deploy note      : %sthis is the exact tree deploy.sh --ship pushes to %s@%s%s\n' "$c_dim" "$VPS_USER" "$VPS_HOST" "$c_rst"
    else
        printf 'origin/main      : %snot found on origin%s\n' "$c_yel" "$c_rst"
    fi
fi

# ── 2. MAIN — LOCAL (integrate contributor work, test, push) ───────────────────
if [[ "$SHOW_MAIN" == true ]]; then
    hdr "2 · MAIN — LOCAL (integrate → test locally → push to remote main)"
    # All three come from the single repo_sync pass (no extra git calls).
    main_dirty="$RS_DIRTY"        # uncommitted changes in the main worktree
    ahead_remote="$RS_AHEAD"      # local commits not yet on remote main
    behind_remote="$RS_BEHIND"    # remote main commits not local

    printf 'local main tip   : %s\n' "$(git -C "$MAIN_WORKTREE" log -1 --format='%h  %s' main 2>/dev/null || echo '?')"
    printf 'worktree         : %s' "$MAIN_WORKTREE"
    [[ "$local_branch" == "main" ]] && printf '  %s(on main)%s\n' "$c_grn" "$c_rst" \
                                    || printf '  %s(on %s — checkout main to integrate)%s\n' "$c_yel" "$local_branch" "$c_rst"
    if [[ "$has_remote_main" == true ]]; then
        printf 'vs origin/main   : %sahead %s%s / %sbehind %s%s%s\n' \
            "$c_yel" "$ahead_remote" "$c_rst" "$c_red" "$behind_remote" "$c_rst" \
            "$([[ "$main_dirty" -gt 0 ]] && printf '   %s(%s uncommitted)%s' "$c_yel" "$main_dirty" "$c_rst")"
    fi
    # The shared repo_sync notice — the canonical local↔remote summary.
    repo_sync_notice

    # Contributor branches on origin that are ahead of LOCAL main = work to integrate.
    CB_NAME=(); CB_AHEAD=()
    while read -r rb; do
        [[ "$rb" == "main" || -z "$rb" ]] && continue
        a="$(count "main..origin/$rb")"
        [[ "$a" -gt 0 ]] && { CB_NAME+=("$rb"); CB_AHEAD+=("$a"); }
    done < <(git -C "$MAIN_WORKTREE" for-each-ref --format='%(refname)' refs/remotes/origin \
                | grep -v '/HEAD$' | sed 's#^refs/remotes/origin/##')

    if [[ "${#CB_NAME[@]}" -eq 0 ]]; then
        printf 'to integrate     : %snone — local main already has all contributor commits%s\n' "$c_dim" "$c_rst"
    else
        printf 'to integrate     :\n'
        for i in "${!CB_NAME[@]}"; do
            printf '  origin/%-12s %s%s commit(s) ahead of local main%s\n' "${CB_NAME[$i]}" "$c_yel" "${CB_AHEAD[$i]}" "$c_rst"
        done
    fi
    # NOTE: this section is now STATUS-ONLY. The actions it used to prompt for
    # (merge contributor work, pull/push to sync local↔remote main, cut a release)
    # moved to the trailing "DO THIS NEXT" pipeline, so the local↔remote sync is
    # only offered AFTER the surface commits/merges below — never before them.
fi

# ── 3. CONTRIBUTORS (open PRs into main — review + approve) ─────────────────────
if [[ "$SHOW_CONTRIB" == true ]]; then
    hdr "3 · CONTRIBUTORS (open PRs → main · review + approve)"
    gh_ok=false
    command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && gh_ok=true
    if [[ "$gh_ok" != true ]]; then
        printf '%sgh CLI missing or not authenticated — PR review skipped.%s\n' "$c_yel" "$c_rst"
        printf '%sInstall https://cli.github.com then run: gh auth login%s\n' "$c_dim" "$c_rst"
    else
        repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
        printf 'repo             : %s\n' "${repo:-unknown}"
        prot="$(gh api "repos/$repo/branches/main/protection" \
            --jq '"\(.required_pull_request_reviews.required_approving_review_count // 0)\t\(.allow_force_pushes.enabled)\t\(.enforce_admins.enabled)"' 2>/dev/null || true)"
        if [[ -n "$prot" ]]; then
            IFS=$'\t' read -r p_appr p_force p_adm <<<"$prot"
            printf 'main protection  : %sPR required · %s approval(s) · force-push %s · admins %s%s\n' \
                "$c_grn" "$p_appr" "$([[ "$p_force" == true ]] && echo on || echo off)" \
                "$([[ "$p_adm" == true ]] && echo enforced || echo exempt)" "$c_rst"
        else
            printf 'main protection  : %sunprotected, or not visible with this token%s\n' "$c_yel" "$c_rst"
        fi
        collabs="$(gh api "repos/$repo/collaborators" \
            --jq '[.[] | .login + "(" + (if .permissions.admin then "admin" elif .permissions.push then "push" else "read" end) + ")"] | join(", ")' 2>/dev/null || true)"
        [[ -n "$collabs" ]] && printf 'collaborators    : %s\n' "$collabs"

        P_NUM=(); P_BR=(); P_AUTHOR=(); P_DEC=(); P_MERG=()
        while IFS=$'\t' read -r num br author dec merg; do
            [[ -z "$num" ]] && continue
            P_NUM+=("$num"); P_BR+=("$br"); P_AUTHOR+=("$author"); P_DEC+=("$dec"); P_MERG+=("$merg")
        done < <(gh pr list --base main --state open \
                    --json number,headRefName,author,reviewDecision,mergeable \
                    --jq '.[] | [.number, .headRefName, .author.login, (.reviewDecision // "REVIEW_REQUIRED"), .mergeable] | @tsv' 2>/dev/null)

        if [[ "${#P_NUM[@]}" -eq 0 ]]; then
            printf 'open PRs → main  : %s(none) — contributors push to dev, then open a PR%s\n' "$c_dim" "$c_rst"
        else
            printf 'open PRs → main  :\n'
            printf '  %s%-5s %-18s %-14s %-13s %s%s\n' "$c_dim" "PR" "branch" "author" "approved" "mergeable" "$c_rst"
            for i in "${!P_NUM[@]}"; do
                if [[ "${P_DEC[$i]}" == "APPROVED" ]]; then appr="Y"; ac="$c_grn"
                elif [[ "${P_DEC[$i]}" == "CHANGES_REQUESTED" ]]; then appr="N (changes)"; ac="$c_red"
                else appr="N"; ac="$c_yel"; fi
                mg="$(printf '%s' "${P_MERG[$i]}" | tr '[:upper:]' '[:lower:]')"
                printf '  #%-4s %-18s %-14s ' "${P_NUM[$i]}" "${P_BR[$i]}" "${P_AUTHOR[$i]}"
                cell "$appr" 13 "$ac"; printf ' %s\n' "$mg"
            done
            # Interactive approval for PRs not yet approved.
            for i in "${!P_NUM[@]}"; do
                [[ "${P_DEC[$i]}" == "APPROVED" ]] && continue
                printf '%saction:%s PR #%s (%s by %s) — verify locally with: gh pr checkout %s\n' \
                    "$c_bold" "$c_rst" "${P_NUM[$i]}" "${P_BR[$i]}" "${P_AUTHOR[$i]}" "${P_NUM[$i]}"
                ask_run "Approve PR #${P_NUM[$i]} (${P_BR[$i]})?" \
                        "gh pr review ${P_NUM[$i]} --approve" \
                        gh pr review "${P_NUM[$i]}" --approve
            done
        fi
    fi
fi

# ── 4. OTHERS ──────────────────────────────────────────────────────────────────
SHOW_OTHERS=false
[[ "$SHOW_GIT" == true || "$SHOW_LOCAL" == true || "$SHOW_VPS" == true ]] && SHOW_OTHERS=true

# 4a. worktree surfaces (data already collected up-front; here we only render)
if [[ "$SHOW_GIT" == true ]]; then
    hdr "4a · SURFACES (worktrees → commit, then merge into local main)"
    printf '%-10s %-12s %-13s %-12s %s\n' "surface" "branch" "uncommitted" "unmerged" "behind main"
    printf '%s%-10s %-12s %-13s %-12s %s%s\n' "$c_dim" "" "" "(needs commit)" "(not in main)" "(missing main commits)" "$c_rst"
    for i in "${!S_NAME[@]}"; do
        d="${S_DIRTY[$i]}"; a="${S_AHEAD[$i]}"; b="${S_BEHIND[$i]}"
        printf '%-10s %-12s ' "${S_NAME[$i]}" "${S_BR[$i]}"
        if [[ "$d" -gt 0 ]]; then cell "$d files" 13 "$c_yel"; else cell "clean" 13 "$c_grn"; fi
        if [[ "$a" -gt 0 ]]; then cell "$a commits" 12 "$c_yel"; else cell "0" 12 "$c_dim"; fi
        if [[ "$b" -gt 0 ]]; then cell "$b" 4 "$c_red"; else cell "0" 4 "$c_dim"; fi
        printf '\n'
    done
    [[ "${#S_NAME[@]}" -eq 0 ]] && printf '%s(no surface worktrees)%s\n' "$c_dim" "$c_rst"
fi

# 4b. release (local version + staged build + rollbacks + .env + live VPS version)
env_ok=1; [[ -f "$RM/BOE_APP/.env" ]] || env_ok=0
local_ver=""
if [[ "$SHOW_LOCAL" == true || "$SHOW_VPS" == true ]]; then
    cur="$RM/BOE_APP/current-version.json"
    if [[ -f "$cur" ]]; then
        local_ver="$(command -v jq >/dev/null && jq -r '.version // "unknown"' "$cur" || cat "$cur")"
    fi
fi

if [[ "$SHOW_LOCAL" == true || "$SHOW_VPS" == true ]]; then
    hdr "4b · RELEASE"
    if [[ "$SHOW_LOCAL" == true ]]; then
        if [[ -n "$local_ver" ]]; then printf 'local deployed   : %s%s%s\n' "$c_grn" "$local_ver" "$c_rst"
        else printf 'local deployed   : %s(none yet)%s\n' "$c_dim" "$c_rst"; fi
    fi
    if [[ "$SHOW_VPS" == true ]]; then
        if [[ -z "$VPS_KEY" ]]; then
            printf 'vps deployed     : %s(pass the .pem path to query: --vps <pem>)%s\n' "$c_dim" "$c_rst"
        elif [[ ! -f "$VPS_KEY" ]]; then
            printf 'vps deployed     : %skey not found: %s%s\n' "$c_yel" "$VPS_KEY" "$c_rst"
        else
            vps_ver="$(ssh -i "$VPS_KEY" -o BatchMode=yes -o ConnectTimeout=10 "$VPS_USER@$VPS_HOST" \
                "cat $VPS_DIR/version.json 2>/dev/null || cat $VPS_DIR/current-version.json 2>/dev/null" 2>/dev/null \
                | { command -v jq >/dev/null && jq -r '.version // empty' 2>/dev/null || cat; } || true)"
            vps_ver="$(printf '%s' "$vps_ver" | tr -d '[:space:]')"
            if [[ -z "$vps_ver" ]]; then
                printf 'vps deployed     : %sunreachable or no release%s  %s(%s@%s)%s\n' "$c_yel" "$c_rst" "$c_dim" "$VPS_USER" "$VPS_HOST" "$c_rst"
            elif [[ -n "$local_ver" && "$vps_ver" == "$local_ver" ]]; then
                printf 'vps deployed     : %s%s%s  %s(in sync with local — %s@%s)%s\n' "$c_grn" "$vps_ver" "$c_rst" "$c_dim" "$VPS_USER" "$VPS_HOST" "$c_rst"
            else
                printf 'vps deployed     : %s%s%s  %s(differs from local %s — %s@%s)%s\n' "$c_yel" "$vps_ver" "$c_rst" "$c_dim" "${local_ver:-?}" "$VPS_USER" "$VPS_HOST" "$c_rst"
            fi
        fi
    fi
    if [[ "$SHOW_LOCAL" == true ]]; then
        staged="$(find "$RM/recent_builds" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)"
        [[ -n "$staged" ]] && printf 'staged build     : %s%s%s\n' "$c_grn" "$(basename "$staged")" "$c_rst" \
                            || printf 'staged build     : %s(none)%s\n' "$c_dim" "$c_rst"
        printf 'rollbacks        : %s\n' "$(find "$RM/rollback" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
        [[ "$env_ok" -eq 1 ]] && printf 'BOE_APP/.env     : %spresent%s\n' "$c_grn" "$c_rst" \
                              || printf 'BOE_APP/.env     : %sMISSING — needed to deploy%s\n' "$c_red" "$c_rst"
    fi
fi

# ── DO THIS NEXT — the interactive action pipeline, in dependency order ─────────
# Everything that CHANGES the repo lives here (the sections above are status-only).
# Order matters: commit + integrate ALL work first, THEN sync local↔remote main,
# THEN cut/build/deploy/ship. With --interactive each step prompts y/N and runs;
# otherwise the equivalent command is printed.
if [[ "$SHOW_MAIN" == true || "$SHOW_OTHERS" == true ]]; then
    hdr "DO THIS NEXT"
    step=1
    say() { printf '\n %s%s.%s %s\n' "$c_bold" "$step" "$c_rst" "$1"; step=$((step+1)); }
    cmd() { printf '      %s%s%s\n' "$c_dim" "$1" "$c_rst"; }

    # 1 · commit uncommitted surface work (asks for a commit message per surface).
    if [[ "$SHOW_GIT" == true && "$need_commit" -eq 1 ]]; then
        say "Commit uncommitted surface work:"
        for i in "${!S_NAME[@]}"; do
            [[ "${S_DIRTY[$i]}" -gt 0 ]] && ask_commit "${S_PATH[$i]}" "${S_NAME[$i]}"
        done
        [[ "$INTERACTIVE" == true ]] && collect_surfaces   # refresh ahead counts after commits
    fi

    # sync_surfaces_behind — offer to merge main into every surface that is
    # missing main commits. Used twice: early (step 2) and again at the end of
    # the pipeline, because the steps in between (commit main, merge contributor
    # work, integrate surfaces, cut a release) all add commits to main and so
    # put the surfaces behind again.
    sync_surfaces_behind() {
        local i
        for i in "${!S_NAME[@]}"; do
            [[ "${S_BEHIND[$i]}" -gt 0 ]] && ask_run \
                "Merge main into ${S_NAME[$i]} (behind by ${S_BEHIND[$i]})?" \
                "cd ${S_PATH[$i]} && git merge main" \
                git -C "${S_PATH[$i]}" merge --no-edit main
        done
        return 0   # don't leak a falsy trailing-&& status into `set -e`
    }

    # 2 · sync surfaces that fell behind main.
    if [[ "$SHOW_GIT" == true && "$need_sync" -eq 1 ]]; then
        say "Sync surfaces that fell behind main:"
        sync_surfaces_behind
    fi

    # 3 · main's own uncommitted edits block any merge that touches the same
    #     files AND block cutting a release (the clean-build gate). Offer to
    #     commit main whenever it is dirty: before merges it is the durable fix
    #     (skipping is fine — merge_into_main auto-stashes overlapping edits);
    #     with nothing to merge it is the only path to a clean, cuttable main.
    merges_pending=0
    [[ "${#CB_NAME[@]}" -gt 0 || "$need_merge" -eq 1 ]] && merges_pending=1
    main_dirty_files="$(git -C "$MAIN_WORKTREE" status --porcelain | wc -l | tr -d ' ')"
    if [[ "$main_dirty_files" -gt 0 && "$local_branch" == "main" ]]; then
        if [[ "$merges_pending" -eq 1 ]]; then
            say "Local main has $main_dirty_files uncommitted change(s) — commit before merging (recommended):"
            printf '      %s(skip = merges below auto-stash your edits only if they overlap the merge)%s\n' "$c_dim" "$c_rst"
        else
            say "Local main has $main_dirty_files uncommitted change(s) — commit to unblock the release cut:"
        fi
        ask_commit "$MAIN_WORKTREE" "main"
    fi

    # 4 · merge approved contributor work into local main (was in §2).
    if [[ "$SHOW_MAIN" == true && "${#CB_NAME[@]}" -gt 0 ]]; then
        say "Merge contributor work into local main:"
        if [[ "$local_branch" != "main" ]]; then
            cmd "checkout main first: git -C $MAIN_WORKTREE checkout main"
        else
            for i in "${!CB_NAME[@]}"; do
                ask_run "Merge origin/${CB_NAME[$i]} into local main (${CB_AHEAD[$i]} commit(s))?" \
                        "git -C $MAIN_WORKTREE merge --no-edit origin/${CB_NAME[$i]}" \
                        merge_into_main "origin/${CB_NAME[$i]}"
            done
        fi
    fi

    # 5 · integrate surface commits into local main.
    if [[ "$SHOW_GIT" == true && "$need_merge" -eq 1 ]]; then
        say "Integrate surface commits into local main:"
        if [[ "$local_branch" != "main" ]]; then
            cmd "checkout main first: git -C $MAIN_WORKTREE checkout main"
        else
            for i in "${!S_NAME[@]}"; do
                [[ "${S_AHEAD[$i]}" -gt 0 ]] && ask_run \
                    "Merge ${S_BR[$i]} into local main (${S_AHEAD[$i]} commit(s))?" \
                    "git -C $MAIN_WORKTREE merge --no-edit ${S_BR[$i]}" \
                    merge_into_main "${S_BR[$i]}"
            done
            [[ "$INTERACTIVE" == true ]] && collect_surfaces   # refresh after integration
        fi
    fi

    # 6 · NOW sync local main ↔ remote main — only AFTER all commits/merges above,
    #     so a push carries the full integrated tree (this is the step that used to
    #     run prematurely at the top of §2).
    if [[ "$SHOW_MAIN" == true && "$has_remote_main" == true ]]; then
        [[ "$INTERACTIVE" == true ]] && repo_sync_eval "$MAIN_WORKTREE"
        sync_ahead="$RS_AHEAD"; sync_behind="$RS_BEHIND"; sync_dirty="$RS_DIRTY"
        if [[ "$sync_behind" -gt 0 || "$sync_ahead" -gt 0 ]]; then
            say "Sync local main ↔ remote main (the VPS deploy source):"
            if [[ "$sync_behind" -gt 0 ]]; then
                [[ "$sync_dirty" -gt 0 ]] && cmd "note: commit/stash first — rebase refuses a dirty tree"
                ask_run "Pull --rebase remote main → local (behind by $sync_behind)?" \
                        "git -C $MAIN_WORKTREE pull --rebase origin main" \
                        git -C "$MAIN_WORKTREE" pull --rebase origin main
                [[ "$INTERACTIVE" == true ]] && { repo_sync_eval "$MAIN_WORKTREE"; sync_ahead="$RS_AHEAD"; sync_behind="$RS_BEHIND"; }
            fi
            if [[ "$sync_ahead" -gt 0 ]]; then
                [[ "$sync_behind" -gt 0 ]] && cmd "still behind by $sync_behind — pull --rebase first or the push is rejected"
                ask_run "Push local main → remote main (ahead by $sync_ahead)?" \
                        "git -C $MAIN_WORKTREE push origin main" \
                        git -C "$MAIN_WORKTREE" push origin main
            fi
        else
            printf '\n %s· local main is level with remote main — in sync.%s\n' "$c_dim" "$c_rst"
        fi
    fi

    # 7 · cut a stable release (interactive acts; read-only instructs).
    if [[ "$SHOW_MAIN" == true || "$SHOW_LOCAL" == true ]]; then
        say "Cut a stable release (bump VERSION, commit, tag, push):"
        if [[ "$INTERACTIVE" == true && "$local_branch" == "main" && "$has_remote_main" == true ]]; then
            repo_sync_eval "$MAIN_WORKTREE"
            if [[ "$RS_CLEAN_SYNC" == true ]]; then
                cut_release || true
            else
                printf '      %s· main is not clean + in sync yet — finish the sync above, then re-run to cut.%s\n' "$c_dim" "$c_rst"
            fi
        else
            cmd "cd $MAIN_WORKTREE && ./release_manager/status.sh --main --interactive   # answer the cut prompt"
        fi
    fi

    # 8 · steps 3–7 may have added commits to main (main's own commit,
    #     contributor merges, surface integration, the release cut), which puts
    #     the surfaces behind main AGAIN. Re-scan and offer the fan-out here so
    #     one interactive run leaves main and every surface level — no re-run.
    if [[ "$SHOW_GIT" == true && "$INTERACTIVE" == true ]]; then
        collect_surfaces
        if [[ "$need_sync" -eq 1 ]]; then
            say "Fan main back out — surfaces fell behind during this run:"
            sync_surfaces_behind
        fi
    fi

    # 9 · build / deploy / ship + the CLEAN-BUILD gate.
    if [[ "$SHOW_LOCAL" == true ]]; then
        # A build is clean/shippable ONLY when the tree is clean AND HEAD is the
        # exact vX.Y.Z release tag (export.sh stamps a stable label; deploy.sh
        # --ship refuses anything with a '-', i.e. any -dev/.dirty build).
        current_version="$(canonical_version "$VERSION_FILE" "$RM/BOE_APP" "$MAIN_WORKTREE")"
        build_clean=false
        on_exact_release_tag "$MAIN_WORKTREE" "$current_version" && build_clean=true || build_clean=false
        main_dirty_now="$(git -C "$MAIN_WORKTREE" status --porcelain | wc -l | tr -d ' ')"

        if [[ "$build_clean" == true ]]; then
            printf '\n %s✓ clean tree on tag v%s — the next build is a stable, shippable %s.%s\n' \
                "$c_grn" "$current_version" "$current_version" "$c_rst"
        else
            printf '\n %s⚠ NOT a clean build yet.%s %sexport.sh will label it %s<next>-dev.N.gSHA[.dirty]%s and%s\n' \
                "$c_yel" "$c_rst" "$c_dim" "$c_bold" "$c_dim" "$c_rst"
            printf '   %sdeploy.sh --ship will REFUSE it. To get a clean, shippable build:%s\n' "$c_dim" "$c_rst"
            [[ "$main_dirty_now" -gt 0 ]] && \
                printf '     %s• commit the %s uncommitted change(s) in main: git -C %s add -A && git commit%s\n' "$c_dim" "$main_dirty_now" "$MAIN_WORKTREE" "$c_rst"
            [[ "$SHOW_GIT" == true && ( "$need_commit" -eq 1 || "$need_merge" -eq 1 ) ]] && \
                printf '     %s• commit + integrate the surface work (steps above) into main%s\n' "$c_dim" "$c_rst"
            printf '     %s• cut a release so HEAD == its vX.Y.Z tag (step above, or status.sh --main --interactive)%s\n' "$c_dim" "$c_rst"
            printf '     %s• then build — export.sh stamps a stable X.Y.Z%s\n' "$c_dim" "$c_rst"
        fi

        if [[ "$env_ok" -eq 0 ]]; then
            say "First deploy only — create the env file, then fill its secrets:"
            cmd "cd $RM/BOE_APP && cp .env.example .env && \$EDITOR .env"
        fi

        say "Build the bundle from the current tree:"
        ask_run "Build the release bundle now (export.sh)?" \
                "cd $MAIN_WORKTREE && ./release_manager/export.sh" \
                "$RM/export.sh"

        say "Deploy locally to test (postgres→migrate→seed→backend→landing, health-checked):"
        ask_run "Deploy the staged bundle locally now (deploy.sh)?" \
                "cd $MAIN_WORKTREE && ./release_manager/deploy.sh" \
                "$RM/deploy.sh"

        say "Ship the staged bundle to the VPS (only after a local test + a CLEAN build):"
        if [[ "$build_clean" != true ]]; then
            printf '      %s· not shippable — make a clean build first (see ⚠ above).%s\n' "$c_yel" "$c_rst"
            cmd "cd $MAIN_WORKTREE && ./release_manager/deploy.sh --ship <pem>"
        elif [[ -n "$VPS_KEY" && -f "$VPS_KEY" ]]; then
            ask_run "Ship to the VPS now (deploy.sh --ship)?" \
                    "cd $MAIN_WORKTREE && ./release_manager/deploy.sh --ship $VPS_KEY" \
                    "$RM/deploy.sh" --ship "$VPS_KEY"
        else
            cmd "cd $MAIN_WORKTREE && ./release_manager/deploy.sh --ship <pem>"
            printf '      %s(pass the .pem to enable this prompt: --all <pem> or --vps <pem>)%s\n' "$c_dim" "$c_rst"
        fi
    fi
fi

# ── reminders ──────────────────────────────────────────────────────────────────
if [[ "$SHOW_MAIN" == true ]]; then
    printf '\n%sFlow:%s contributor → PR (approve in §3) → %sDO THIS NEXT%s: commit+integrate all work into local main → sync to %sremote main%s → cut → build → test locally → ship to VPS. Only local main pushes to remote main.\n' \
        "$c_dim" "$c_rst" "$c_bold" "$c_rst" "$c_bold" "$c_rst"
fi
if [[ "$SHOW_GIT" == true ]]; then
    printf '%sReminder:%s wt/* commits are LOCAL and never go to origin — they reach the VPS only by being merged into local main, then pushed to remote main.\n' \
        "$c_dim" "$c_rst"
fi

# Dashboard always exits clean on a completed run (set -e already aborts on real
# errors); avoids leaking a trailing test's / empty-read's nonzero status.
exit 0
