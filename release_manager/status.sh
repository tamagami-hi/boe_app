#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# status.sh — the CONTROL CENTER. The one script an operator needs to remember.
#
# It owns no deployment logic of its own. It shows state and drives the other
# three scripts, so there is exactly one implementation of each operation:
#
#   export.sh    build images/APKs and stage a bundle   (advances the version)
#   deploy.sh    ship a bundle and run the remote deploy
#   rollback.sh  run the remote rollback
#
# It is also the only place that CUTS a release: bump VERSION, commit, tag, push.
# export.sh reads that tag; it never creates one.
#
# Usage:
#   ./release_manager/status.sh              interactive menu
#   ./release_manager/status.sh --status     print the state table and exit
#   ./release_manager/status.sh --diagnose   run the VPS readiness check and exit
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RM_DIR="$ROOT_DIR/release_manager"
BUILD_DIR="$RM_DIR/build"
LEDGER="$RM_DIR/state/versions.json"
VERSION_FILE="$ROOT_DIR/VERSION"

# shellcheck source=lib/ui.sh
source "$RM_DIR/lib/ui.sh"
# shellcheck source=lib/version.sh
source "$RM_DIR/lib/version.sh"
# shellcheck source=lib/stacks.sh
source "$RM_DIR/lib/stacks.sh"
# shellcheck source=lib/paths.sh
source "$RM_DIR/lib/paths.sh"
# shellcheck source=lib/repo_sync.sh
source "$RM_DIR/lib/repo_sync.sh"
# shellcheck source=lib/git_workflow.sh
source "$RM_DIR/lib/git_workflow.sh"
# shellcheck source=lib/input_validation.sh
source "$RM_DIR/lib/input_validation.sh"

for c in jq git ssh; do
    command -v "$c" >/dev/null || { err "$c is required"; exit 1; }
done
for remote_root in "$BOE_VPS_ROOT" "$BOE_BACKUP_ROOT" "$BOE_BACKUP_MOUNT"; do
    is_safe_absolute_remote_path "$remote_root" || {
        err "unsafe configured remote path: $remote_root"
        exit 1
    }
done

# Cache of remote state so a single menu render costs one SSH round trip.
REMOTE_STATE=""
REMOTE_FETCHED=false

# ── helpers ─────────────────────────────────────────────────────────────────

latest_bundle() {
    find "$BUILD_DIR/$1" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n1
}

bundle_version() {
    local b; b="$(latest_bundle "$1")"
    [[ -n "$b" && -f "$b/manifest.json" ]] || return 0
    jq -r '.version // empty' "$b/manifest.json" 2>/dev/null || true
}

ledger_get() {
    [[ -s "$LEDGER" ]] || return 0
    jq -r --arg s "$1" --arg k "$2" '.[$s][$k] // empty' "$LEDGER" 2>/dev/null || true
}

