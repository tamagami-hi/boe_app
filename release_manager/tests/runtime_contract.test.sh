#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE="$ROOT_DIR/frontend_stack/app/Dockerfile"
NGINX_CONFIG="$ROOT_DIR/frontend_stack/app/nginx.conf"
LANDING_DOCKERFILE="$ROOT_DIR/frontend_stack/packages/landing_page/Dockerfile"
FRONTEND_DOCKERIGNORE="$ROOT_DIR/frontend_stack/.dockerignore"
BACKEND_DOCKERFILE="$ROOT_DIR/backend_controller/Dockerfile"
PATCHED_NODE_BASE='node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32'
PATCHED_NGINX_BASE='nginxinc/nginx-unprivileged:1.31.1-alpine3.23-slim@sha256:762e8e4e5e103817c4158400fc3753c8e713ff8153b8c3afbb458ae4572bc9a3'
STACKS_LIB="$ROOT_DIR/release_manager/lib/stacks.sh"
EXPORT_SCRIPT="$ROOT_DIR/release_manager/export.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

assert_file_contains() {
    local file="$1" pattern="$2" message="$3"
    grep -qE "$pattern" "$file" || fail_test "$message"
}

service_block() {
    local compose_file="$1" service="$2"
    awk -v header="  ${service}:" '
        $0 == header { in_service=1; print; next }
        in_service && /^  [[:alnum:]_-]+:/ { exit }
        in_service { print }
    ' "$compose_file"
}

assert_file_contains "$DOCKERFILE" \
    '^FROM nginxinc/nginx-unprivileged:[^@]+@sha256:[0-9a-f]{64} AS runtime$' \
    'frontend runtime is not a digest-pinned unprivileged nginx image'
grep -qF "FROM $PATCHED_NGINX_BASE AS runtime" "$DOCKERFILE" \
    || fail_test 'frontend runtime does not use the approved patched nginx base'
if grep -qE '^FROM node:[^@[:space:]]+([[:space:]]+AS[[:space:]]+.*)?$' \
    "$DOCKERFILE" "$LANDING_DOCKERFILE"; then
    fail_test 'frontend build or landing image uses a floating Node base tag'
fi
for node_dockerfile in "$BACKEND_DOCKERFILE" "$DOCKERFILE" "$LANDING_DOCKERFILE"; do
    while IFS= read -r node_from; do
        [[ "$node_from" == "FROM $PATCHED_NODE_BASE"* ]] \
            || fail_test "$(basename "$node_dockerfile") uses an unapproved Node base: $node_from"
    done < <(grep '^FROM node:' "$node_dockerfile")
done
assert_file_contains "$FRONTEND_DOCKERIGNORE" '^\*\*/node_modules$' \
    'frontend Docker context does not exclude local dependency trees'
assert_file_contains "$FRONTEND_DOCKERIGNORE" '^\*\*/\.next$' \
    'frontend Docker context does not exclude local Next build output'
assert_file_contains "$DOCKERFILE" '^USER 101:101$' \
    'frontend runtime does not explicitly select the unprivileged nginx user'
assert_file_contains "$DOCKERFILE" '^ENTRYPOINT \[\]$' \
    'frontend runtime still invokes the image mutation entrypoint'
assert_file_contains "$DOCKERFILE" '^EXPOSE 8080$' \
    'frontend image does not expose its unprivileged port'
assert_file_contains "$DOCKERFILE" 'http://127\.0\.0\.1:8080/health' \
    'frontend image healthcheck does not probe the unprivileged health endpoint'
assert_file_contains "$NGINX_CONFIG" '^[[:space:]]*listen 8080;' \
    'frontend nginx does not listen on an unprivileged port'
assert_file_contains "$EXPORT_SCRIPT" 'for key in app admin;' \
    'release export does not test both frontend runtime images'
assert_file_contains "$EXPORT_SCRIPT" 'BOE_RUNTIME_IMAGE="\$tag" bash' \
    'release export does not execute the hardened runtime acceptance test'
assert_file_contains "$EXPORT_SCRIPT" 'npm --prefix "\$ROOT_DIR/frontend_stack/packages/landing_page" run audit:production' \
    'release export does not gate landing runtime dependency advisories'
if grep -qE '^COPY --chown=node:node --from=build /app/\.next/' "$LANDING_DOCKERFILE"; then
    fail_test 'landing runtime makes compiled application code writable by node'
fi
assert_file_contains "$EXPORT_SCRIPT" 'BOE_LANDING_RUNTIME_IMAGE="\$landing_tag" bash' \
    'release export does not execute landing runtime acceptance'

