#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — SHIP stage. Runs on this computer; deploys nothing itself.
#
# The division of labour is deliberate and strict:
#
#   THIS SCRIPT                        THE VPS-NATIVE SCRIPT
#   ───────────────────────────        ─────────────────────────────────────
#   verify the bundle                  acquire the deploy lock
#   verify the VPS is reachable        verify checksums again, on arrival
#   verify remote preconditions        archive the outgoing release
#   upload tarballs + scripts          back up the database
#   invoke <stack>_deploy.sh    ───▶   docker load / compose up
#   stream its output back             health-gate and record the version
#
# This script runs NO docker command against the VPS. Every container operation
# happens inside the VPS-native script, which is the only thing that touches the
# docker daemon. That is a hard requirement, not a stylistic choice.
#
# Transfer is rsync over SSH, writing ONLY the files this pipeline owns. It never
# renames or deletes a directory — the old implementation swapped the deploy
# directory (`mv D D.previous && mv D.next D && rm -rf D.previous`), which under
# the current layout would destroy the sibling stacks and their state.
#
# Usage:
#   ./release_manager/deploy.sh --dev
#   ./release_manager/deploy.sh --prod
#   ./release_manager/deploy.sh --monitor
#   ./release_manager/deploy.sh --dev --ship-only     upload without deploying
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RM_DIR="$ROOT_DIR/release_manager"
BUILD_DIR="$RM_DIR/build"

# shellcheck source=lib/ui.sh
source "$RM_DIR/lib/ui.sh"
# shellcheck source=lib/version.sh
source "$RM_DIR/lib/version.sh"
# shellcheck source=lib/stacks.sh
source "$RM_DIR/lib/stacks.sh"
# shellcheck source=lib/paths.sh
source "$RM_DIR/lib/paths.sh"
# shellcheck source=lib/repo_sync.sh
source "$RM_DIR/lib/repo_sync.sh"

STACK=""
BUNDLE_ARG=""
SHIP_ONLY=false
ASSUME_YES=false
FORCE=false
SKIP_CHECKS=false
REMOTE_ARGS=()

usage() {
    cat <<'USAGE'
Usage: ./release_manager/deploy.sh (--dev | --prod | --monitor) [options]

Uploads the latest staged bundle to the VPS and then runs that stack's native
deploy script there. All docker work happens on the VPS.

Stack selection (required, exactly one):
  --dev        → /srv/dev_stack/BOE_APP/dev_release      → dev_deploy.sh
  --prod       → /srv/dev_stack/BOE_APP/prod_release     → prod_deploy.sh
  --monitor    → /srv/dev_stack/BOE_APP/monitor_service  → ms_deploy.sh

Options:
  --bundle DIR    ship a specific bundle instead of the newest
  --ship-only     upload the artifacts but do not run the remote deploy
  --yes, -y       skip local confirmation, and pass --yes to the remote script
  --force         pass --force to the remote script (redeploy the same version)
  --skip-checks   pass --skip-checks to the remote script
  --help, -h      this message

Requires that export.sh has already staged a bundle for the chosen stack.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev|--prod|--monitor)
            [[ -z "$STACK" ]] || { err "only one stack may be selected"; exit 1; }
            STACK="$(resolve_stack "$1")" || exit 1; shift ;;
        --bundle)      BUNDLE_ARG="${2:-}"; shift 2 ;;
        --ship-only)   SHIP_ONLY=true; shift ;;
        --yes|-y)      ASSUME_YES=true; REMOTE_ARGS+=(--yes); shift ;;
        --force)       FORCE=true; REMOTE_ARGS+=(--force); shift ;;
        --skip-checks) SKIP_CHECKS=true; REMOTE_ARGS+=(--skip-checks); shift ;;
        --help|-h)     usage; exit 0 ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

[[ -n "$STACK" ]] || { err "a stack is required: --dev, --prod or --monitor"; usage >&2; exit 1; }

for c in ssh scp rsync jq sha256sum; do
    command -v "$c" >/dev/null || { err "$c is required"; exit 1; }
done

REMOTE_DIR="$(stack_dir "$STACK")"
assert_safe_remote_dir "$REMOTE_DIR" || exit 1

banner "DEPLOY · $STACK"

# ── 1. locate and validate the bundle ───────────────────────────────────────
section "1/7  BUNDLE"

if [[ -n "$BUNDLE_ARG" ]]; then
    BUNDLE="$(cd "$BUNDLE_ARG" 2>/dev/null && pwd)" || { err "no such bundle: $BUNDLE_ARG"; exit 1; }
