#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# prod_rollback.sh — VPS-native rollback entry point for the PRODUCTION stack.
#
# Runs ON THE VPS, in /srv/dev_stack/BOE_APP/prod_release.
#
#     ./prod_rollback.sh --list      show available versions (always start here)
#     ./prod_rollback.sh --latest    roll back one release
#     ./prod_rollback.sh --to 1.4.1
#
# Application rollback reuses the current .env, so configuration must remain
# backward-compatible with retained images. Adding --restore-db additionally
# restores the pre-deploy database snapshot, which discards transactions
# committed since — that path demands typing RESTORE at a live terminal, and
# in production --yes NEVER waives that typed confirmation.
#
# Production policy: a rollback target containing '-' is a dev-labelled build
# (0.6.4-dev.18.g62274c0.dirty), never a cut release, and is refused — the
# same rule prod_deploy.sh enforces for deploys.
#
# Shares the same flock as prod_deploy.sh.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../_shared/_boe_lib.sh
source "$HERE/_boe_lib.sh"
# shellcheck source=../_shared/_boe_deploy.sh
source "$HERE/_boe_deploy.sh"      # for boe_deploy_smoke_tests
# shellcheck source=../_shared/_boe_rollback.sh
source "$HERE/_boe_rollback.sh"

# Production gate: never roll production back to a development build.
_prod_rollback_guard() {
    local prev="" a
    for a in "$@"; do
        if [[ "$prev" == "--to" && "$a" == *-* ]]; then
            printf 'error: refusing to roll production back to a development build: %s\n' "$a" >&2
            printf '       roll back to a stable release instead\n' >&2
            exit 1
        fi
        prev="$a"
    done
}

_prod_rollback_guard "$@"

boe_rollback_main "$HERE/paths.json" "$@"