# shellcheck source=../lib/stacks.sh
source "$STACKS_LIB"
for stack in dev_release prod_release; do
    image_ports="$(stack_images "$stack" | awk -F: '$1 == "app" || $1 == "admin" { print $3 }')"
    [[ "$image_ports" == $'8080\n8080' ]] \
        || fail_test "$stack image metadata does not declare port 8080 for app and admin"

    compose_file="$ROOT_DIR/release_manager/stacks/$stack/$(stack_attr "$stack" compose)"
    grep -qF 'test: ["CMD-SHELL", "test -f /tmp/boe-worker-ready"]' "$compose_file" \
        || fail_test "$stack has no first-pass worker readiness probe"
    landing_block="$(service_block "$compose_file" landing)"
    grep -qE '^[[:space:]]+read_only:[[:space:]]+true$' <<< "$landing_block" \
        || fail_test "$stack/landing does not use a read-only root filesystem"
    grep -qE '^[[:space:]]+- /tmp:' <<< "$landing_block" \
        || fail_test "$stack/landing has no bounded writable /tmp mount"
    for service in app_frontend admin_frontend; do
        block="$(service_block "$compose_file" "$service")"
        grep -qE '127\.0\.0\.1:\$\{(APP|ADMIN)_FRONTEND_PORT\}:8080' <<< "$block" \
            || fail_test "$stack/$service does not publish container port 8080"
        grep -qE '^[[:space:]]+read_only:[[:space:]]+true$' <<< "$block" \
            || fail_test "$stack/$service lost its read-only root filesystem"
        grep -qE '^[[:space:]]+- /tmp:' <<< "$block" \
            || fail_test "$stack/$service has no bounded writable /tmp mount"
        if grep -qE '/var/(cache/nginx|run)' <<< "$block"; then
            fail_test "$stack/$service retains obsolete writable nginx paths"
        fi
    done

    for service in payments-worker email-worker sips-worker; do
        block="$(service_block "$compose_file" "$service")"
        grep -qF 'healthcheck: *worker-health' <<< "$block" \
            || fail_test "$stack/$service has no first-pass readiness healthcheck"
        if grep -qE '^[[:space:]]+disable:[[:space:]]+true$' <<< "$block"; then
            fail_test "$stack/$service disables worker readiness checks"
        fi
        grep -qE '^[[:space:]]+seed:$' <<< "$block" \
            || fail_test "$stack/$service is not gated on successful seed completion"
        grep -qE 'command: \["sh", "-ec",' <<< "$block" \
            || fail_test "$stack/$service does not exit when a worker pass fails"
        grep -qF 'rm -f /tmp/boe-worker-ready' <<< "$block" \
            || fail_test "$stack/$service does not clear stale readiness on restart"
        grep -qF 'touch /tmp/boe-worker-ready' <<< "$block" \
            || fail_test "$stack/$service does not record a successful first pass"
        if grep -qF '|| true' <<< "$block"; then
            fail_test "$stack/$service masks worker pass failures"
        fi
    done

    BOE_VERSION=runtime-contract docker compose \
        --env-file "$ROOT_DIR/release_manager/stacks/$stack/.env.example" \
        -f "$compose_file" config --quiet \
        || fail_test "$stack Compose configuration does not render"
done

# Optional executable acceptance check for a freshly built image. The caller
# supplies BOE_RUNTIME_IMAGE so ordinary static verification does not build or
# pull anything.
if [[ -n "${BOE_RUNTIME_IMAGE:-}" ]]; then
    command -v docker >/dev/null 2>&1 || fail_test 'docker is required for runtime acceptance'
    container_id="$(docker run -d \
        --read-only \
        --cap-drop ALL \
        --security-opt no-new-privileges:true \
        --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
        "$BOE_RUNTIME_IMAGE")" || fail_test 'hardened frontend container did not start'
    trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' EXIT

    for _ in {1..20}; do
        health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
        [[ "$health" == healthy ]] && break
        [[ "$health" == unhealthy || "$health" == exited ]] \
            && fail_test "hardened frontend container became $health"
        sleep 1
    done
    [[ "${health:-}" == healthy ]] || fail_test 'hardened frontend container did not become healthy'
    [[ "$(docker inspect -f '{{.Config.User}}' "$container_id")" == '101:101' ]] \
        || fail_test 'hardened frontend container is not running as uid/gid 101'
fi

if [[ -n "${BOE_LANDING_RUNTIME_IMAGE:-}" ]]; then
    command -v docker >/dev/null 2>&1 || fail_test 'docker is required for landing runtime acceptance'
    landing_container_id="$(docker run -d \
        --read-only \
        --cap-drop ALL \
        --security-opt no-new-privileges:true \
        --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
        -e PORT=3100 \
        -e HOSTNAME=0.0.0.0 \
        -e BEO_API_BASE=http://127.0.0.1:9 \
        "$BOE_LANDING_RUNTIME_IMAGE")" || fail_test 'landing container did not start'
    trap 'docker rm -f "$landing_container_id" >/dev/null 2>&1 || true' EXIT

    for _ in {1..45}; do
        landing_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$landing_container_id" 2>/dev/null || true)"
        [[ "$landing_health" == healthy ]] && break
        [[ "$landing_health" == unhealthy || "$landing_health" == exited ]] \
            && fail_test "landing container became $landing_health"
        sleep 1
    done
    [[ "${landing_health:-}" == healthy ]] || fail_test 'landing container did not become healthy'
    [[ "$(docker inspect -f '{{.Config.User}}' "$landing_container_id")" == node ]] \
        || fail_test 'landing container is not running as the node user'
    if docker exec "$landing_container_id" sh -c 'test -w /app/server.js'; then
        fail_test 'landing compiled server is writable by the node user'
    fi
    docker exec "$landing_container_id" node -e "require('sharp')" \
        || fail_test 'landing image cannot load its patched Sharp runtime'
    if docker logs "$landing_container_id" 2>&1 | grep -q 'EACCES'; then
        fail_test 'landing emitted a filesystem permission error'
    fi
fi

printf 'PASS: runtime hardening and service health contracts are consistent\n'
