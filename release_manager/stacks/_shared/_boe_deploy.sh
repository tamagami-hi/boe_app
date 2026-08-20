#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# _boe_deploy.sh — the generic VPS-native deployment flow.
#
# Runs ON THE VPS. Sourced by dev_deploy.sh / prod_deploy.sh / ms_deploy.sh,
# which supply only stack identity and policy (e.g. production requires an
# explicit confirmation). Everything else is driven by paths.json, so one
# implementation serves all three stacks and they cannot drift apart.
#
# Implements plan §18 (production deployment flow) verbatim where the step is
# meaningful for this application. Deviations are commented inline.
#
# Contract with the operator machine: by the time this runs, deploy.sh has
# already placed manifest.json, the compose file, and images/*.tar.gz into the
# stack directory. This script owns every docker command from here on.
# ─────────────────────────────────────────────────────────────────────────────

# boe_deploy_main <paths.json> <args...>
boe_deploy_main() {
    local paths_file="$1"; shift

    local ASSUME_YES=false SKIP_CHECKS=false SKIP_DB_BACKUP=false FORCE=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes|-y)         ASSUME_YES=true; shift ;;
            --skip-checks)    SKIP_CHECKS=true; shift ;;
            --skip-db-backup) SKIP_DB_BACKUP=true; shift ;;
            --force)          FORCE=true; shift ;;
            --help|-h)        boe_deploy_usage; return 0 ;;
            *) printf 'Unknown argument: %s\n' "$1" >&2; boe_deploy_usage >&2; return 1 ;;
        esac
    done

    require_cmds jq sha256sum gzip tar curl flock mountpoint sed awk
    boe_load_paths "$paths_file"

    printf '\n%s═══ BOE_APP deploy · %s (%s) ═══%s\n' \
        "$_c_bold" "${P[stack]}" "${P[environment]}" "$_c_rst"

    # ── 1. exclusive lock (shared with the rollback script) ──────────────────
    step "1/16  acquire deployment lock"
    boe_lock

    # ── 2. release directory sanity ─────────────────────────────────────────
    step "2/16  verify release directory"
    [[ -d "${P[stack_dir]}" ]]     || die "stack directory missing: ${P[stack_dir]}"
    [[ -f "${P[compose_file]}" ]]  || die "compose file missing: ${P[compose_file]}"
    [[ -f "${P[manifest_file]}" ]] || die "manifest.json missing — has deploy.sh shipped a bundle yet?"
    ok "release directory present"

    # ── 3. backup disk mounted (plan §32) ───────────────────────────────────
    step "3/16  verify backup disk"
    boe_assert_backup_mounted
    boe_assert_writable "${P[rollback_root]}" "${P[rollback_images]}" "${P[deploy_log]}"
    boe_open_log deploy

    # ── 4. disk space ───────────────────────────────────────────────────────
    step "4/16  check disk space"
    local need; need="$(boe_required_space_mib)"
    boe_assert_space "${P[stack_dir]}" "$need"
    boe_assert_space "${P[rollback_root]}" "$need"

    # ── 5/6. version reconciliation ─────────────────────────────────────────
    step "5/16  read deployed version"
    local current incoming
    current="$(boe_current_version)"
    incoming="$(boe_incoming_version)"
    info "currently deployed: ${current:-<none>}"
    info "incoming release:   $incoming"

    step "6/16  validate incoming version"
    if [[ -n "$current" && "$current" == "$incoming" ]]; then
        if [[ "$FORCE" == true ]]; then
            warn "version $incoming is already deployed — proceeding because --force was given"
        else
            die "version $incoming is already deployed (use --force to redeploy)"
        fi
    fi

    # ── 7. checksums (plan §17.2) ───────────────────────────────────────────
    step "7/16  verify SHA-256 checksums"
    boe_verify_checksums

    # ── 8/9. docker + compose + env ─────────────────────────────────────────
    step "8/16  verify docker and compose"
    boe_assert_docker

    step "9/16  assemble environment"
    boe_build_effective_env
    trap 'boe_cleanup_effective_env' EXIT
    boe_deploy_assert_env
    BOE_VERSION_FOR_COMPOSE="$incoming"
    boe_validate_compose

    # Confirmation gate — production only, and only when a human is present.
    if [[ "${BOE_REQUIRE_CONFIRM:-false}" == true && "$ASSUME_YES" != true ]]; then
        if [[ -t 0 ]]; then
            local reply
            printf '\n%s  ➜ Deploy %s to PRODUCTION? [y/N] %s' "$_c_bold" "$incoming" "$_c_rst"
            read -r reply || reply=""
            [[ "$reply" == [yY] || "$reply" == [yY][eE][sS] ]] || { warn "aborted by operator"; return 0; }
        else
            die "production deploy needs --yes when running non-interactively"
        fi
    fi

    # ── 10/11/12. preserve the outgoing release ─────────────────────────────
    step "10/16 create versioned rollback directory"
    local rb_dir=""
    if [[ -n "$current" ]]; then
        rb_dir="${P[rollback_images]}/$current"
        boe_assert_writable "$rb_dir"
        ok "rollback target: $rb_dir"
    else
        info "no previous version to preserve (first deploy)"
    fi

    step "11/16 archive current images"
    if [[ -n "$current" ]]; then
        boe_archive_current_images "$rb_dir" "$current"
    else
        info "skipped — nothing deployed yet"
    fi

    step "12/16 preserve current APK artifacts"
    boe_deploy_archive_apks "$current"

    # ── 13. pre-deployment database backup (plan §18 step 13) ───────────────
    step "13/16 pre-deployment database backup"
    if [[ "${P[has_database]}" != "true" ]]; then
        info "stack has no database"
    elif [[ "$SKIP_DB_BACKUP" == true ]]; then
        warn "database backup SKIPPED by flag — rollback will have no pre-deploy snapshot"
    elif [[ -z "$current" ]]; then
        info "first deploy — no database to back up yet"
    else
        boe_assert_writable "${P[rollback_db]}/$current"
        boe_backup_database "${P[rollback_db]}/$current" "pre-deploy" >/dev/null
    fi

    # ── 14. load new images ─────────────────────────────────────────────────
    step "14/16 load new images"
    boe_load_images
    boe_assert_images_present "$incoming"

    # ── 15. start the stack ─────────────────────────────────────────────────
    # Ordering is enforced by the compose file's depends_on conditions
    # (postgres healthy → migrate completed → seed → backend + workers →
    # frontends), so a single `up -d` is correct and migrations run in-band.
    step "15/16 start stack"
    if [[ "${P[has_database]}" == "true" ]]; then
        log "bringing up postgres first"
        compose up -d postgres || die "failed to start postgres"
        boe_wait_postgres
    fi
    log "bringing up the full stack (migrations run in-band)"
    compose up -d --remove-orphans || boe_deploy_fail "$current" "$incoming" "compose up failed"
    compose ps

    # ── 16. health gate, then and only then record the version ──────────────
    step "16/16 health checks"
    local healthy=true
    if [[ "$SKIP_CHECKS" == true ]]; then
        warn "health checks SKIPPED by flag — version will be recorded unverified"
    else
        boe_wait_compose_healthy 45 || healthy=false
        boe_deploy_smoke_tests   || healthy=false
    fi

    if [[ "$healthy" != true ]]; then
        boe_deploy_fail "$current" "$incoming" "health checks failed"
    fi

    boe_write_version "$incoming" "$current" active
    boe_update_registry "$incoming"

    # Retention last, so a failure above never destroys a rollback target.
    boe_prune_rollbacks "${P[rollback_images]}" "${P[keep_releases]}"
    boe_prune_rollbacks "${P[rollback_db]}"     "${P[keep_releases]}"

    boe_summary "Deployment complete" \
        "stack=${P[stack]}" \
        "environment=${P[environment]}" \
        "version=$incoming" \
        "previous=${current:-<none>}" \
        "project=${P[compose_project]}" \
        "log=$BOE_LOG_FILE"
}

