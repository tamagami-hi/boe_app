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
# shellcheck source=lib/apk_ship.sh
source "$RM_DIR/lib/apk_ship.sh"
# shellcheck source=lib/nginx_ship.sh
source "$RM_DIR/lib/nginx_ship.sh"

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
  --skip-build   reuse already-built images; development/monitoring only
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
        --keep)
            [[ $# -ge 2 && "$2" =~ ^[0-9]+$ && "$2" -ge 1 ]] \
                || { err "--keep requires a positive integer (got: ${2:-<none>})"; exit 1; }
            KEEP_BUNDLES="$2"; shift 2 ;;
        --help|-h)    usage; exit 0 ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

[[ -n "$STACK" ]] || { err "a stack is required: --dev, --prod or --monitor"; usage >&2; exit 1; }

if [[ "$STACK" == prod_release && "$SKIP_BUILD" == true ]]; then
    err "production exports may not use --skip-build"
    err "rebuild production images so their contents come from the reviewed release commit"
    exit 1
fi

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
    local api_base admin_api_base

    case "$STACK" in
        prod_release)
            api_base="${PROD_API_BASE:-https://app.beonedge.in/api}"
            ;;
        dev_release)
            api_base="${DEV_API_BASE:-https://dev-app.beonedge.in/api}"
            ;;
    esac

    # The admin console is served from a DIFFERENT host than the user SPA
    # (admin.boe.app.internal over Tailscale, not dev-app.beonedge.in), and its
    # nginx vhost proxies /api/ to the backend on that same host. Baking the user
    # SPA's absolute origin into the admin bundle made every admin API call
    # cross-origin, which fails three ways at once: CORS returns no
    # Access-Control-Allow-Origin for an unlisted origin, validateWebOrigin()
    # rejects `Sec-Fetch-Site: cross-site` outright, and Secure/__Host- session
    # cookies are not sent cross-site. The visible symptom was the admin splash
    # never releasing, because its reachability probe (GET /v1/health) was
    # discarded by the browser.
    #
    # A RELATIVE base is what the vhost's same-origin contract requires: the
    # bundle then calls whichever host served it, so one image works behind any
    # admin hostname without a rebuild. Override only if the admin console is
    # ever served from an origin that does NOT proxy /api/ itself.
    #
    # The APKs are NOT built here (see emu/boe_update.sh); they keep an absolute
    # https origin, which they need — a Capacitor WebView has no server to be
    # same-origin with.
    admin_api_base="${ADMIN_API_BASE:-/api}"

    section "BUILD IMAGES" "api base baked in: $api_base (admin: $admin_api_base)"

    # ── fail fast on the known Dockerfile gap, BEFORE any expensive build ────
    # app and admin are two builds of the SAME Dockerfile, differentiated only by
    # VITE_BEO_APP_TARGET. Docker silently ignores a --build-arg the Dockerfile
    # does not declare, so without this ARG both images build identically and the
    # "user" frontend would serve the admin UI. Checked first because the backend
    # and admin builds take minutes.
    local app_dockerfile="$ROOT_DIR/frontend_stack_ts/Dockerfile"
    [[ -f "$app_dockerfile" ]] || { err "missing $app_dockerfile"; exit 1; }
    if ! grep -q 'ARG[[:space:]]\+VITE_BEO_APP_TARGET' "$app_dockerfile"; then
        err "frontend_stack_ts/Dockerfile does not declare ARG VITE_BEO_APP_TARGET"
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

    local backend_tag app_tag admin_tag
    backend_tag="$(stack_image_tag "$STACK" backend "$VERSION")"
    app_tag="$(stack_image_tag "$STACK" app "$VERSION")"
    admin_tag="$(stack_image_tag "$STACK" admin "$VERSION")"

    step "backend → $backend_tag"
    docker build -t "$backend_tag" "$ROOT_DIR/backend_controller"

    step "user SPA → $app_tag"
    docker build \
        --build-arg "VITE_BEO_APP_TARGET=client" \
        --build-arg "VITE_BEO_API_MODE=http" \
        --build-arg "VITE_BEO_API_BASE_URL=$api_base" \
        -f "$app_dockerfile" \
        -t "$app_tag" \
        "$ROOT_DIR"

    step "admin SPA → $admin_tag"
    docker build \
        --build-arg "VITE_BEO_APP_TARGET=admin" \
        --build-arg "VITE_BEO_API_MODE=http" \
        --build-arg "VITE_BEO_API_BASE_URL=$admin_api_base" \
        -f "$app_dockerfile" \
        -t "$admin_tag" \
        "$ROOT_DIR"

    ok "all three images built"
}

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
    local key tag
    section "FRONTEND RUNTIME ACCEPTANCE"

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
if [[ "$STACK" != "monitor_service" ]]; then
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

# The nginx site configs travel in the bundle too, so they are covered by
# checksums.sha256 and the remote verify proves the file that arrived is the file
# that was built. They are staged for every stack because the NGINX folder sits at
# <vps.root> and is shared by the whole box — shipping only one stack's vhost
# would leave the folder permanently half-current, which is how it drifted months
# behind the repo in the first place.
#
# Staging is all this does. Installing into /etc/nginx needs root and can take
# down every site at once, so deploy.sh prints per-file commands instead; see
# lib/nginx_ship.sh.
step "staging nginx configs"
nginx_ship_stage "$BUNDLE"

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

