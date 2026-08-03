#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# stacks.sh — the stack registry. THE single place that knows the three
# deployable stacks exist and where each one lives on the VPS.
#
# Replaces the old lib/ship.sh two-channel model (dev → /srv/dev_stack/BOE_APP,
# prod → /srv/prod_stack/BOE_APP), which was wrong on both paths and had no
# concept of a monitoring stack.
#
# Verified VPS layout this encodes (all three stacks share ONE parent):
#   /srv/dev_stack/BOE_APP/dev_release
#   /srv/dev_stack/BOE_APP/prod_release
#   /srv/dev_stack/BOE_APP/monitor_service
#
# Design rules enforced here:
#   • Nothing is hardcoded twice. Local scripts and VPS scripts both resolve
#     paths through the per-stack paths.json that this library generates.
#   • Sourcing this file has NO side effects beyond defining functions and
#     read-only constants. (The old ship.sh mutated PG_CONTAINER at import
#     time, which silently broke local DB dumps.)
#   • `docker`, never `sudo docker` — verified that the beonedge user is in the
#     docker group and that passwordless sudo is NOT available.
# ─────────────────────────────────────────────────────────────────────────────

# ── remote identity ─────────────────────────────────────────────────────────
# The SSH alias configured in ~/.ssh/config. Overridable for a second operator
# machine, but never guessed: no user, host, IP, or port is hardcoded.
BOE_SSH_ALIAS="${BOE_SSH_ALIAS:-beonedge}"

# Verified: `docker info` succeeds as beonedge (docker group), and `sudo -n`
# fails. Anything that prepends sudo here will hang waiting for a password.
BOE_DOCKER="${BOE_DOCKER:-docker}"

# Shared parent of all three stacks on the VPS.
BOE_VPS_ROOT="${BOE_VPS_ROOT:-/srv/dev_stack/BOE_APP}"

# Backup disk. Must be a real mountpoint before anything is written to it.
BOE_BACKUP_ROOT="${BOE_BACKUP_ROOT:-/srv/backup/BOE_APP}"
BOE_BACKUP_MOUNT="${BOE_BACKUP_MOUNT:-/srv/backup}"

# The three stack ids, in deploy-order preference.
BOE_STACKS=(dev_release prod_release monitor_service)

