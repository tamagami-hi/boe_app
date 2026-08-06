#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# stacks.sh — the stack registry. THE single place that knows the three
# deployable stacks exist, how they are named, and how to reach the VPS.
#
# Replaces the old lib/ship.sh two-channel model, which was wrong on its paths
# and had no concept of a monitoring stack.
#
# AUTHORITY BOUNDARY (schema 3)
# This file owns stack IDENTITY only: stack ids, selector resolution, image
# naming rules, and non-path metadata (compose filename, container prefix,
# retention policy). It owns NO paths. Every deployment, backup, log, database,
# image, configuration and APK path lives in the stack's tracked paths.json
# contract and is read through lib/paths.sh (stack_paths_file, paths_validate,
# paths_get). A path change is a paths.json edit — never an edit here.
#
# Design rules enforced here:
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

# The three stack ids, in deploy-order preference.
BOE_STACKS=(dev_release prod_release monitor_service)

# ── stack attribute lookup ──────────────────────────────────────────────────
# stack_attr <stack> <attr> — echo one attribute, or return 1 if unknown.
#
# Only NON-PATH metadata lives here (identity and naming rules). Anything that
# is a filesystem path belongs to the stack's paths.json contract; ask for it
# with paths_get "$(stack_paths_file <stack>)" <query> after paths_validate.
#
# Attributes:
#   env             environment name (development|production|monitoring)
#   short           short id used in filenames and container prefixes
#   compose         compose filename inside the stack dir
#   version_file    per-stack version filename inside the stack dir
#   deploy          native deploy script filename
#   rollback        native rollback script filename
#   guide           guide filename
#   prefix          container name prefix
#   project         compose project name
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
                keep)          printf '3\n' ;;
                has_db)        printf 'false\n' ;;
                *) return 1 ;;
            esac ;;
        *) return 1 ;;
    esac
}

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
# BOE_SSH_ALIAS and BOE_SSH_KEY are operator-controlled environment values:
# validate them before they become ssh/scp argv, so a hostile value can never
# smuggle extra options (an alias like "-oProxyCommand=..." is just argv).
boe_ssh_opts() {
    if [[ ! "$BOE_SSH_ALIAS" =~ ^[A-Za-z0-9._-]+$ || "$BOE_SSH_ALIAS" == -* ]]; then
        printf 'boe_ssh_opts: unsafe BOE_SSH_ALIAS: %s\n' \
            "$(printf '%s' "$BOE_SSH_ALIAS" | LC_ALL=C tr -d '\000-\010\013-\037\177')" >&2
        return 1
    fi
    BOE_SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
    if [[ -n "${BOE_SSH_KEY:-}" ]]; then
        if [[ ! "$BOE_SSH_KEY" =~ ^[A-Za-z0-9._/~+-]+$ || "$BOE_SSH_KEY" == -* ]]; then
            printf 'boe_ssh_opts: unsafe BOE_SSH_KEY path: %s\n' \
                "$(printf '%s' "$BOE_SSH_KEY" | LC_ALL=C tr -d '\000-\010\013-\037\177')" >&2
            return 1
        fi
        BOE_SSH_OPTS+=(-i "$BOE_SSH_KEY" -o IdentitiesOnly=yes)
    fi
}

# boe_ssh <args...> — run a command on the VPS.
boe_ssh() {
    boe_ssh_opts || return 1
    ssh "${BOE_SSH_OPTS[@]}" "$BOE_SSH_ALIAS" "$@"
}

# assert_safe_remote_dir <path> — refuse to operate on a path that could
# plausibly be the filesystem root or escape via traversal. Keeps a later
# `rm -rf "$dir/something"` from becoming catastrophic.
assert_safe_remote_dir() {
    local dir="${1:-}"
    # Rejected values are untrusted: strip control bytes before printing so a
    # hostile path cannot forge or overwrite the refusal message.
    local shown
    shown="$(printf '%s' "$dir" | LC_ALL=C tr -d '\000-\010\013-\037\177')"
    [[ -n "$dir" ]]                      || { printf 'Refusing empty remote dir\n' >&2; return 1; }
    [[ "$dir" != *".."* ]]               || { printf 'Refusing remote dir with ..: %s\n' "$shown" >&2; return 1; }
    [[ "$dir" =~ ^/[A-Za-z0-9_./-]+$ ]]  || { printf 'Refusing unsafe remote dir: %s\n' "$shown" >&2; return 1; }
    # Require depth >= 3 so a truncated variable can never resolve to a
    # top-level directory.
    local depth; depth="$(printf '%s' "${dir//[!\/]/}" | wc -c)"
    (( depth >= 3 )) || { printf 'Refusing shallow remote dir: %s\n' "$shown" >&2; return 1; }
}