# paths.json is the stack's hand-edited canonical contract (schema 3): the
# sole authority for every path this bundle will use. It is validated and
# copied byte-for-byte — never generated, regenerated, or overwritten here.
PATHS_FILE="$(stack_paths_file "$STACK")" || exit 1
paths_validate "$STACK" "$PATHS_FILE" \
    || { err "the $STACK path contract failed validation — fix stacks/$STACK/paths.json"; exit 1; }
cp "$PATHS_FILE" "$BUNDLE/paths.json"
PATHS_SHA="$(sha256sum "$BUNDLE/paths.json" | cut -d' ' -f1)"
ok "validated and staged paths.json (schema 3, unchanged)"

COMPOSE_SHA="$(sha256sum "$BUNDLE/$COMPOSE_NAME" | cut -d' ' -f1)"

# ── APKs ────────────────────────────────────────────────────────────────────
APK_JSON='{}'
if [[ "$WITH_APK" == true ]]; then
    if [[ "$STACK" == "monitor_service" ]]; then
        warn "monitoring stack has no APKs — ignoring --with-apk"
    else
        section "BUILD APKs"
        apk_target="$([[ "$STACK" == "prod_release" ]] && echo --prod || echo --dev)"
        apk_short="$(stack_attr "$STACK" short)"
        apk_mode=dev
        [[ "$STACK" == "prod_release" ]] && apk_mode=prod
        # Filenames carry the BASE semver (boe_update.sh strips any -dev label),
        # so the exact artifacts of THIS build are addressed by name — never by
        # wildcard or mtime, which could sweep retained older builds into the
        # bundle.
        apk_base_version="${VERSION%%-*}"
        if BOE_APK_VERSION="$VERSION" "$ROOT_DIR/emu/boe_update.sh" "$apk_target" --no-install --both; then
            mkdir -p "$BUNDLE/apk"
            for variant in client admin; do
                apk="$(apk_ship_exact_apk "$ROOT_DIR/emu/out" "$apk_short" "$variant" "$apk_base_version")" || {
                    err "APK build did not produce the exact $variant artifact for $apk_base_version"
                    exit 1
                }
                apk_expected_git=""
                [[ "$GIT_SHA" != unknown ]] && apk_expected_git="$GIT_SHA"
                apk_sha="$(apk_validate_local_artifact "$apk" "$apk_short" "$variant" \
                    "$apk_base_version" "$apk_expected_git" "$apk_mode")" || exit 1
                cp -- "$apk" "$BUNDLE/apk/"
                cp -- "${apk%.apk}.json" "$BUNDLE/apk/"
                APK_JSON="$(printf '%s' "$APK_JSON" | jq \
                    --arg v "$variant" --arg f "$(basename "$apk")" \
                    --arg s "$apk_sha" --arg t "$apk_short" \
                    --arg ver "$apk_base_version" --arg g "$GIT_SHA" \
                    '.[$v] = {variant: $v, file: $f, sha256: $s,
                              target: $t, version: $ver, git_sha: $g}')"
                ok "staged $(basename "$apk")"
            done
        else
            # --with-apk was explicitly requested: an APK-less bundle would
            # silently ship a release without the artifacts the operator asked
            # for. Fail closed instead — the incomplete bundle is removed by
            # the EXIT trap.
            err "--with-apk was requested but the APK build failed"
            err "fix the Android build, or re-run without --with-apk"
            exit 1
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
    --arg paths_sha "$PATHS_SHA" \
    --argjson images "$IMAGES_JSON" \
    --argjson apk "$APK_JSON" \
    '{version: $version, kind: $kind, stack: $stack, environment: $environment,
      created_at: $created_at,
      git_sha: $git_sha, git_branch: $git_branch, git_dirty: $git_dirty,
      compose: {file: $compose_file, sha256: $compose_sha},
      paths: {file: "paths.json", sha256: $paths_sha},
      images: $images,
      apk: $apk}' > "$BUNDLE/manifest.json"

jq empty "$BUNDLE/manifest.json" || { err "generated invalid manifest"; exit 1; }

# A flat checksum list too, so `sha256sum -c` works on the VPS without jq. It
# covers every staged file that lands IN THE STACK DIRECTORY — compose,
# paths.json, manifest.json, all scripts, .env.example, the guide, the monitor
# config tree, image archives and the APK artifacts — so deploy.sh's remote check
# genuinely proves upload integrity.
#
# `./nginx/*` is excluded, and the exclusion is load-bearing rather than tidy-up.
# Both verifiers run `cd <stack_dir> && sha256sum -c checksums.sha256`
# (deploy.sh, and boe_verify_checksums in stacks/_shared/_boe_lib.sh), so every
# path in this file must resolve relative to the stack directory. The nginx
# configs are deliberately installed OUTSIDE it, at <vps.root>/NGINX, because
# /etc/nginx is shared by the whole box and not by one release. Listing them here
# made both verifiers fail on files that were never meant to be there:
#
#   sha256sum: ./nginx/app.beonedge.in.conf: No such file or directory
#
# Their integrity is proven where they actually land: deploy.sh compares the
# remote digests in <vps.root>/NGINX against the bundle copies right after the
# upload.
( cd "$BUNDLE" && find . -type f ! -name 'checksums.sha256' ! -path './nginx/*' -print0 \
    | sort -z | xargs -0 -r sha256sum > checksums.sha256 )

# From here the bundle is coherent and may be shipped.
BUNDLE_COMPLETE=true

ok "manifest.json written"

# ── retention ───────────────────────────────────────────────────────────────
# Oldest-first by build time, so pruning cannot delete the clean tagged release
# and keep an older dirty prerelease of the same version (see version.sh).
mapfile -t old < <(bundle_dirs_oldest_first "$BUILD_DIR/$STACK")
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