else
    BUNDLE="$(find "$BUILD_DIR/$STACK" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n1)"
    [[ -n "$BUNDLE" ]] || { err "no bundle staged for $STACK — run: ./release_manager/export.sh $([[ "$STACK" == prod_release ]] && echo --prod || echo --dev)"; exit 1; }
fi

COMPOSE_NAME="$(stack_attr "$STACK" compose)"
DEPLOY_NAME="$(stack_attr "$STACK" deploy)"
ROLLBACK_NAME="$(stack_attr "$STACK" rollback)"

for f in manifest.json paths.json "$COMPOSE_NAME" "$DEPLOY_NAME" "$ROLLBACK_NAME" \
         _boe_lib.sh _boe_deploy.sh _boe_rollback.sh; do
    [[ -f "$BUNDLE/$f" ]] || { err "bundle is incomplete, missing: $f"; exit 1; }
done

PATHS_SCHEMA="$(jq -r '.schema // 0' "$BUNDLE/paths.json" 2>/dev/null || printf '0')"
[[ "$PATHS_SCHEMA" == "2" ]] || {
    err "bundle uses paths schema $PATHS_SCHEMA; schema 2 is required"
    err "export a new bundle so deployment cannot restore the retired external-secrets overlay"
    exit 1
}

VERSION="$(jq -r '.version // empty' "$BUNDLE/manifest.json")"
KIND="$(jq -r '.kind // "unknown"' "$BUNDLE/manifest.json")"
[[ -n "$VERSION" ]] || { err "bundle manifest has no version"; exit 1; }

field "bundle"  "${BUNDLE#"$ROOT_DIR"/}"
field "version" "$VERSION"
field "kind"    "$KIND"
field "remote"  "${BOE_SSH_ALIAS}:${REMOTE_DIR}"

# Verify locally before spending bandwidth on a corrupt archive.
step "verifying bundle checksums"
while read -r key sha archive; do
    [[ -n "$key" ]] || continue
    [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || { warn "no checksum recorded for $key"; continue; }
    actual="$(sha256sum "$BUNDLE/$archive" | cut -d' ' -f1)"
    [[ "$actual" == "$sha" ]] || { err "local checksum mismatch for $archive"; exit 1; }
done < <(jq -r '.images | to_entries[] | [.key, .value.sha256, .value.archive] | @tsv' "$BUNDLE/manifest.json")
ok "bundle checksums verified locally"

# ── 2. production gate ──────────────────────────────────────────────────────
section "2/7  RELEASE GATE"

if [[ "$STACK" == "prod_release" ]]; then
    if [[ "$VERSION" == *-* ]]; then
        err "refusing to ship a development build to production: $VERSION"
        err "cut a stable release first: ./release_manager/status.sh"
        exit 1
    fi
    if ! release_origin_is_approved "$ROOT_DIR"; then
        err "origin fetch/push URLs are not the single approved BeOnEdge repository"
        exit 1
    fi
    repo_sync_eval "$RM_DIR" >/dev/null 2>&1 || true
    manifest_sha="$(jq -r '.git_sha // empty' "$BUNDLE/manifest.json")"
    manifest_dirty="$(jq -r '.git_dirty // false' "$BUNDLE/manifest.json")"
    if [[ "$RS_FETCHED" != true || "$RS_HAS_REMOTE" != true || -z "$RS_REMOTE_FULL" ]]; then
        err "could not freshly verify origin/main — refusing production deployment"
        exit 1
    fi
    origin_sha="$RS_REMOTE_FULL"

    if [[ "$manifest_dirty" == "true" ]]; then
        err "bundle was built from a dirty tree — refusing to ship to production"
        exit 1
    fi
    if [[ "$manifest_sha" != "$origin_sha" ]]; then
        err "bundle commit ${manifest_sha:0:9} is not origin/main ${origin_sha:0:9}"
        err "push the release commit before shipping to production"
        exit 1
    fi
    if ! remote_release_refs_match "$ROOT_DIR" "$VERSION" "$manifest_sha"; then
        err "live origin/main and v$VERSION do not both resolve to bundle commit ${manifest_sha:0:9}"
        err "retry or reconcile the atomic release push before shipping to production"
        exit 1
    fi
    ok "production gate passed (stable, clean, matches origin/main and remote tag)"
else
    ok "non-production stack — no release gate"
fi

# ── 3. remote reachability and preconditions ────────────────────────────────
section "3/7  REMOTE PREFLIGHT"

step "checking SSH connectivity"
boe_ssh true 2>/dev/null || { err "cannot reach $BOE_SSH_ALIAS over SSH"; exit 1; }
ok "SSH ok"

# One round trip that reports everything we need to know before uploading.
# Read-only: it changes nothing on the VPS.
PREFLIGHT="$(boe_ssh "bash -s -- '$REMOTE_DIR' '$BOE_BACKUP_MOUNT' '$BOE_BACKUP_ROOT'" <<'REMOTE' || true
set -u
stack_dir="$1"; backup_mount="$2"; backup_root="$3"
printf 'stack_dir_exists=%s\n'  "$([[ -d "$stack_dir" ]] && echo yes || echo no)"
printf 'stack_dir_writable=%s\n' "$([[ -w "$stack_dir" ]] && echo yes || echo no)"
printf 'env_present=%s\n'        "$([[ -f "$stack_dir/.env" ]] && echo yes || echo no)"
printf 'env_nonempty=%s\n'       "$([[ -s "$stack_dir/.env" ]] && echo yes || echo no)"
env_safe=no
if [[ ! -L "$stack_dir/.env" && -f "$stack_dir/.env" && -r "$stack_dir/.env" ]]; then
  mode="$(stat -c '%a' "$stack_dir/.env" 2>/dev/null || true)"
  owner="$(stat -c '%u' "$stack_dir/.env" 2>/dev/null || true)"
  links="$(stat -c '%h' "$stack_dir/.env" 2>/dev/null || true)"
  if [[ "$links" == 1 ]] && { [[ "$owner" == "$(id -u)" && "$mode" == 600 ]] || [[ "$owner" == 0 && "$mode" == 640 ]]; }; then
    env_safe=yes
  fi
fi
printf 'env_safe=%s\n'           "$env_safe"
printf 'docker_ok=%s\n'          "$(docker info >/dev/null 2>&1 && echo yes || echo no)"
printf 'compose_ok=%s\n'         "$(docker compose version >/dev/null 2>&1 && echo yes || echo no)"
printf 'backup_mounted=%s\n'     "$(mountpoint -q "$backup_mount" && echo yes || echo no)"
printf 'backup_writable=%s\n'    "$([[ -w "$backup_root" ]] && echo yes || echo no)"
printf 'rsync_ok=%s\n'           "$(command -v rsync >/dev/null 2>&1 && echo yes || echo no)"
printf 'disk_avail_mib=%s\n'     "$(df -BM --output=avail "$stack_dir" 2>/dev/null | tail -n1 | tr -dc '0-9')"
REMOTE
)"