# fetch_remote_state — one SSH call that returns every stack's live version,
# status and container count. Everything the dashboard needs.
fetch_remote_state() {
    [[ "$REMOTE_FETCHED" == true ]] && return 0
    REMOTE_FETCHED=true
    REMOTE_STATE="$(boe_ssh "bash -s -- '$BOE_VPS_ROOT' '$BOE_BACKUP_MOUNT' '$BOE_BACKUP_ROOT'" <<'REMOTE' 2>/dev/null || true
set -u
root="$1"; mount="$2"; broot="$3"
printf 'REACHABLE=yes\n'
printf 'DOCKER=%s\n'          "$(docker info >/dev/null 2>&1 && echo yes || echo no)"
printf 'BACKUP_MOUNTED=%s\n'  "$(mountpoint -q "$mount" && echo yes || echo no)"
printf 'BACKUP_WRITABLE=%s\n' "$([[ -w "$broot" ]] && echo yes || echo no)"
printf 'DISK_STACK=%s\n'      "$(df -h --output=avail "$root" 2>/dev/null | tail -n1 | tr -d ' ')"
printf 'DISK_BACKUP=%s\n'     "$(df -h --output=avail "$mount" 2>/dev/null | tail -n1 | tr -d ' ')"
printf 'NGINX=%s\n'           "$(systemctl is-active nginx 2>/dev/null || echo unknown)"
for s in dev_release:dev-version.json prod_release:release-version.json monitor_service:monitor_service-version.json; do
  stack="${s%%:*}"; vf="${s##*:}"; d="$root/$stack"
  v=""; st=""
  if [[ -s "$d/$vf" ]]; then
    v="$(jq -r '.version // empty' "$d/$vf" 2>/dev/null || true)"
    st="$(jq -r '.status // empty'  "$d/$vf" 2>/dev/null || true)"
  fi
  printf '%s_VERSION=%s\n' "$stack" "$v"
  printf '%s_STATUS=%s\n'  "$stack" "$st"
  printf '%s_ENV=%s\n'     "$stack" "$([[ -s "$d/.env" ]] && echo yes || echo no)"
  env_mode="$(stat -c '%a' "$d/.env" 2>/dev/null || true)"
  env_owner="$(stat -c '%U:%G' "$d/.env" 2>/dev/null || true)"
  env_safe=no
  if [[ ! -L "$d/.env" && -f "$d/.env" && -r "$d/.env" ]]; then
    env_uid="$(stat -c '%u' "$d/.env" 2>/dev/null || true)"
    env_links="$(stat -c '%h' "$d/.env" 2>/dev/null || true)"
    if [[ "$env_links" == 1 ]] && { [[ "$env_uid" == "$(id -u)" && "$env_mode" == 600 ]] || [[ "$env_uid" == 0 && "$env_mode" == 640 ]]; }; then
      env_safe=yes
    fi
  fi
  printf '%s_ENV_MODE=%s\n'  "$stack" "$env_mode"
  printf '%s_ENV_OWNER=%s\n' "$stack" "$env_owner"
  printf '%s_ENV_SAFE=%s\n'  "$stack" "$env_safe"
  # -s not -f: the original VPS scaffold contains a 0-byte paths.json, so an
  # existence test would report an unshipped stack as provisioned.
  printf '%s_SHIPPED=%s\n' "$stack" "$([[ -s "$d/paths.json" ]] && jq -e . "$d/paths.json" >/dev/null 2>&1 && echo yes || echo no)"
done
printf 'CONTAINERS<<\n'
docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null | grep -E '^boe' || true
printf '>>\n'
REMOTE
)"
    [[ -n "$REMOTE_STATE" ]] || REMOTE_STATE="REACHABLE=no"
}

rs() { printf '%s\n' "$REMOTE_STATE" | sed -n "s/^$1=//p" | tail -n1; }

# ── dashboard ───────────────────────────────────────────────────────────────

