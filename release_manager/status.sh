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
#   ./release_manager/status.sh --reload <stack>
#                          recreate the deployed stack's containers with the
#                          current on-VPS .env (dev|prod|monitor; nothing is
#                          shipped and the version does not change)
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
# shellcheck source=lib/apk_ship.sh
source "$RM_DIR/lib/apk_ship.sh"

for c in jq git ssh; do
    command -v "$c" >/dev/null || { err "$c is required"; exit 1; }
done

# The tracked contracts are the sole path authority. Validate all three before
# anything reads a path, then take the shared roots from them (they agree —
# the cross-stack check proves it).
for _s in "${BOE_STACKS[@]}"; do
    paths_validate "$_s" "$(stack_paths_file "$_s")" || {
        err "the $_s path contract failed validation — fix stacks/$_s/paths.json"
        exit 1
    }
done
paths_validate_cross_stack || { err "path contracts disagree across stacks"; exit 1; }
_paths_dev="$(stack_paths_file dev_release)"
VPS_ROOT="$(paths_get "$_paths_dev" .vps.root)" || exit 1
BACKUP_ROOT="$(paths_get "$_paths_dev" .backup.root)" || exit 1
BACKUP_MOUNT="$(paths_get "$_paths_dev" .backup.mount_check)" || exit 1
unset _paths_dev
for remote_root in "$VPS_ROOT" "$BACKUP_ROOT" "$BACKUP_MOUNT"; do
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
    bundle_path_newest "$BUILD_DIR/$1"
}

bundle_version() {
    local b; b="$(latest_bundle "$1")"
    [[ -n "$b" && -f "$b/manifest.json" ]] || return 0
    jq -r '.version // empty' "$b/manifest.json" 2>/dev/null || true
}

# fetch_remote_state — one SSH call that returns every stack's live version,
# status and container count. Everything the dashboard needs. Every remote
# path comes from the validated contracts; nothing is constructed here.
fetch_remote_state() {
    [[ "$REMOTE_FETCHED" == true ]] && return 0
    REMOTE_FETCHED=true

    local s f
    # One argv element per value: the remote shell re-parses the command
    # string, so a '|'-joined spec would be read as a pipeline.
    local -a rargs=("$BACKUP_MOUNT" "$BACKUP_ROOT")
    for s in "${BOE_STACKS[@]}"; do
        f="$(stack_paths_file "$s")"
        rargs+=("$(paths_get "$f" .vps.stack_dir)"
                "$(paths_get "$f" .vps.version_name)"
                "$(paths_get "$f" .vps.env_file)")
    done

    local qcmd="bash -s --" a
    for a in "${rargs[@]}"; do
        printf -v a '%q' "$a"
        qcmd+=" $a"
    done

    REMOTE_STATE="$(boe_ssh "$qcmd" <<'REMOTE' 2>/dev/null || true
set -u
mount="$1"; broot="$2"; shift 2
printf 'REACHABLE=yes\n'
printf 'JQ=%s\n'             "$(command -v jq >/dev/null 2>&1 && echo yes || echo no)"
printf 'DOCKER=%s\n'          "$(docker info >/dev/null 2>&1 && echo yes || echo no)"
printf 'BACKUP_MOUNTED=%s\n'  "$(mountpoint -q "$mount" && echo yes || echo no)"
printf 'BACKUP_WRITABLE=%s\n' "$([[ -w "$broot" ]] && echo yes || echo no)"
printf 'DISK_STACK=%s\n'      "$(df -h --output=avail "$1" 2>/dev/null | tail -n1 | tr -d ' ')"
printf 'DISK_BACKUP=%s\n'     "$(df -h --output=avail "$mount" 2>/dev/null | tail -n1 | tr -d ' ')"
printf 'NGINX=%s\n'           "$(systemctl is-active nginx 2>/dev/null || echo unknown)"
while (( $# >= 3 )); do
  d="$1"; vf="$2"; envf="$3"; shift 3
  stack="${d##*/}"
  v=""; st=""
  if [[ -s "$d/$vf" ]] && command -v jq >/dev/null 2>&1; then
    v="$(jq -r '.version // empty' "$d/$vf" 2>/dev/null || true)"
    st="$(jq -r '.status // empty'  "$d/$vf" 2>/dev/null || true)"
  fi
  printf '%s_VERSION=%s\n' "$stack" "$v"
  printf '%s_STATUS=%s\n'  "$stack" "$st"
  printf '%s_ENV=%s\n'     "$stack" "$([[ -s "$envf" ]] && echo yes || echo no)"
  env_mode="$(stat -c '%a' "$envf" 2>/dev/null || true)"
  env_owner="$(stat -c '%U:%G' "$envf" 2>/dev/null || true)"
  env_safe=no
  if [[ ! -L "$envf" && -f "$envf" && -r "$envf" ]]; then
    env_uid="$(stat -c '%u' "$envf" 2>/dev/null || true)"
    env_links="$(stat -c '%h' "$envf" 2>/dev/null || true)"
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

# rs <key> — one value out of the cached remote state. First-writer wins
# (head -n1): a duplicated key cannot smuggle a second value past the first.
# Values are remote output, so control bytes (including ESC) are stripped
# before they ever reach the terminal.
rs() {
    printf '%s\n' "$REMOTE_STATE" | sed -n "s/^$1=//p" | head -n1 \
        | LC_ALL=C tr -d '\000-\010\013-\037\177'
}

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
            err "backup tree NOT writable — see Ship + Deploy → Diagnose the VPS"
        fi
        field "nginx"        "$(rs NGINX)"
        field "free stack disk"  "$(rs DISK_STACK)"
        field "free backup disk" "$(rs DISK_BACKUP)"
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

# status_lock — serialize local state-mutating actions (cutting a release,
# publishing APKs) against a second status.sh running on the same checkout.
status_lock() {
    mkdir -p "$RM_DIR/state"
    exec 9>"$RM_DIR/state/.status.lock"
    flock -n 9 || { err "another status.sh release action is in progress"; return 1; }
}

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
    local mode="${1:-build}" s flag
    local -a extra=()
    s="$(pick_stack 'Export which stack?')" || { err "invalid selection"; return 1; }
    flag="$(stack_flag "$s")"
    case "$mode" in
        build) : ;;
        restage) extra+=(--skip-build) ;;
        *) err "unknown export mode: $mode"; return 1 ;;
    esac
    if [[ "$s" != "monitor_service" ]] && confirm "Also build the Android APKs?"; then
        extra+=(--with-apk)
    fi
    printf '\n'
    "$RM_DIR/export.sh" "$flag" "${extra[@]}"
}