get_flag() { printf '%s\n' "$PREFLIGHT" | sed -n "s/^$1=//p" | tail -n1; }

for f in docker_ok compose_ok rsync_ok; do
    [[ "$(get_flag "$f")" == "yes" ]] || { err "remote preflight failed: $f"; exit 1; }
done
ok "docker, compose and rsync available on the VPS"

[[ "$(get_flag stack_dir_exists)" == "yes" ]] || { err "remote stack directory missing: $REMOTE_DIR"; exit 1; }
[[ "$(get_flag stack_dir_writable)" == "yes" ]] || { err "remote stack directory not writable: $REMOTE_DIR"; exit 1; }
ok "remote stack directory writable"

if [[ "$(get_flag backup_mounted)" != "yes" ]]; then
    err "backup disk is not mounted at $BOE_BACKUP_MOUNT on the VPS"
    err "the remote deploy would refuse to write rollback artifacts"
    exit 1
fi
ok "backup disk mounted"

# This is the known blocker: /srv/backup/BOE_APP is root-owned by default, and
# the VPS has no passwordless sudo, so the deploy user cannot write rollbacks.
# Surface it here — before uploading — with the exact fix.
if [[ "$(get_flag backup_writable)" != "yes" ]]; then
    err "$BOE_BACKUP_ROOT is NOT writable by the deploy user on the VPS"
    err ""
    err "The remote deploy cannot create rollback artifacts, database snapshots"
    err "or logs. Fix it once, by hand, on the VPS:"
    err ""
    err "    sudo chown -R beonedge:beonedge $BOE_BACKUP_ROOT"
    err "    sudo chmod -R u+rwX,go+rX $BOE_BACKUP_ROOT"
    err ""
    err "See release_manager/OPERATOR_MANUAL_STEPS.md §1."
    exit 1
fi
ok "backup tree writable"

