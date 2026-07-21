#!/usr/bin/env bash

# ═══════════════════════════════════════════════════════════════════════════
# BeOnEdge — local deploy (+ optional ship to VPS)
# ═══════════════════════════════════════════════════════════════════════════
# Takes the single staged bundle in release_manager/recent_builds and makes it
# the active release in release_manager/BOE_APP, then brings the Docker stack up
# locally (postgres → migrate → seed → backend → landing) and health-checks it.
#
#   1. PRE-FLIGHT      verify tooling + validate the staged bundle
#   2. ROLLBACK SNAP   copy the currently-active release + pg_dump the live DB
#   3. STAGE BUNDLE    copy the staged bundle into BOE_APP/ (the active release)
#   4. STOP / LOAD     stop the old stack, docker load the new image tarballs
#   5. START + CHECK   compose up -d, then HTTP health-check backend + landing
#   6. SHIP (optional) with --ship <pem>: pull the VPS DB into BOE_APP/db_records,
#      replace BOE_APP on the VPS, restart it, and seed a FRESH VPS from the
#      latest local DB snapshot (migration case).
#
# The pgdata Postgres volume is preserved across deploys (compose down, no -v).
# Across VPS MIGRATIONS the volume is new (empty), so deploy.sh pulls the old
# VPS's DB to db_records/ and restores it into the fresh VPS before migrations.
# With --ship the remote .env is preserved except for BOE_VERSION, which is
# advanced to the shipped release tag (the VPS keeps its own secrets/domains).
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTIVE_DIR="$ROOT_DIR/BOE_APP"
RECENT_DIR="$ROOT_DIR/recent_builds"
ROLLBACK_DIR="$ROOT_DIR/rollback"
PG_CONTAINER="${PG_CONTAINER:-boe-postgres}"   # compose-fixed Postgres container name
DB_RECORDS_DIR="$ACTIVE_DIR/db_records"        # local copies of the VPS DB (pulled on --ship)
DB_RECORDS_KEEP="${DB_RECORDS_KEEP:-10}"       # how many pulled DB snapshots to retain

# shellcheck source=lib/repo_sync.sh
source "$ROOT_DIR/lib/repo_sync.sh"
# shellcheck source=lib/ui.sh
source "$ROOT_DIR/lib/ui.sh"
INTERACTIVE="$UI_INTERACTIVE"   # local alias for readability

SKIP_DOWN=false
SKIP_LOAD=false
SKIP_CHECKS=false
SHIP=false
ASSUME_YES=false   # --yes: skip the interactive local-deploy confirmation
FORCE_SHIP=false   # --force-ship: break-glass override of the local==remote ship gate
SKIP_DB_SYNC=false      # --skip-db-sync: don't pull the VPS DB or seed it during --ship
DB_FORCE_RESTORE=false  # --db-force-restore: restore local DB to the VPS even if it has data
REMOTE_DB_STATE=""      # set by probe_remote_db_state: has-data | empty | no-postgres

# --ship target (override any of these via the environment).
# Source of truth for these defaults: resources/vps_site_bind/algogon.xyz-nginx-tls-bind.md
# SHIP_KEY (the SSH .pem path) is NOT hardcoded — it is passed as the argument
# after --ship, e.g. `--ship resources/credentials/cli_app.pem`.
SHIP_HOST="${SHIP_HOST:-13.207.69.165}"
SHIP_USER="${SHIP_USER:-ubuntu}"
SHIP_KEY="${SHIP_KEY:-}"                          # set via the --ship <pem> argument
SHIP_REMOTE_DIR="${SHIP_REMOTE_DIR:-BOE_APP}"   # relative to the remote $HOME
SHIP_DOCKER="${SHIP_DOCKER:-sudo docker}"        # how docker is invoked on the VPS

# presentation + prompt helpers (colors, banner/section/step/ok/warn/field,
# confirm) are provided by lib/ui.sh, sourced above.

