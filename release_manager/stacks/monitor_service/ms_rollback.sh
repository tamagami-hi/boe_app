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
    [[ -d "$HERE/config" ]] && { mkdir -p "$dest/config"; cp -r "$HERE/config/." "$dest/config/" 2>/dev/null || true; }
    ( cd "$dest" && find . -type f ! -name checksums.sha256 -exec sha256sum {} + > checksums.sha256 2>/dev/null ) || true
    ok "archived monitoring configuration → $dest"
}

# Restore configuration, then re-pull the pinned tags from that revision.
boe_rollback_load() {
    local rb="$1"
    [[ -f "$rb/${P[compose_name]}" ]] || die "rollback archive has no compose file"
    cp "$rb/${P[compose_name]}" "${P[compose_file]}"
    [[ -f "$rb/manifest.json" ]] && cp "$rb/manifest.json" "${P[manifest_file]}"
    if [[ -d "$rb/config" ]]; then
        rm -rf "$HERE/config" && mkdir -p "$HERE/config" && cp -r "$rb/config/." "$HERE/config/"
        info "restored monitoring configuration"
    fi
    compose pull --quiet || die "failed to pull the monitoring images for this revision"
}

boe_rollback_main "$HERE/paths.json" "$@"
