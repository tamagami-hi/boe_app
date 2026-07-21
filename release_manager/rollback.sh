#!/usr/bin/env bash

# Restore a previous BeOnEdge release from release_manager/rollback into BOE_APP.
# With no --rollback-dir, prompts to pick a snapshot interactively.
# The pgdata Postgres volume is preserved (compose down without -v).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTIVE_DIR="$ROOT_DIR/BOE_APP"
ROLLBACK_DIR="$ROOT_DIR/rollback"
ACTIVE_COMPOSE_FILE="$ACTIVE_DIR/docker-compose.yml"
PG_CONTAINER="${PG_CONTAINER:-boe-postgres}"   # compose-fixed Postgres container name

# shellcheck source=lib/ui.sh
source "$ROOT_DIR/lib/ui.sh"

TARGET_DIR=""
SKIP_DOWN=false
SKIP_LOAD=false
SKIP_CHECKS=false
SKIP_DB_RESTORE=false   # --skip-db-restore: roll back images only, leave DB as-is

usage() {
    cat <<'USAGE'
Usage: ./release_manager/rollback.sh [--rollback-dir DIR] [--skip-down] [--skip-load]
                                     [--skip-checks] [--skip-db-restore]

Restores a previous release snapshot from release_manager/rollback into BOE_APP.
Without --rollback-dir, lists snapshots and prompts for a selection.

If the chosen snapshot contains a db.sql.gz (captured by deploy.sh), the database
is also restored to match the rolled-back release: Postgres is brought up alone,
the current DB is OVERWRITTEN from the dump (after an explicit confirm), then the
full stack starts. Pass --skip-db-restore to roll back images only and keep the
current data (safe only when migrations are backward-compatible — see DEPLOY.md).
USAGE
}

write_step() { printf '\n==> %s\n' "$1"; }
assert_dir() { [[ -d "$1" ]] || { printf '%s not found: %s\n' "$2" "$1" >&2; exit 1; }; }
assert_file() { [[ -f "$1" ]] || { printf '%s not found: %s\n' "$2" "$1" >&2; exit 1; }; }
read_json_value() { jq -r "$2" "$1" 2>/dev/null || printf ''; }  # never abort a `set -e` caller on bad/odd JSON; callers tolerate empty
write_json_version() { jq -n --arg version "$2" '{version: $version}' > "$1"; }

resolve_snapshot_version() {
    local snapshot_dir="$1" v_file="" v_manifest=""
    v_file="$(read_json_value "$snapshot_dir/version.json" '.version // empty' 2>/dev/null || true)"
    [[ -f "$snapshot_dir/manifest.json" ]] && v_manifest="$(read_json_value "$snapshot_dir/manifest.json" '.version // empty' 2>/dev/null || true)"
    if [[ -n "$v_file" && -n "$v_manifest" && "$v_file" != "$v_manifest" ]]; then
        printf 'Snapshot version mismatch: version.json=%s manifest.json=%s (%s)\n' "$v_file" "$v_manifest" "$snapshot_dir" >&2
        exit 1
    fi
    [[ -n "$v_file" ]] && { printf '%s\n' "$v_file"; return; }
    [[ -n "$v_manifest" ]] && { printf '%s\n' "$v_manifest"; return; }
    printf '\n'
}

# BeOnEdge persistence contract: the Postgres data volume must be declared and
# mounted, or we refuse to roll back (guards against silent state loss).
assert_compose_persistence_contract() {
    local compose_file="$1" label="$2"
    assert_file "$compose_file" "$label"
    grep -Fq -- "pgdata:/var/lib/postgresql/data" "$compose_file" || {
        printf '%s is missing the pgdata volume mount: %s\n' "$label" "$compose_file" >&2; exit 1; }
    grep -Eq '^volumes:' "$compose_file" || {
        printf '%s is missing a top-level volumes section: %s\n' "$label" "$compose_file" >&2; exit 1; }
    grep -Eq '^[[:space:]]+pgdata:' "$compose_file" || {
        printf '%s is missing the pgdata volume declaration: %s\n' "$label" "$compose_file" >&2; exit 1; }
}

