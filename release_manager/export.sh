#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# export.sh — BUILD stage. Runs ONLY on this computer, never on the VPS.
#
# Responsibilities (and nothing else):
#   1. Determine the version label — this is the ONLY script that advances it.
#   2. Build the Docker images for the selected stack from the working tree.
#   3. `docker save | gzip` them into a versioned bundle under build/<stack>/.
#   4. Optionally build and stage the Android APKs.
#   5. Write manifest.json with SHA-256 checksums and git provenance.
#   6. Copy the VPS-native scripts, compose file, paths.json and .env.example
#      into the bundle, so the bundle is everything the VPS needs.
#
# Explicitly NOT this script's job:
#   • touching the VPS (that is deploy.sh)
#   • running docker compose anywhere (that is the VPS-native scripts)
#   • committing, tagging or pushing git (that is status.sh)
#
# Usage:
#   ./release_manager/export.sh --dev              build the development bundle
#   ./release_manager/export.sh --prod             build the production bundle
#   ./release_manager/export.sh --monitor          stage the monitoring bundle
#   ./release_manager/export.sh --dev --with-apk   also build the Android APKs
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RM_DIR="$ROOT_DIR/release_manager"
STACKS_SRC="$RM_DIR/stacks"
BUILD_DIR="$RM_DIR/build"
VERSION_FILE="$ROOT_DIR/VERSION"

# shellcheck source=lib/ui.sh
source "$RM_DIR/lib/ui.sh"
# shellcheck source=lib/version.sh
source "$RM_DIR/lib/version.sh"
# shellcheck source=lib/stacks.sh
source "$RM_DIR/lib/stacks.sh"
# shellcheck source=lib/paths.sh
source "$RM_DIR/lib/paths.sh"

STACK=""
SKIP_BUILD=false
WITH_APK=false
KEEP_BUNDLES=3

usage() {
    cat <<'USAGE'
Usage: ./release_manager/export.sh (--dev | --prod | --monitor) [options]

Builds images from the current working tree and stages a versioned release
bundle under release_manager/build/<stack>/. Never touches the VPS.

Stack selection (required, exactly one):
  --dev        development stack   → build/dev_release/
  --prod       production stack    → build/prod_release/
  --monitor    monitoring stack    → build/monitor_service/

Options:
  --with-apk     also build + stage the Android APKs for this stack
  --skip-build   reuse already-built images; only re-stage the bundle
  --keep N       how many past bundles to retain per stack (default 3)
  --help, -h     this message

Version labelling (this is the only script that advances the version):
  • clean tree on the exact vX.Y.Z tag  → stable X.Y.Z          (shippable to prod)
  • anything else                       → <next>-dev.N.gSHA[.dirty]  (dev only)

Production deploys refuse any version containing '-', so cut a release in
status.sh before exporting a production bundle.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev|--prod|--monitor)
            [[ -z "$STACK" ]] || { err "only one stack may be selected"; exit 1; }
            STACK="$(resolve_stack "$1")" || exit 1; shift ;;
        --with-apk)   WITH_APK=true; shift ;;
        --skip-build) SKIP_BUILD=true; shift ;;
        --keep)       KEEP_BUNDLES="${2:-3}"; shift 2 ;;
        --help|-h)    usage; exit 0 ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

[[ -n "$STACK" ]] || { err "a stack is required: --dev, --prod or --monitor"; usage >&2; exit 1; }

for c in docker jq gzip sha256sum git; do
    command -v "$c" >/dev/null || { err "$c is required"; exit 1; }
done

# ── version label ───────────────────────────────────────────────────────────
# canonical_version reads the tracked VERSION file first. Note the second
# argument is now the per-stack build dir rather than the old single BOE_APP
# directory, so a stack's own last-known version can act as the fallback.
CANONICAL="$(canonical_version "$VERSION_FILE" "$BUILD_DIR/$STACK" "$ROOT_DIR")"
assert_semver "$CANONICAL" || exit 1

