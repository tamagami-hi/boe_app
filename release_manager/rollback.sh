#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# rollback.sh — ROLLBACK stage. Runs on this computer; rolls back nothing itself.
#
# Structurally identical to deploy.sh, as required: it is a thin, safe front end
# that validates preconditions locally and then invokes the VPS-native rollback
# script over SSH. Every docker command runs on the VPS.
#
# It never uploads a bundle. Rollback deliberately uses the artifacts already
# archived under the stack's rollback tree on the backup disk, because the
# point of a rollback is to return to a release that was already verified on
# the VPS — not to re-derive one from this machine's current working tree.
#
# Usage:
#   ./release_manager/rollback.sh --dev  --list
#   ./release_manager/rollback.sh --prod --latest
#   ./release_manager/rollback.sh --prod --to 1.4.1
#   ./release_manager/rollback.sh --prod --to 1.4.1 --restore-db
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RM_DIR="$ROOT_DIR/release_manager"

# shellcheck source=lib/ui.sh
source "$RM_DIR/lib/ui.sh"
# shellcheck source=lib/stacks.sh
source "$RM_DIR/lib/stacks.sh"
# shellcheck source=lib/paths.sh
source "$RM_DIR/lib/paths.sh"

STACK=""
LIST_ONLY=false
RESTORE_DB=false
ASSUME_YES=false
REMOTE_ARGS=()

usage() {
    cat <<'USAGE'
Usage: ./release_manager/rollback.sh (--dev | --prod | --monitor) [options]

Invokes the VPS-native rollback script for the chosen stack. All docker work
happens on the VPS, against artifacts already archived there.

Stack selection (required, exactly one):
  --dev        → dev_rollback.sh
  --prod       → prod_rollback.sh
  --monitor    → ms_rollback.sh

Target selection:
  --list, -l        show available rollback versions and exit (start here)
  --to <version>    roll back to a specific version
  --latest          roll back to the newest archived version that is not running

Options:
  --restore-db    ALSO restore that release's pre-deploy database snapshot.
                  Destructive: discards transactions committed since then, and
                  requires typing RESTORE at the remote prompt.
  --yes, -y       skip confirmation prompts (local and remote)
  --skip-checks   pass --skip-checks to the remote script
  --help, -h      this message

Application rollback only swaps images when schemas are compatible. Rolling
back across v0.8.8 migration 025 requires --restore-db and its matching snapshot.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev|--prod|--monitor)
            [[ -z "$STACK" ]] || { err "only one stack may be selected"; exit 1; }
            STACK="$(resolve_stack "$1")" || exit 1; shift ;;
        --list|-l)     LIST_ONLY=true; REMOTE_ARGS+=(--list); shift ;;
        --to)          [[ -n "${2:-}" ]] || { err "--to needs a version"; exit 1; }
                       # Validate locally, before anything reaches the remote
                       # shell: the version is spliced into a remotely-parsed
                       # command string, so it must carry no shell syntax.
                       # This also covers the version status.sh reads
                       # interactively and passes straight through here.
                       [[ "$2" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] \
                           || { err "invalid rollback version: $2"; exit 1; }
                       REMOTE_ARGS+=(--to "$2"); shift 2 ;;
        --latest)      REMOTE_ARGS+=(--latest); shift ;;
        --restore-db)  RESTORE_DB=true; REMOTE_ARGS+=(--restore-db); shift ;;
        --yes|-y)      ASSUME_YES=true; REMOTE_ARGS+=(--yes); shift ;;
        --skip-checks) REMOTE_ARGS+=(--skip-checks); shift ;;
        --help|-h)     usage; exit 0 ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

[[ -n "$STACK" ]] || { err "a stack is required: --dev, --prod or --monitor"; usage >&2; exit 1; }
command -v ssh >/dev/null || { err "ssh is required"; exit 1; }

# The tracked contract is the sole path authority. Validate it, then read
# every remote location from it — nothing is derived here.
PATHS_FILE="$(stack_paths_file "$STACK")" || exit 1
paths_validate "$STACK" "$PATHS_FILE" \
    || { err "the $STACK path contract failed validation — fix stacks/$STACK/paths.json"; exit 1; }
REMOTE_DIR="$(paths_get "$PATHS_FILE" .vps.stack_dir)" || exit 1
BACKUP_MOUNT="$(paths_get "$PATHS_FILE" .backup.mount_check)" || exit 1
BACKUP_ROOT="$(paths_get "$PATHS_FILE" .backup.root)" || exit 1
assert_safe_remote_dir "$REMOTE_DIR" || exit 1
ROLLBACK_NAME="$(stack_attr "$STACK" rollback)"
VERSION_NAME="$(stack_attr "$STACK" version_file)"

banner "ROLLBACK · $STACK"
field "remote" "${BOE_SSH_ALIAS}:${REMOTE_DIR}"
field "script" "$ROLLBACK_NAME"

# ── preflight ───────────────────────────────────────────────────────────────
section "PREFLIGHT"

step "checking SSH connectivity"
boe_ssh true 2>/dev/null || { err "cannot reach $BOE_SSH_ALIAS over SSH"; exit 1; }
ok "SSH ok"