action_deploy() {
    local mode="${1:-deploy}" s flag deploy_rc=0
    local -a extra=()
    s="$(pick_stack 'Deploy which stack?')" || { err "invalid selection"; return 1; }
    flag="$(stack_flag "$s")"
    case "$mode" in
        deploy) : ;;
        ship-only) extra+=(--ship-only) ;;
        force) extra+=(--force) ;;
        *) err "unknown deployment mode: $mode"; return 1 ;;
    esac
    local b; b="$(latest_bundle "$s")"
    if [[ -z "$b" ]]; then
        err "no bundle staged for $s"
        confirm "Run export for $s now?" && "$RM_DIR/export.sh" "$flag" || return 1
    fi
    printf '\n'
    "$RM_DIR/deploy.sh" "$flag" "${extra[@]}" || deploy_rc=$?
    REMOTE_FETCHED=false
    return "$deploy_rc"
}

# action_reload [stack] — recreate the deployed containers with the CURRENT
# on-VPS .env and the already-deployed images. Nothing is shipped, the version
# does not change. This is the right tool after editing the stack's .env on
# the VPS (compose re-reads it on `up -d`; a plain `restart` would not).
action_reload() {
    local s="${1:-}" f d project compose prefix vname reload_rc=0
    if [[ -z "$s" ]]; then
        s="$(pick_stack 'Reload which stack?')" || { err "invalid selection"; return 1; }
    else
        case "$s" in
            dev|dev_release)          s=dev_release ;;
            prod|prod_release)        s=prod_release ;;
            monitor|monitor_service)  s=monitor_service ;;
            *) err "unknown stack: $s (expected dev|prod|monitor)"; return 1 ;;
        esac
    fi
    f="$(stack_paths_file "$s")"
    d="$(paths_get "$f" .vps.stack_dir)"        || { err "cannot resolve the stack directory"; return 1; }
    project="$(paths_get "$f" .vps.compose_project)" || { err "cannot resolve the compose project"; return 1; }
    compose="$(paths_get "$f" .vps.compose_name)"    || { err "cannot resolve the compose file name"; return 1; }
    prefix="$(paths_get "$f" .vps.container_prefix)" || { err "cannot resolve the container prefix"; return 1; }
    vname="$(paths_get "$f" .vps.version_name)"      || { err "cannot resolve the version file name"; return 1; }

    section "RELOAD $s" "recreate containers with the current on-VPS config; nothing is shipped"
    if [[ "$UI_INTERACTIVE" == true ]]; then
        confirm "Reload $s on the VPS now?" || { warn "cancelled"; return 0; }
    fi
    printf '\n'
    local qd qp qc qpr qv
    printf -v qd '%q' "$d"
    printf -v qp '%q' "$project"
    printf -v qc '%q' "$compose"
    printf -v qpr '%q' "$prefix"
    printf -v qv '%q' "$vname"
    # The compose file interpolates ${BOE_VERSION} into image tags, so the
    # reload must pin it to the version the VPS has actually deployed —
    # otherwise compose would try to start tags that were never shipped.
    boe_ssh "bash -s -- $qd $qp $qc $qpr $qv" <<'REMOTE' || reload_rc=$?