if on_exact_release_tag "$ROOT_DIR" "$CANONICAL" \
   && release_origin_is_approved "$ROOT_DIR" \
   && remote_release_refs_match "$ROOT_DIR" "$CANONICAL" \
        "$(git -C "$ROOT_DIR" rev-parse HEAD)"; then
    VERSION="$CANONICAL"
    RELEASE_KIND="stable"
else
    # Bump the patch so a dev label always sorts AFTER the last release.
    VERSION="$(dev_version "$(bump_version "$CANONICAL" patch)" "$ROOT_DIR")"
    RELEASE_KIND="dev"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BUNDLE="$BUILD_DIR/$STACK/${VERSION}-${STAMP}"

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git -C "$ROOT_DIR" symbolic-ref --short -q HEAD 2>/dev/null || echo detached)"
GIT_DIRTY=false
[[ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)" ]] && GIT_DIRTY=true

banner "EXPORT · $STACK"
field "environment" "$(stack_attr "$STACK" env)"
field "version"     "$VERSION"
field "kind"        "$RELEASE_KIND"
field "commit"      "${GIT_SHA:0:9}$([[ "$GIT_DIRTY" == true ]] && printf ' (dirty)')"
field "bundle"      "${BUNDLE#"$ROOT_DIR"/}"

if [[ "$RELEASE_KIND" == "dev" && "$STACK" == "prod_release" ]]; then
    warn "this is a DEV label — prod_deploy.sh on the VPS will refuse it"
    warn "cut and push a stable release first:  ./release_manager/status.sh"
fi

mkdir -p "$BUNDLE/images"

# A bundle is only meaningful once manifest.json exists. If we abort before that
# — a failed build, a missing Dockerfile ARG — remove the partial directory so
# deploy.sh's "newest bundle" selection can never pick up a half-built release.
BUNDLE_COMPLETE=false
cleanup_incomplete_bundle() {
    if [[ "$BUNDLE_COMPLETE" != true && -d "$BUNDLE" ]]; then
        rm -rf "$BUNDLE"
        printf '   %sremoved incomplete bundle%s\n' "$c_dim" "$c_rst" >&2
    fi
}
trap cleanup_incomplete_bundle EXIT

# ── build images ────────────────────────────────────────────────────────────
# Frontend API origins are baked in at BUILD time (Vite/Next), so dev and prod
# genuinely need separate builds — this cannot be deferred to a runtime env var.
build_images() {
    local api_base landing_origin

    case "$STACK" in
        prod_release)
            api_base="${PROD_API_BASE:-https://app.beonedge.in/api}"
            landing_origin="${PROD_LANDING_ORIGIN:-https://beonedge.in}"
            ;;
        dev_release)
            api_base="${DEV_API_BASE:-https://dev-app.beonedge.in/api}"
            landing_origin="${DEV_LANDING_ORIGIN:-https://dev.beonedge.in}"
            ;;
    esac

    section "BUILD IMAGES" "api base baked in: $api_base"

    # ── fail fast on the known Dockerfile gap, BEFORE any expensive build ────
    # app and admin are two builds of the SAME Dockerfile, differentiated only by
    # VITE_BEO_APP_TARGET. Docker silently ignores a --build-arg the Dockerfile
    # does not declare, so without this ARG both images build identically and the
    # "user" frontend would serve the admin UI. Checked first because the backend
    # and landing builds take minutes.
    local app_dockerfile="$ROOT_DIR/frontend_stack/app/Dockerfile"
    [[ -f "$app_dockerfile" ]] || { err "missing $app_dockerfile"; exit 1; }
    if ! grep -q 'ARG[[:space:]]\+VITE_BEO_APP_TARGET' "$app_dockerfile"; then
        err "frontend_stack/app/Dockerfile does not declare ARG VITE_BEO_APP_TARGET"
        err ""
        err "Both frontend images would build identically, and the user-facing app"
        err "would serve the admin UI. Add these two lines to its build stage,"
        err "before the 'npm run build' line:"
        err ""
        err "    ARG VITE_BEO_APP_TARGET=client"
        err "    ENV VITE_BEO_APP_TARGET=\$VITE_BEO_APP_TARGET"
        err ""
        err "See release_manager/FACTS_VS_PLAN.md §6 item 7."
        exit 1
    fi
    ok "Dockerfile declares ARG VITE_BEO_APP_TARGET"

    local backend_tag landing_tag app_tag admin_tag
    backend_tag="$(stack_image_tag "$STACK" backend "$VERSION")"
    landing_tag="$(stack_image_tag "$STACK" landing "$VERSION")"
    app_tag="$(stack_image_tag "$STACK" app "$VERSION")"
    admin_tag="$(stack_image_tag "$STACK" admin "$VERSION")"

    step "backend → $backend_tag"
    docker build -t "$backend_tag" "$ROOT_DIR/backend_controller"

    step "landing → $landing_tag"
    # The landing image talks to the backend over the internal docker network,
    # so it is given the service name, not a public URL.
    docker build \
        --build-arg "BEO_API_BASE=http://backend:47502" \
        -t "$landing_tag" \
        "$ROOT_DIR/frontend_stack/packages/landing_page"

    step "user SPA → $app_tag"
    docker build \
        --build-arg "VITE_BEO_APP_TARGET=client" \
        --build-arg "VITE_BEO_API_MODE=http" \
        --build-arg "VITE_BEO_API_BASE_URL=$api_base" \
        -f "$app_dockerfile" \
        -t "$app_tag" \
        "$ROOT_DIR/frontend_stack"

    step "admin SPA → $admin_tag"
    docker build \
        --build-arg "VITE_BEO_APP_TARGET=admin" \
        --build-arg "VITE_BEO_API_MODE=http" \
        --build-arg "VITE_BEO_API_BASE_URL=$api_base" \
        -f "$app_dockerfile" \
        -t "$admin_tag" \
        "$ROOT_DIR/frontend_stack"

    ok "all four images built"
}

