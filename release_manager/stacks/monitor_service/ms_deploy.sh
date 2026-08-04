#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ms_deploy.sh — VPS-native deploy entry point for the MONITORING stack.
#
# Runs ON THE VPS, in /srv/dev_stack/BOE_APP/monitor_service.
#
#     cd /srv/dev_stack/BOE_APP/monitor_service && ./ms_deploy.sh
#
# The monitoring stack differs from the two application stacks in one important
# way: it ships NO image tarballs. Prometheus, Grafana, Alertmanager and the
# exporters are pinned upstream images, so this script pulls them rather than
# loading archives. Nothing from this repository is built into it yet.
#
# It also owns no database, so the pre-deployment backup steps are skipped.
#
# Monitoring must survive an application deploy or rollback (plan §37), so it is
# deployed independently and uses its own lock and compose project.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../_shared/_boe_lib.sh
source "$HERE/_boe_lib.sh"
# shellcheck source=../_shared/_boe_deploy.sh
source "$HERE/_boe_deploy.sh"

BOE_REQUIRE_CONFIRM=false

# ── monitoring-specific overrides ───────────────────────────────────────────

# Upstream images only: no POSTGRES_*/BACKEND_PORT contract to satisfy.
boe_deploy_assert_env() {
    boe_assert_env_keys GRAFANA_PORT GRAFANA_ADMIN_PASSWORD
}

# Pull pinned upstream tags instead of loading shipped archives.
boe_load_images() {
    log "pulling pinned upstream monitoring images"
    compose pull --quiet || die "failed to pull monitoring images"
    ok "monitoring images pulled"
}

# The version being deployed is a config revision, not an image tag, so there is
# nothing to inspect in the local image store.
boe_assert_images_present() { :; }

# Archive the compose file and config, not image tarballs — the upstream images
# are always re-pullable by tag, but the configuration is what actually changes.
# The config location comes from the contract's vps.config_dir, never from
# where this script happens to live.
boe_archive_current_images() {
    local dest="$1" version="$2"
    [[ -n "$version" ]] || { info "no current version to archive"; return 0; }
    boe_assert_writable "$dest"
    [[ -f "${P[compose_file]}" ]]  && cp "${P[compose_file]}"  "$dest/${P[compose_name]}"
    [[ -f "${P[manifest_file]}" ]] && cp "${P[manifest_file]}" "$dest/manifest.json"
    [[ -f "${P[version_file]}" ]]  && cp "${P[version_file]}"  "$dest/${P[version_name]}"
    if [[ -n "${P[config_dir]:-}" && -d "${P[config_dir]}" ]]; then
        mkdir -p "$dest/config" && cp -r "${P[config_dir]}/." "$dest/config/" \
            || die "could not archive monitoring configuration from ${P[config_dir]}"
    fi
    ( cd "$dest" && find . -type f ! -name checksums.sha256 -exec sha256sum {} + > checksums.sha256 2>/dev/null ) \
        || die "could not write checksums for the archived monitoring configuration"
    ok "archived monitoring configuration → $dest"
}

boe_deploy_archive_apks() { info "monitoring stack publishes no APKs"; }

# Probe Grafana only; Prometheus/Alertmanager sit on the internal network.
boe_deploy_smoke_tests() {
    local grafana_port rc=0
    grafana_port="$(env_get GRAFANA_PORT "$BOE_EFFECTIVE_ENV")"
    [[ -n "$grafana_port" ]] && { wait_http "http://127.0.0.1:${grafana_port}/api/health" 30 2 || rc=1; }
    return $rc
}

boe_deploy_main "$HERE/paths.json" "$@"
