#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=../lib/ui.sh
source "$ROOT_DIR/release_manager/lib/ui.sh"
# shellcheck source=../stacks/_shared/_boe_lib.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_lib.sh"
# shellcheck source=../stacks/_shared/_boe_rollback.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_rollback.sh"

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

# ── a MANDATORY backup (pre-rollback with --restore-db) must never skip ──────
# With required=true the silent-skip paths (postgres stopped, credentials
# unset) become fatal; without it they stay tolerant for routine rollbacks.

no_postgres_docker="$TEST_DIR/docker-no-postgres"
cat > "$no_postgres_docker" <<'FAKE_DOCKER'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
    ps)
        : # postgres is not running
        ;;
    *)
        exit 65
        ;;
esac
FAKE_DOCKER
chmod 700 "$no_postgres_docker"
P[docker]="$no_postgres_docker"

if (boe_backup_database "$backup_dir" pre-rollback true >/dev/null 2>&1); then
    fail_test 'a mandatory pre-rollback backup was silently skipped with postgres stopped'
fi
boe_backup_database "$backup_dir" pre-rollback >/dev/null \
    || fail_test 'an optional pre-rollback backup did not tolerate a stopped postgres'

empty_env="$TEST_DIR/empty.env"
: > "$empty_env"
chmod 600 "$empty_env"
BOE_EFFECTIVE_ENV="$empty_env"
if (boe_backup_database "$backup_dir" pre-rollback true >/dev/null 2>&1); then
    fail_test 'a mandatory pre-rollback backup was silently skipped without POSTGRES_USER/POSTGRES_DB'
fi
BOE_EFFECTIVE_ENV="$env_file"
P[docker]="$fake_docker"

# ── restore safety: production --yes still demands a typed RESTORE ───────────
P[rollback_db]="$TEST_DIR/rollback-db"
snapshot_dir="${P[rollback_db]}/1.0.0"
mkdir -p "$snapshot_dir"
printf 'snapshot-bytes' > "$snapshot_dir/snap.dump"
snap_sha="$(sha256sum "$snapshot_dir/snap.dump" | cut -d' ' -f1)"
jq -n --arg sha "$snap_sha" '{sha256: $sha, status: "complete"}' \
    > "$snapshot_dir/snap.metadata.json"

P[environment]="production"
restore_out="$( (boe_rollback_restore_database "1.0.0" true </dev/null) 2>&1 )" \
    && fail_test 'production --restore-db --yes proceeded without a typed RESTORE'
grep -q 'interactive terminal' <<< "$restore_out" \
    || fail_test 'production --restore-db --yes did not demand the typed RESTORE confirmation'

# ── restore safety: a snapshot without verifiable provenance is refused ──────
orphan_dir="${P[rollback_db]}/2.0.0"
mkdir -p "$orphan_dir"
printf 'unverified-bytes' > "$orphan_dir/orphan.dump"
P[environment]="development"
restore_out="$( (boe_rollback_restore_database "2.0.0" true </dev/null) 2>&1 )" \
    && fail_test 'a database snapshot without a metadata sidecar was restored'
grep -q 'metadata sidecar' <<< "$restore_out" \
    || fail_test 'a missing metadata sidecar did not fail loudly'

# ── the restore SQL must never be locally expanded (injection) ───────────────
ROLLBACK_LIB="$ROOT_DIR/release_manager/stacks/_shared/_boe_rollback.sh"
grep -qF "<<'SQL'" "$ROLLBACK_LIB" \
    || fail_test 'the database restore heredoc is not quoted — local expansion is possible'
if grep -q '<<SQL' "$ROLLBACK_LIB"; then
    fail_test 'an unquoted SQL heredoc remains — backticks and $vars would execute locally'
fi
grep -q ':"db"' "$ROLLBACK_LIB" \
    || fail_test 'the restore SQL does not use psql identifier quoting for the database name'

printf 'PASS: database backup uses the plain docker exec CLI contract\n'