set -euo pipefail
d="$1"; project="$2"; compose="$3"; prefix="$4"; vname="$5"
cd "$d"
version="$(jq -r '.version // empty' "$vname")"
[[ -n "$version" ]] || { echo "no deployed version recorded in $d/$vname — ship + deploy first" >&2; exit 65; }
echo "reloading stack: version $version"
BOE_VERSION="$version" BOE_CONTAINER_PREFIX="$prefix" \
    docker compose --project-name "$project" -f "$compose" up -d --remove-orphans
BOE_VERSION="$version" BOE_CONTAINER_PREFIX="$prefix" \
    docker compose --project-name "$project" -f "$compose" ps
REMOTE
    REMOTE_FETCHED=false
    return "$reload_rc"
}

action_rollback() {
    local s flag rollback_rc=0
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
        1) "$RM_DIR/rollback.sh" "$flag" --latest || rollback_rc=$? ;;
        2) printf '%s   ➜ version: %s' "$c_bold" "$c_rst"; local v; read -r v
           [[ -n "$v" ]] || { err "no version given"; return 1; }
           local dbflag=()
           confirm "Also restore that release's database snapshot? (DESTRUCTIVE)" && dbflag+=(--restore-db)
           "$RM_DIR/rollback.sh" "$flag" --to "$v" "${dbflag[@]}" || rollback_rc=$? ;;
        *) warn "cancelled" ;;
    esac
    REMOTE_FETCHED=false
    return "$rollback_rc"
}

action_apk() {
    status_lock || return 1
    printf '\n   1) development APKs (client + admin)\n'
    printf '   2) production APKs (client + admin)\n'
    printf '   3) cancel\n'
    printf '\n%s   ➜ choice [1-3]: %s' "$c_bold" "$c_rst"
    local n stack target version expected_git="" mode=dev
    read -r n
    case "$n" in
        1) stack=dev_release; target=dev ;;
        2) stack=prod_release; target=prod ;;
        *) warn "cancelled"; return 0 ;;
    esac
    version="$(canonical_version "$VERSION_FILE" "$BUILD_DIR/prod_release" "$ROOT_DIR")"
    assert_semver "$version" || return 1
    if [[ "$target" == prod ]]; then
        # Gate BEFORE any build: a production APK may only ever be published
        # from the clean, tagged, pushed release commit. The library then
        # independently refuses anything the sidecar proves is dirty,
        # off-commit, off-version, or not release-signed.
        prepare_release_git || return 1
        on_exact_release_tag "$ROOT_DIR" "$version" || {
            err "production APKs require HEAD on the exact v$version release tag"
            err "cut the release first: status.sh → Git → Cut a release"
            return 1
        }
        expected_git="$(git -C "$ROOT_DIR" rev-parse HEAD)"
        remote_release_refs_match "$ROOT_DIR" "$version" "$expected_git" || {
            err "origin/main and v$version do not both resolve to HEAD"
            err "push the release before publishing production APKs"
            return 1
        }
        mode=prod
    fi
    BOE_APK_VERSION="$version" "$ROOT_DIR/emu/boe_update.sh" "--$target" --no-install --both || return 1
    section "SHIP APKs" "publish to the dedicated VPS paths.json directories"
    paths_validate "$stack" "$(stack_paths_file "$stack")" || return 1
    apk_ship_release "$RM_DIR/stacks/$stack/paths.json" "$ROOT_DIR/emu/out" "$target" "$version" true "$expected_git" "$mode"
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

