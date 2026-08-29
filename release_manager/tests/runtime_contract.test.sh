#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE="$ROOT_DIR/frontend_stack_ts/Dockerfile"
NGINX_CONFIG="$ROOT_DIR/frontend_stack_ts/nginx.conf"
FRONTEND_DOCKERIGNORE="$ROOT_DIR/.dockerignore"
BACKEND_DOCKERFILE="$ROOT_DIR/backend_controller/Dockerfile"
PATCHED_NODE_BASE='node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32'
PATCHED_NGINX_BASE='nginxinc/nginx-unprivileged:1.31.1-alpine3.23-slim@sha256:762e8e4e5e103817c4158400fc3753c8e713ff8153b8c3afbb458ae4572bc9a3'
STACKS_LIB="$ROOT_DIR/release_manager/lib/stacks.sh"
EXPORT_SCRIPT="$ROOT_DIR/release_manager/export.sh"
CI_WORKFLOW="$ROOT_DIR/.github/workflows/ci.yml"

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

compose_backend_env_keys() {
    local compose_file="$1"
    awk '
        $0 == "x-backend-env: &backend-env" { in_env=1; next }
        in_env && $0 == "services:" { exit }
        in_env && $0 ~ /^  [A-Z][A-Z0-9_]*:/ {
            sub(/^  /, "", $0)
            sub(/:.*/, "", $0)
            print
        }
    ' "$compose_file" | sort -u
}

workflow_job_block() {
    local workflow_file="$1" job="$2"
    awk -v header="  ${job}:" '
        $0 == header { in_job=1; print; next }
        in_job && /^  [[:alnum:]_-]+:/ { exit }
        in_job { print }
    ' "$workflow_file"
}

assert_file_contains "$DOCKERFILE" \
    '^FROM nginxinc/nginx-unprivileged:[^@]+@sha256:[0-9a-f]{64} AS runtime$' \
    'frontend runtime is not a digest-pinned unprivileged nginx image'
grep -qF "FROM $PATCHED_NGINX_BASE AS runtime" "$DOCKERFILE" \
    || fail_test 'frontend runtime does not use the approved patched nginx base'
if grep -qE '^FROM node:[^@[:space:]]+([[:space:]]+AS[[:space:]]+.*)?$' "$DOCKERFILE"; then
    fail_test 'frontend build image uses a floating Node base tag'
fi
for node_dockerfile in "$BACKEND_DOCKERFILE" "$DOCKERFILE"; do
    while IFS= read -r node_from; do
        [[ "$node_from" == "FROM $PATCHED_NODE_BASE"* ]] \
            || fail_test "$(basename "$node_dockerfile") uses an unapproved Node base: $node_from"
    done < <(grep '^FROM node:' "$node_dockerfile")
done
assert_file_contains "$FRONTEND_DOCKERIGNORE" '^\*\*/node_modules$' \
    'frontend Docker context does not exclude local dependency trees'
assert_file_contains "$FRONTEND_DOCKERIGNORE" '^\*\*/dist$' \
    'frontend Docker context does not exclude local build output'
assert_file_contains "$FRONTEND_DOCKERIGNORE" '^\*\*/build$' \
    'frontend Docker context does not exclude local Gradle build output'
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
assert_file_contains "$CI_WORKFLOW" '^  backend:$' \
    'CI does not define a backend verification job'
assert_file_contains "$CI_WORKFLOW" '^  frontend:$' \
    'CI does not define a frontend verification job'
assert_file_contains "$CI_WORKFLOW" '^  contracts:$' \
    'CI does not define a contracts verification job'
backend_ci_block="$(workflow_job_block "$CI_WORKFLOW" backend)"
frontend_ci_block="$(workflow_job_block "$CI_WORKFLOW" frontend)"
contracts_ci_block="$(workflow_job_block "$CI_WORKFLOW" contracts)"
grep -qE '^[[:space:]]+- run: npm run check$' <<< "$backend_ci_block" \
    || fail_test 'backend CI job does not run the package verification command'
grep -qE '^[[:space:]]+- run: npm run test:integration -- --coverage.enabled=false$' <<< "$backend_ci_block" \
    || fail_test 'backend CI job does not run integration tests'
grep -qE '^[[:space:]]+- run: npm test$' <<< "$frontend_ci_block" \
    || fail_test 'frontend CI job does not run frontend tests'
grep -qE '^[[:space:]]+- run: npm run build:client$' <<< "$frontend_ci_block" \
    || fail_test 'frontend CI job does not build the client variant'
grep -qE '^[[:space:]]+- run: npm run build:admin$' <<< "$frontend_ci_block" \
    || fail_test 'frontend CI job does not build the admin variant'
grep -qE '^[[:space:]]+- run: npm run typecheck$' <<< "$frontend_ci_block" \
    || fail_test 'frontend CI job does not typecheck'
grep -qE 'check-phonepe-native-target' <<< "$frontend_ci_block" \
    || fail_test 'frontend CI job does not assert the native PhonePe SDK stays unlinked'
grep -qE '^[[:space:]]+- run: npm run check$' <<< "$contracts_ci_block" \
    || fail_test 'contracts CI job does not run contract verification'

