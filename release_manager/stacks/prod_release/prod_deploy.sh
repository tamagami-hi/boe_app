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

    # The manifest location comes from the path contract, and an unreadable
    # version is fatal — silently skipping this check could let a dev-labelled
    # build through.
    local manifest version
    manifest="$(jq -r '.vps.manifest_file // empty' "$HERE/paths.json" 2>/dev/null)"
    if [[ -z "$manifest" ]]; then
        printf 'error: cannot read vps.manifest_file from %s/paths.json\n' "$HERE" >&2
        exit 1
    fi
    if [[ ! -f "$manifest" ]]; then
        printf 'error: manifest.json missing at %s — has deploy.sh shipped a bundle yet?\n' "$manifest" >&2
        exit 1
    fi
    version="$(jq -r '.version // empty' "$manifest" 2>/dev/null)"
    if [[ -z "$version" ]]; then
        printf 'error: cannot read .version from %s\n' "$manifest" >&2
        exit 1
    fi
    if [[ "$version" == *-* ]]; then
        printf 'error: refusing to deploy a development build to production: %s\n' "$version" >&2
        printf '       cut a stable release first (release_manager/status.sh)\n' >&2
        exit 1
    fi
}

_prod_guard "$@"

boe_deploy_main "$HERE/paths.json" "$@"
