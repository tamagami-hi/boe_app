#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# nginx_ship.sh — ships the nginx site configs and tells the operator exactly
# what to install. Callers must source ui.sh and stacks.sh first.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
# The nginx configs were the one part of the release that no script carried. The
# bundle shipped images, compose, paths.json and the native scripts; the nginx
# files were copied up by hand, and the staging folder on the VPS drifted months
# behind the repo without anything noticing. A rate limiter sat in front of routes
# the backend does not serve for exactly that reason: the repo was fixed, the box
# was not, and nothing compared the two.
#
# ── WHY IT STOPS AT THE STAGING FOLDER ──────────────────────────────────────
# This ships to <vps.root>/NGINX and goes no further. Installing into /etc/nginx
# needs root, and a bad file there takes down every site on the box at once —
# including the two this pipeline does not own (the landing site and unrelated
# tenants). So the pipeline stages the files and prints the precise commands; a
# human runs them, reads `nginx -t`, and decides to reload. That division is the
# same one deploy.sh already draws around docker: this script touches nothing
# live.
#
# ── WHY THE NAMES ARE MAPPED ────────────────────────────────────────────────
# The repo names configs by hostname (app.beonedge.in.conf) and nginx installs
# them by site (sites-available/boe-app). Nothing derives one from the other, so
# the mapping is declared once, here, and both the shipper and the guide read it.
# A wrong guess installs a vhost over an unrelated site.
# ─────────────────────────────────────────────────────────────────────────────

NGINX_ETC="${NGINX_ETC:-/etc/nginx}"

# ── the routing table ───────────────────────────────────────────────────────
# <repo filename>|<path under /etc/nginx>|<kind>
#
# kind:
#   site    a server block in sites-available; needs a sites-enabled symlink
#   http    http-context include in conf.d — loaded by EVERY site on the box
#   snippet an include fragment, inert until a site includes it
#
# Only files listed here are shipped. A config in release_manager/nginx/ with no
# row is reported as unroutable rather than uploaded to be forgotten about: an
# unmapped file is either a mistake or a decision nobody wrote down.
nginx_ship_map() {
    cat <<'MAP'
app.beonedge.in.conf|sites-available/boe-app|site
dev-app.beonedge.in.conf|sites-available/boe-dev-app|site
admin.tailscale.conf|sites-available/boe-admin-tailscale|site
boe-shared.conf|conf.d/boe-shared.conf|http
boe-security-headers.conf|snippets/boe-security-headers.conf|snippet
MAP
}

# nginx_ship_source_dir — the tracked configs in the working tree.
nginx_ship_source_dir() { printf '%s\n' "$RM_DIR/nginx"; }

# nginx_ship_remote_dir <paths.json> — <vps.root>/NGINX.
#
# Derived from the contract's root rather than added as a schema key: the folder
# is shared by every stack, so it is a property of the box, not of a release.
nginx_ship_remote_dir() {
    local paths_file="$1" root
    root="$(paths_get "$paths_file" '.vps.root')" || return 1
    printf '%s/NGINX\n' "$root"
}