audit_landing_runtime_dependencies() {
    command -v npm >/dev/null || { err "npm is required for the landing production audit"; exit 1; }
    section "LANDING PRODUCTION DEPENDENCY AUDIT"
    npm --prefix "$ROOT_DIR/frontend_stack/packages/landing_page" run audit:production
    ok "landing production dependencies have no audit findings"
}

if [[ "$STACK" != "monitor_service" ]]; then
    # This deliberately runs even with --skip-build so a reused local image
    # cannot bypass the current runtime advisory gate.
    audit_landing_runtime_dependencies
fi

if [[ "$STACK" == "monitor_service" ]]; then
    section "BUILD IMAGES" "monitoring stack uses pinned upstream images — nothing to build"
elif [[ "$SKIP_BUILD" == true ]]; then
    section "BUILD IMAGES" "skipped by --skip-build"
else
    build_images
fi

# Prove the exact images about to be archived can start under the VPS frontend
# security profile. This also gates --skip-build, where an old local image could
# otherwise be repackaged even though the source contract has changed.
assert_frontend_runtime_images() {
    local key tag landing_tag
    section "FRONTEND RUNTIME ACCEPTANCE"
    landing_tag="$(stack_image_tag "$STACK" landing "$VERSION")"
    docker image inspect "$landing_tag" >/dev/null 2>&1 \
        || { err "image not present: $landing_tag (drop --skip-build?)"; exit 1; }
    step "landing → non-root read-only runtime"
    BOE_LANDING_RUNTIME_IMAGE="$landing_tag" bash "$RM_DIR/tests/runtime_contract.test.sh"

    for key in app admin; do
        tag="$(stack_image_tag "$STACK" "$key" "$VERSION")"
        docker image inspect "$tag" >/dev/null 2>&1 \
            || { err "image not present: $tag (drop --skip-build?)"; exit 1; }
        step "$key → hardened non-root runtime"
        BOE_RUNTIME_IMAGE="$tag" bash "$RM_DIR/tests/runtime_contract.test.sh"
    done
    ok "all frontend images passed hardened runtime acceptance"
}

if [[ "$STACK" != "monitor_service" ]]; then
    assert_frontend_runtime_images
fi