# ── stack attribute lookup ──────────────────────────────────────────────────
# stack_attr <stack> <attr> — echo one attribute, or return 1 if unknown.
#
# Attributes:
#   env             environment name (development|production|monitoring)
#   short           short id used in filenames and container prefixes
#   dir             absolute stack directory on the VPS
#   compose         compose filename inside the stack dir
#   version_file    per-stack version filename inside the stack dir
#   deploy          native deploy script filename
#   rollback        native rollback script filename
#   guide           guide filename
#   lock            absolute flock path
#   prefix          container name prefix
#   project         compose project name
#   rollback_root   backup subtree root for this stack
#   images_sub      rollback images subdirectory name
#   apk_sub         rollback APK subdirectory name
#   db_sub          rollback DB subdirectory name
#   log_sub         log subtree name
#   db_backup_sub   scheduled DB backup subtree name
#   apk_dirs        space-separated APK holder dirs inside the stack dir
#   keep            how many rollback releases to retain
#   has_db          true|false — does this stack own a postgres service
stack_attr() {
    local stack="$1" attr="$2"
    case "$stack" in
        dev_release)
            case "$attr" in
                env)           printf 'development\n' ;;
                short)         printf 'dev\n' ;;
                compose)       printf 'docker-compose.dev_app.yml\n' ;;
                version_file)  printf 'dev-version.json\n' ;;
                deploy)        printf 'dev_deploy.sh\n' ;;
                rollback)      printf 'dev_rollback.sh\n' ;;
                guide)         printf 'DEV_GUIDE.md\n' ;;
                prefix)        printf 'boe-dev\n' ;;
                project)       printf 'boe_dev\n' ;;
                rollback_root) printf '%s/DEV_ROLLBACK\n' "$BOE_BACKUP_ROOT" ;;
                images_sub)    printf 'DEPLOY_IMAGES\n' ;;
                apk_sub)       printf 'DEV_APK\n' ;;
                db_sub)        printf 'DEV_PSQL_DB\n' ;;
                log_sub)       printf 'DEV_LOGS\n' ;;
                log_prefix)    printf 'DEV_\n' ;;
                db_backup_sub) printf 'DEV\n' ;;
                apk_dirs)      printf 'dev_apk dev_admin_apk\n' ;;
                keep)          printf '3\n' ;;
                has_db)        printf 'true\n' ;;
                *) return 1 ;;
            esac ;;
        prod_release)
            case "$attr" in
                env)           printf 'production\n' ;;
                short)         printf 'prod\n' ;;
                compose)       printf 'docker-compose.prod_app.yml\n' ;;
                version_file)  printf 'release-version.json\n' ;;
                deploy)        printf 'prod_deploy.sh\n' ;;
                rollback)      printf 'prod_rollback.sh\n' ;;
                guide)         printf 'PROD_GUIDE.md\n' ;;
                prefix)        printf 'boe\n' ;;
                project)       printf 'boe_prod\n' ;;
                rollback_root) printf '%s/PROD_ROLLBACK\n' "$BOE_BACKUP_ROOT" ;;
                images_sub)    printf 'IMAGES\n' ;;
                apk_sub)       printf 'APK\n' ;;
                db_sub)        printf 'PSQL_DB\n' ;;
                log_sub)       printf 'PROD_LOGS\n' ;;
                log_prefix)    printf '\n' ;;
                db_backup_sub) printf 'PROD\n' ;;
                apk_dirs)      printf 'prod_apk admin_apk\n' ;;
                keep)          printf '5\n' ;;
                has_db)        printf 'true\n' ;;
                *) return 1 ;;
            esac ;;
        monitor_service)
            case "$attr" in
                env)           printf 'monitoring\n' ;;
                short)         printf 'ms\n' ;;
                compose)       printf 'docker-compose.monitor_service.yml\n' ;;
                version_file)  printf 'monitor_service-version.json\n' ;;
                deploy)        printf 'ms_deploy.sh\n' ;;
                rollback)      printf 'ms_rollback.sh\n' ;;
                guide)         printf 'MS_GUIDE.md\n' ;;
                prefix)        printf 'boe-ms\n' ;;
                project)       printf 'boe_monitor\n' ;;
                rollback_root) printf '%s/MONITOR_ROLLBACK\n' "$BOE_BACKUP_ROOT" ;;
                images_sub)    printf 'IMAGES\n' ;;
                apk_sub)       printf 'MS_APK\n' ;;
                db_sub)        printf 'PSQL_DB\n' ;;
                log_sub)       printf 'MONITOR_LOGS\n' ;;
                log_prefix)    printf '\n' ;;
                db_backup_sub) printf 'MONITOR\n' ;;
                apk_dirs)      printf 'ms_apk\n' ;;
                keep)          printf '3\n' ;;
                has_db)        printf 'false\n' ;;
                *) return 1 ;;
            esac ;;
        *) return 1 ;;
    esac
    # dir/lock are uniform across stacks; handled after the case for brevity.
}

# Uniform attributes that derive from the stack id.
stack_dir()  { printf '%s/%s\n' "$BOE_VPS_ROOT" "$1"; }
stack_lock() { printf '/run/lock/boe-%s.lock\n' "$1"; }

# is_stack <candidate> — true if the argument names a real stack.
is_stack() {
    local s
    for s in "${BOE_STACKS[@]}"; do [[ "$s" == "$1" ]] && return 0; done
    return 1
}

# resolve_stack <selector> — map user-facing flags onto a canonical stack id.
#   --dev  | dev  | dev_release      → dev_release
#   --prod | prod | prod_release     → prod_release
#   --monitor | ms | monitor_service → monitor_service
resolve_stack() {
    case "${1:-}" in
        --dev|dev|dev_release)                 printf 'dev_release\n' ;;
        --prod|prod|production|prod_release)   printf 'prod_release\n' ;;
        --monitor|monitor|ms|monitor_service)  printf 'monitor_service\n' ;;
        *) printf 'Unknown stack selector: %s\n' "${1:-<empty>}" >&2
           printf 'Expected one of: --dev  --prod  --monitor\n' >&2
           return 1 ;;
    esac
}