usage() {
    cat <<'USAGE'
Usage: ./release_manager/deploy.sh [--skip-down] [--skip-load] [--skip-checks]
                                   [--ship <pem-key> | --production <pem-key>]

DEFAULT: deploy the single bundle in release_manager/recent_builds locally
(snapshot → stage → compose up → health-check). The active bundle is copied to
rollback first; the pgdata Postgres volume is preserved (compose down, no -v).

PRODUCTION (--ship / --production): after the local deploy, the SHIP GATE
verifies the bundle is a STABLE release whose commit == origin/main and was built
clean, then ships it to the VPS. Cut + push the release in status.sh and rebuild
with export.sh first, or the gate refuses (override only with --force-ship).

  --skip-down       Do not `docker compose down` the existing local stack first.
  --skip-load       Do not `docker load` the image tarballs locally.
  --skip-checks     Skip the post-deploy HTTP health checks (local and remote).
  --yes, -y         Do not prompt before the local deploy (for automation/CI).
  --force-ship      Break-glass: ship to the VPS even if the artifact's commit
                    does not match origin/main. Use only in emergencies.
  --skip-db-sync    With --ship: do NOT pull the VPS database to db_records/ or
                    seed a fresh VPS from a local snapshot. Stack only.
  --db-force-restore  With --ship: restore the latest local db_records snapshot
                    onto the VPS even if the remote DB already has data
                    (DESTRUCTIVE — overwrites remote data; default only seeds an
                    EMPTY remote, e.g. a fresh-VPS migration).
  --ship <pem-key>       After the local deploy, also archive BOE_APP, push it to
  --production <pem-key>  the VPS, replace the remote BOE_APP after compose down,
                    load the images, and restart the remote stack (the two flags
                    are aliases). REQUIRES the path to the SSH .pem key, e.g.
                    --production resources/credentials/cli_app.pem
                    The remote .env secrets/domains are PRESERVED; only
                    BOE_VERSION is updated to the shipped release tag. The
                    remote pgdata volume survives (compose down, no -v).

--ship target (host/user/dir/docker default as shown; override via env):
  SHIP_HOST=13.207.69.165   SHIP_USER=ubuntu
  SHIP_REMOTE_DIR=BOE_APP   SHIP_DOCKER="sudo docker"
  (the .pem key is supplied as the --ship argument, not via SHIP_KEY)
USAGE
}

read_json_version() { jq -r '.version // empty' "$1" 2>/dev/null || printf ''; }  # never abort a `set -e` caller on bad/odd JSON; callers check for empty
assert_file() { [[ -f "$1" ]] || { printf 'Required file missing: %s\n' "$1" >&2; exit 1; }; }
assert_dir() { [[ -d "$1" ]] || { printf 'Required directory missing: %s\n' "$1" >&2; exit 1; }; }

