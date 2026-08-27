#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# _boe_rollback.sh — the generic VPS-native rollback flow.
#
# Runs ON THE VPS. Sourced by dev_rollback.sh / prod_rollback.sh / ms_rollback.sh.
#
# Implements plan §20. The load-bearing rule: APPLICATION rollback and DATABASE
# restoration are separate operations.
#
#   • Application rollback swaps compatible container images back. A rollback
#     across a destructive schema boundary requires database restoration.
#   • Database restoration discards transactions committed since the snapshot.
#     It requires --restore-db plus a typed confirmation, always backs up the
#     current database first (a failed or impossible backup aborts the whole
#     rollback in that mode), and is logged separately. In production the
#     literal typed RESTORE is ALWAYS required — --yes never waives it.
#
# Uses the same flock as the deploy script, so a rollback can never race a
# deploy (plan §18).
# ─────────────────────────────────────────────────────────────────────────────

# boe_rollback_main <paths.json> <args...>
boe_rollback_main() {
    local paths_file="$1"; shift

    local TARGET="" LIST_ONLY=false ASSUME_YES=false RESTORE_DB=false LATEST=false SKIP_CHECKS=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --to)          TARGET="${2:-}"; [[ -n "$TARGET" ]] || { printf -- '--to needs a version\n' >&2; return 1; }; shift 2 ;;
            --latest)      LATEST=true; shift ;;
            --list|-l)     LIST_ONLY=true; shift ;;
            --restore-db)  RESTORE_DB=true; shift ;;
            --yes|-y)      ASSUME_YES=true; shift ;;
            --skip-checks) SKIP_CHECKS=true; shift ;;
            --help|-h)     boe_rollback_usage; return 0 ;;
            *) printf 'Unknown argument: %s\n' "$1" >&2; boe_rollback_usage >&2; return 1 ;;
        esac
    done

    require_cmds jq sha256sum gzip curl flock mountpoint sed awk
    boe_load_paths "$paths_file"

    printf '\n%s═══ BOE_APP rollback · %s (%s) ═══%s\n' \
        "$_c_bold" "${P[stack]}" "${P[environment]}" "$_c_rst"

    # ── inventory ───────────────────────────────────────────────────────────
    local current; current="$(boe_current_version)"
    local -a available=()
    boe_rollback_inventory available

    if [[ "$LIST_ONLY" == true ]]; then
        boe_rollback_print_inventory "$current" "${available[@]}"
        return 0
    fi

    (( ${#available[@]} > 0 )) || die "no complete rollback archives found in ${P[rollback_images]}"

    # ── select target ───────────────────────────────────────────────────────
    if [[ "$LATEST" == true ]]; then
        # Newest archived version that is not the one running now.
        local v
        for (( i = ${#available[@]} - 1; i >= 0; i-- )); do
            v="${available[$i]}"
            [[ "$v" != "$current" ]] && { TARGET="$v"; break; }
        done
        [[ -n "$TARGET" ]] || die "no rollback target other than the running version"
    elif [[ -z "$TARGET" ]]; then
        boe_rollback_print_inventory "$current" "${available[@]}"
        [[ -t 0 ]] || die "no target given and not running interactively (use --to <version> or --latest)"
        local reply
        printf '%s  ➜ rollback to which version? %s' "$_c_bold" "$_c_rst"
        read -r reply || die "no selection made"
        TARGET="$reply"
    fi

    # Validate the selection against the inventory rather than trusting input.
    local found=false v
    for v in "${available[@]}"; do [[ "$v" == "$TARGET" ]] && found=true; done
    [[ "$found" == true ]] || die "no complete rollback archive for version: $TARGET"
    [[ "$TARGET" != "$current" ]] || die "version $TARGET is already the running version"

    if [[ "${P[has_database]}" == "true" ]] \
        && boe_rollback_requires_database_restore "$current" "$TARGET" \
        && [[ "$RESTORE_DB" != true ]]; then
        die "rollback from $current to $TARGET crosses migration 025; rerun with --restore-db and the matching pre-v0.8.8 snapshot"
    fi

    local rb="${P[rollback_images]}/$TARGET"

    # ── lock and preflight ──────────────────────────────────────────────────
    boe_lock
    boe_assert_backup_mounted
    boe_assert_writable "${P[deploy_log]}"
    boe_open_log rollback
    boe_assert_docker

    log "rollback target: $TARGET  (current: ${current:-<none>})"

    # ── verify the rollback archive before trusting it ──────────────────────
    step "verify rollback archive"
    boe_rollback_verify "$rb"

    # ── confirmation ────────────────────────────────────────────────────────
    if [[ "$ASSUME_YES" != true ]]; then
        [[ -t 0 ]] || die "rollback needs --yes when running non-interactively"
        local reply
        printf '\n%s  ➜ roll %s back from %s to %s? [y/N] %s' \
            "$_c_bold" "${P[stack]}" "${current:-<none>}" "$TARGET" "$_c_rst"
        read -r reply || reply=""
        [[ "$reply" == [yY] || "$reply" == [yY][eE][sS] ]] || { warn "aborted by operator"; return 0; }
    fi

    boe_build_effective_env
    trap 'boe_cleanup_effective_env' EXIT
    boe_deploy_assert_env

    # ── preserve what is running now, so the rollback is itself reversible ──
    step "preserve the outgoing release"
    if [[ -n "$current" ]]; then
        local keep="${P[rollback_images]}/$current"
        if [[ -d "$keep" ]] && compgen -G "$keep/*.tar.gz" >/dev/null 2>&1; then
            info "outgoing version $current is already archived"
        else
            BOE_VERSION_FOR_COMPOSE="$current"
            boe_archive_current_images "$keep" "$current"
        fi
    else
        info "nothing currently recorded as deployed"
    fi

    # ── database: back up now, restore only if explicitly asked ─────────────
    step "database handling"
    if [[ "${P[has_database]}" != "true" ]]; then
        info "stack has no database"
    elif [[ "$RESTORE_DB" == true ]]; then
        # A restore discards committed transactions; proceeding without a
        # fresh pre-rollback snapshot would make that unrecoverable, so the
        # backup is mandatory and any failure/skip aborts the rollback.
        boe_assert_writable "${P[rollback_db]}/pre-rollback"
        boe_backup_database "${P[rollback_db]}/pre-rollback" "pre-rollback" true >/dev/null
    else
        boe_assert_writable "${P[rollback_db]}/pre-rollback"
        boe_backup_database "${P[rollback_db]}/pre-rollback" "pre-rollback" >/dev/null || true
    fi

    # The current Compose file is still authoritative here. Stop every current
    # database consumer before boe_rollback_load replaces that file; otherwise
    # a service removed from the target release could survive the restore.
    if [[ "$RESTORE_DB" == true && "${P[has_database]}" == "true" ]]; then
        boe_stop_database_consumers
    fi

    # ── load the target images ──────────────────────────────────────────────
    # Hook: the monitoring stack overrides this to re-pull pinned upstream tags
    # and restore its config tree instead of loading image archives.
    step "load rollback images"
    boe_rollback_load "$rb"

    BOE_VERSION_FOR_COMPOSE="$TARGET"
    boe_assert_images_present "$TARGET"
    boe_validate_compose

    # ── restore/start ───────────────────────────────────────────────────────
    if [[ "${P[has_database]}" == "true" ]]; then
        compose up -d postgres || die "failed to start postgres"
        boe_wait_postgres
    fi

    if [[ "$RESTORE_DB" == true ]]; then
        boe_rollback_restore_database "$TARGET" "$ASSUME_YES" \
            || die "database restoration was not completed; refusing to start rollback target"
    fi

    step "start rolled-back stack"
    compose up -d --remove-orphans || die "failed to start the rolled-back stack"
    compose ps

    # ── health ──────────────────────────────────────────────────────────────
    step "health checks"
    if [[ "$SKIP_CHECKS" == true ]]; then
        warn "health checks skipped by flag"
    else
        boe_wait_compose_healthy 40 || die "rolled-back stack did not become healthy — manual intervention required"
        boe_deploy_smoke_tests || warn "some smoke tests failed after rollback — investigate"
    fi

    boe_write_version "$TARGET" "$current" active
    boe_update_registry "$TARGET"

    boe_summary "Rollback complete" \
        "stack=${P[stack]}" \
        "rolled_back_from=${current:-<none>}" \
        "now_running=$TARGET" \
        "database_restored=$([[ "$RESTORE_DB" == true ]] && echo yes || echo 'no (application-only)')" \
        "log=$BOE_LOG_FILE"
}

# boe_rollback_load <rollback_dir> — default: load the archived image tarballs
# and restore the compose file and manifest that shipped with that version, so
# the stack comes back up exactly as it was rather than as the newest compose
# file describes. Overridden by ms_rollback.sh (config + upstream pull).
boe_rollback_load() {
    local rb="$1" key archive port path
    while IFS=$'\t' read -r key archive port; do
        path="$rb/$archive"
        [[ -f "$path" ]] || die "rollback archive incomplete, missing $archive"
        log "loading $archive"
        gzip -dc "$path" | "$(docker_bin)" image load >/dev/null || die "failed to load $archive"
        ok "loaded $archive"
    done < <(boe_images)

    [[ -f "$rb/${P[compose_name]}" ]] && { cp "$rb/${P[compose_name]}" "${P[compose_file]}"; info "restored compose file"; }
    [[ -f "$rb/manifest.json" ]]      && { cp "$rb/manifest.json"      "${P[manifest_file]}"; info "restored manifest"; }
    return 0
}

boe_rollback_usage() {
    cat <<'USAGE'
Roll this stack back to a previously archived release.

  --list, -l        show available rollback versions and exit
  --to <version>    roll back to a specific version
  --latest          roll back to the newest archived version that is not running
  --restore-db      ALSO restore the database snapshot taken before that release
                    (destructive: discards transactions committed since then)
  --yes, -y         skip confirmation prompts (in production the typed RESTORE
                    confirmation for --restore-db is still always required)
  --skip-checks     do not gate on health checks
  --help, -h        this message

Application rollback (the default) only swaps container images and is safe when
the target schema is compatible. Crossing the v0.8.8 migration-025 boundary
requires --restore-db. Restoration always backs up the current database first.
USAGE
}

boe_restored_schema_is_compatible() {
    local target="$1" has_migration_025="$2" has_migration_042="$3"
    if boe_rollback_requires_database_restore 0.8.8 "$target"; then
        [[ "$has_migration_025" == "0" ]] || return 1
    fi
    if boe_rollback_requires_database_restore 0.11.9 "$target"; then
        [[ "$has_migration_042" == "0" ]] || return 1
    fi
    return 0
}

# Stop every Compose service except Postgres before destructive restoration.
# `compose config --services` keeps this generic across dev/prod layouts and
# includes one-shot migrate/seed services if they are still running.
boe_stop_database_consumers() {
    local service
    local -a consumers=()
    while IFS= read -r service; do
        [[ -n "$service" && "$service" != "postgres" ]] && consumers+=("$service")
    done < <(compose config --services)
    (( ${#consumers[@]} == 0 )) || compose stop "${consumers[@]}" \
        || die "failed to stop database consumers before restore"
}

# boe_rollback_inventory <array_name> — fill the named array with versions that
# have a COMPLETE archive, oldest → newest (version-sorted).
#
# Completeness matters: a half-finished `docker image save` must never appear as
# a rollback candidate.
boe_rollback_inventory() {
    local -n out="$1"
    out=()
    local dir="${P[rollback_images]}" v key archive port complete
    [[ -d "$dir" ]] || return 0
    while read -r v; do
        [[ -n "$v" ]] || continue
        complete=true
        while IFS=$'\t' read -r key archive port; do
            [[ -f "$dir/$v/$archive" ]] || complete=false
        done < <(boe_images)
        # A stack with no image list (monitoring) is complete if the dir exists.
        [[ "$complete" == true ]] && out+=("$v")
    done < <(find "$dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -V)
}

boe_rollback_print_inventory() {
    local current="$1"; shift
    printf '\n%sAvailable rollback versions for %s%s\n' "$_c_bold" "${P[stack]}" "$_c_rst"
    printf '  %s%-28s %-12s %s%s\n' "$_c_dim" "VERSION" "SIZE" "ARCHIVED" "$_c_rst"
    local v dir size when marker
    for v in "$@"; do
        dir="${P[rollback_images]}/$v"
        size="$(du -sh "$dir" 2>/dev/null | cut -f1)"
        when="$(date -r "$dir" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '-')"
        marker=""
        [[ "$v" == "$current" ]] && marker=" ${_c_grn}← running${_c_rst}"
        printf '  %-28s %-12s %s%b\n' "$v" "${size:-?}" "$when" "$marker"
    done
    (( $# > 0 )) || printf '  %s(none)%s\n' "$_c_dim" "$_c_rst"
    printf '\n'
}

# boe_rollback_verify lives in _boe_lib.sh — the deploy flow's auto-rollback
# needs it as well, and deploy entry points do not source this file.

# boe_rollback_restore_database <version> <assume_yes>
#
# Separate, explicit, doubly confirmed. Requires typing RESTORE so it cannot
# happen by reflex, because it discards committed transactions. In production
# the typed RESTORE is mandatory even when --yes was given.
boe_rollback_restore_database() {
    local version="$1" assume_yes="$2" dump dir user db reply
    [[ "${P[has_database]}" == "true" ]] || { warn "stack has no database to restore"; return 0; }

    dir="${P[rollback_db]}/$version"
    dump="$(find "$dir" -maxdepth 1 -name '*.dump' -type f 2>/dev/null | sort | tail -n1)"
    [[ -n "$dump" ]] || die "no database snapshot found for $version in $dir"

    # A dump without verifiable provenance is not trusted: the sidecar written
    # by boe_backup_database must exist, carry a sha256, and match.
    local meta="${dump%.dump}.metadata.json"
    [[ -f "$meta" ]] \
        || die "database snapshot has no metadata sidecar: $meta — refusing to restore an unverified dump"
    local expected actual
    expected="$(jq -r '.sha256 // empty' "$meta")"
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] \
        || die "database snapshot metadata has no valid sha256: $meta"
    actual="$(sha256sum "$dump" | cut -d' ' -f1)"
    [[ "$actual" == "$expected" ]] || die "database snapshot checksum mismatch: $dump"
    ok "snapshot checksum verified"

    printf '\n%s%sDATABASE RESTORATION%s\n' "$_c_bold" "$_c_red" "$_c_rst"
    printf '  Snapshot: %s\n' "$dump"
    printf '  %sThis DISCARDS every transaction committed after that snapshot.%s\n' "$_c_yel" "$_c_rst"

    if [[ "${P[environment]}" == "production" || "$assume_yes" != true ]]; then
        [[ "${P[environment]}" == "production" && "$assume_yes" == true ]] \
            && warn "production: --yes does not waive the typed RESTORE confirmation"
        [[ -t 0 ]] || die "database restoration requires an interactive terminal"
        printf '%s  ➜ type RESTORE to proceed: %s' "$_c_bold" "$_c_rst"
        read -r reply || reply=""
        [[ "$reply" == "RESTORE" ]] || die "database restoration aborted; rollback target was not started"
    fi

    user="$(env_get POSTGRES_USER "$BOE_EFFECTIVE_ENV")"
    db="$(env_get POSTGRES_DB "$BOE_EFFECTIVE_ENV")"

    step "restoring database $db"

    # Drop connections, recreate the database, then restore. The heredoc is
    # quoted ('SQL') so nothing in it is expanded locally, and the database /
    # role names reach psql as variables with identifier quoting (:"...") —
    # never through shell interpolation.
    "$(docker_bin)" exec -i "$(pg_container)" psql -U "$user" -d postgres \
        -v ON_ERROR_STOP=1 -v db="$db" -v dbuser="$user" <<'SQL' || die "failed to reset database"
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS :"db";
CREATE DATABASE :"db" OWNER :"dbuser";
SQL

    local restore_errors
    restore_errors="$(mktemp)"
    if ! "$(docker_bin)" exec -i "$(pg_container)" \
            pg_restore -U "$user" -d "$db" --no-owner --exit-on-error < "$dump" 2>"$restore_errors"; then
        while IFS= read -r line; do log "pg_restore: $line"; done < "$restore_errors"
        rm -f "$restore_errors"
        die "database restore failed; rollback target remains stopped"
    fi
    rm -f "$restore_errors"

    # A zero pg_restore exit is necessary but not sufficient evidence. BOE app
    # snapshots must carry their migration ledger and the core identity tables
    # before any API or worker is allowed to start.
    local restored_version required_tables has_migration_025 has_migration_042
    restored_version="$("$(docker_bin)" exec -i "$(pg_container)" \
        psql -tA -U "$user" -d "$db" \
        -c "SELECT COALESCE(MAX(version), '') FROM schema_migrations;" 2>/dev/null)" \
        || die "restored database has no readable migration ledger"
    [[ -n "$restored_version" ]] || die "restored database migration ledger is empty"
    has_migration_025="$("$(docker_bin)" exec -i "$(pg_container)" \
        psql -tA -U "$user" -d "$db" \
        -c "SELECT count(*) FROM schema_migrations WHERE version = '025_onboarding_rework';" 2>/dev/null)" \
        || die "restored database migration-boundary verification failed"
    has_migration_042="$("$(docker_bin)" exec -i "$(pg_container)" \
        psql -tA -U "$user" -d "$db" \
        -c "SELECT count(*) FROM schema_migrations WHERE version = '042_remove_legacy_compliance_tables';" 2>/dev/null)" \
        || die "restored database migration-boundary verification failed"
    boe_restored_schema_is_compatible "$version" "$has_migration_025" "$has_migration_042" \
        || die "restored snapshot is incompatible with rollback target $version"
    required_tables="$("$(docker_bin)" exec -i "$(pg_container)" \
        psql -tA -U "$user" -d "$db" \
        -c "SELECT count(*) FROM (VALUES (to_regclass('public.users')), (to_regclass('public.applications'))) AS required(name) WHERE name IS NOT NULL;" 2>/dev/null)" \
        || die "restored database core-table verification failed"
    [[ "$required_tables" == "2" ]] || die "restored database is missing required identity tables"
    ok "database restored from $(basename "$dump") at migration $restored_version"
}
