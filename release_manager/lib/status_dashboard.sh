#!/usr/bin/env bash

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
        ok "HEAD is exactly tag v$canonical → a dev export is labelled $canonical when origin has the tag"
    else
        info "HEAD is not on tag v$canonical → a dev export gets a -dev label"
    fi
    info "a production export builds origin's production tip in a temporary worktree"

    show_production_branch

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

show_production_branch() {
    local running tip_tag newest label
    printf '\n%s━━ production%s\n' "$c_bold" "$c_rst"
    running="$(rs prod_release_VERSION)"
    if ! production_origin_refs "$ROOT_DIR"; then
        warn "could not read origin's production branch"
        field "prod stack runs" "${running:-<unknown>}"
        return 0
    fi
    if [[ -z "$PO_PRODUCTION" ]]; then
        label="does not exist yet"
    else
        tip_tag="$(production_tag_at "$PO_PRODUCTION")"
        label="${tip_tag:-not a release tag} (${PO_PRODUCTION:0:7})"
    fi
    field "production branch" "$label  │  prod stack runs ${running:-<unknown>}"
    if [[ -n "${tip_tag:-}" && -n "$running" && "${tip_tag#v}" != "$running" ]]; then
        warn "production approves ${tip_tag}, but the production stack runs $running"
    fi
    newest="$(head -n1 <<< "$PO_TAGS" | cut -f1)"
    if [[ -n "$newest" && "$newest" != "${tip_tag:-}" ]]; then
        info "newest release tag $newest is not production's tip: Git → Push a release to production"
    fi
}