show_status() {
    fetch_remote_state

    local canonical
    canonical="$(canonical_version "$VERSION_FILE" "$BUILD_DIR/prod_release" "$ROOT_DIR")"

    printf '\n%s╔══════════════════════════════════════════════════════════════════════╗%s\n' "$c_bold" "$c_rst"
    printf '%s║  BeOnEdge · BOE_APP release control center                            ║%s\n' "$c_bold" "$c_rst"
    printf '%s╚══════════════════════════════════════════════════════════════════════╝%s\n' "$c_bold" "$c_rst"

    # ── repository ──────────────────────────────────────────────────────────
    repo_sync_eval "$RM_DIR" >/dev/null 2>&1 || true
    local dirty_note=""
    [[ "${RS_DIRTY:-0}" != "0" ]] && dirty_note=" ${c_yel}(${RS_DIRTY} uncommitted)${c_rst}"

    printf '\n%s━━ repository%s\n' "$c_bold" "$c_rst"
    field "VERSION file" "$canonical"
    field "branch"       "$(git -C "$ROOT_DIR" symbolic-ref --short -q HEAD 2>/dev/null || echo detached)"
    printf '   %s%-18s%s %s%b\n' "$c_dim" "local HEAD" "$c_rst" "${RS_LOCAL_SHA:-?}" "$dirty_note"
    field "origin/main"  "${RS_REMOTE_SHA:-<unknown>}"
    if [[ "${RS_IDENTICAL:-false}" == true ]]; then
        ok "local main matches origin/main"
    else
        warn "local main and origin/main differ (ahead ${RS_AHEAD:-?}, behind ${RS_BEHIND:-?})"
    fi
    if on_exact_release_tag "$ROOT_DIR" "$canonical"; then
        ok "HEAD is exactly tag v$canonical → export produces a STABLE bundle"
    else
        info "HEAD is not on tag v$canonical → export produces a DEV bundle"
    fi

    # ── VPS ─────────────────────────────────────────────────────────────────
    printf '\n%s━━ vps (%s)%s\n' "$c_bold" "$BOE_SSH_ALIAS" "$c_rst"
    if [[ "$(rs REACHABLE)" != "yes" ]]; then
        err "unreachable over SSH"
    else
        ok "reachable"
        [[ "$(rs DOCKER)" == "yes" ]] && ok "docker usable" || err "docker NOT usable"
        [[ "$(rs BACKUP_MOUNTED)" == "yes" ]] && ok "backup disk mounted" || err "backup disk NOT mounted"
        if [[ "$(rs BACKUP_WRITABLE)" == "yes" ]]; then
            ok "backup tree writable"
        else
            err "backup tree NOT writable — deploys will refuse (see menu option 9)"
        fi
        field "nginx"        "$(rs NGINX)"
        field "free /srv/dev_stack" "$(rs DISK_STACK)"
        field "free /srv/backup"    "$(rs DISK_BACKUP)"
    fi

    # ── stacks ──────────────────────────────────────────────────────────────
    printf '\n%s━━ stacks%s\n' "$c_bold" "$c_rst"
    printf '   %s%-17s %-28s %-28s %-10s%s\n' "$c_dim" "STACK" "STAGED (local)" "DEPLOYED (vps)" "SYNC" "$c_rst"
    local s built deployed status mark
    for s in "${BOE_STACKS[@]}"; do
        built="$(bundle_version "$s")"
        deployed="$(rs "${s}_VERSION")"
        status="$(rs "${s}_STATUS")"
        if [[ -n "$built" && -n "$deployed" && "$built" == "$deployed" ]]; then
            mark="${c_grn}in sync${c_rst}"
        elif [[ -n "$built" && "$built" != "$deployed" ]]; then
            mark="${c_yel}ship pending${c_rst}"
        elif [[ -z "$built" && -n "$deployed" ]]; then
            mark="${c_dim}no bundle${c_rst}"
        else
            mark="${c_dim}not started${c_rst}"
        fi
        printf '   %-17s %-28s %-28s %b\n' \
            "$s" "${built:-—}" "${deployed:-—}${status:+ ($status)}" "$mark"
    done

    # ── containers ──────────────────────────────────────────────────────────
    local containers
    containers="$(printf '%s\n' "$REMOTE_STATE" | sed -n '/^CONTAINERS<</,/^>>/p' | sed '1d;$d')"
    printf '\n%s━━ running containers%s\n' "$c_bold" "$c_rst"
    if [[ -n "$containers" ]]; then
        printf '%s\n' "$containers" | while IFS=$'\t' read -r n st; do
            printf '   %-42s %s\n' "$n" "$st"
        done
    else
        info "no boe-* containers running"
    fi

    # ── readiness ───────────────────────────────────────────────────────────
    printf '\n%s━━ configuration readiness%s\n' "$c_bold" "$c_rst"
    for s in "${BOE_STACKS[@]}"; do
        local shipped envp
        shipped="$(rs "${s}_SHIPPED")"; envp="$(rs "${s}_ENV")"
        if [[ "$shipped" != "yes" ]]; then
            warn "$s: never shipped (no paths.json on the VPS)"
        elif [[ "$envp" != "yes" ]]; then
            warn "$s: shipped, but .env is missing or empty on the VPS"
        else
            ok "$s: provisioned"
        fi
    done
    printf '\n'
}

# ── actions ─────────────────────────────────────────────────────────────────