# ── save images ─────────────────────────────────────────────────────────────
declare -A SHA=()
if [[ "$STACK" != "monitor_service" && "$SKIP_BUILD" != true ]] || \
   { [[ "$STACK" != "monitor_service" ]] && [[ "$SKIP_BUILD" == true ]]; }; then
    section "SAVE IMAGES"
    while IFS=: read -r key archive port; do
        [[ -n "$key" ]] || continue
        tag="$(stack_image_tag "$STACK" "$key" "$VERSION")"
        docker image inspect "$tag" >/dev/null 2>&1 \
            || { err "image not present: $tag (drop --skip-build?)"; exit 1; }
        step "saving $tag"
        # gzip -n omits the timestamp so identical input yields an identical
        # archive — the checksum then means something across rebuilds.
        docker save "$tag" | gzip -n > "$BUNDLE/images/$archive"
        SHA["$key"]="$(sha256sum "$BUNDLE/images/$archive" | cut -d' ' -f1)"
        ok "$archive  $(du -h "$BUNDLE/images/$archive" | cut -f1)"
    done < <(stack_images "$STACK")
fi

# ── stage the VPS-side artifacts ────────────────────────────────────────────
section "STAGE VPS ARTIFACTS"

COMPOSE_NAME="$(stack_attr "$STACK" compose)"
DEPLOY_NAME="$(stack_attr "$STACK" deploy)"
ROLLBACK_NAME="$(stack_attr "$STACK" rollback)"
GUIDE_NAME="$(stack_attr "$STACK" guide)"

cp "$STACKS_SRC/$STACK/$COMPOSE_NAME"   "$BUNDLE/$COMPOSE_NAME"
cp "$STACKS_SRC/$STACK/$DEPLOY_NAME"    "$BUNDLE/$DEPLOY_NAME"
cp "$STACKS_SRC/$STACK/$ROLLBACK_NAME"  "$BUNDLE/$ROLLBACK_NAME"
cp "$STACKS_SRC/$STACK/.env.example"    "$BUNDLE/.env.example"
[[ -f "$STACKS_SRC/$STACK/$GUIDE_NAME" ]] && cp "$STACKS_SRC/$STACK/$GUIDE_NAME" "$BUNDLE/$GUIDE_NAME"

# The shared runtime library travels with every stack, so a stack directory on
# the VPS is self-sufficient over nothing but SSH.
cp "$STACKS_SRC/_shared/_boe_lib.sh"      "$BUNDLE/_boe_lib.sh"
cp "$STACKS_SRC/_shared/_boe_deploy.sh"   "$BUNDLE/_boe_deploy.sh"
cp "$STACKS_SRC/_shared/_boe_rollback.sh" "$BUNDLE/_boe_rollback.sh"
chmod +x "$BUNDLE/$DEPLOY_NAME" "$BUNDLE/$ROLLBACK_NAME"

# Monitoring configuration tree (prometheus/grafana/alertmanager/blackbox).
if [[ "$STACK" == "monitor_service" && -d "$STACKS_SRC/$STACK/config" ]]; then
    sensitive_config="$(find "$STACKS_SRC/$STACK/config" -type f \( \
        -name '.env*' -o -name '*.pem' -o -name '*.key' -o \
        -name '*.swp' -o -name '*.swo' -o -name '*~' \
    \) -print -quit)"
    [[ -z "$sensitive_config" ]] \
        || die "refusing to bundle sensitive monitoring config: $sensitive_config"
    cp -r "$STACKS_SRC/$STACK/config" "$BUNDLE/config"
    ok "staged monitoring config"
fi

# paths.json is regenerated at export time so it can never lag lib/stacks.sh.
paths_write "$STACK" "$BUNDLE/paths.json"
cp "$BUNDLE/paths.json" "$STACKS_SRC/$STACK/paths.json"
ok "generated paths.json"

COMPOSE_SHA="$(sha256sum "$BUNDLE/$COMPOSE_NAME" | cut -d' ' -f1)"