boe_deploy_usage() {
    cat <<'USAGE'
Deploy the staged release in this directory.

  --yes, -y           skip the production confirmation prompt
  --skip-checks       start the stack but do not gate on health checks
  --skip-db-backup    do not take a pre-deployment database snapshot
  --force             redeploy even if this version is already active
  --help, -h          this message

The release bundle (manifest.json, compose file, images/*.tar.gz) must already
be present; it is placed here by the operator machine's deploy.sh.
USAGE
}

# ── stack-specific hooks (overridable by the entry scripts) ─────────────────

# Required env keys, checked before docker is touched.
boe_deploy_assert_env() {
    if [[ "${P[has_database]}" == "true" ]]; then
        boe_assert_env_keys \
            POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
            BACKEND_PORT APP_FRONTEND_PORT ADMIN_FRONTEND_PORT \
            PUBLIC_API_BASE_URL CORS_ORIGIN WEB_ORIGIN_ALLOWLIST \
            ACCESS_TOKEN_ISSUER ACCESS_TOKEN_AUDIENCE ACCESS_TOKEN_CURRENT_KID \
            ACCESS_TOKEN_SIGNING_KEY ACCESS_TOKEN_VERIFICATION_KEYS \
            REFRESH_HMAC_KEY REFRESH_KEY_VERSION CSRF_KEY_VERSION CURSOR_HMAC_KEY \
            CRYPTO_TOKEN_HASH_KEY CRYPTO_TOKEN_HASH_KEY_VERSION \
            CRYPTO_CONSENT_IP_HMAC_KEY CRYPTO_CONSENT_IP_HMAC_KEY_VERSION \
            CRYPTO_RECIPIENT_HMAC_KEY CRYPTO_RECIPIENT_HMAC_KEY_VERSION \
            CRYPTO_RECIPIENT_ENC_KEY CRYPTO_RECIPIENT_ENC_KEY_VERSION \
            NEWUSER_SHARED_SECRET \
            KYC_EMAIL_FROM EMAIL_SMTP_HOST EMAIL_SMTP_PORT EMAIL_SMTP_USER EMAIL_SMTP_PASSWORD EMAIL_SMTP_SECURE \
            APK_DOWNLOAD_BASE_URL
        boe_validate_app_key_material
        boe_validate_app_policy
    fi
}

boe_assert_base64_key() {
    local key="$1" minimum="$2" exact="${3:-false}" value bytes
    value="$(env_get "$key" "$BOE_EFFECTIVE_ENV")"
    if ! bytes="$(printf '%s' "$value" | base64 --decode 2>/dev/null | wc -c | tr -d '[:space:]')"; then
        die "$key must be valid base64"
    fi
    if [[ "$exact" == "true" ]]; then
        [[ "$bytes" == "$minimum" ]] || die "$key must decode to exactly $minimum bytes"
    else
        (( bytes >= minimum )) || die "$key must decode to at least $minimum bytes"
    fi
}

boe_validate_app_key_material() {
    require_cmds base64 openssl jq
    boe_assert_base64_key REFRESH_HMAC_KEY 32 true
    boe_assert_base64_key CURSOR_HMAC_KEY 32 true
    boe_assert_base64_key CRYPTO_TOKEN_HASH_KEY 32
    boe_assert_base64_key CRYPTO_CONSENT_IP_HMAC_KEY 32
    boe_assert_base64_key CRYPTO_RECIPIENT_HMAC_KEY 32
    boe_assert_base64_key CRYPTO_RECIPIENT_ENC_KEY 32 true

    local kid signing verification public_key signing_curve public_curve signing_hash public_hash
    kid="$(env_get ACCESS_TOKEN_CURRENT_KID "$BOE_EFFECTIVE_ENV")"
    signing="$(env_get ACCESS_TOKEN_SIGNING_KEY "$BOE_EFFECTIVE_ENV")"
    signing_curve="$(printf '%b' "$signing" | openssl pkey -text_pub -noout 2>/dev/null)" \
        || die "ACCESS_TOKEN_SIGNING_KEY must be an escaped PKCS8 PEM"
    grep -Eq 'ASN1 OID: prime256v1|NIST CURVE: P-256' <<<"$signing_curve" \
        || die "ACCESS_TOKEN_SIGNING_KEY must be an ES256 P-256 key"
    verification="$(env_get ACCESS_TOKEN_VERIFICATION_KEYS "$BOE_EFFECTIVE_ENV")"
    jq -e --arg kid "$kid" 'type == "object" and (.[$kid] | type == "string" and length > 0)' \
        <<<"$verification" >/dev/null 2>&1 \
        || die "ACCESS_TOKEN_VERIFICATION_KEYS must contain the current kid"
    public_key="$(jq -r --arg kid "$kid" '.[$kid]' <<<"$verification")"
    public_curve="$(printf '%s' "$public_key" | openssl pkey -pubin -text_pub -noout 2>/dev/null)" \
        || die "ACCESS_TOKEN_VERIFICATION_KEYS contains an invalid public PEM"
    grep -Eq 'ASN1 OID: prime256v1|NIST CURVE: P-256' <<<"$public_curve" \
        || die "ACCESS_TOKEN_VERIFICATION_KEYS must contain an ES256 P-256 key"
    signing_hash="$(printf '%b' "$signing" | openssl pkey -pubout -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
    public_hash="$(printf '%s' "$public_key" | openssl pkey -pubin -pubout -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
    [[ "$signing_hash" == "$public_hash" ]] \
        || die "ACCESS_TOKEN_SIGNING_KEY does not match the current verification key"
}

boe_validate_app_policy() {
    local issuer allowlist origin provider smtp_host smtp_port smtp_secure smtp_user smtp_password from_address apk_base expected_apk_base seed_enabled key value
    local -a origins
    issuer="$(env_get ACCESS_TOKEN_ISSUER "$BOE_EFFECTIVE_ENV")"
    [[ "$issuer" == https://* ]] || die "ACCESS_TOKEN_ISSUER must use https://"
    for key in PUBLIC_API_BASE_URL CORS_ORIGIN; do
        value="$(env_get "$key" "$BOE_EFFECTIVE_ENV")"
        [[ "$value" == https://* ]] || die "$key must use https://"
    done
    for key in BACKEND_PORT APP_FRONTEND_PORT ADMIN_FRONTEND_PORT; do
        value="$(env_get "$key" "$BOE_EFFECTIVE_ENV")"
        [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 )) \
            || die "$key must be an integer from 1 to 65535"
    done
    value="$(env_get POSTGRES_PASSWORD "$BOE_EFFECTIVE_ENV")"
    [[ "$value" =~ ^[A-Za-z0-9._~-]{24,}$ ]] \
        || die "POSTGRES_PASSWORD must be at least 24 URL-safe characters (A-Z, a-z, 0-9, . _ ~ -)"
    # These become SQL identifiers in the restore path (DROP/CREATE DATABASE),
    # so they must never carry quotes, spaces, or punctuation.
    for key in POSTGRES_USER POSTGRES_DB; do
        value="$(env_get "$key" "$BOE_EFFECTIVE_ENV")"
        [[ "$value" =~ ^[A-Za-z0-9_]+$ ]] \
            || die "$key must match ^[A-Za-z0-9_]+$ (it is used as a SQL identifier)"
    done
    [[ "$(env_get WEB_COOKIE_SECURE "$BOE_EFFECTIVE_ENV")" == "true" ]] \
        || die "WEB_COOKIE_SECURE must be true"
    allowlist="$(env_get WEB_ORIGIN_ALLOWLIST "$BOE_EFFECTIVE_ENV")"
    IFS=',' read -r -a origins <<<"$allowlist"
    for origin in "${origins[@]}"; do
        [[ "$origin" == https://* && "$origin" != *' '* ]] \
            || die "every WEB_ORIGIN_ALLOWLIST entry must be an unspaced https:// origin"
    done
    # `https://localhost` is the Android APK's own content origin: Capacitor
    # serves the bundle over androidScheme=https, so every request from the
    # client and admin APKs carries `Origin: https://localhost`. CORS reflects
    # only explicitly listed origins, so omitting it makes the entire APK appear
    # offline against a backend that is otherwise healthy.
    #
    # A warning rather than a hard failure: a backend that serves no APK has no
    # reason to allow it. An equivalent check existed in the retired deploy
    # script and was lost in this rewrite.
    case ",$allowlist," in
        *,https://localhost,*) : ;;
        *) warn "WEB_ORIGIN_ALLOWLIST does not include https://localhost — APK requests will be blocked by CORS" ;;
    esac
    provider="$(env_get PAYMENT_PROVIDER "$BOE_EFFECTIVE_ENV")"
    [[ -z "$provider" || "$provider" == "manual" ]] \
        || boe_assert_env_keys PHONEPE_CLIENT_ID PHONEPE_CLIENT_SECRET PHONEPE_CLIENT_VERSION \
            PHONEPE_ENV PHONEPE_CALLBACK_USERNAME PHONEPE_CALLBACK_PASSWORD
    smtp_host="$(env_get EMAIL_SMTP_HOST "$BOE_EFFECTIVE_ENV")"
    smtp_port="$(env_get EMAIL_SMTP_PORT "$BOE_EFFECTIVE_ENV")"
    smtp_secure="$(env_get EMAIL_SMTP_SECURE "$BOE_EFFECTIVE_ENV")"
    smtp_user="$(env_get EMAIL_SMTP_USER "$BOE_EFFECTIVE_ENV")"
    smtp_password="$(env_get EMAIL_SMTP_PASSWORD "$BOE_EFFECTIVE_ENV")"
    from_address="$(env_get KYC_EMAIL_FROM "$BOE_EFFECTIVE_ENV")"
    [[ "$smtp_host" == "smtppro.zoho.in" ]] || die "EMAIL_SMTP_HOST must be smtppro.zoho.in"
    [[ "$smtp_port" == "465" ]] || die "EMAIL_SMTP_PORT must be 465"
    [[ "$smtp_secure" == "true" ]] || die "EMAIL_SMTP_SECURE must be true"
    [[ "$from_address" == "$smtp_user" ]] || die "KYC_EMAIL_FROM must equal EMAIL_SMTP_USER"
    apk_base="$(env_get APK_DOWNLOAD_BASE_URL "$BOE_EFFECTIVE_ENV")"
    if [[ "${P[environment]}" == "production" ]]; then
        expected_apk_base="https://app.beonedge.in/downloads"
    else
        expected_apk_base="https://dev-app.beonedge.in/downloads"
    fi
    [[ "$apk_base" == "$expected_apk_base" ]] \
        || die "APK_DOWNLOAD_BASE_URL must be $expected_apk_base"
    [[ "$(env_get KYC_CODE_MAX_ATTEMPTS "$BOE_EFFECTIVE_ENV")" == "5" ]] \
        || die "KYC_CODE_MAX_ATTEMPTS must be 5"
    seed_enabled="$(env_get SEED_AUTH_ENABLED "$BOE_EFFECTIVE_ENV")"
    [[ "$seed_enabled" == "false" ]] || boe_assert_env_keys ADMIN_LOGIN_ID ADMIN_PASSWORD
    if [[ "${P[environment]}" == "production" ]]; then
        [[ "$(env_get SEED_AUTH_OVERWRITE "$BOE_EFFECTIVE_ENV")" != "true" ]] \
            || die "SEED_AUTH_OVERWRITE must not be true in production"
    fi
}

# Archive the currently published APKs of every configured variant into that
# variant's own rollback directory before they can be replaced (plan §18 step
# 12). Routing comes from the contract's explicit apk.destinations[] — never
# from array position or a directory basename.
boe_deploy_archive_apks() {
    local current="$1" variant current_dir rollback_dir dest count=0
    [[ -n "$current" ]] || { info "no current version — no APKs to preserve"; return 0; }

    local any=false
    while IFS=$'\t' read -r variant current_dir rollback_dir; do
        [[ -n "$current_dir" && -d "$current_dir" ]] || continue
        compgen -G "$current_dir/*.apk" >/dev/null 2>&1 || continue
        any=true
    done < <(boe_apk_destinations)

    [[ "$any" == true ]] || { info "no APK artifacts published yet"; return 0; }

    while IFS=$'\t' read -r variant current_dir rollback_dir; do
        [[ -n "$current_dir" && -d "$current_dir" ]] || continue
        compgen -G "$current_dir/*.apk" >/dev/null 2>&1 || continue
        dest="$rollback_dir/pre-deploy-$current"
        boe_assert_writable "$dest"
        # Copy only regular files — never dereference symlinks, matching the
        # standalone archiver in lib/apk_ship.sh (fail-closed artifact rule).
        local f
        for f in "$current_dir"/*.apk "$current_dir"/*.json; do
            [[ -f "$f" && ! -L "$f" ]] || continue
            cp -p -- "$f" "$dest/" 2>/dev/null || true
        done
        ( cd "$dest" && find . -name '*.apk' -exec sha256sum {} + > checksums.sha256 2>/dev/null ) || true
        count=$(( count + 1 ))
    done < <(boe_apk_destinations)
    ok "preserved APKs from $count variant directory(ies) before deploy"
}

# Application-level smoke tests (plan §18 steps 18-21). Ports are read from the
# effective env so they always match what compose actually published.
#
# NOTE ON PATHS: the backend's real routes are /health/live and /health/ready
# (no /api prefix). Public traffic reaches them as /api/health/... because nginx
# strips the prefix. Probing here is direct-to-loopback, so no prefix is used.
boe_deploy_smoke_tests() {
    local backend_port app_port admin_port rc=0
    backend_port="$(env_get BACKEND_PORT "$BOE_EFFECTIVE_ENV")"
    app_port="$(env_get APP_FRONTEND_PORT "$BOE_EFFECTIVE_ENV")"
    admin_port="$(env_get ADMIN_FRONTEND_PORT "$BOE_EFFECTIVE_ENV")"

    [[ -n "$backend_port" ]] && { wait_http "http://127.0.0.1:${backend_port}/health/ready" 30 2 || rc=1; }
    [[ -n "$app_port"     ]] && { wait_http "http://127.0.0.1:${app_port}/"                 20 2 || rc=1; }
    [[ -n "$admin_port"   ]] && { wait_http "http://127.0.0.1:${admin_port}/"               20 2 || rc=1; }
    return $rc
}

# boe_deploy_fail <previous> <attempted> <reason> — mark the release failed and
# attempt an automatic application-level rollback.
#
# A failed deploy must not rewrite history: the version record keeps .version
# pointing at the previous release and records the attempted one in
# last_attempted, so a retry is not told the failed version is "already
# deployed" and rollback state stays consistent.
#
# Deliberately does NOT restore the database: a failed application deploy should
# trigger an application rollback, not silently discard committed transactions
# (plan §20.2). Database restore stays an explicit, separate operation.
boe_deploy_fail() {
    local previous="$1" attempted="$2" reason="$3"
    warn "deployment failed: $reason"
    compose logs --tail 40 2>/dev/null || true

    if [[ -z "$previous" ]]; then
        boe_write_version "" "" failed "$attempted"
        die "deployment failed and there is no previous version to restore"
    fi

    local rb="${P[rollback_images]}/$previous"
    if [[ ! -d "$rb" ]]; then
        boe_write_version "$previous" "" failed "$attempted"
        die "deployment failed and no rollback archive exists at $rb"
    fi

    if [[ "${P[has_database]}" == "true" ]] \
        && boe_rollback_requires_database_restore "$attempted" "$previous"; then
        # Migrations already ran before health checking. Starting the previous
        # image here would cross the destructive migration-025 boundary without
        # restoring its database. Stop every current consumer and leave only
        # Postgres available for the explicit manual restore workflow.
        local service
        local -a consumers=()
        while IFS= read -r service; do
            [[ -n "$service" && "$service" != "postgres" ]] && consumers+=("$service")
        done < <(compose config --services)
        (( ${#consumers[@]} == 0 )) || compose stop "${consumers[@]}" >/dev/null 2>&1 || true
        boe_write_version "$previous" "" failed "$attempted"
        die "deployment failed ($reason) after migration 025; automatic image-only rollback to $previous is unsafe. Run the manual rollback with --restore-db"
    fi

    step "AUTO-ROLLBACK to $previous"
    # Never load an archive that fails integrity verification, and never start
    # a half-loaded rollback: any load failure aborts the auto-rollback.
    boe_rollback_verify "$rb"
    local key archive port path
    while IFS=$'\t' read -r key archive port; do
        path="$rb/$archive"
        if [[ ! -f "$path" ]]; then
            boe_write_version "$previous" "" failed "$attempted"
            die "deployment failed ($reason) and rollback archive is missing $archive — auto-rollback aborted"
        fi
        if ! gzip -dc "$path" | "$(docker_bin)" image load >/dev/null 2>&1; then
            boe_write_version "$previous" "" failed "$attempted"
            die "deployment failed ($reason) and rollback archive $archive would not load — auto-rollback aborted"
        fi
        info "restored $archive"
    done < <(boe_images)

    [[ -f "$rb/${P[compose_name]}" ]] && cp "$rb/${P[compose_name]}" "${P[compose_file]}"

    BOE_VERSION_FOR_COMPOSE="$previous"
    if compose up -d --remove-orphans >/dev/null 2>&1; then
        if boe_wait_compose_healthy 30; then
            boe_write_version "$previous" "$attempted" "rolled-back"
            boe_update_registry "$previous"
            die "deployment failed ($reason) — automatically rolled back to $previous"
        fi
    fi

    boe_write_version "$previous" "" failed "$attempted"
    die "deployment failed ($reason) AND automatic rollback did not come up healthy — manual intervention required"
}