pick_stack() {
    local prompt="${1:-Select stack}"
    printf '\n   1) dev_release      (development)\n' >&2
    printf '   2) prod_release     (production)\n' >&2
    printf '   3) monitor_service  (monitoring)\n' >&2
    printf '\n%s   ➜ %s [1-3]: %s' "$c_bold" "$prompt" "$c_rst" >&2
    local n; read -r n
    case "$n" in
        1) printf 'dev_release\n' ;;
        2) printf 'prod_release\n' ;;
        3) printf 'monitor_service\n' ;;
        *) return 1 ;;
    esac
}

stack_flag() {
    case "$1" in
        dev_release)      printf -- '--dev\n' ;;
        prod_release)     printf -- '--prod\n' ;;
        monitor_service)  printf -- '--monitor\n' ;;
    esac
}

action_export() {
    local s flag extra=()
    s="$(pick_stack 'Export which stack?')" || { err "invalid selection"; return 1; }
    flag="$(stack_flag "$s")"
    if [[ "$s" != "monitor_service" ]] && confirm "Also build the Android APKs?"; then
        extra+=(--with-apk)
    fi
    printf '\n'
    "$RM_DIR/export.sh" "$flag" "${extra[@]}"
}

action_deploy() {
    local s flag
    s="$(pick_stack 'Deploy which stack?')" || { err "invalid selection"; return 1; }
    flag="$(stack_flag "$s")"
    local b; b="$(latest_bundle "$s")"
    if [[ -z "$b" ]]; then
        err "no bundle staged for $s"
        confirm "Run export for $s now?" && "$RM_DIR/export.sh" "$flag" || return 1
    fi
    printf '\n'
    "$RM_DIR/deploy.sh" "$flag"
    REMOTE_FETCHED=false
}

action_rollback() {
    local s flag
    s="$(pick_stack 'Roll back which stack?')" || { err "invalid selection"; return 1; }
    flag="$(stack_flag "$s")"
    printf '\n'
    # Always show the inventory first so a target is chosen from fact.
    "$RM_DIR/rollback.sh" "$flag" --list || return 1
    printf '\n   1) roll back to the latest archived version\n'
    printf '   2) roll back to a specific version\n'
    printf '   3) cancel\n'
    printf '\n%s   ➜ choice [1-3]: %s' "$c_bold" "$c_rst"
    local n; read -r n
    case "$n" in
        1) "$RM_DIR/rollback.sh" "$flag" --latest ;;
        2) printf '%s   ➜ version: %s' "$c_bold" "$c_rst"; local v; read -r v
           [[ -n "$v" ]] || { err "no version given"; return 1; }
           local dbflag=()
           confirm "Also restore that release's database snapshot? (DESTRUCTIVE)" && dbflag+=(--restore-db)
           "$RM_DIR/rollback.sh" "$flag" --to "$v" "${dbflag[@]}" ;;
        *) warn "cancelled" ;;
    esac
    REMOTE_FETCHED=false
}

action_apk() {
    printf '\n   1) development APKs (client + admin)\n'
    printf '   2) production APKs (client + admin)\n'
    printf '   3) cancel\n'
    printf '\n%s   ➜ choice [1-3]: %s' "$c_bold" "$c_rst"
    local n; read -r n
    case "$n" in
        1) "$ROOT_DIR/emu/boe_update.sh" --dev --both ;;
        2) "$ROOT_DIR/emu/boe_update.sh" --prod --both ;;
        *) warn "cancelled" ;;
    esac
}

assert_release_origin_approved() {
    if ! release_origin_is_approved "$ROOT_DIR"; then
        err "origin must have exactly one fetch URL and one push URL"
        err "both must be the approved BeOnEdge GitHub repository"
        return 1
    fi
}

action_git_workflow() {
    section "GIT WORKFLOW" "commit worktrees/main → integrate → review PRs → push main"
    assert_release_origin_approved || return 1
    git_workflow_run "$ROOT_DIR"
}