# ── APKs ────────────────────────────────────────────────────────────────────
APK_JSON='{}'
if [[ "$WITH_APK" == true ]]; then
    if [[ "$STACK" == "monitor_service" ]]; then
        warn "monitoring stack has no APKs — ignoring --with-apk"
    else
        section "BUILD APKs"
        apk_target="$([[ "$STACK" == "prod_release" ]] && echo --prod || echo --dev)"
        if BOE_APK_VERSION="$VERSION" "$ROOT_DIR/emu/boe_update.sh" "$apk_target" --no-install --both; then
            for variant in client admin; do
                for f in "$ROOT_DIR"/emu/out/boe."$(stack_attr "$STACK" short)".*"$variant"*.apk; do
                    [[ -f "$f" ]] || continue
                    mkdir -p "$BUNDLE/apk"
                    cp "$f" "$BUNDLE/apk/"
                    [[ -f "${f%.apk}.json" ]] && cp "${f%.apk}.json" "$BUNDLE/apk/"
                    APK_JSON="$(printf '%s' "$APK_JSON" | jq \
                        --arg v "$variant" --arg f "$(basename "$f")" \
                        --arg s "$(sha256sum "$f" | cut -d' ' -f1)" \
                        '.[$v] = {file: $f, sha256: $s}')"
                    ok "staged $(basename "$f")"
                done
            done
        else
            warn "APK build failed — bundle staged without APKs"
        fi
    fi
fi

# ── manifest ────────────────────────────────────────────────────────────────
section "MANIFEST"

IMAGES_JSON='{}'
while IFS=: read -r key archive port; do
    [[ -n "$key" ]] || continue
    IMAGES_JSON="$(printf '%s' "$IMAGES_JSON" | jq \
        --arg k "$key" \
        --arg tag "$(stack_image_tag "$STACK" "$key" "$VERSION")" \
        --arg archive "images/$archive" \
        --arg sha "${SHA[$key]:-}" \
        '.[$k] = {tag: $tag, archive: $archive, sha256: $sha}')"
done < <(stack_images "$STACK")

jq -n \
    --arg version "$VERSION" \
    --arg kind "$RELEASE_KIND" \
    --arg stack "$STACK" \
    --arg environment "$(stack_attr "$STACK" env)" \
    --arg created_at "$STAMP" \
    --arg git_sha "$GIT_SHA" \
    --arg git_branch "$GIT_BRANCH" \
    --argjson git_dirty "$GIT_DIRTY" \
    --arg compose_file "$COMPOSE_NAME" \
    --arg compose_sha "$COMPOSE_SHA" \
    --argjson images "$IMAGES_JSON" \
    --argjson apk "$APK_JSON" \
    '{version: $version, kind: $kind, stack: $stack, environment: $environment,
      created_at: $created_at,
      git_sha: $git_sha, git_branch: $git_branch, git_dirty: $git_dirty,
      compose: {file: $compose_file, sha256: $compose_sha},
      images: $images,
      apk: $apk}' > "$BUNDLE/manifest.json"

jq empty "$BUNDLE/manifest.json" || { err "generated invalid manifest"; exit 1; }

# From here the bundle is coherent and may be shipped.
BUNDLE_COMPLETE=true

# A flat checksum list too, so `sha256sum -c` works on the VPS without jq.
( cd "$BUNDLE" && { sha256sum "$COMPOSE_NAME"; [[ -d images ]] && sha256sum images/*.tar.gz; } > checksums.sha256 2>/dev/null ) || true

ok "manifest.json written"

# ── retention ───────────────────────────────────────────────────────────────
mapfile -t old < <(find "$BUILD_DIR/$STACK" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -V)
if (( ${#old[@]} > KEEP_BUNDLES )); then
    for v in "${old[@]:0:$(( ${#old[@]} - KEEP_BUNDLES ))}"; do
        rm -rf -- "$BUILD_DIR/$STACK/$v" && info "pruned old bundle $v" 2>/dev/null || true
    done
fi

# ── done ────────────────────────────────────────────────────────────────────
banner "BUNDLE READY"
field "stack"   "$STACK"
field "version" "$VERSION"
field "path"    "${BUNDLE#"$ROOT_DIR"/}"
field "size"    "$(du -sh "$BUNDLE" | cut -f1)"
printf '\n'
printf '   Next:  ./release_manager/deploy.sh %s\n' "$([[ "$STACK" == prod_release ]] && echo --prod || { [[ "$STACK" == dev_release ]] && echo --dev || echo --monitor; })"
printf '\n'