# shellcheck source=../lib/stacks.sh
source "$STACKS_LIB"
for stack in dev_release prod_release; do
    image_ports="$(stack_images "$stack" | awk -F: '$1 == "app" || $1 == "admin" { print $3 }')"
    [[ "$image_ports" == $'8080\n8080' ]] \
        || fail_test "$stack image metadata does not declare port 8080 for app and admin"

    compose_file="$ROOT_DIR/release_manager/stacks/$stack/$(stack_attr "$stack" compose)"
    grep -qF 'test: ["CMD-SHELL", "test -f /tmp/boe-worker-ready"]' "$compose_file" \
        || fail_test "$stack has no first-pass worker readiness probe"
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
        grep -qE 'healthcheck: \*[a-z0-9_-]+-worker-health' <<< "$block" \
            || fail_test "$stack/$service has no first-pass readiness healthcheck"
        if grep -qE '^[[:space:]]+disable:[[:space:]]+true$' <<< "$block"; then
            fail_test "$stack/$service disables worker readiness checks"
        fi
        grep -qE '^[[:space:]]+seed:$' <<< "$block" \
            || fail_test "$stack/$service is not gated on successful seed completion"
        if [[ "$service" == "payments-worker" ]]; then
            grep -qF 'command: ["node", "dist/paymentReconciliationEntrypoint.js"]' <<< "$block" \
                || fail_test "$stack/$service is not a long-lived reconciliation process"
        else
            grep -qE 'command: \["sh", "-ec",' <<< "$block" \
                || fail_test "$stack/$service does not exit when a worker pass fails"
            grep -qF 'rm -f /tmp/boe-worker-ready' <<< "$block" \
                || fail_test "$stack/$service does not clear stale readiness on restart"
            grep -qF 'touch /tmp/boe-worker-ready' <<< "$block" \
                || fail_test "$stack/$service does not record a successful first pass"
        fi
        if grep -qF '|| true' <<< "$block"; then
            fail_test "$stack/$service masks worker pass failures"
        fi
    done

    email_block="$(service_block "$compose_file" email-worker)"
    stack_name="${stack%%_release}"
    egress_network="${stack_name}_egress"
    internal_network="${stack_name}_internal"
    grep -qE "^[[:space:]]+- ${egress_network}$" <<< "$email_block" \
        || fail_test "$stack/email-worker has no dedicated network for SMTP delivery"
    grep -qE "^[[:space:]]+- ${internal_network}$" <<< "$email_block" \
        || fail_test "$stack/email-worker lost its internal database network"
    assert_file_contains "$compose_file" "^  ${egress_network}:$" \
        "$stack does not define the dedicated SMTP egress network"
    egress_block="$(awk -v header="  ${egress_network}:" '
        $0 == header { in_network=1; print; next }
        in_network && /^  [[:alnum:]_-]+:/ { exit }
        in_network { print }
    ' "$compose_file")"
    if grep -qE '^[[:space:]]+internal:[[:space:]]+true$' <<< "$egress_block"; then
        fail_test "$stack SMTP egress network is internally isolated"
    fi

    BOE_VERSION=runtime-contract docker compose \
        --env-file "$ROOT_DIR/release_manager/stacks/$stack/.env.example" \
        -f "$compose_file" config --quiet \
        || fail_test "$stack Compose configuration does not render"
done

dev_compose="$ROOT_DIR/release_manager/stacks/dev_release/docker-compose.dev_app.yml"
prod_compose="$ROOT_DIR/release_manager/stacks/prod_release/docker-compose.prod_app.yml"
if ! diff -u <(compose_backend_env_keys "$dev_compose") \
            <(compose_backend_env_keys "$prod_compose") >/dev/null; then
    fail_test 'development and production backend containers do not expose the same application configuration contract'
fi
for pair in \
    'dev_release dev_internal dev_redis_data dev_postgres_data' \
    'prod_release prod_internal prod_redis_data prod_postgres_data'; do
    read -r stack internal redis_volume postgres_volume <<< "$pair"
    compose_file="$ROOT_DIR/release_manager/stacks/$stack/$(stack_attr "$stack" compose)"
    redis_block="$(service_block "$compose_file" redis)"
    postgres_block="$(service_block "$compose_file" postgres)"
    grep -qE "^[[:space:]]+- ${internal}$" <<< "$redis_block" \
        || fail_test "$stack Redis is not isolated on its application-internal network"
    grep -qE "^[[:space:]]+- ${redis_volume}:/data$" <<< "$redis_block" \
        || fail_test "$stack Redis does not use its dedicated persistent volume"
    grep -qE "^[[:space:]]+- ${internal}$" <<< "$postgres_block" \
        || fail_test "$stack PostgreSQL is not isolated on its application-internal network"
    grep -qE "^[[:space:]]+- ${postgres_volume}:/var/lib/postgresql/data$" <<< "$postgres_block" \
        || fail_test "$stack PostgreSQL does not use its dedicated persistent volume"
    if grep -qE '^[[:space:]]+ports:' <<< "$postgres_block"; then
        fail_test "$stack PostgreSQL exposes a host port"
    fi
done

[[ "$(stack_image_tag dev_release backend release-test)" != \
   "$(stack_image_tag prod_release backend release-test)" ]] \
    || fail_test 'development and production backend image namespaces are not isolated'
[[ "$(stack_image_tag dev_release app release-test)" != \
   "$(stack_image_tag prod_release app release-test)" ]] \
    || fail_test 'development and production frontend image namespaces are not isolated'

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

printf 'PASS: runtime hardening and service health contracts are consistent\n'