select_recent_bundle() {
    local bundles=()
    mapfile -t bundles < <(find "$RECENT_DIR" -mindepth 1 -maxdepth 1 -type d | sort)
    if [[ ${#bundles[@]} -ne 1 ]]; then
        printf 'Expected exactly one release bundle in %s, found %s\n' "$RECENT_DIR" "${#bundles[@]}" >&2
        exit 1
    fi
    printf '%s\n' "${bundles[0]}"
}

copy_active_bundle_to_rollback() {
    [[ -f "$ACTIVE_DIR/version.json" ]] || { step "No active release yet — nothing to snapshot."; return 0; }
    [[ -f "$ACTIVE_DIR/images/backend.tar.gz" ]] || { step "Active release has no images — nothing to snapshot."; return 0; }

    local version stamp snapshot_dir
    version="$(read_json_version "$ACTIVE_DIR/version.json")"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    snapshot_dir="$ROLLBACK_DIR/${version:-unknown}-${stamp}"
    mkdir -p "$snapshot_dir"

    for file in docker-compose.yml .env version.json manifest.json README.txt; do
        [[ -f "$ACTIVE_DIR/$file" ]] && cp "$ACTIVE_DIR/$file" "$snapshot_dir/$file"
    done
    [[ -f "$ACTIVE_DIR/images/backend.tar.gz" ]] && cp "$ACTIVE_DIR/images/backend.tar.gz" "$snapshot_dir/backend.tar.gz"
    [[ -f "$ACTIVE_DIR/images/landing.tar.gz" ]] && cp "$ACTIVE_DIR/images/landing.tar.gz" "$snapshot_dir/landing.tar.gz"

    # Capture the DATA, not just the images. The new stack runs migrations
    # forward (step 4/5); restoring only images on rollback would leave an old
    # app pointed at a newer schema. Dumping here — while the old stack is still
    # up (compose down happens later) — pins the dump to this exact release.
    dump_active_db_to_snapshot "$snapshot_dir"

    ok "Snapshotted active release ${version:-unknown} → rollback/$(basename "$snapshot_dir")"
}

# Dump the currently-running Postgres into the rollback snapshot dir. Reads the
# DB user/name from the active (about-to-be-replaced) .env via env_value so the
# dump matches the release being snapshotted. Skips cleanly when no DB container
# is running yet (first deploy). A dump failure is non-fatal: the snapshot keeps
# its images, but rollback will then restore images only (no data).
dump_active_db_to_snapshot() {
    local snapshot_dir="$1"
    if ! docker ps --filter "name=^/${PG_CONTAINER}$" --filter "status=running" \
            --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
        step "No running ${PG_CONTAINER} — skipping DB dump (first deploy?)."
        return 0
    fi

    local pg_user pg_db
    pg_user="$(env_value POSTGRES_USER)"
    pg_db="$(env_value POSTGRES_DB)"
    if [[ -z "$pg_user" || -z "$pg_db" ]]; then
        warn "POSTGRES_USER/POSTGRES_DB not in active .env — skipping DB dump."
        return 0
    fi

    step "Dumping running database '${pg_db}' → snapshot/db.sql.gz"
    if docker exec "$PG_CONTAINER" pg_dump -U "$pg_user" "$pg_db" | gzip > "$snapshot_dir/db.sql.gz"; then
        ok "Database dump captured ($(du -h "$snapshot_dir/db.sql.gz" | cut -f1))"
    else
        rm -f "$snapshot_dir/db.sql.gz"
        warn "pg_dump failed — snapshot keeps images only (rollback will not restore data)."
    fi
}

copy_bundle_into_active() {
    local bundle_dir="$1"

    mkdir -p "$ACTIVE_DIR/images" "$ACTIVE_DIR/releases"
    rm -f "$ACTIVE_DIR/docker-compose.yml" "$ACTIVE_DIR/version.json" "$ACTIVE_DIR/manifest.json" "$ACTIVE_DIR/README.txt"
    rm -f "$ACTIVE_DIR/images/backend.tar.gz" "$ACTIVE_DIR/images/landing.tar.gz"

    cp "$bundle_dir/docker-compose.yml" "$ACTIVE_DIR/docker-compose.yml"
    cp "$bundle_dir/version.json" "$ACTIVE_DIR/version.json"
    cp "$bundle_dir/backend.tar.gz" "$ACTIVE_DIR/images/backend.tar.gz"
    cp "$bundle_dir/landing.tar.gz" "$ACTIVE_DIR/images/landing.tar.gz"
    [[ -f "$bundle_dir/.env" ]] && cp "$bundle_dir/.env" "$ACTIVE_DIR/.env"
    [[ -f "$bundle_dir/manifest.json" ]] && cp "$bundle_dir/manifest.json" "$ACTIVE_DIR/manifest.json"
    [[ -f "$bundle_dir/README.txt" ]] && cp "$bundle_dir/README.txt" "$ACTIVE_DIR/README.txt"
    ok "Staged bundle copied into $(basename "$ACTIVE_DIR")/"
}

env_value() {
    local key="$1"
    [[ -f "$ACTIVE_DIR/.env" ]] || return 0
    sed -n "s/^${key}=//p" "$ACTIVE_DIR/.env" | tail -n 1
}

# Hard gate before shipping to the VPS: the artifact being shipped must be the
# exact commit that is on remote main, built from a clean tree. The bundle's
# provenance (git_sha / git_dirty) is stamped by export.sh into manifest.json.
# Refuses unless --force-ship. Reads origin/main fresh so the check is honest.
assert_ship_in_sync() {
    local bundle_dir="$1" manifest="$1/manifest.json"
    local bsha bdirty bver remote_full reason=""

    if ! git -C "$ROOT_DIR" fetch -q origin main 2>/dev/null; then
        reason="cannot fetch origin/main to verify sync (network/SSH?)"
    fi
    remote_full="$(git -C "$ROOT_DIR" rev-parse origin/main 2>/dev/null || echo '')"
    bsha="$(jq -r '.git_sha // empty'   "$manifest" 2>/dev/null || true)"
    bdirty="$(jq -r '.git_dirty // empty' "$manifest" 2>/dev/null || true)"
    bver="$(read_json_version "$bundle_dir/version.json" 2>/dev/null || true)"

    section "SHIP GATE" "the VPS only accepts a STABLE artifact whose commit == remote main"
    field "artifact version" "${bver:-<unknown>}"
    field "channel"          "$([[ "$bver" == *-* ]] && echo "dev/candidate (local-only)" || echo stable)"
    field "artifact commit"  "${bsha:-<none recorded>}"
    field "remote main"      "${remote_full:-<unknown>}"
    field "built clean"      "$([[ "$bdirty" == false ]] && echo yes || echo "no/unknown")"

    if [[ -z "$reason" ]]; then
        if [[ "$bver" == *-* ]]; then
            reason="this is a dev/candidate build ($bver) — only stable releases ship. Cut a release first (./release_manager/status.sh --main), then rebuild: ./release_manager/export.sh"
        elif [[ -z "$bsha" ]]; then
            reason="bundle has no git provenance — rebuild it: ./release_manager/export.sh"
        elif [[ -z "$remote_full" ]]; then
            reason="origin/main not found — cannot verify the deploy source"
        elif [[ "$bdirty" == true ]]; then
            reason="bundle was built from a DIRTY working tree — commit, push to remote main, then rebuild"
        elif [[ "$bsha" != "$remote_full" ]]; then
            reason="artifact commit != remote main — push local main → remote main (status.sh --main), then rebuild the bundle from that commit"
        fi
    fi

    if [[ -n "$reason" ]]; then
        if [[ "$FORCE_SHIP" == true ]]; then
            warn "SHIP GATE BYPASSED (--force-ship): $reason"
            return 0
        fi
        printf '%s   ✗ refusing to ship: %s%s\n' "$c_red" "$reason" "$c_rst" >&2
        printf '%s     (override only if you know what you are doing: --force-ship)%s\n' "$c_dim" "$c_rst" >&2
        exit 1
    fi
    ok "Ship gate passed — artifact matches remote main"
}

# ── VPS database sync (pull-before-ship, seed-fresh-on-migrate) ────────────────
# The VPS Postgres lives in a Docker volume that does NOT travel between VPSes,
# so a migration would start empty. To keep data consistent across updates AND
# migrations, --ship: (1) probes + pulls the live remote DB into db_records/
# before touching the stack, and (2) restores the latest local snapshot into the
# remote ONLY when the remote DB is empty (a fresh VPS) — or always, with
# --db-force-restore. A populated remote is never overwritten by default.

# Probe the remote DB without changing anything. Echoes one of:
#   has-data | empty | no-postgres   (stdout). Used to decide pull + seed.
probe_remote_db_state() {
    local remote="$1"; shift
    local ssh_opts=("$@")
    ssh "${ssh_opts[@]}" "$remote" "bash -s -- '$SHIP_REMOTE_DIR' '$SHIP_DOCKER' '$PG_CONTAINER'" <<'EOF' 2>/dev/null || echo no-postgres
set -euo pipefail
remote_dir="$1"; read -r -a dc <<< "$2"; pgc="$3"
cd "$remote_dir" 2>/dev/null || { echo no-postgres; exit 0; }
[[ -f .env ]] || { echo no-postgres; exit 0; }
ev() { sed -n "s/^$1=//p" .env | tail -n1; }
u="$(ev POSTGRES_USER)"; d="$(ev POSTGRES_DB)"
if ! "${dc[@]}" ps --filter "name=^/${pgc}$" --filter status=running --format '{{.Names}}' | grep -qx "$pgc"; then
    echo no-postgres; exit 0
fi
t="$("${dc[@]}" exec "$pgc" psql -tA -U "$u" "$d" -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d '[:space:]')"
[[ "${t:-0}" -gt 0 ]] && echo has-data || echo empty
EOF
}

# pg_dump the live remote DB and stream it (gzipped) into db_records/. Only call
# when the remote actually has data. Updates the db_records/latest.sql.gz pointer
# and prunes to DB_RECORDS_KEEP snapshots.
pull_remote_db() {
    local remote="$1" release_version="$2"; shift 2
    local ssh_opts=("$@")
    local tmp dest stamp
    tmp="$(mktemp "${TMPDIR:-/tmp}/boe-vpsdb.XXXXXX.sql.gz")"

    step "Pulling live VPS database → db_records/"
    if ! ssh "${ssh_opts[@]}" "$remote" "bash -s -- '$SHIP_REMOTE_DIR' '$SHIP_DOCKER' '$PG_CONTAINER'" > "$tmp" 2>/dev/null <<'EOF'
set -euo pipefail
remote_dir="$1"; read -r -a dc <<< "$2"; pgc="$3"
cd "$remote_dir"
ev() { sed -n "s/^$1=//p" .env | tail -n1; }
u="$(ev POSTGRES_USER)"; d="$(ev POSTGRES_DB)"
"${dc[@]}" exec "$pgc" pg_dump -U "$u" "$d" | gzip
EOF
    then
        rm -f "$tmp"; warn "Remote DB pull failed — kept existing local db_records."; return 0
    fi

    if [[ ! -s "$tmp" ]] || ! gzip -t "$tmp" 2>/dev/null; then
        rm -f "$tmp"; warn "Remote DB dump was empty/invalid — kept existing local db_records."; return 0
    fi

    mkdir -p "$DB_RECORDS_DIR"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    dest="$DB_RECORDS_DIR/${release_version:-unknown}-${stamp}.sql.gz"
    mv "$tmp" "$dest"
    ln -sf "$(basename "$dest")" "$DB_RECORDS_DIR/latest.sql.gz"
    ok "Pulled VPS DB → db_records/$(basename "$dest") ($(du -h "$dest" | cut -f1))"

    # Retention: keep the newest DB_RECORDS_KEEP real snapshots (ignore the symlink).
    local old
    while IFS= read -r old; do rm -f "$old"; done < <(
        find "$DB_RECORDS_DIR" -maxdepth 1 -type f -name '*.sql.gz' | sort -r | tail -n +"$((DB_RECORDS_KEEP + 1))"
    )
    return 0   # don't let the trailing loop's status leak to a `set -e` caller
}

# Push the just-deployed BOE_APP payload to the VPS, replacing the remote deploy
# directory after compose down. Deliberately does NOT ship .env: the VPS keeps
# its own production .env (domain, CORS, secrets). The only remote .env key
# updated here is BOE_VERSION, because compose resolves image tags from it.
# pgdata is preserved.
ship_to_vps() {
    command -v ssh >/dev/null || { echo "ssh is required for --ship" >&2; exit 1; }
    command -v scp >/dev/null || { echo "scp is required for --ship" >&2; exit 1; }
    command -v tar >/dev/null || { echo "tar is required for --ship" >&2; exit 1; }
    assert_file "$SHIP_KEY"

    local ssh_opts=(-i "$SHIP_KEY" -o BatchMode=yes -o ConnectTimeout=15)
    local remote="$SHIP_USER@$SHIP_HOST"
    local release_version ship_archive remote_archive
    release_version="$(read_json_version "$ACTIVE_DIR/version.json")"
    [[ -n "$release_version" ]] || { echo "Cannot ship: active version.json has no version" >&2; exit 1; }
    ship_archive="$(mktemp "${TMPDIR:-/tmp}/boe-app.${release_version}.XXXXXX.tar.gz")"
    remote_archive="${SHIP_REMOTE_DIR}.upload-${release_version}.tar.gz"

    banner "SHIP TO VPS"
    field "target"  "$remote"
    field "remote dir" "~/$SHIP_REMOTE_DIR"
    field "ssh key"  "$SHIP_KEY"
    field "policy"   "ships BOE_APP payload — remote secrets/domains preserved, BOE_VERSION updated"
    field "db sync"  "$([[ "$SKIP_DB_SYNC" == true ]] && echo "off (--skip-db-sync)" || echo "pull VPS DB → db_records; seed only an EMPTY remote$([[ "$DB_FORCE_RESTORE" == true ]] && echo " (FORCE: overwrite remote)")")"

    section "Connectivity" "verify SSH reachability and ensure the remote layout exists"
    if ssh "${ssh_opts[@]}" "$remote" "mkdir -p '$SHIP_REMOTE_DIR'"; then
        ok "Connected to $remote"
    else
        echo "Cannot reach $remote over SSH (check key/host/network)" >&2
        exit 1
    fi

    # ── DB SYNC (pull) ─────────────────────────────────────────────────────────
    # Capture the live VPS data BEFORE we touch the stack, and decide whether the
    # remote needs seeding (fresh VPS) from a local snapshot.
    local seed_remote=""
    if [[ "$SKIP_DB_SYNC" == true ]]; then
        section "DB sync" "skipped (--skip-db-sync) — stack only, no DB pull/seed"
    else
        section "DB sync" "pull the live VPS DB to db_records/, then seed a fresh VPS if needed"
        REMOTE_DB_STATE="$(probe_remote_db_state "$remote" "${ssh_opts[@]}" | tr -d '[:space:]')"
        field "remote DB" "${REMOTE_DB_STATE:-unknown}"
        if [[ "$REMOTE_DB_STATE" == "has-data" ]]; then
            pull_remote_db "$remote" "$release_version" "${ssh_opts[@]}"
        else
            step "Remote DB is ${REMOTE_DB_STATE:-unreachable} — nothing to pull (kept local db_records)."
        fi

        # Decide whether to ship a seed dump up. Default: only when the remote is
        # empty/fresh (migration). --db-force-restore: always (overwrites remote).
        if [[ -f "$DB_RECORDS_DIR/latest.sql.gz" ]] \
            && { [[ "$DB_FORCE_RESTORE" == true ]] || [[ "$REMOTE_DB_STATE" != "has-data" ]]; }; then
            local seed_local
            seed_local="$(readlink -f "$DB_RECORDS_DIR/latest.sql.gz" 2>/dev/null || true)"
            if [[ -n "$seed_local" && -f "$seed_local" ]]; then
                seed_remote="${SHIP_REMOTE_DIR}.dbseed-${release_version}.sql.gz"
                step "Uploading local DB snapshot to seed the VPS ($(basename "$seed_local"))"
                scp "${ssh_opts[@]}" "$seed_local" "$remote:$seed_remote"
                if [[ "$DB_FORCE_RESTORE" == true && "$REMOTE_DB_STATE" == "has-data" ]]; then
                    warn "--db-force-restore: the remote DB WILL be overwritten by this snapshot."
                else
                    ok "Seed staged — will restore only if the remote DB is empty."
                fi
            fi
        fi
    fi

    section "Upload" "archive and copy the active BOE_APP payload (NOT .env / .env.production / db_records)"
    step "Creating BOE_APP archive"
    # .env.production is shipped MANUALLY (scp + rename to .env on the VPS);
    # it carries production secrets and must never ride along in the archive.
    tar --exclude='.env' --exclude='./.env' \
        --exclude='.env.production' --exclude='./.env.production' \
        --exclude='./db_records' --exclude='db_records' \
        -C "$ACTIVE_DIR" -czf "$ship_archive" .
    step "Uploading $(basename "$ship_archive")"
    scp "${ssh_opts[@]}" "$ship_archive" "$remote:$remote_archive"
    rm -f "$ship_archive"
    ok "Upload complete"

    section "Remote restart" "compose down, replace BOE_APP, load images, seed-if-empty, then compose up (pgdata survives)"
    ssh "${ssh_opts[@]}" "$remote" "bash -s -- '$SHIP_REMOTE_DIR' '$release_version' '$SHIP_DOCKER' '$remote_archive' '$seed_remote' '$DB_FORCE_RESTORE' '$PG_CONTAINER'" <<'EOF'
set -euo pipefail
remote_dir="$1"
release_version="$2"
docker_cmd_raw="$3"
archive_path="$4"
seed_dump="$5"
force_restore="$6"
pg_container="$7"

read -r -a docker_cmd <<< "$docker_cmd_raw"

if [[ -z "$remote_dir" || "$remote_dir" == "/" ]]; then
    echo "Unsafe SHIP_REMOTE_DIR: $remote_dir" >&2
    exit 1
fi

if [[ ! -f "$remote_dir/.env" ]]; then
    echo "Remote .env is missing in $remote_dir; refusing to deploy without production secrets." >&2
    exit 1
fi

tmp_env="$(mktemp)"
if grep -q '^BOE_VERSION=' "$remote_dir/.env"; then
    sed "s/^BOE_VERSION=.*/BOE_VERSION=${release_version}/" "$remote_dir/.env" > "$tmp_env"
else
    cp "$remote_dir/.env" "$tmp_env"
    printf '\nBOE_VERSION=%s\n' "$release_version" >> "$tmp_env"
fi

next_dir="${remote_dir}.next"
previous_dir="${remote_dir}.previous"
rm -rf "$next_dir" "$previous_dir"
mkdir -p "$next_dir"
tar -xzf "$archive_path" -C "$next_dir"
mv "$tmp_env" "$next_dir/.env"

if [[ -f "$remote_dir/docker-compose.yml" ]]; then
    (cd "$remote_dir" && "${docker_cmd[@]}" compose down)
fi

mv "$remote_dir" "$previous_dir"
mv "$next_dir" "$remote_dir"
rm -rf "$previous_dir"
rm -f "$archive_path"

cd "$remote_dir"
"${docker_cmd[@]}" load -i images/backend.tar.gz
"${docker_cmd[@]}" load -i images/landing.tar.gz

ev() { sed -n "s/^$1=//p" .env | tail -n1; }
pg_user="$(ev POSTGRES_USER)"; pg_db="$(ev POSTGRES_DB)"

# Bring Postgres up ALONE first so we can seed data before migrate/seed run.
"${docker_cmd[@]}" compose up -d postgres
for _i in $(seq 1 30); do
    "${docker_cmd[@]}" exec "$pg_container" pg_isready -U "$pg_user" -d "$pg_db" >/dev/null 2>&1 && break
    sleep 2
done

# Seed the remote DB from the shipped local snapshot. Default: only when the
# remote DB is empty (a fresh VPS / new volume). force_restore overrides that.
if [[ -n "$seed_dump" && -f "$seed_dump" ]]; then
    do_restore=false
    if [[ "$force_restore" == "true" ]]; then
        do_restore=true
    else
        tcount="$("${docker_cmd[@]}" exec "$pg_container" psql -tA -U "$pg_user" "$pg_db" -c \
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d '[:space:]')"
        [[ "${tcount:-0}" -eq 0 ]] && do_restore=true
    fi

    if [[ "$do_restore" == true ]]; then
        echo "Seeding remote database '${pg_db}' from shipped local snapshot"
        "${docker_cmd[@]}" exec "$pg_container" psql -v ON_ERROR_STOP=1 -U "$pg_user" -d postgres -c \
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${pg_db}' AND pid <> pg_backend_pid();" >/dev/null
        "${docker_cmd[@]}" exec "$pg_container" psql -v ON_ERROR_STOP=1 -U "$pg_user" -d postgres -c \
            "DROP DATABASE IF EXISTS \"${pg_db}\";"
        "${docker_cmd[@]}" exec "$pg_container" psql -v ON_ERROR_STOP=1 -U "$pg_user" -d postgres -c \
            "CREATE DATABASE \"${pg_db}\" OWNER \"${pg_user}\";"
        gunzip -c "$seed_dump" | "${docker_cmd[@]}" exec -i "$pg_container" psql -v ON_ERROR_STOP=1 -U "$pg_user" "$pg_db" >/dev/null
        echo "Remote database seeded; migrations will run forward over it next."
    else
        echo "Remote DB already has data — leaving it intact (use --db-force-restore to overwrite)."
    fi
fi
rm -f "$seed_dump" 2>/dev/null || true

# Full stack: migrate runs forward over the (possibly just-seeded) DB, then app up.
"${docker_cmd[@]}" compose up -d
"${docker_cmd[@]}" compose ps
cp version.json current-version.json
EOF
    ok "Remote stack restarted"

    if [[ "$SKIP_CHECKS" == false ]]; then
        section "Remote health checks" "curl backend /health and landing / on the VPS"
        ssh "${ssh_opts[@]}" "$remote" "bash -s -- '$SHIP_REMOTE_DIR'" <<'EOF'
set -euo pipefail
cd "$1"
env_value() {
    local key="$1"
    sed -n "s/^${key}=//p" .env | tail -n 1
}
backend_port="$(env_value BACKEND_PORT)"; backend_port="${backend_port:-47502}"
landing_port="$(env_value LANDING_PORT)"; landing_port="${landing_port:-3100}"
curl -fsS --max-time 30 "http://localhost:${backend_port}/health" >/dev/null
printf '   ✓ Remote backend OK (:%s/health)\n' "$backend_port"
curl -fsS --max-time 30 "http://localhost:${landing_port}/" >/dev/null
printf '   ✓ Remote landing OK (:%s)\n' "$landing_port"
EOF
    else
        warn "Remote health checks skipped (--skip-checks)"
    fi

    ok "Shipped version $(read_json_version "$ACTIVE_DIR/version.json") to $remote"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-down) SKIP_DOWN=true; shift ;;
        --skip-load) SKIP_LOAD=true; shift ;;
        --skip-checks) SKIP_CHECKS=true; shift ;;
        --yes|-y) ASSUME_YES=true; shift ;;
        --force-ship) FORCE_SHIP=true; shift ;;
        --skip-db-sync) SKIP_DB_SYNC=true; shift ;;
        --db-force-restore) DB_FORCE_RESTORE=true; shift ;;
        --ship|--production)
            SHIP=true
            if [[ $# -lt 2 || "${2:-}" == -* ]]; then
                printf -- '%s requires a path to the SSH .pem key, e.g. %s resources/credentials/cli_app.pem\n' "$1" "$1" >&2
                exit 1
            fi
            SHIP_KEY="$2"
            shift 2
            ;;
        --help|-h) usage; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
    esac
done

# Resolve the key to an absolute path NOW — cwd changes later via pushd, so a
# relative --ship path would otherwise break inside ship_to_vps.
if [[ "$SHIP" == true ]]; then
    assert_file "$SHIP_KEY"
    SHIP_KEY="$(cd "$(dirname "$SHIP_KEY")" && pwd)/$(basename "$SHIP_KEY")"
fi

banner "BeOnEdge — local deploy"
printf '%sStage the bundle in recent_builds into BOE_APP and bring the Docker stack up.%s\n' "$c_dim" "$c_rst"
printf '%sRollback snapshot is taken first; the pgdata volume is preserved.%s\n' "$c_dim" "$c_rst"
[[ "$SHIP" == true ]] && printf '%sThen ship the images to %s@%s and restart the remote stack.%s\n' \
    "$c_dim" "$SHIP_USER" "$SHIP_HOST" "$c_rst"

# ── 1. PRE-FLIGHT ─────────────────────────────────────────────────────────────
section "1/5  PRE-FLIGHT" "verify tooling and validate the staged bundle"
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
ok "docker, jq, curl present"

assert_dir "$ACTIVE_DIR"

BUNDLE_DIR="$(select_recent_bundle)"
assert_dir "$BUNDLE_DIR"
assert_file "$BUNDLE_DIR/docker-compose.yml"
assert_file "$BUNDLE_DIR/version.json"
assert_file "$BUNDLE_DIR/backend.tar.gz"
assert_file "$BUNDLE_DIR/landing.tar.gz"
assert_file "$BUNDLE_DIR/.env"
BUNDLE_VERSION="$(read_json_version "$BUNDLE_DIR/version.json")"
ok "Bundle validated"
field "bundle"  "$(basename "$BUNDLE_DIR")"
field "version" "${BUNDLE_VERSION:-unknown}"

# ── REPO SYNC + GATES ──────────────────────────────────────────────────────────
section "REPO SYNC" "how your local main compares to remote main (the VPS source)"
repo_sync_eval "$ROOT_DIR"
repo_sync_notice

# Fail fast: if shipping, the artifact MUST equal remote main. Check before we
# touch the local stack so a divergent ship never silently deploys locally only.
if [[ "$SHIP" == true ]]; then
    assert_ship_in_sync "$BUNDLE_DIR"
fi

# Confirm the local deploy (interactive terminals only; --yes / CI bypass it).
if [[ "$ASSUME_YES" != true && "$INTERACTIVE" == true ]]; then
    if ! confirm "Proceed with LOCAL deploy of ${BUNDLE_VERSION:-?} (see local↔remote diff above)?"; then
        warn "Aborted before local deploy."
        exit 0
    fi
fi

# ── 2. ROLLBACK SNAPSHOT ──────────────────────────────────────────────────────
section "2/5  ROLLBACK SNAPSHOT" "copy the currently-active release into rollback/"
mkdir -p "$ROLLBACK_DIR"
copy_active_bundle_to_rollback

# ── 3. STAGE BUNDLE ───────────────────────────────────────────────────────────
section "3/5  STAGE BUNDLE" "make the staged bundle the active release in BOE_APP/"
copy_bundle_into_active "$BUNDLE_DIR"

pushd "$ACTIVE_DIR" >/dev/null
trap 'popd >/dev/null' EXIT

# ── 4. STOP / LOAD ────────────────────────────────────────────────────────────
section "4/5  STOP + LOAD IMAGES" "stop the old stack and docker load the new image tarballs"
if [[ "$SKIP_DOWN" == false ]]; then
    step "Stopping existing stack (pgdata volume kept)"
    docker compose down
    ok "Stack stopped"
else
    warn "Stop skipped (--skip-down)"
fi

if [[ "$SKIP_LOAD" == false ]]; then
    step "Loading backend + landing images"
    docker load -i "$ACTIVE_DIR/images/backend.tar.gz"
    docker load -i "$ACTIVE_DIR/images/landing.tar.gz"
    ok "Images loaded"
else
    warn "Image load skipped (--skip-load)"
fi

# ── 5. START + HEALTH CHECK ───────────────────────────────────────────────────
section "5/5  START + HEALTH CHECK" "compose up -d, then HTTP-probe backend and landing"
step "Starting stack"
docker compose up -d
docker compose ps

if [[ "$SKIP_CHECKS" == false ]]; then
    backend_port="$(env_value BACKEND_PORT)"; backend_port="${backend_port:-47502}"
    landing_port="$(env_value LANDING_PORT)"; landing_port="${landing_port:-3100}"
    curl -fsS --max-time 30 "http://localhost:${backend_port}/health" >/dev/null && ok "Backend OK (:${backend_port}/health)"
    curl -fsS --max-time 30 "http://localhost:${landing_port}/" >/dev/null && ok "Landing OK (:${landing_port})"
else
    warn "Health checks skipped (--skip-checks)"
fi

cp "$ACTIVE_DIR/version.json" "$ACTIVE_DIR/current-version.json"

# ── SUMMARY ───────────────────────────────────────────────────────────────────
banner "DEPLOY SUMMARY"
field "local version" "$(read_json_version "$ACTIVE_DIR/version.json")"
field "from bundle"   "$(basename "$BUNDLE_DIR")"
field "shipped"       "$([[ "$SHIP" == true ]] && echo "pending (see SHIP TO VPS below)" || echo "no  (run with --ship <pem> to push to the VPS)")"

if [[ "$SHIP" == true ]]; then
    ship_to_vps
fi

printf '\n%s✓ Done.%s\n' "$c_grn" "$c_rst"