# nginx_ship_unmapped — configs present in the tree with no row in the table.
nginx_ship_unmapped() {
    local src; src="$(nginx_ship_source_dir)"
    local mapped f base
    mapped="$(nginx_ship_map | cut -d'|' -f1)"
    for f in "$src"/*.conf; do
        [[ -e "$f" ]] || continue
        base="$(basename "$f")"
        printf '%s\n' "$mapped" | grep -qxF "$base" || printf '%s\n' "$base"
    done
}

# nginx_ship_stage <bundle_dir> — copy the mapped configs into <bundle>/nginx/.
#
# Called by export.sh so the configs travel inside the bundle and are covered by
# checksums.sha256 like everything else — the remote verify then proves the file
# that arrived is the file that was built.
nginx_ship_stage() {
    local bundle="$1" src staged=0 missing=()
    src="$(nginx_ship_source_dir)"
    [[ -d "$src" ]] || { warn "no nginx directory at $src — nothing to stage"; return 0; }

    mkdir -p "$bundle/nginx"
    local file dest kind
    while IFS='|' read -r file dest kind; do
        [[ -n "$file" ]] || continue
        if [[ -f "$src/$file" && ! -L "$src/$file" ]]; then
            cp -- "$src/$file" "$bundle/nginx/$file"
            staged=$((staged + 1))
        else
            missing+=("$file")
        fi
    done < <(nginx_ship_map)

    # A mapped-but-absent file is reported, not fatal: a config can be
    # legitimately retired (monitor.beonedge.in.conf was), and the row is then
    # removed from the table in the same commit.
    if ((${#missing[@]})); then
        warn "mapped but not in the tree: ${missing[*]}"
        info "remove the row from nginx_ship_map if the config was retired"
    fi

    local orphan
    orphan="$(nginx_ship_unmapped)"
    [[ -z "$orphan" ]] || {
        warn "unroutable config(s), NOT shipped: $(printf '%s ' $orphan)"
        info "add a row to nginx_ship_map in release_manager/lib/nginx_ship.sh"
    }

    ok "staged $staged nginx config(s)"
}

# ── the guide ───────────────────────────────────────────────────────────────

# nginx_ship_probe <remote_nginx_dir> — classify every mapped config.
#
# Emits "<file>|<state>|<dest>|<kind>" with state one of:
#   SAME      installed file is byte-identical — nothing to do
#   CHANGED   installed file differs — needs installing
#   NEW       nothing installed at the destination yet
#   ABSENT    not in the staging folder (never shipped, or shipping failed)
#
# One SSH round trip: the installed digests are fetched in a single call and
# compared locally against the tree, which is equivalent to comparing against the
# staged copy because the upload is checksum-verified.
nginx_ship_probe() {
    local remote_nginx_dir="$1"
    local src; src="$(nginx_ship_source_dir)"

    local dests=() file dest kind
    while IFS='|' read -r file dest kind; do
        [[ -n "$file" ]] || continue
        dests+=("$NGINX_ETC/$dest")
    done < <(nginx_ship_map)

    # `2>/dev/null` on sha256sum: a destination that does not exist yet is a NEW
    # config, not an error. Missing lines are handled below.
    local remote_digests
    remote_digests="$(boe_ssh "sha256sum ${dests[*]@Q} 2>/dev/null; ls -1 ${remote_nginx_dir@Q} 2>/dev/null | sed 's/^/STAGED /'" || true)"

    # Distinguish "the box answered and has nothing" from "we never reached the
    # box". Without this, an SSH failure reports every config as ABSENT, which
    # reads as a shipping bug and sends the operator looking in the wrong place.
    if [[ -z "$remote_digests" ]]; then
        printf '__UNREACHABLE__\n'
        return 0
    fi

    while IFS='|' read -r file dest kind; do
        [[ -n "$file" ]] || continue

        if ! printf '%s\n' "$remote_digests" | grep -qx "STAGED $file"; then
            printf '%s|ABSENT|%s|%s\n' "$file" "$dest" "$kind"
            continue
        fi

        local installed
        installed="$(printf '%s\n' "$remote_digests" \
            | awk -v p="$NGINX_ETC/$dest" '$2 == p { print $1; exit }')"
        if [[ -z "$installed" ]]; then
            printf '%s|NEW|%s|%s\n' "$file" "$dest" "$kind"
            continue
        fi

        local local_sha
        local_sha="$(sha256sum "$src/$file" 2>/dev/null | cut -d' ' -f1)"
        if [[ "$local_sha" == "$installed" ]]; then
            printf '%s|SAME|%s|%s\n' "$file" "$dest" "$kind"
        else
            printf '%s|CHANGED|%s|%s\n' "$file" "$dest" "$kind"
        fi
    done < <(nginx_ship_map)
}

# nginx_ship_guide <remote_nginx_dir> — print per-file install instructions.
#
# Prints commands only for configs that actually differ. A guide that lists every
# file every time trains the reader to paste it unread, which is how an unrelated
# site gets a vhost dropped on it.
nginx_ship_guide() {
    local remote_nginx_dir="$1"
    local probe; probe="$(nginx_ship_probe "$remote_nginx_dir")" || {
        warn "could not compare the staged configs with $NGINX_ETC"
        return 0
    }

    if [[ "$probe" == "__UNREACHABLE__" ]]; then
        warn "could not reach $BOE_SSH_ALIAS to compare against $NGINX_ETC"
        info "the configs may be staged correctly — re-run this step to get the guide"
        return 0
    fi

    section "NGINX  what is installed vs what was just shipped"

    local file state dest kind
    local -a to_install=() new_sites=() absent=()
    local shared_changed=false

    while IFS='|' read -r file state dest kind; do
        [[ -n "$file" ]] || continue
        case "$state" in
            SAME)    ok    "$file → $dest  (identical, nothing to do)" ;;
            CHANGED) warn  "$file → $dest  (differs — needs installing)"
                     to_install+=("$file|$dest|$kind")
                     [[ "$kind" == "http" ]] && shared_changed=true ;;
            NEW)     warn  "$file → $dest  (not installed yet)"
                     to_install+=("$file|$dest|$kind")
                     [[ "$kind" == "site" ]] && new_sites+=("$dest")
                     [[ "$kind" == "http" ]] && shared_changed=true ;;
            ABSENT)  err   "$file  (not in $remote_nginx_dir — shipping failed?)"
                     absent+=("$file") ;;
        esac
    done <<< "$probe"

    if ((${#absent[@]})); then
        info "re-run the ship step; do not hand-copy a file the pipeline did not place"
    fi

    if ((${#to_install[@]} == 0)); then
        printf '\n'
        ok "$NGINX_ETC is already current — no action needed"
        return 0
    fi

    # ── the commands ────────────────────────────────────────────────────────
    printf '\n   %sRun these on the VPS, in order:%s\n\n' "$c_bold" "$c_rst"
    printf '     ssh %s\n' "$BOE_SSH_ALIAS"
    printf '     sudo cp -a %s /root/nginx-backup-$(date +%%Y%%m%%dT%%H%%M%%S)\n\n' "$NGINX_ETC"

    local entry
    for entry in "${to_install[@]}"; do
        IFS='|' read -r file dest kind <<< "$entry"
        printf '     sudo cp %s/%s %s/%s\n' "$remote_nginx_dir" "$file" "$NGINX_ETC" "$dest"
    done

    if ((${#new_sites[@]})); then
        printf '\n     # new site(s) — enable them:\n'
        local site
        for site in "${new_sites[@]}"; do
            printf '     sudo ln -sfn %s/%s %s/sites-enabled/%s\n' \
                "$NGINX_ETC" "$site" "$NGINX_ETC" "$(basename "$site")"
        done
    fi

    printf '\n     sudo nginx -t\n'
    printf '     sudo systemctl reload nginx\n'

    # ── what to check afterwards ────────────────────────────────────────────
    printf '\n   %sThen verify:%s\n\n' "$c_bold" "$c_rst"
    printf '     # sign-in is rate limited, refresh is NOT (a limit there breaks the app)\n'
    printf '     grep -n "location ~ .*auth" %s/sites-enabled/*\n' "$NGINX_ETC"
    printf '     curl -s -o /dev/null -w "%%{http_code}\\n" -H "Host: dev-app.beonedge.in" http://127.0.0.1/\n'
    printf '     curl -s -o /dev/null -w "%%{http_code}\\n" -H "Host: beonedge.in" http://127.0.0.1/\n'

    if [[ "$shared_changed" == true ]]; then
        printf '\n'
        warn "conf.d/boe-shared.conf changed — it is loaded by EVERY site on this box"
        info "it carries the rate-limit zones and the CF real_ip block, so this also"
        info "affects the landing site and any unrelated tenant. Compare the zone"
        info "rates before reloading:"
        printf '     diff <(grep limit_req_zone %s/%s) <(grep limit_req_zone %s/conf.d/boe-shared.conf)\n' \
            "$remote_nginx_dir" "boe-shared.conf" "$NGINX_ETC"
    fi

    printf '\n   %sIf anything breaks:%s\n\n' "$c_bold" "$c_rst"
    printf '     sudo cp -a /root/nginx-backup-<timestamp>/. %s/ && sudo nginx -t && sudo systemctl reload nginx\n\n' \
        "$NGINX_ETC"
}