# ── image set per stack ─────────────────────────────────────────────────────
# stack_images <stack> — echo one "key:archive:container_port" triple per line.
#
# Verified against the real source tree:
#   backend  → backend_controller/Dockerfile,               listens 47502
#   landing  → frontend_stack/packages/landing_page/,       listens 3100
#   app      → frontend_stack/app/ (VITE_BEO_APP_TARGET=client), nginx :8080
#   admin    → frontend_stack/app/ (VITE_BEO_APP_TARGET=admin),  nginx :8080
#
# `app` and `admin` are two builds of the SAME Dockerfile. VITE_BEO_APP_TARGET
# selects the client or admin bundle at build time; the runtime serves either
# static artifact as non-root nginx on port 8080.
stack_images() {
    case "$1" in
        dev_release|prod_release)
            printf 'backend:backend.tar.gz:47502\n'
            printf 'landing:landing.tar.gz:3100\n'
            printf 'app:app.tar.gz:8080\n'
            printf 'admin:admin.tar.gz:8080\n'
            ;;
        monitor_service)
            # The monitoring stack runs upstream images only (prometheus,
            # grafana, exporters). Nothing is built from this repo yet, so it
            # ships no tarballs — ms_deploy.sh pulls pinned upstream tags.
            ;;
        *) return 1 ;;
    esac
}

# stack_image_tag <stack> <key> <version> — the fully qualified local image tag.
# Dev and prod get distinct repositories so a dev image can never satisfy a prod
# compose reference even if the version string collides.
stack_image_tag() {
    local stack="$1" key="$2" version="$3" short
    short="$(stack_attr "$stack" short)" || return 1
    case "$stack" in
        prod_release) printf 'boe-prod-%s:%s\n' "$key" "$version" ;;
        dev_release)  printf 'boe-dev-%s:%s\n'  "$key" "$version" ;;
        *)            printf 'boe-%s-%s:%s\n' "$short" "$key" "$version" ;;
    esac
}

# ── ssh plumbing ────────────────────────────────────────────────────────────
# boe_ssh_opts — populate the BOE_SSH_OPTS array. BatchMode so a missing key
# fails fast instead of prompting and hanging a script.
boe_ssh_opts() {
    BOE_SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
    if [[ -n "${BOE_SSH_KEY:-}" ]]; then
        BOE_SSH_OPTS+=(-i "$BOE_SSH_KEY" -o IdentitiesOnly=yes)
    fi
}

# boe_ssh <args...> — run a command on the VPS.
boe_ssh() {
    boe_ssh_opts
    ssh "${BOE_SSH_OPTS[@]}" "$BOE_SSH_ALIAS" "$@"
}

# boe_scp <local> <remote-abs-path> — copy one file to the VPS.
boe_scp() {
    boe_ssh_opts
    scp -q "${BOE_SSH_OPTS[@]}" "$1" "${BOE_SSH_ALIAS}:$2"
}

# assert_safe_remote_dir <path> — refuse to operate on a path that could
# plausibly be the filesystem root or escape via traversal. Keeps a later
# `rm -rf "$dir/something"` from becoming catastrophic.
assert_safe_remote_dir() {
    local dir="${1:-}"
    [[ -n "$dir" ]]                      || { printf 'Refusing empty remote dir\n' >&2; return 1; }
    [[ "$dir" != *".."* ]]               || { printf 'Refusing remote dir with ..: %s\n' "$dir" >&2; return 1; }
    [[ "$dir" =~ ^/[A-Za-z0-9_./-]+$ ]]  || { printf 'Refusing unsafe remote dir: %s\n' "$dir" >&2; return 1; }
    # Require depth >= 3 (/srv/dev_stack/BOE_APP/<stack>) so a truncated
    # variable can never resolve to /srv or /.
    local depth; depth="$(printf '%s' "${dir//[!\/]/}" | wc -c)"
    (( depth >= 3 )) || { printf 'Refusing shallow remote dir: %s\n' "$dir" >&2; return 1; }
}