step "checking the remote stack is provisioned"
PRE="$(boe_ssh "bash -s -- '$REMOTE_DIR' '$ROLLBACK_NAME' '$BACKUP_MOUNT' '$BACKUP_ROOT'" <<'REMOTE' || true
set -u
d="$1"; script="$2"; mount="$3"; broot="$4"
printf 'script_present=%s\n'  "$([[ -x "$d/$script" ]] && echo yes || echo no)"
printf 'paths_present=%s\n'   "$([[ -f "$d/paths.json" ]] && echo yes || echo no)"
printf 'lib_present=%s\n'     "$([[ -f "$d/_boe_lib.sh" ]] && echo yes || echo no)"
printf 'backup_mounted=%s\n'  "$(mountpoint -q "$mount" && echo yes || echo no)"
printf 'backup_writable=%s\n' "$([[ -w "$broot" ]] && echo yes || echo no)"
printf 'docker_ok=%s\n'       "$(docker info >/dev/null 2>&1 && echo yes || echo no)"
REMOTE
)"
get_flag() { printf '%s\n' "$PRE" | sed -n "s/^$1=//p" | tail -n1; }

if [[ "$(get_flag script_present)" != "yes" ]]; then
    err "$REMOTE_DIR/$ROLLBACK_NAME is not present or not executable on the VPS"
    err "ship the stack at least once first: ./release_manager/deploy.sh --${STACK%%_*} --ship-only"
    exit 1
fi
[[ "$(get_flag paths_present)" == "yes" ]] || { err "remote paths.json missing — ship the stack first"; exit 1; }
[[ "$(get_flag lib_present)"   == "yes" ]] || { err "remote _boe_lib.sh missing — ship the stack first"; exit 1; }
[[ "$(get_flag docker_ok)"     == "yes" ]] || { err "docker not usable on the VPS"; exit 1; }
ok "remote stack is provisioned"

[[ "$(get_flag backup_mounted)" == "yes" ]] || { err "backup disk not mounted at $BACKUP_MOUNT — rollback artifacts are unreadable"; exit 1; }
if [[ "$(get_flag backup_writable)" != "yes" ]]; then
    err "$BACKUP_ROOT is not writable by the deploy user on the VPS"
    err "rollback needs to write a pre-rollback snapshot and a log. Fix once:"
    err "    sudo chown -R beonedge:beonedge $BACKUP_ROOT"
    err "See release_manager/OPERATOR_MANUAL_STEPS.md §1."
    exit 1
fi
ok "backup tree ready"

CURRENT="$(boe_ssh "jq -r '.version // empty' '$REMOTE_DIR/$VERSION_NAME' 2>/dev/null" || true)"
field "currently deployed" "${CURRENT:-<none>}"

# ── warn loudly about database restoration ──────────────────────────────────
if [[ "$RESTORE_DB" == true ]]; then
    printf '\n'
    warn "--restore-db requested"
    warn "This will DROP and recreate the ${STACK} database from a snapshot."
    warn "Every transaction committed after that snapshot will be lost."
    warn "The remote script will back up the current database first and will"
    warn "require you to type RESTORE before proceeding."
    if [[ "$ASSUME_YES" != true && "$UI_INTERACTIVE" == true ]]; then
        confirm "Continue to the remote database-restore prompt?" || { warn "aborted"; exit 0; }
    fi
fi

if [[ "$LIST_ONLY" != true && "$ASSUME_YES" != true && "$UI_INTERACTIVE" == true ]]; then
    confirm "Run $ROLLBACK_NAME on $BOE_SSH_ALIAS for $STACK?" || { warn "aborted"; exit 0; }
fi

# ── hand off to the VPS-native rollback script ──────────────────────────────
section "REMOTE ROLLBACK" "all docker work happens on the VPS from here"

boe_ssh_opts
# Every argument is individually shell-quoted before it is spliced into the
# remotely-parsed command string, so no argument can ever break out and be
# re-interpreted by the remote shell.
REMOTE_TAIL=""
if (( ${#REMOTE_ARGS[@]} > 0 )); then
    printf -v REMOTE_TAIL ' %q' "${REMOTE_ARGS[@]}"
fi
printf '\n'
if ssh -t "${BOE_SSH_OPTS[@]}" "$BOE_SSH_ALIAS" \
        "cd '$REMOTE_DIR' && ./'$ROLLBACK_NAME'$REMOTE_TAIL"; then
    REMOTE_RC=0
else
    REMOTE_RC=$?
fi
printf '\n'

[[ "$LIST_ONLY" == true ]] && exit "$REMOTE_RC"

# ── reconcile the local ledger ──────────────────────────────────────────────
section "RECONCILE"

NOW="$(boe_ssh "jq -r '.version // empty' '$REMOTE_DIR/$VERSION_NAME' 2>/dev/null" || true)"
STATUS="$(boe_ssh "jq -r '.status // empty' '$REMOTE_DIR/$VERSION_NAME' 2>/dev/null" || true)"

mkdir -p "$RM_DIR/state"
LEDGER="$RM_DIR/state/versions.json"
[[ -s "$LEDGER" ]] || printf '{}\n' > "$LEDGER"
tmp="$(mktemp "${LEDGER}.XXXXXX")"
jq --arg stack "$STACK" --arg deployed "${NOW:-}" --arg status "${STATUS:-unknown}" \
   --arg from "${CURRENT:-}" --arg at "$(date -Is)" \
   '.[$stack] = ((.[$stack] // {}) + {deployed: $deployed, status: $status,
                                      rolled_back_from: $from, rolled_back_at: $at})' \
   "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"

field "was"    "${CURRENT:-<none>}"
field "now"    "${NOW:-<unknown>}"
field "status" "${STATUS:-<unknown>}"

if (( REMOTE_RC != 0 )); then
    err "remote rollback exited with status $REMOTE_RC"
    exit "$REMOTE_RC"
fi

banner "ROLLED BACK"
field "stack" "$STACK"
field "version" "${NOW:-<unknown>}"
printf '\n'
