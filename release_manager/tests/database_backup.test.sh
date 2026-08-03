#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=../lib/ui.sh
source "$ROOT_DIR/release_manager/lib/ui.sh"
# shellcheck source=../stacks/_shared/_boe_lib.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_lib.sh"

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
chmod 700 "$TEST_DIR"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

fake_docker="$TEST_DIR/docker"
docker_log="$TEST_DIR/docker.log"
apply_fake_docker() {
    cat > "$fake_docker" <<'FAKE_DOCKER'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
    ps)
        printf '%s\n' 'boe-dev-postgres'
        ;;
    exec)
        shift
        if [ "${1:-}" = '-T' ]; then
            printf '%s\n' 'docker exec does not accept -T' >&2
            exit 64
        fi
        printf '%s' 'valid-custom-format-dump'
        ;;
    *)
        exit 65
        ;;
esac
FAKE_DOCKER
    chmod 700 "$fake_docker"
}
apply_fake_docker
export FAKE_DOCKER_LOG="$docker_log"

env_file="$TEST_DIR/.env"
printf 'POSTGRES_USER=test_user\nPOSTGRES_DB=test_database\n' > "$env_file"
chmod 600 "$env_file"

backup_dir="$TEST_DIR/backups"
mkdir "$backup_dir"

P[has_database]="true"
P[container_prefix]="boe-dev"
P[short]="dev"
P[environment]="development"
P[docker]="$fake_docker"
BOE_EFFECTIVE_ENV="$env_file"

boe_backup_database "$backup_dir" pre-deploy >/dev/null \
    || fail_test 'database backup rejected a valid plain docker exec invocation'

grep -q '^exec boe-dev-postgres pg_dump ' "$docker_log" \
    || fail_test 'database backup did not call pg_dump through docker exec'
if grep -q '^exec -T ' "$docker_log"; then
    fail_test 'database backup passed the Compose-only -T flag to docker exec'
fi

dump_file="$(find "$backup_dir" -maxdepth 1 -type f -name '*.dump' -print -quit)"
metadata_file="$(find "$backup_dir" -maxdepth 1 -type f -name '*.metadata.json' -print -quit)"
[[ -s "$dump_file" ]] || fail_test 'database backup did not write a non-empty dump'
[[ "$(stat -c '%a' "$dump_file")" == 600 ]] || fail_test 'database dump is not mode 600'
jq -e '.status == "complete" and .backup_type == "pre-deploy" and .size_bytes > 0' \
    "$metadata_file" >/dev/null || fail_test 'database backup metadata is incomplete'

printf 'PASS: database backup uses the plain docker exec CLI contract\n'
