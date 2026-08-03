#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev_rollback.sh — VPS-native rollback entry point for the DEVELOPMENT stack.
#
# Runs ON THE VPS, in /srv/dev_stack/BOE_APP/dev_release.
#
#     ./dev_rollback.sh --list           show what can be rolled back to
#     ./dev_rollback.sh --latest         roll back one release
#     ./dev_rollback.sh --to 0.6.4-dev.18.g62274c0
#
# Shares the same flock as dev_deploy.sh, so the two can never run concurrently.
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
