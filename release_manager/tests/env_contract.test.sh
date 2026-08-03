#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_LIB="$ROOT_DIR/release_manager/stacks/_shared/_boe_lib.sh"

# shellcheck source=../lib/ui.sh
source "$ROOT_DIR/release_manager/lib/ui.sh"
# shellcheck source=../stacks/_shared/_boe_lib.sh
source "$RUNTIME_LIB"

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
chmod 700 "$TEST_DIR"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

prepare_paths() {
    local env_file="$1"
    P[stack]="dev_release"
    P[env_file]="$env_file"
    P[env_example]="$TEST_DIR/.env.example"
}

# Arrange: a private, regular stack-local environment file.
valid_env="$TEST_DIR/.env"
printf 'POSTGRES_PASSWORD=test-only\n' > "$valid_env"
chmod 600 "$valid_env"
prepare_paths "$valid_env"
legacy_overlay="$TEST_DIR/legacy-secrets.env"
printf 'POSTGRES_PASSWORD=must-not-win\n' > "$legacy_overlay"
P[secrets_env]="$legacy_overlay"

# Act.
boe_build_effective_env >/dev/null

# Assert: Compose receives the authoritative file directly, without a merge.
[[ "$BOE_EFFECTIVE_ENV" == "$valid_env" ]] \
    || fail_test "stack-local .env was not selected directly"
[[ "$(env_get POSTGRES_PASSWORD "$BOE_EFFECTIVE_ENV")" == "test-only" ]] \
    || fail_test "a legacy external secrets overlay changed the effective value"
[[ -z "${BOE_EFFECTIVE_ENV_TMP:-}" ]] \
    || fail_test "an unnecessary merged environment file was created"

# Arrange: an environment file readable by other users.
public_env="$TEST_DIR/public.env"
printf 'POSTGRES_PASSWORD=test-only\n' > "$public_env"
chmod 644 "$public_env"
prepare_paths "$public_env"

# Act + assert.
(boe_build_effective_env >/dev/null 2>&1) \
    && fail_test "world-readable .env was accepted"

# Arrange: a symlink that could redirect the deployment to another file.
symlink_env="$TEST_DIR/symlink.env"
ln -s "$valid_env" "$symlink_env"
prepare_paths "$symlink_env"

# Act + assert.
(boe_build_effective_env >/dev/null 2>&1) \
    && fail_test "symlinked .env was accepted"

# Arrange: duplicate assignments whose last-value-wins behavior is ambiguous.
duplicate_env="$TEST_DIR/duplicate.env"
printf 'POSTGRES_PASSWORD=first\nPOSTGRES_PASSWORD=second\n' > "$duplicate_env"
chmod 600 "$duplicate_env"
prepare_paths "$duplicate_env"

# Act + assert.
(boe_build_effective_env >/dev/null 2>&1) \
    && fail_test "duplicate environment keys were accepted"

# Arrange: Compose-compatible quoting that env_get would interpret differently.
quoted_env="$TEST_DIR/quoted.env"
printf 'QUOTED="value"\n' > "$quoted_env"
chmod 600 "$quoted_env"
prepare_paths "$quoted_env"

# Act + assert: the supported contract is deliberately stricter than Compose.
(boe_build_effective_env >/dev/null 2>&1) \
    && fail_test "quoted environment values were accepted"

# Arrange: bare Compose interpolation would diverge from env_get semantics.
dollar_env="$TEST_DIR/dollar.env"
printf 'POSTGRES_PASSWORD=$HOME\n' > "$dollar_env"
chmod 600 "$dollar_env"
prepare_paths "$dollar_env"

# Act + assert.
(boe_build_effective_env >/dev/null 2>&1) \
    && fail_test "a dollar-interpolated environment value was accepted"

# Arrange: a private file in a replaceable group-writable directory.
unsafe_dir="$TEST_DIR/unsafe"
mkdir "$unsafe_dir"
chmod 770 "$unsafe_dir"
unsafe_env="$unsafe_dir/.env"
printf 'POSTGRES_PASSWORD=test-only\n' > "$unsafe_env"
chmod 600 "$unsafe_env"
prepare_paths "$unsafe_env"

# Act + assert.
(boe_build_effective_env >/dev/null 2>&1) \
    && fail_test "an .env in a group-writable stack directory was accepted"

# Arrange: an inherited variable conflicts with the authoritative .env.
prepare_paths "$valid_env"
docker_stub="$TEST_DIR/docker-stub"
printf '%s\n' '#!/usr/bin/env bash' '[[ -z "${POSTGRES_PASSWORD+x}" ]]' > "$docker_stub"
chmod 700 "$docker_stub"
P[docker]="$docker_stub"
P[compose_project]="boe_test"
P[container_prefix]="boe-test"
P[compose_file]="$TEST_DIR/compose.yml"
printf 'services: {}\n' > "${P[compose_file]}"
BOE_VERSION_FOR_COMPOSE="test-version"
export POSTGRES_PASSWORD="inherited-must-not-win"

# Act + assert.
compose config >/dev/null 2>&1 \
    || fail_test "Compose inherited a variable that should have been removed"
unset POSTGRES_PASSWORD

# Arrange: Docker control variables could redirect every daemon operation.
export DOCKER_HOST="tcp://untrusted.invalid:2375"

# Act + assert.
declare -F boe_assert_clean_docker_environment >/dev/null \
    || fail_test "Docker control-environment guard is missing"
(boe_assert_clean_docker_environment >/dev/null 2>&1) \
    && fail_test "an inherited DOCKER_HOST was accepted"
unset DOCKER_HOST

printf 'PASS: stack-local .env contract\n'