prepare_release_git() {
    local branch
    branch="$(git -C "$ROOT_DIR" symbolic-ref --short -q HEAD || true)"
    [[ "$branch" == main ]] || {
        err "releases must be cut from main, not ${branch:-detached HEAD}"
        return 1
    }
    assert_release_origin_approved || return 1

    repo_sync_eval "$ROOT_DIR"
    if [[ "$RS_CLEAN_SYNC" != true ]]; then
        warn "main is not clean and synchronized with origin/main"
        confirm "Run the Git workflow now (commit, integrate and push)?" || return 1
        action_git_workflow || return 1
        repo_sync_eval "$ROOT_DIR"
    fi

    [[ "$RS_FETCHED" == true && "$RS_HAS_REMOTE" == true && "$RS_CLEAN_SYNC" == true ]] || {
        err "release gate failed: require a fresh fetch and clean main == origin/main"
        return 1
    }
    [[ "$(git -C "$ROOT_DIR" rev-parse HEAD)" == "$(git -C "$ROOT_DIR" rev-parse refs/heads/main)" ]] || {
        err "HEAD is not the main branch tip"
        return 1
    }
}

# Cut a release: bump VERSION, commit, tag, push. The ONLY place this happens.
action_cut_release() {
    local canonical next bump remote_tag_status
    prepare_release_git || return 1
    canonical="$(canonical_version "$VERSION_FILE" "$BUILD_DIR/prod_release" "$ROOT_DIR")"
    assert_semver "$canonical" || return 1

    section "CUT RELEASE" "current: $canonical"
    printf '   1) patch → %s\n' "$(bump_version "$canonical" patch)"
    printf '   2) minor → %s\n' "$(bump_version "$canonical" minor)"
    printf '   3) major → %s\n' "$(bump_version "$canonical" major)"
    printf '   4) cancel\n'
    printf '\n%s   ➜ choice [1-4]: %s' "$c_bold" "$c_rst"
    local n; read -r n
    case "$n" in
        1) bump=patch ;;
        2) bump=minor ;;
        3) bump=major ;;
        *) warn "cancelled"; return 0 ;;
    esac
    next="$(bump_version "$canonical" "$bump")"
    if git -C "$ROOT_DIR" rev-parse --verify --quiet "refs/tags/v$next" >/dev/null; then
        err "release tag v$next already exists locally"
        return 1
    fi
    remote_tag_status=0
    git -C "$ROOT_DIR" ls-remote --exit-code --tags origin "refs/tags/v$next" \
        >/dev/null 2>&1 || remote_tag_status=$?
    case "$remote_tag_status" in
        0) err "release tag v$next already exists on origin"; return 1 ;;
        2) : ;;
        *) err "could not verify whether v$next exists on origin"; return 1 ;;
    esac

    printf '\n'
    field "new version" "$next"
    field "tag"         "v$next"
    field "branch"      "main"
    confirm "Cut release v$next (commit, tag and atomically push)?" || { warn "cancelled"; return 0; }

    printf '%s\n' "$next" > "$VERSION_FILE" || {
        err "could not write VERSION"
        return 1
    }
    git -C "$ROOT_DIR" add -- VERSION || {
        err "could not stage VERSION"
        return 1
    }
    git -C "$ROOT_DIR" commit -m "chore(release): v$next" || {
        err "release commit failed; no tag or push was attempted"
        return 1
    }
    git -C "$ROOT_DIR" tag -a "v$next" -m "Release v$next" || {
        err "release tag failed; nothing was pushed"
        return 1
    }
    git -C "$ROOT_DIR" push --atomic origin \
        refs/heads/main:refs/heads/main \
        "refs/tags/v$next:refs/tags/v$next" || {
            err "atomic release push failed; origin was not partially updated"
            warn "push outcome may be ambiguous; retained local commit and tag v$next"
            warn "retry the atomic push after checking origin; stable export remains blocked until the remote tag matches"
            return 1
        }
    ok "committed, tagged and pushed v$next"
    printf '\n   Next:  ./release_manager/export.sh --prod\n\n'
}

action_regenerate() {
    section "REGENERATE STACK ARTIFACTS" "paths.json from lib/stacks.sh"
    local s
    for s in "${BOE_STACKS[@]}"; do
        paths_write "$s" "$RM_DIR/stacks/$s/paths.json" && ok "$s/paths.json"
    done
    info "re-ship for these to take effect on the VPS:  ./release_manager/deploy.sh <stack> --ship-only"
}

