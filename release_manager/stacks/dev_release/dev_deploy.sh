#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev_deploy.sh — VPS-native deploy entry point for the DEVELOPMENT stack.
#
# Runs ON THE VPS, in /srv/dev_stack/BOE_APP/dev_release.
# Invoked either by the operator machine (release_manager/deploy.sh --dev) or by
# hand over SSH:
#
#     cd /srv/dev_stack/BOE_APP/dev_release && ./dev_deploy.sh
#
# All logic is shared (_boe_deploy.sh); this file only declares identity and
# policy. Development policy: no confirmation prompt, because dev is redeployed
# constantly and a prompt would only train the operator to reflex-approve.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../_shared/_boe_lib.sh
source "$HERE/_boe_lib.sh"
# shellcheck source=../_shared/_boe_deploy.sh
source "$HERE/_boe_deploy.sh"

BOE_REQUIRE_CONFIRM=false

boe_deploy_main "$HERE/paths.json" "$@"