if [[ "$(get_flag env_nonempty)" != "yes" ]]; then
    warn "remote $REMOTE_DIR/.env is missing or empty"
    warn "the .env.example in this bundle will be uploaded, but you must fill it in"
    if [[ "$SHIP_ONLY" != true ]]; then
        err "a runtime deployment requires the stack-local .env"
        exit 1
    fi
elif [[ "$(get_flag env_safe)" != "yes" ]]; then
    warn "remote $REMOTE_DIR/.env has unsafe ownership, permissions, or links"
    warn "use deploy-user ownership with mode 600, or root ownership with mode 640"
    if [[ "$SHIP_ONLY" != true ]]; then
        err "refusing to deploy with an insecure stack-local .env"
        exit 1
    fi
fi

avail="$(get_flag disk_avail_mib)"
bundle_mib="$(du -sm "$BUNDLE" | cut -f1)"
need=$(( bundle_mib * 3 ))
if [[ -n "$avail" ]] && (( avail < need )); then
    err "insufficient remote disk: ${avail}MiB free, need ~${need}MiB"
    exit 1
fi
field "remote disk" "${avail:-?}MiB free (bundle ${bundle_mib}MiB)"

# ── 4. confirm ──────────────────────────────────────────────────────────────
if [[ "$ASSUME_YES" != true && "$UI_INTERACTIVE" == true ]]; then
    printf '\n'
    if ! confirm "Ship $VERSION to $STACK on $BOE_SSH_ALIAS?"; then
        warn "aborted"; exit 0
    fi
fi

# ── 5. upload ───────────────────────────────────────────────────────────────
section "5/7  UPLOAD"

# rsync, not a tar+scp+directory-swap. Two important properties:
#   • --checksum re-verifies content rather than trusting size+mtime
#   • no --delete: we never remove remote files we did not put there, so
#     .env, images from other releases and sibling stacks are all untouched
RSYNC_OPTS=(-az --checksum --human-readable --partial --info=progress2
            --chmod=F644,D755 --exclude='/.env')
boe_ssh_opts
RSYNC_SSH="ssh ${BOE_SSH_OPTS[*]}"

step "uploading release artifacts"
rsync "${RSYNC_OPTS[@]}" -e "$RSYNC_SSH" \
    "$BUNDLE/manifest.json" \
    "$BUNDLE/paths.json" \
    "$BUNDLE/checksums.sha256" \
    "$BUNDLE/$COMPOSE_NAME" \
    "$BUNDLE/.env.example" \
    "${BOE_SSH_ALIAS}:${REMOTE_DIR}/" \
    || { err "failed to upload release metadata"; exit 1; }

step "uploading VPS-native scripts"
rsync -az --checksum --chmod=F755,D755 -e "$RSYNC_SSH" \
    "$BUNDLE/$DEPLOY_NAME" "$BUNDLE/$ROLLBACK_NAME" \
    "$BUNDLE/_boe_lib.sh" "$BUNDLE/_boe_deploy.sh" "$BUNDLE/_boe_rollback.sh" \
    "${BOE_SSH_ALIAS}:${REMOTE_DIR}/" \
    || { err "failed to upload native scripts"; exit 1; }

if [[ -f "$BUNDLE/$(stack_attr "$STACK" guide)" ]]; then
    rsync -az --checksum --chmod=F644 -e "$RSYNC_SSH" \
        "$BUNDLE/$(stack_attr "$STACK" guide)" "${BOE_SSH_ALIAS}:${REMOTE_DIR}/" || true
fi

if [[ -d "$BUNDLE/images" ]] && compgen -G "$BUNDLE/images/*.tar.gz" >/dev/null; then
    step "uploading image archives ($(du -sh "$BUNDLE/images" | cut -f1))"
    boe_ssh "mkdir -p '$REMOTE_DIR/images'" || { err "cannot create remote images dir"; exit 1; }
    rsync "${RSYNC_OPTS[@]}" -e "$RSYNC_SSH" \
        "$BUNDLE/images/" "${BOE_SSH_ALIAS}:${REMOTE_DIR}/images/" \
        || { err "failed to upload image archives"; exit 1; }
fi

if [[ -d "$BUNDLE/config" ]]; then
    step "uploading monitoring config"
    rsync -az --checksum --chmod=F644,D755 \
        --exclude='.env*' --exclude='*.pem' --exclude='*.key' \
        --exclude='*.swp' --exclude='*.swo' --exclude='*~' \
        -e "$RSYNC_SSH" \
        "$BUNDLE/config/" "${BOE_SSH_ALIAS}:${REMOTE_DIR}/config/" \
        || { err "failed to upload config"; exit 1; }
