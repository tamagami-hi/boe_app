#!/usr/bin/env bash

# Build + save the BeOnEdge deploy images into a single release bundle under
# release_manager/recent_builds/. This script ONLY builds the current working
# tree into Docker images — it never bumps the version, commits, tags, or pushes.
#
# All git/version work (cut a release, push to remote main) lives in status.sh.
# export.sh just labels the build from the canonical VERSION file:
#   • tree is clean AND HEAD is exactly the vX.Y.Z release tag → stable X.Y.Z
#     (the only thing deploy.sh will ship to the VPS).
#   • otherwise → an auto-derived <next>-dev.N.gSHA[.dirty] label, local-only.
#
# Typical flow:  status.sh (cut + push release)  →  export.sh  →  deploy.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release_manager"
RECENT_DIR="$RELEASE_DIR/recent_builds"
ACTIVE_DIR="$RELEASE_DIR/BOE_APP"

# shellcheck source=lib/version.sh
source "$RELEASE_DIR/lib/version.sh"
# shellcheck source=lib/ui.sh
source "$RELEASE_DIR/lib/ui.sh"

BACKEND_CONTEXT="$ROOT_DIR/backend_controller"
LANDING_CONTEXT="$ROOT_DIR/frontend_stack/packages/landing_page"

# Git-tracked source of truth for the project version (written by status.sh).
VERSION_FILE="$ROOT_DIR/VERSION"

SKIP_BUILD=false

usage() {
    cat <<'USAGE'
Usage: ./release_manager/export.sh [--skip-build]

Builds boe-backend + boe-landing images from the CURRENT working tree and
exports one bundle to release_manager/recent_builds (replacing any older one).

The version label is derived, never bumped here:
  • clean tree on the exact vX.Y.Z release tag  → stable X.Y.Z (shippable)
  • anything else                               → <next>-dev.N.gSHA[.dirty]

To cut a stable release (bump VERSION, commit, tag, push to remote main), use
the interactive console first:  ./release_manager/status.sh

  --skip-build   reuse already-built images; just re-export the bundle.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build) SKIP_BUILD=true; shift ;;
        --help|-h) usage; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
    esac
done

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v gzip >/dev/null || { echo "gzip is required" >&2; exit 1; }

mkdir -p "$RECENT_DIR"

# ── version label (derived from git state — no bump, no mutation) ───────────────
CANONICAL_VERSION="$(canonical_version "$VERSION_FILE" "$ACTIVE_DIR" "$ROOT_DIR")"
if on_exact_release_tag "$ROOT_DIR" "$CANONICAL_VERSION"; then
    # Built from the exact release commit status.sh cut → stable, shippable.
    VERSION="$CANONICAL_VERSION"
else
    # In-flight work → local-only dev label, based off the next patch so it sorts
    # AFTER the last release. deploy.sh's ship gate refuses anything with a '-'.
    DEV_BASE="$(bump_version "$CANONICAL_VERSION" patch)"
    VERSION="$(dev_version "$DEV_BASE" "$ROOT_DIR")"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BUNDLE_DIR="$RECENT_DIR/${VERSION}-${STAMP}"

# Read-only git provenance for the manifest. deploy.sh's ship gate checks that
# git_sha == origin/main and git_dirty == false before it will ship; recording
# them here is labeling, not git work.
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git -C "$ROOT_DIR" symbolic-ref --short -q HEAD 2>/dev/null || echo detached)"
GIT_DIRTY=false; [[ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)" ]] && GIT_DIRTY=true

section "BUILD" "version $VERSION  ·  commit ${GIT_SHA:0:9}  ·  $([[ "$VERSION" == *-* ]] && echo 'dev (local-only)' || echo 'stable (shippable)')"
if [[ "$VERSION" == *-* ]]; then
    warn "dev build — not shippable to the VPS. Cut a release in status.sh for a stable bundle."
fi

# Backend port baked into the landing image's Next rewrites at build time.
BACKEND_PORT="${BACKEND_PORT:-47502}"

BACKEND_IMAGE="boe-backend:$VERSION"
LANDING_IMAGE="boe-landing:$VERSION"

if [[ "$SKIP_BUILD" == false ]]; then
    printf '==> Building %s\n' "$BACKEND_IMAGE"
    docker build -t "$BACKEND_IMAGE" "$BACKEND_CONTEXT"

    printf '==> Building %s\n' "$LANDING_IMAGE"
    docker build \
        --build-arg "BEO_API_BASE=http://backend:${BACKEND_PORT}" \
        -t "$LANDING_IMAGE" \
        "$LANDING_CONTEXT"
fi

# Keep only the newest bundle in recent_builds.
find "$RECENT_DIR" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
mkdir -p "$BUNDLE_DIR"

printf '==> Saving images\n'
docker save "$BACKEND_IMAGE" | gzip -c > "$BUNDLE_DIR/backend.tar.gz"
docker save "$LANDING_IMAGE" | gzip -c > "$BUNDLE_DIR/landing.tar.gz"

cp "$ACTIVE_DIR/docker-compose.yml" "$BUNDLE_DIR/docker-compose.yml"

if [[ -f "$ACTIVE_DIR/.env" ]]; then
    cp "$ACTIVE_DIR/.env" "$BUNDLE_DIR/.env"
else
    cp "$ACTIVE_DIR/.env.example" "$BUNDLE_DIR/.env"
fi

# Pin the version the deploy compose will resolve.
if grep -q '^BOE_VERSION=' "$BUNDLE_DIR/.env"; then
    sed -i "s/^BOE_VERSION=.*/BOE_VERSION=$VERSION/" "$BUNDLE_DIR/.env"
else
    printf '\nBOE_VERSION=%s\n' "$VERSION" >> "$BUNDLE_DIR/.env"
fi

jq -n --arg version "$VERSION" '{version: $version}' > "$BUNDLE_DIR/version.json"
jq -n \
    --arg version "$VERSION" \
    --arg created_at "$STAMP" \
    --arg backend_image "$BACKEND_IMAGE" \
    --arg landing_image "$LANDING_IMAGE" \
    --arg git_sha "$GIT_SHA" \
    --arg git_branch "$GIT_BRANCH" \
    --argjson git_dirty "$GIT_DIRTY" \
    '{version: $version, created_at: $created_at, backend_image: $backend_image, landing_image: $landing_image,
      git_sha: $git_sha, git_branch: $git_branch, git_dirty: $git_dirty}' \
    > "$BUNDLE_DIR/manifest.json"

cat > "$BUNDLE_DIR/README.txt" <<EOF
BeOnEdge release bundle
Version: $VERSION
Created: $STAMP
Backend image: $BACKEND_IMAGE
Landing image: $LANDING_IMAGE

Deploy locally with:   ./release_manager/deploy.sh
Ship to the VPS with:  ./release_manager/deploy.sh --ship <pem>   (stable bundles only)
EOF

printf '\nExported release bundle: %s\n' "$BUNDLE_DIR"
