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
# committed since — that path demands typing RESTORE at a live terminal.
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

boe_rollback_main "$HERE/paths.json" "$@"