fi

# APKs go into their designated holder directories (plan §16.7).
if [[ -d "$BUNDLE/apk" ]]; then
    step "publishing APK artifacts"
    while read -r apk_dir; do
        [[ -n "$apk_dir" ]] || continue
        boe_ssh "mkdir -p '$apk_dir'" || continue
        case "$apk_dir" in
            *admin*) pattern="*admin*" ;;
            *)       pattern="*client*" ;;
        esac
        for f in "$BUNDLE"/apk/$pattern; do
            [[ -f "$f" ]] || continue
            rsync -az --checksum --chmod=F644 -e "$RSYNC_SSH" "$f" "${BOE_SSH_ALIAS}:${apk_dir}/" \
                && ok "published $(basename "$f") → ${apk_dir##*/}"
        done
    done < <(jq -r '.vps.apk_dirs[]?' "$BUNDLE/paths.json")
fi

step "verifying uploads on the VPS"
REMOTE_VERIFY="$(boe_ssh "cd '$REMOTE_DIR' && sha256sum -c --quiet checksums.sha256 2>&1 && echo VERIFY_OK" || true)"
if ! printf '%s' "$REMOTE_VERIFY" | grep -q VERIFY_OK; then
    err "remote checksum verification FAILED after upload"
    printf '%s\n' "$REMOTE_VERIFY" >&2
    exit 1
fi
ok "remote checksums match — upload intact"

if [[ "$SHIP_ONLY" == true ]]; then
    banner "SHIPPED (not deployed)"
    field "version" "$VERSION"
    field "remote"  "$REMOTE_DIR"
    printf '\n   Deploy on the VPS with:\n     ssh %s "cd %s && ./%s"\n\n' \
        "$BOE_SSH_ALIAS" "$REMOTE_DIR" "$DEPLOY_NAME"
    exit 0
fi

# ── 6. hand off to the VPS-native deploy script ─────────────────────────────
section "6/7  REMOTE DEPLOY" "all docker work happens on the VPS from here"

# -t so the remote script can prompt (production confirmation) and so we get
# its output streamed live rather than buffered until it finishes.
boe_ssh_opts
printf '\n'
if ssh -t "${BOE_SSH_OPTS[@]}" "$BOE_SSH_ALIAS" \
        "cd '$REMOTE_DIR' && ./'$DEPLOY_NAME' ${REMOTE_ARGS[*]:-}"; then
    REMOTE_RC=0
else
    REMOTE_RC=$?
fi
printf '\n'

# ── 7. reconcile ────────────────────────────────────────────────────────────
section "7/7  RECONCILE"

VERSION_NAME="$(stack_attr "$STACK" version_file)"
DEPLOYED="$(boe_ssh "jq -r '.version // empty' '$REMOTE_DIR/$VERSION_NAME' 2>/dev/null" || true)"
STATUS="$(boe_ssh "jq -r '.status // empty' '$REMOTE_DIR/$VERSION_NAME' 2>/dev/null" || true)"

mkdir -p "$RM_DIR/state"
LEDGER="$RM_DIR/state/versions.json"
[[ -s "$LEDGER" ]] || printf '{}\n' > "$LEDGER"
tmp="$(mktemp "${LEDGER}.XXXXXX")"
jq --arg stack "$STACK" --arg built "$VERSION" --arg deployed "${DEPLOYED:-}" \
   --arg status "${STATUS:-unknown}" --arg at "$(date -Is)" \
   '.[$stack] = {built: $built, deployed: $deployed, status: $status, shipped_at: $at}' \
   "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"

field "shipped"  "$VERSION"
field "deployed" "${DEPLOYED:-<unknown>}"
field "status"   "${STATUS:-<unknown>}"

if (( REMOTE_RC != 0 )); then
    err "remote deploy exited with status $REMOTE_RC"
    err "inspect the log on the VPS:"
    err "  ssh $BOE_SSH_ALIAS 'ls -t $(paths_get "$BUNDLE/paths.json" .backup.deploy_log)/ | head'"
    exit "$REMOTE_RC"
fi

if [[ "$DEPLOYED" != "$VERSION" ]]; then
    warn "remote reports '$DEPLOYED' but we shipped '$VERSION' — investigate"
    exit 1
fi

banner "DEPLOYED"
field "stack"   "$STACK"
field "version" "$VERSION"
field "status"  "${STATUS:-active}"
printf '\n'