action_logs() {
    local s dir
    s="$(pick_stack 'Show logs for which stack?')" || { err "invalid selection"; return 1; }
    dir="$(paths_get "$RM_DIR/stacks/$s/paths.json" .backup.deploy_log)" || { err "cannot resolve log dir"; return 1; }
    is_safe_absolute_remote_path "$dir" || { err "unsafe remote log directory"; return 1; }
    printf '\n'
    step "last 5 deploy logs in $dir"
    boe_ssh "ls -1t '$dir' 2>/dev/null | head -5" || warn "none found"
    printf '\n%s   ➜ log filename to view (blank to skip): %s' "$c_bold" "$c_rst"
    local f; read -r f
    [[ -n "$f" ]] || return 0
    is_safe_log_basename "$f" || { err "invalid log filename"; return 1; }
    boe_ssh "bash -s -- '$dir' '$f'" <<'REMOTE' || { err "cannot read that log"; return 1; }
set -eu
dir="$1"
file="$2"
case "$file" in
  ''|.|..|*[!A-Za-z0-9._-]*) exit 64 ;;
esac
tail -n 80 -- "$dir/$file"
REMOTE
}

action_containers() {
    local s
    s="$(pick_stack 'Inspect which stack?')" || { err "invalid selection"; return 1; }
    local d project
    d="$(stack_dir "$s")"
    project="$(stack_attr "$s" project)"
    printf '\n'
    step "compose ps"
    boe_ssh "cd '$d' 2>/dev/null && docker compose --project-name '$project' -f '$(stack_attr "$s" compose)' ps 2>&1 || echo 'stack not deployed'"
    printf '\n'
    step "recent container logs"
    boe_ssh "docker ps --filter name=^/$(stack_attr "$s" prefix) --format '{{.Names}}' | head -20"
}

action_diagnose() {
    banner "VPS READINESS DIAGNOSIS"
    REMOTE_FETCHED=false
    fetch_remote_state

    local blockers=0

    section "connectivity"
    if [[ "$(rs REACHABLE)" == "yes" ]]; then ok "SSH to $BOE_SSH_ALIAS"; else err "SSH failed"; blockers=$((blockers+1)); fi
    if [[ "$(rs DOCKER)" == "yes" ]]; then ok "docker usable without sudo"; else err "docker not usable"; blockers=$((blockers+1)); fi

    section "storage"
    if [[ "$(rs BACKUP_MOUNTED)" == "yes" ]]; then ok "$BOE_BACKUP_MOUNT is a mountpoint"; else err "$BOE_BACKUP_MOUNT not mounted"; blockers=$((blockers+1)); fi
    if [[ "$(rs BACKUP_WRITABLE)" == "yes" ]]; then
        ok "$BOE_BACKUP_ROOT writable"
    else
        err "$BOE_BACKUP_ROOT NOT writable by the deploy user"
        printf '\n     %sFix (run on the VPS, once):%s\n' "$c_bold" "$c_rst"
        printf '       sudo chown -R beonedge:beonedge %s\n' "$BOE_BACKUP_ROOT"
        printf '       sudo chmod -R u+rwX,go+rX %s\n\n' "$BOE_BACKUP_ROOT"
        blockers=$((blockers+1))
    fi
    field "free /srv/dev_stack" "$(rs DISK_STACK)"
    field "free /srv/backup"    "$(rs DISK_BACKUP)"

    section "host services"
    field "nginx" "$(rs NGINX)"
    step "checking TLS certificates and listeners"
    boe_ssh "ls /etc/letsencrypt/live 2>/dev/null | head" >/dev/null 2>&1 \
        && ok "letsencrypt directory present" \
        || warn "no TLS certificates yet — see OPERATOR_MANUAL_STEPS.md §5"
    boe_ssh "ss -lnt 2>/dev/null | grep -q ':443 '" \
        && ok "something is listening on :443" \
        || warn ":443 is not listening — HTTPS is not configured yet"

    section "per-stack provisioning"
    local s
    for s in "${BOE_STACKS[@]}"; do
        printf '\n   %s%s%s\n' "$c_bold" "$s" "$c_rst"
        [[ "$(rs "${s}_SHIPPED")" == "yes" ]] && ok "  paths.json present" || warn "  never shipped"
        if [[ "$(rs "${s}_ENV")" != "yes" ]]; then
            warn "  .env missing/empty"
        elif [[ "$(rs "${s}_ENV_SAFE")" == "yes" ]]; then
            ok "  .env secure ($(rs "${s}_ENV_OWNER") mode $(rs "${s}_ENV_MODE"))"
        else
            warn "  .env permissions unsafe ($(rs "${s}_ENV_OWNER") mode $(rs "${s}_ENV_MODE"))"
            blockers=$((blockers+1))
        fi
        local v st
        v="$(rs "${s}_VERSION")"
        st="$(rs "${s}_STATUS")"
        if [[ -n "$v" ]]; then
            ok "  deployed: $v (${st:-unknown})"
        else
            info "  not deployed"
        fi
    done

    printf '\n'
    if (( blockers == 0 )); then
        ok "no blocking issues found"
    else
        err "$blockers blocking issue(s) — see release_manager/OPERATOR_MANUAL_STEPS.md"
    fi
    printf '\n'
}