action_sync_worktrees() {
    section "SYNC LOCAL WORKTREES" "merge main into wt/admin and wt/client"
    git_workflow_sync_worktrees "$ROOT_DIR"
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
    status_lock || return 1
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

    # Atomic VERSION write: a crash mid-write must never leave a truncated
    # file for the next export to read.
    local vtmp
    vtmp="$(mktemp "$ROOT_DIR/.VERSION.XXXXXX")" || {
        err "could not create a temporary VERSION file"
        return 1
    }
    printf '%s\n' "$next" > "$vtmp" && mv "$vtmp" "$VERSION_FILE" || {
        rm -f "$vtmp"
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

action_validate_contracts() {
    section "VALIDATE PATH CONTRACTS" "tracked schema-3 paths.json is the sole path authority"
    local s
    for s in "${BOE_STACKS[@]}"; do
        paths_validate "$s" "$(stack_paths_file "$s")" && ok "$s/paths.json" || return 1
    done
    paths_validate_cross_stack && ok "all three contracts are consistent and non-overlapping"
    info "re-ship a contract after editing it:  ./release_manager/deploy.sh <stack> --ship-only"
}

action_logs() {
    local s dir
    s="$(pick_stack 'Show logs for which stack?')" || { err "invalid selection"; return 1; }
    dir="$(paths_get "$(stack_paths_file "$s")" .backup.deploy_log)" || { err "cannot resolve log dir"; return 1; }
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
    local f d project
    f="$(stack_paths_file "$s")"
    d="$(paths_get "$f" .vps.stack_dir)" || { err "cannot resolve the stack directory"; return 1; }
    project="$(paths_get "$f" .vps.compose_project)" || { err "cannot resolve the compose project"; return 1; }
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
    if [[ "$(rs REACHABLE)" == "yes" ]]; then
        if [[ "$(rs JQ)" == "yes" ]]; then
            ok "remote jq present"
        else
            err "remote jq MISSING — version and status reporting is degraded"
            blockers=$((blockers+1))
        fi
    fi

    section "storage"
    if [[ "$(rs BACKUP_MOUNTED)" == "yes" ]]; then ok "$BACKUP_MOUNT is a mountpoint"; else err "$BACKUP_MOUNT not mounted"; blockers=$((blockers+1)); fi
    if [[ "$(rs BACKUP_WRITABLE)" == "yes" ]]; then
        ok "$BACKUP_ROOT writable"
    else
        err "$BACKUP_ROOT NOT writable by the deploy user"
        printf '\n     %sFix (run on the VPS, once):%s\n' "$c_bold" "$c_rst"
        printf '       sudo chown -R beonedge:beonedge %s\n' "$BACKUP_ROOT"
        printf '       sudo chmod -R u+rwX,go+rX %s\n\n' "$BACKUP_ROOT"
        blockers=$((blockers+1))
    fi
    field "free stack disk"  "$(rs DISK_STACK)"
    field "free backup disk" "$(rs DISK_BACKUP)"

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

# ── menus ───────────────────────────────────────────────────────────────────

pause_after_action() {
    printf '\n%s   ➜ press Enter to continue %s' "$c_dim" "$c_rst"
    read -r _
}

menu_git() {
    local choice
    while true; do
        cat <<MENU

${c_bold}━━ Git${c_rst}
   1) Full Git workflow       commit, review PRs, integrate and push main
   2) Sync local worktrees    merge main into admin and client
   3) Cut a release           prepare Git, bump VERSION, tag and push
   b) Back

MENU
        printf '%s   ➜ Git choice: %s' "$c_bold" "$c_rst"
        read -r choice || return 0
        case "$choice" in
            1) action_git_workflow || warn "Git workflow did not complete" ;;
            2) action_sync_worktrees || warn "worktree synchronization did not complete" ;;
            3) action_cut_release || warn "release not cut" ;;
            b|B) return 0 ;;
            *) warn "unknown Git choice: $choice"; continue ;;
        esac
        pause_after_action || return 0
    done
}

