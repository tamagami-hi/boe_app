#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ⚠  DEPRECATED — DO NOT SOURCE THIS FILE. Superseded by lib/stacks.sh.
#
# Kept only as a record of the previous two-channel pipeline. Nothing in the
# current tooling reads it. Sourcing it would actively break a deployment:
#
#   • Its paths are wrong. It maps dev → /srv/dev_stack/BOE_APP and
#     prod → /srv/prod_stack/BOE_APP. The real layout is three stacks under one
#     parent: /srv/dev_stack/BOE_APP/{dev_release,prod_release,monitor_service},
#     and /srv/prod_stack does not exist on the VPS at all.
#   • It has no concept of the monitoring stack.
#   • SHIP_DOCKER defaults to "sudo docker", but the VPS has no passwordless
#     sudo — every remote command would block waiting for a password.
#   • Sourcing it MUTATES the caller's PG_CONTAINER as an import side effect.
#     That was a live bug: a local deploy would probe boe-dev-postgres while
#     compose had created boe-postgres, so the pre-deploy database dump was
#     silently skipped and rollback snapshots came out image-only.
#
# Use lib/stacks.sh instead: resolve_stack, stack_dir, stack_attr, boe_ssh.
# ─────────────────────────────────────────────────────────────────────────────
#
# ── original header, for reference ──────────────────────────────────────────
# ship.sh — the ONE definition of where BeOnEdge deploys.
#
# Sourced by deploy.sh (which ships) and status.sh (which reports what is live),
# so the two can never disagree about the target. The self-contained runners that
# execute ON the VPS deliberately do not depend on this file.
#
# The target is an SSH alias, not a user@host pair:
#
#     ssh beonedge          →  ~/.ssh/config supplies HostName, User and IdentityFile
#
# That indirection is the point. The host is reachable over a private tailnet
# address today; if it moves, one line of ~/.ssh/config changes and every release
# script follows. Nothing here hardcodes an IP, and no key path is required on the
# command line — although one may still be passed for a host that has no alias.
#
# TWO CHANNELS on one host, fully isolated from each other:
#
#   dev   /srv/dev_stack/BOE_APP    any build, no gate — your own testing over the
#                                   public internet. Container prefix `boe-dev`,
#                                   its own ports, its own database volume.
#   prod  /srv/prod_stack/BOE_APP   what clients use. Gated: the artifact must be a
#                                   stable X.Y.Z whose commit matches origin/main.
#
# Isolation is what makes shipping an untested dev build safe: separate compose
# project, separate container names, separate host ports and — crucially — a
# separate pgdata volume, so a dev deploy can never touch client data.
#
#     <dir>.next / <dir>.previous    staging + the release a swap replaced
#
# /srv is root-owned, so the parent directory is bootstrapped once (mkdir + chown
# to the SSH user) and every later step runs unprivileged. Only Docker itself is
# invoked through sudo.
#
# Override any of these from the environment, or from release_manager/.env:
#     SHIP_SSH_ALIAS  SHIP_CHANNEL  SHIP_REMOTE_DIR  SHIP_DOCKER  SHIP_KEY
# ─────────────────────────────────────────────────────────────────────────────

# Optional file-based overrides (never committed): release_manager/.env.
_ship_env_file() {
    local lib_dir
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    printf '%s/.env' "$(cd "$lib_dir/.." && pwd)"
}

# ship_config <KEY> — environment wins, then release_manager/.env, else empty.
ship_config() {
    local key="$1" value="${!1:-}" env_file
    env_file="$(_ship_env_file)"
    if [[ -z "$value" && -f "$env_file" ]]; then
        value="$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1 | tr -d '\r')"
    fi
    printf '%s' "$value"
}

# ── the target ───────────────────────────────────────────────────────────────
SHIP_SSH_ALIAS="$(ship_config SHIP_SSH_ALIAS)"; SHIP_SSH_ALIAS="${SHIP_SSH_ALIAS:-beonedge}"
SHIP_DOCKER="$(ship_config SHIP_DOCKER)"; SHIP_DOCKER="${SHIP_DOCKER:-sudo docker}"
SHIP_KEY="$(ship_config SHIP_KEY)"

# Captured ONCE, before any channel is applied: ship_use_channel assigns
# SHIP_REMOTE_DIR, so re-reading it later would mistake its own output for an
# operator override and pin the first channel forever.
SHIP_REMOTE_DIR_OVERRIDE="$(ship_config SHIP_REMOTE_DIR)"

# dev is the default so the easy command is the safe one: `--ship` touches your
# test stack, and reaching clients takes the explicit word `prod`.
SHIP_CHANNEL="$(ship_config SHIP_CHANNEL)"; SHIP_CHANNEL="${SHIP_CHANNEL:-dev}"

