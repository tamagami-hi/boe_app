#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=../lib/ui.sh
source "$ROOT_DIR/release_manager/lib/ui.sh"
# shellcheck source=../stacks/_shared/_boe_lib.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_lib.sh"
# shellcheck source=../stacks/_shared/_boe_rollback.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_rollback.sh"
# shellcheck source=../stacks/_shared/_boe_deploy.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_deploy.sh"

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

# A real pseudo-terminal refusal must abort nonzero before any database command.
: > "$docker_log"
restore_command="source '$ROOT_DIR/release_manager/lib/ui.sh'; source '$ROOT_DIR/release_manager/stacks/_shared/_boe_lib.sh'; source '$ROOT_DIR/release_manager/stacks/_shared/_boe_rollback.sh'; P[rollback_db]='$TEST_DIR/rollback-db'; P[has_database]=true; P[environment]=production; P[container_prefix]=boe-dev; P[docker]='$fake_docker'; BOE_EFFECTIVE_ENV='$env_file'; boe_rollback_restore_database 1.0.0 true"
if decline_out="$(printf 'NO\n' | script -qec "bash -c \"$restore_command\"" /dev/null 2>&1)"; then
    fail_test 'declining typed RESTORE returned success'
fi
grep -q 'rollback target was not started' <<< "$decline_out" \
    || fail_test 'declining typed RESTORE did not report an aborted rollback'
if grep -q 'pg_restore\|psql' "$docker_log"; then
    fail_test 'declining typed RESTORE reached a database mutation command'
fi

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

# ── migration 025 rollback safety ──────────────────────────────────────────
grep -q 'boe_rollback_requires_database_restore' "$ROLLBACK_LIB" \
    || fail_test 'rollback does not guard the migration-025 compatibility boundary'
boe_rollback_requires_database_restore 0.8.8 0.8.7 \
    || fail_test 'rollback guard missed the v0.8.8 to v0.8.7 boundary'
if boe_rollback_requires_database_restore 0.8.8 0.8.8-dev.1; then
    fail_test 'rollback guard treated the v0.8.8 schema family as incompatible'
fi
if boe_rollback_requires_database_restore 0.8.7 0.8.6; then
    fail_test 'rollback guard applied migration 025 before its release boundary'
fi
boe_restored_schema_is_compatible 0.8.7 0 \
    || fail_test 'pre-025 snapshot was rejected for a pre-025 target'
if boe_restored_schema_is_compatible 0.8.7 1; then
    fail_test 'migration-025 snapshot was accepted for a pre-025 target'
fi
DEPLOY_LIB="$ROOT_DIR/release_manager/stacks/_shared/_boe_deploy.sh"
grep -q 'boe_rollback_requires_database_restore "$attempted" "$previous"' "$DEPLOY_LIB" \
    || fail_test 'failed-deploy auto-rollback bypasses the migration-025 guard'
guard_line="$(grep -n 'boe_rollback_requires_database_restore "$attempted" "$previous"' "$DEPLOY_LIB" | cut -d: -f1)"
auto_start_line="$(grep -n 'BOE_VERSION_FOR_COMPOSE="$previous"' "$DEPLOY_LIB" | cut -d: -f1)"
[[ -n "$guard_line" && -n "$auto_start_line" && "$guard_line" -lt "$auto_start_line" ]] \
    || fail_test 'failed-deploy boundary guard runs after auto-rollback startup'
grep -q 'boe_stop_database_consumers' "$ROLLBACK_LIB" \
    || fail_test 'database restore does not isolate postgres from app/workers'
restore_line="$(grep -n 'boe_rollback_restore_database "$TARGET"' "$ROLLBACK_LIB" | head -1 | cut -d: -f1)"
start_line="$(grep -n 'compose up -d --remove-orphans' "$ROLLBACK_LIB" | head -1 | cut -d: -f1)"
[[ -n "$restore_line" && -n "$start_line" && "$restore_line" -lt "$start_line" ]] \
    || fail_test 'the rolled-back application starts before database restoration completes'

printf 'PASS: database backup uses the plain docker exec CLI contract\n'