menu_exports() {
    local choice
    while true; do
        cat <<MENU

${c_bold}━━ Exports${c_rst}
   1) Build bundle            build images, optionally APKs, then stage
   2) Re-stage dev bundle     reuse existing images; production is blocked
   3) Build + ship APKs       publish client + admin to paths.json folders
   4) Validate path contracts check the schema-3 path authority
   b) Back

MENU
        printf '%s   ➜ Export choice: %s' "$c_bold" "$c_rst"
        read -r choice || return 0
        case "$choice" in
            1) action_export build || warn "export did not complete" ;;
            2) action_export restage || warn "re-stage did not complete" ;;
            3) action_apk || warn "APK build did not complete" ;;
            4) action_validate_contracts ;;
            b|B) return 0 ;;
            *) warn "unknown Export choice: $choice"; continue ;;
        esac
        pause_after_action || return 0
    done
}

menu_ship_deploy() {
    local choice
    while true; do
        cat <<MENU

${c_bold}━━ Ship + Deploy${c_rst}
   1) Ship + deploy           upload the latest bundle and deploy it
   2) Ship only               upload for inspection; do not deploy
   3) Force redeploy          redeploy the latest bundle with --force
   4) Reload deployed stack   recreate containers with the current on-VPS .env
   5) Roll back               select an archived VPS release
   6) View deploy logs        tail a remote deployment log
   7) Inspect containers      remote compose ps and recent logs
   8) Diagnose the VPS        readiness checks and blockers
   9) Operator manual         steps that must be run by hand
   b) Back

MENU
        printf '%s   ➜ Ship + Deploy choice: %s' "$c_bold" "$c_rst"
        read -r choice || return 0
        case "$choice" in
            1) action_deploy deploy || warn "deploy did not complete" ;;
            2) action_deploy ship-only || warn "shipping did not complete" ;;
            3) action_deploy force || warn "forced redeploy did not complete" ;;
            4) action_reload || warn "reload did not complete" ;;
            5) action_rollback || warn "rollback did not complete" ;;
            6) action_logs || true ;;
            7) action_containers || true ;;
            8) action_diagnose ;;
            9) action_operator_guide || true ;;
            b|B) return 0 ;;
            *) warn "unknown Ship + Deploy choice: $choice"; continue ;;
        esac
        pause_after_action || return 0
    done
}

menu_main() {
    local choice
    while true; do
        show_status
        cat <<MENU
${c_bold}━━ workflows${c_rst}
   1) Git                    prepare and synchronize source control
   2) Exports                build and stage images or APKs
   3) Ship + Deploy          transfer, deploy and operate VPS stacks
   r) Refresh
   q) Quit

MENU
        printf '%s   ➜ workflow: %s' "$c_bold" "$c_rst"
        read -r choice || return 0
        case "$choice" in
            1) menu_git ;;
            2) menu_exports ;;
            3) menu_ship_deploy ;;
            r|R) REMOTE_FETCHED=false ;;
            q|Q) printf '\n'; return 0 ;;
            *) warn "unknown workflow: $choice" ;;
        esac
    done
}

# ── entry ───────────────────────────────────────────────────────────────────

status_main() {
    case "${1:-}" in
        --status) show_status; return 0 ;;
        --diagnose) action_diagnose; return 0 ;;
        --reload) action_reload "${2:-}"; return $? ;;
        --help|-h)
            cat <<'USAGE'
Usage: ./release_manager/status.sh [--status | --diagnose | --reload <stack>]

With no arguments, opens the interactive control center.

  --status          print the state dashboard and exit
  --diagnose        run the VPS readiness check and exit
  --reload <stack>  recreate the deployed stack's containers with the current
                    on-VPS .env (dev|prod|monitor; nothing is shipped)
USAGE
            return 0 ;;
        "") : ;;
        *) err "unknown argument: $1"; return 1 ;;
    esac

    [[ "$UI_INTERACTIVE" == true ]] \
        || { err "not a terminal — use --status, --diagnose or --reload <stack>"; return 1; }
    menu_main
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    status_main "$@"
fi
