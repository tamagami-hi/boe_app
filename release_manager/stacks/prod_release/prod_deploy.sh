#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# prod_deploy.sh — VPS-native deploy entry point for the PRODUCTION stack.
#
# Runs ON THE VPS, in /srv/dev_stack/BOE_APP/prod_release.
#
#     cd /srv/dev_stack/BOE_APP/prod_release && ./prod_deploy.sh
#
# Production policy differences from development:
#   • Requires an explicit confirmation (or --yes) before touching containers.
#   • Refuses to deploy a dev-labelled version. A version containing '-' came
#     from an in-flight tree (0.6.4-dev.18.g62274c0.dirty), never from a cut
#     release, and must not reach production.
#   • Refuses to skip the pre-deployment database backup.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../_shared/_boe_lib.sh
source "$HERE/_boe_lib.sh"
# shellcheck source=../_shared/_boe_deploy.sh
source "$HERE/_boe_deploy.sh"

BOE_REQUIRE_CONFIRM=true

# Production gate: stable versions only, and the DB backup is not optional.
_prod_guard() {
    local a
    for a in "$@"; do
        if [[ "$a" == "--skip-db-backup" ]]; then
            printf 'error: --skip-db-backup is not permitted for production\n' >&2
            exit 1
        fi
    done

    local manifest="$HERE/manifest.json" version
    if [[ -f "$manifest" ]]; then
        version="$(jq -r '.version // empty' "$manifest" 2>/dev/null || true)"
        if [[ "$version" == *-* ]]; then
            printf 'error: refusing to deploy a development build to production: %s\n' "$version" >&2
            printf '       cut a stable release first (release_manager/status.sh)\n' >&2
            exit 1
        fi
    fi
}

_prod_guard "$@"

boe_deploy_main "$HERE/paths.json" "$@"