action_operator_guide() {
    local guide="$RM_DIR/OPERATOR_MANUAL_STEPS.md"
    [[ -f "$guide" ]] || { err "guide not found: $guide"; return 1; }
    if command -v less >/dev/null; then less "$guide"; else cat "$guide"; fi
}

# ── entry ───────────────────────────────────────────────────────────────────

case "${1:-}" in
    --status)   show_status; exit 0 ;;
    --diagnose) action_diagnose; exit 0 ;;
    --help|-h)
        cat <<'USAGE'
Usage: ./release_manager/status.sh [--status | --diagnose]

With no arguments, opens the interactive control center.

  --status      print the state dashboard and exit
  --diagnose    run the VPS readiness check and exit
USAGE
        exit 0 ;;
    "") : ;;
    *) err "unknown argument: $1"; exit 1 ;;
esac

[[ "$UI_INTERACTIVE" == true ]] || { err "not a terminal — use --status or --diagnose"; exit 1; }

while true; do
    show_status
    cat <<MENU
${c_bold}━━ actions${c_rst}
   1) Export a bundle        build images (+APKs) and stage a release
   2) Deploy                 ship a bundle and run the remote deploy
   3) Roll back              run the remote rollback
   4) Build APKs only        no docker images, no shipping
   5) Git workflow           commit worktrees/main, review PRs, push
   6) Cut a release          prepare Git, bump VERSION, tag, push
   7) Regenerate paths.json  after editing lib/stacks.sh
   8) View deploy logs       tail a remote deploy log
   9) Inspect containers     remote compose ps
  10) Diagnose the VPS       readiness + blockers, with fixes
  11) Operator manual        the steps you must run by hand
   r) Refresh
   q) Quit

MENU
    printf '%s   ➜ choice: %s' "$c_bold" "$c_rst"
    read -r choice || break
    case "$choice" in
        1)  action_export        || warn "export did not complete" ;;
        2)  action_deploy        || warn "deploy did not complete" ;;
        3)  action_rollback      || warn "rollback did not complete" ;;
        4)  action_apk           || warn "APK build did not complete" ;;
        5)  action_git_workflow  || warn "Git workflow did not complete" ;;
        6)  action_cut_release   || warn "release not cut" ;;
        7)  action_regenerate ;;
        8)  action_logs          || true ;;
        9)  action_containers    || true ;;
        10) action_diagnose ;;
        11) action_operator_guide || true ;;
        r|R) REMOTE_FETCHED=false ;;
        q|Q) printf '\n'; exit 0 ;;
        *)  warn "unknown choice: $choice" ;;
    esac
    printf '\n%s   ➜ press Enter to continue %s' "$c_dim" "$c_rst"
    read -r _ || break
done