# ship_use_channel <dev|prod> — set the channel and everything derived from it.
ship_use_channel() {
    local channel="$1"
    case "$channel" in
        dev|prod) SHIP_CHANNEL="$channel" ;;
        *) printf 'Unknown channel: %s (expected dev or prod)\n' "$channel" >&2; return 1 ;;
    esac

    # An explicit SHIP_REMOTE_DIR always wins; otherwise it follows the channel.
    if [[ -n "${SHIP_REMOTE_DIR_OVERRIDE:-}" ]]; then
        SHIP_REMOTE_DIR="$SHIP_REMOTE_DIR_OVERRIDE"
    elif [[ "$channel" == prod ]]; then
        SHIP_REMOTE_DIR="/srv/prod_stack/BOE_APP"
    else
        SHIP_REMOTE_DIR="/srv/dev_stack/BOE_APP"
    fi

    # Only prod is gated. Shipping a dirty dev build to the dev stack is the whole
    # point of having a dev stack.
    if [[ "$channel" == prod ]]; then
        SHIP_REQUIRE_STABLE=true
        SHIP_CONTAINER_PREFIX="boe"
        SHIP_COMPOSE_PROJECT="boe_prod"
    else
        SHIP_REQUIRE_STABLE=false
        SHIP_CONTAINER_PREFIX="boe-dev"
        SHIP_COMPOSE_PROJECT="boe_dev"
    fi
    # deploy.sh talks to Postgres by container name when it pulls/seeds the DB.
    PG_CONTAINER="${SHIP_CONTAINER_PREFIX}-postgres"
}
ship_use_channel "$SHIP_CHANNEL"

# ship_remote — the SSH destination. An explicit user@host (SHIP_USER/SHIP_HOST,
# kept for hosts without an alias) takes precedence over the alias.
ship_remote() {
    local user host
    user="$(ship_config SHIP_USER)"
    host="$(ship_config SHIP_HOST)"
    if [[ -n "$host" ]]; then
        [[ -n "$user" ]] && printf '%s@%s' "$user" "$host" || printf '%s' "$host"
    else
        printf '%s' "$SHIP_SSH_ALIAS"
    fi
}

# ship_ssh_opts — fills the SHIP_SSH_OPTS array with the options every SSH/SCP
# call should carry. BatchMode keeps a missing key from hanging on a password
# prompt inside a script; a key is only passed when one was supplied, otherwise
# the alias's IdentityFile is used.
ship_ssh_opts() {
    SHIP_SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
    if [[ -n "$SHIP_KEY" ]]; then
        [[ -f "$SHIP_KEY" ]] || { printf 'SSH key not found: %s\n' "$SHIP_KEY" >&2; return 1; }
        SHIP_SSH_OPTS+=(-i "$SHIP_KEY" -o IdentitiesOnly=yes)
    fi
}

# assert_safe_remote_dir <dir> — refuse a path that would let a later `rm -rf`
# or a sibling `.next`/`.previous` land somewhere destructive.
assert_safe_remote_dir() {
    local dir="$1"
    [[ -n "$dir" ]] || { echo "SHIP_REMOTE_DIR is empty." >&2; return 1; }
    [[ "$dir" != *".."* ]] || { echo "SHIP_REMOTE_DIR must not contain '..': $dir" >&2; return 1; }
    [[ "$dir" =~ ^/[A-Za-z0-9_./-]+$ ]] || {
        echo "SHIP_REMOTE_DIR must be a safe absolute path: $dir" >&2; return 1;
    }
    # Depth 2 minimum (/srv/x), so the target can never be / or a top-level dir.
    [[ "$(tr -cd '/' <<<"${dir%/}" | wc -c)" -ge 2 ]] || {
        echo "SHIP_REMOTE_DIR is too shallow to be a deploy dir: $dir" >&2; return 1;
    }
    return 0
}

# ship_bootstrap_remote_dir <remote> — make the deploy dir and its parent usable
# by the SSH user. Idempotent, and it only escalates when it has to: if the
# directory is already writable, sudo is never invoked.
ship_bootstrap_remote_dir() {
    local remote="$1" parent
    parent="$(dirname "$SHIP_REMOTE_DIR")"
    ssh "${SHIP_SSH_OPTS[@]}" "$remote" \
        "bash -s -- $(printf '%q %q' "$SHIP_REMOTE_DIR" "$parent")" <<'REMOTE'
set -euo pipefail
deploy_dir="$1"
parent_dir="$2"
owner="$(id -un):$(id -gn)"

# The swap creates <dir>.next and <dir>.previous beside the deploy dir, so the
# PARENT has to be writable, not just the dir itself.
if [[ ! -w "$parent_dir" ]]; then
    sudo -n true 2>/dev/null || { echo "passwordless sudo is required once to create $parent_dir" >&2; exit 1; }
    sudo mkdir -p "$parent_dir"
    sudo chown "$owner" "$parent_dir"
fi
mkdir -p "$deploy_dir"
[[ -w "$deploy_dir" ]] || { echo "deploy dir is not writable by $(id -un): $deploy_dir" >&2; exit 1; }
printf 'remote layout ready: %s (owner %s)\n' "$deploy_dir" "$owner"
REMOTE
}
