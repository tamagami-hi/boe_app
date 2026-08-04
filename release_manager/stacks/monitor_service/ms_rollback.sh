#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ms_rollback.sh — VPS-native rollback entry point for the MONITORING stack.
#
# Runs ON THE VPS, in /srv/dev_stack/BOE_APP/monitor_service.
#
#     ./ms_rollback.sh --list
#     ./ms_rollback.sh --latest
#
# Because the monitoring stack ships no image tarballs, rolling it back means
# restoring the previous compose file and configuration and re-pulling the tags
# that revision pinned. There is no database, so --restore-db does nothing here.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../_shared/_boe_lib.sh
source "$HERE/_boe_lib.sh"
# shellcheck source=../_shared/_boe_deploy.sh
source "$HERE/_boe_deploy.sh"
# shellcheck source=../_shared/_boe_rollback.sh
source "$HERE/_boe_rollback.sh"

# ── monitoring-specific overrides (must match ms_deploy.sh) ─────────────────

boe_deploy_assert_env() { boe_assert_env_keys GRAFANA_PORT GRAFANA_ADMIN_PASSWORD; }
boe_assert_images_present() { :; }
boe_deploy_smoke_tests() {
    local grafana_port rc=0
    grafana_port="$(env_get GRAFANA_PORT "$BOE_EFFECTIVE_ENV")"
    [[ -n "$grafana_port" ]] && { wait_http "http://127.0.0.1:${grafana_port}/api/health" 30 2 || rc=1; }
    return $rc
}

boe_archive_current_images() {
    local dest="$1" version="$2"
    [[ -n "$version" ]] || return 0
    boe_assert_writable "$dest"
    [[ -f "${P[compose_file]}" ]]  && cp "${P[compose_file]}"  "$dest/${P[compose_name]}"
    [[ -f "${P[manifest_file]}" ]] && cp "${P[manifest_file]}" "$dest/manifest.json"
    if [[ -n "${P[config_dir]:-}" && -d "${P[config_dir]}" ]]; then
        mkdir -p "$dest/config" && cp -r "${P[config_dir]}/." "$dest/config/" \
            || die "could not archive monitoring configuration from ${P[config_dir]}"
    fi
    ( cd "$dest" && find . -type f ! -name checksums.sha256 -exec sha256sum {} + > checksums.sha256 2>/dev/null ) \
        || die "could not write checksums for the archived monitoring configuration"
    ok "archived monitoring configuration → $dest"
}

# Restore configuration, then re-pull the pinned tags from that revision.
# The live config location comes from the contract's vps.config_dir.
#
# The config tree is staged next to the live one and swapped in with mv, so an
# interrupted copy can never leave a wiped or half-restored config directory.
boe_rollback_load() {
    local rb="$1"
    [[ -f "$rb/${P[compose_name]}" ]] || die "rollback archive has no compose file"
    cp "$rb/${P[compose_name]}" "${P[compose_file]}"
    [[ -f "$rb/manifest.json" ]] && cp "$rb/manifest.json" "${P[manifest_file]}"
    if [[ -d "$rb/config" ]]; then
        [[ -n "${P[config_dir]:-}" ]] || die "paths.json has no vps.config_dir for the monitoring stack"
        _boe_safe_abs "${P[config_dir]}" || die "unsafe vps.config_dir in paths.json: ${P[config_dir]}"
        case "${P[config_dir]}" in
            "${P[stack_dir]}"/*) ;;
            *) die "vps.config_dir is not contained in vps.stack_dir: ${P[config_dir]}" ;;
        esac
        local staging="${P[config_dir]}.rollback-staging.$$" previous="${P[config_dir]}.rollback-previous.$$"
        rm -rf -- "$staging" "$previous"
        mkdir -p "$staging"
        cp -r "$rb/config/." "$staging/" \
            || { rm -rf -- "$staging"; die "failed to stage the archived monitoring configuration"; }
        if [[ -d "${P[config_dir]}" ]]; then
            mv "${P[config_dir]}" "$previous" \
                || { rm -rf -- "$staging"; die "could not set aside the live monitoring configuration"; }
        fi
        if mv "$staging" "${P[config_dir]}"; then
            rm -rf -- "$previous"
        else
            if [[ -d "$previous" ]]; then mv "$previous" "${P[config_dir]}"; fi
            die "could not activate the restored monitoring configuration"
        fi
        info "restored monitoring configuration"
    fi
    compose pull --quiet || die "failed to pull the monitoring images for this revision"
}

boe_rollback_main "$HERE/paths.json" "$@"