assert_runtime_state_markers() {
    local label="$1"
    [[ -f "$ACTIVE_DIR/current-version.json" ]] || return 0
    local cfg; cfg="$(docker compose config --format json 2>/dev/null || true)"
    [[ -n "$cfg" ]] || { printf '%s could not resolve compose volumes from %s\n' "$label" "$ACTIVE_COMPOSE_FILE" >&2; exit 1; }
    local expected=(); mapfile -t expected < <(printf '%s' "$cfg" | jq -r '(.volumes // {}) | to_entries[]? | (.value.name // .key)')
    [[ ${#expected[@]} -eq 0 ]] && return 0
    local missing=() v
    for v in "${expected[@]}"; do [[ -n "$v" ]] || continue; docker volume inspect "$v" >/dev/null 2>&1 || missing+=("$v"); done
    if [[ ${#missing[@]} -gt 0 ]]; then
        printf '%s refused: expected persistent Docker volumes are missing: %s\n' "$label" "${missing[*]}" >&2
        printf 'Refusing to continue because this looks like state loss or a changed compose project context.\n' >&2
        exit 1
    fi
}

invoke_health_check() {
    if curl -fsS --max-time 30 "$1" >/dev/null; then printf '%s OK -> %s\n' "$2" "$1"
    else printf '%s FAILED -> %s\n' "$2" "$1" >&2; exit 1; fi
}

copy_snapshot_into_active() {
    local snapshot_dir="$1"
    rm -rf "$ACTIVE_DIR/images"
    rm -f "$ACTIVE_DIR/docker-compose.yml" "$ACTIVE_DIR/README.txt" "$ACTIVE_DIR/version.json" "$ACTIVE_DIR/manifest.json"
    mkdir -p "$ACTIVE_DIR/images"
    cp "$snapshot_dir/docker-compose.yml" "$ACTIVE_DIR/docker-compose.yml"
    cp "$snapshot_dir/version.json" "$ACTIVE_DIR/version.json"
    cp "$snapshot_dir/.env" "$ACTIVE_DIR/.env"
    cp "$snapshot_dir/backend.tar.gz" "$ACTIVE_DIR/images/backend.tar.gz"
    cp "$snapshot_dir/landing.tar.gz" "$ACTIVE_DIR/images/landing.tar.gz"
    [[ -f "$snapshot_dir/README.txt" ]] && cp "$snapshot_dir/README.txt" "$ACTIVE_DIR/README.txt"
    [[ -f "$snapshot_dir/manifest.json" ]] && cp "$snapshot_dir/manifest.json" "$ACTIVE_DIR/manifest.json"
}

env_value() {
    local key="$1"
    [[ -f "$ACTIVE_DIR/.env" ]] || return 0
    sed -n "s/^${key}=//p" "$ACTIVE_DIR/.env" | tail -n 1
}

# Poll until the Postgres container accepts connections (it has a compose
# healthcheck, but we want the data path ready before restoring).
wait_for_postgres_ready() {
    local pg_user="$1" pg_db="$2" i
    for i in $(seq 1 30); do
        docker exec "$PG_CONTAINER" pg_isready -U "$pg_user" -d "$pg_db" >/dev/null 2>&1 && return 0
        sleep 2
    done
    return 1
}

# Restore the snapshot's db.sql.gz so the data matches the rolled-back release.
# Must run with Postgres UP but the app DOWN (no writers): we drop + recreate the
# DB and reload the plain dump onto a clean schema, avoiding clashes with tables
# the newer release's migrations may have added. Guarded by --skip-db-restore,
# the absence of a dump, and an explicit destructive-overwrite confirmation.
maybe_restore_database() {
    if [[ "$SKIP_DB_RESTORE" == true ]]; then
        warn "DB restore skipped (--skip-db-restore) — app rolled back onto current data."
        return 0
    fi
    local dump="$TARGET_DIR/db.sql.gz"
    if [[ ! -f "$dump" ]]; then
        warn "Snapshot has no db.sql.gz — app-only rollback (database left as-is)."
        return 0
    fi

    local pg_user pg_db
    pg_user="$(env_value POSTGRES_USER)"
    pg_db="$(env_value POSTGRES_DB)"
    [[ -n "$pg_user" && -n "$pg_db" ]] || {
        err "POSTGRES_USER/POSTGRES_DB missing from restored .env — cannot restore DB."; exit 1; }

    warn "DB RESTORE will OVERWRITE the current '${pg_db}' database with the snapshot's data."
    warn "This is destructive and cannot be undone — current data will be lost."
    if ! confirm "Restore database '${pg_db}' from snapshot $(basename "$TARGET_DIR")?"; then
        warn "Database restore declined — continuing with app-only rollback (data left as-is)."
        warn "(pass --skip-db-restore to silence this prompt next time)"
        return 0
    fi

    write_step "Bringing up Postgres only for restore"
    docker compose up -d postgres
    wait_for_postgres_ready "$pg_user" "$pg_db" || {
        err "Postgres did not become ready in time — aborting before restore."; exit 1; }

    write_step "Restoring database '${pg_db}' from $(basename "$dump")"
    docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$pg_user" -d postgres \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${pg_db}' AND pid <> pg_backend_pid();" >/dev/null
    docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$pg_user" -d postgres \
        -c "DROP DATABASE IF EXISTS \"${pg_db}\";"
    docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$pg_user" -d postgres \
        -c "CREATE DATABASE \"${pg_db}\" OWNER \"${pg_user}\";"
    if gunzip -c "$dump" | docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$pg_user" "$pg_db" >/dev/null; then
        printf 'Database restored from %s\n' "$(basename "$dump")"
    else
        err "Database restore FAILED — '${pg_db}' may be inconsistent. Investigate before"
        err "bringing the app up; you may need to re-run the rollback."
        exit 1
    fi
}

select_snapshot_interactively() {
    mapfile -t entries < <(find "$ROLLBACK_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
    [[ ${#entries[@]} -gt 0 ]] || { echo "No rollback snapshots found in $ROLLBACK_DIR" >&2; exit 1; }
    echo "Available rollback snapshots:"
    local display=() entry version
    for entry in "${entries[@]}"; do
        version="unknown"
        [[ -f "$entry/version.json" ]] && version="$(read_json_value "$entry/version.json" '.version // "unknown"')"
        display+=("$(basename "$entry") | version=$version")
    done
    select choice in "${display[@]}"; do
        [[ -n "${choice:-}" ]] && { TARGET_DIR="${entries[$((REPLY-1))]}"; break; }
        echo "Invalid selection"
    done
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --rollback-dir) TARGET_DIR="$(cd "$2" && pwd)"; shift 2 ;;
        --skip-down) SKIP_DOWN=true; shift ;;
        --skip-load) SKIP_LOAD=true; shift ;;
        --skip-checks) SKIP_CHECKS=true; shift ;;
        --skip-db-restore) SKIP_DB_RESTORE=true; shift ;;
        --help|-h) usage; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
    esac
done

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

assert_dir "$ACTIVE_DIR" "Active deployment directory"
assert_dir "$ROLLBACK_DIR" "Rollback directory"

[[ -z "$TARGET_DIR" ]] && select_snapshot_interactively

assert_dir "$TARGET_DIR" "Selected rollback bundle"
assert_file "$TARGET_DIR/docker-compose.yml" "Rollback compose file"
assert_file "$TARGET_DIR/version.json" "Rollback version file"
assert_file "$TARGET_DIR/.env" "Rollback environment file"
assert_file "$TARGET_DIR/backend.tar.gz" "Rollback backend archive"
assert_file "$TARGET_DIR/landing.tar.gz" "Rollback landing archive"
assert_compose_persistence_contract "$TARGET_DIR/docker-compose.yml" "Rollback compose file"

target_version="$(resolve_snapshot_version "$TARGET_DIR")"
[[ -n "$target_version" ]] || { printf 'Selected snapshot has no usable version metadata: %s\n' "$TARGET_DIR" >&2; exit 1; }

write_step "Restoring previous release"
printf 'Selected snapshot: %s\nVersion: %s\n' "$TARGET_DIR" "$target_version"

copy_snapshot_into_active "$TARGET_DIR"

pushd "$ACTIVE_DIR" >/dev/null
trap 'popd >/dev/null' EXIT

write_step "Checking Docker availability"
docker version >/dev/null
docker compose version >/dev/null
assert_compose_persistence_contract "$ACTIVE_COMPOSE_FILE" "Active compose file"
assert_runtime_state_markers "Rollback"

if [[ "$SKIP_DOWN" == false ]]; then
    write_step "Stopping existing stack"
    docker compose down
fi

if [[ "$SKIP_LOAD" == false ]]; then
    write_step "Loading images"
    docker load -i "$ACTIVE_DIR/images/backend.tar.gz"
    docker load -i "$ACTIVE_DIR/images/landing.tar.gz"
fi

# Restore DATA before the app comes up (Postgres up, writers down). No-op when
# the snapshot has no dump or --skip-db-restore is set.
maybe_restore_database

write_step "Starting restored stack"
docker compose up -d
docker compose ps

if [[ "$SKIP_CHECKS" == false ]]; then
    write_step "Running local health checks"
    backend_port="$(env_value BACKEND_PORT)"; backend_port="${backend_port:-47502}"
    landing_port="$(env_value LANDING_PORT)"; landing_port="${landing_port:-3100}"
    invoke_health_check "http://localhost:${backend_port}/health" "Backend"
    invoke_health_check "http://localhost:${landing_port}/" "Landing"
fi

write_json_version "$ACTIVE_DIR/current-version.json" "$target_version"
write_step "Rollback completed"
printf 'Active version: %s\n' "$target_version"
warn "Local deploy is now an OLDER release ($target_version) — it intentionally"
warn "diverges from remote main. Do not ship from this state; re-deploy a current"
warn "release once the incident is resolved (deploy.sh's ship gate enforces this)."
