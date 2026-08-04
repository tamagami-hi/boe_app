#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# _boe_lib.sh — shared runtime library for the BOE_APP VPS-native scripts.
#
# This file runs ON THE VPS. It is shipped into each stack directory alongside
# that stack's deploy/rollback scripts, so a stack folder is self-sufficient:
# given only SSH access you can deploy or roll back with no source tree present.
#
# EVERY docker command in the pipeline lives in this file or its callers. The
# operator machine never runs docker against the VPS — it only ships tarballs
# and invokes these scripts. That separation is a hard requirement.
#
# All paths come from the stack's paths.json contract (schema 3 — see
# release_manager/lib/paths.sh). Nothing here hardcodes or derives a directory.
#
# Verified environment assumptions (checked on beonedge-vps, Ubuntu 26.04):
#   • docker 29.1.3 + compose v5.3.1, usable WITHOUT sudo
#   • sudo -n is NOT available — never prepend sudo to anything
#   • jq sha256sum flock mountpoint numfmt gzip tar curl are all present
#   • /run/lock is writable by the deploying user
#   • the backup disk is a real mountpoint
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── output ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    _c_bold=$'\033[1m'; _c_dim=$'\033[2m'; _c_grn=$'\033[32m'
    _c_yel=$'\033[33m'; _c_red=$'\033[31m'; _c_cyn=$'\033[36m'; _c_rst=$'\033[0m'
else
    _c_bold=''; _c_dim=''; _c_grn=''; _c_yel=''; _c_red=''; _c_cyn=''; _c_rst=''
fi

# Every message is also appended to the stack's deploy log when logging is armed.
BOE_LOG_FILE="${BOE_LOG_FILE:-}"

_emit() {
    printf '%s\n' "$1"
    if [[ -n "$BOE_LOG_FILE" ]]; then
        printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$2" | tr -d '\r')" \
            >> "$BOE_LOG_FILE" 2>/dev/null || true
    fi
}

log()   { _emit "$(printf '%s==>%s %s' "$_c_cyn" "$_c_rst" "$*")" "INFO  $*"; }
ok()    { _emit "$(printf '  %s✓%s %s'  "$_c_grn" "$_c_rst" "$*")" "OK    $*"; }
warn()  { _emit "$(printf '  %s!%s %s'  "$_c_yel" "$_c_rst" "$*")" "WARN  $*"; }
info()  { _emit "$(printf '  %s%s%s'    "$_c_dim" "$*"      "$_c_rst")" "INFO  $*"; }
step()  { _emit "$(printf '%s--- %s%s'  "$_c_bold" "$*"     "$_c_rst")" "STEP  $*"; }

die() {
    _emit "$(printf '%serror:%s %s' "$_c_red" "$_c_rst" "$*")" "ERROR $*"
    exit 1
}

# ── prerequisite tools ──────────────────────────────────────────────────────
require_cmds() {
    local missing=() c
    for c in "$@"; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
    (( ${#missing[@]} == 0 )) || die "missing required commands: ${missing[*]}"
}

# ── paths.json access ───────────────────────────────────────────────────────
# Populated by boe_load_paths. Every subsequent function reads these, never a
# literal path.
declare -A P=()

# _boe_safe_abs <path> — absolute, normalized, shell-safe remote path. The
# contract was validated before shipping; this is the fail-closed recheck on
# the values this runtime is about to interpolate into shell commands.
_boe_safe_abs() {
    local p="$1"
    [[ "$p" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
    [[ "$p" != *'//'* && "$p" != */ ]] || return 1
    [[ "$p" != *'..'* ]] || return 1
    return 0
}

boe_load_paths() {
    local file="$1" schema
    [[ -f "$file" ]] || die "paths.json not found: $file"
    [[ ! -L "$file" ]] || die "paths.json must not be a symlink: $file"
    jq empty "$file" 2>/dev/null || die "paths.json is not valid JSON: $file"
    schema="$(jq -r '.schema // 0' "$file")"
    [[ "$schema" == "3" ]] \
        || die "unsupported paths.json schema $schema — ship a current release bundle"

    local k v
    # Flatten the keys the runtime needs into the associative array P.
    while IFS=$'\t' read -r k v; do
        P["$k"]="$v"
    done < <(jq -r '
        [
          ["stack",            .stack],
          ["environment",      .environment],
          ["short",            .short],
          ["stack_dir",        .vps.stack_dir],
          ["images_dir",       .vps.images_dir],
          ["compose_file",     .vps.compose_file],
          ["compose_name",     .vps.compose_name],
          ["env_file",         .vps.env_file],
          ["env_example",      .vps.env_example],
          ["version_file",     .vps.version_file],
          ["version_name",     .vps.version_name],
          ["manifest_file",    .vps.manifest_file],
          ["checksums_file",   .vps.checksums_file],
          ["registry",         .vps.registry],
          ["database_dir",     (.vps.database_dir // "")],
          ["config_dir",       (.vps.config_dir // "")],
          ["docker",           .vps.docker],
          ["container_prefix", .vps.container_prefix],
          ["compose_project",  .vps.compose_project],
          ["lock_file",        .vps.lock_file],
          ["backup_mount",     .backup.mount_check],
          ["backup_root",      .backup.root],
          ["rollback_root",    .backup.rollback_root],
          ["rollback_images",  .backup.rollback_images],
          ["rollback_apk",     .backup.rollback_apk],
          ["rollback_db",      .backup.rollback_db],
          ["db_backups",       .backup.db_backups],
          ["deploy_log",       .backup.deploy_log],
          ["image_log",        .backup.image_log],
          ["db_log",           .backup.db_log],
          ["has_database",     (.has_database|tostring)],
          ["keep_releases",    (.retention.keep_releases|tostring)]
        ] | .[] | @tsv' "$file")

    BOE_PATHS_FILE="$file"
    [[ -n "${P[stack_dir]:-}" ]] || die "paths.json missing vps.stack_dir"

    # Recheck every path value before it is interpolated into a command.
    local path_keys=(stack_dir images_dir compose_file env_file env_example
        version_file manifest_file checksums_file registry lock_file
        backup_mount backup_root rollback_root rollback_images rollback_apk
        rollback_db db_backups deploy_log image_log db_log
        database_dir config_dir)
    for k in "${path_keys[@]}"; do
        v="${P[$k]:-}"
        [[ -z "$v" ]] && continue
        _boe_safe_abs "$v" || die "unsafe path in paths.json at $k: $v"
    done

    # keep_releases is used in arithmetic by boe_prune_rollbacks; anything but
    # plain digits would be an arithmetic-evaluation hazard.
    [[ "${P[keep_releases]:-}" =~ ^[0-9]+$ ]] \
        || die "retention.keep_releases must be a non-negative integer in paths.json"
}

# boe_images — echo "key<TAB>archive<TAB>container_port" per image.
boe_images() {
    jq -r '.images[]? | [.key, .archive, (.container_port|tostring)] | @tsv' "$BOE_PATHS_FILE"
}

# boe_apk_destinations — echo "variant<TAB>current_dir<TAB>rollback_dir" per
# configured APK destination, routing by explicit variant only.
boe_apk_destinations() {
    local variant current_dir rollback_dir
    while IFS=$'\t' read -r variant current_dir rollback_dir; do
        [[ -n "$variant" ]] || continue
        _boe_safe_abs "$current_dir" && _boe_safe_abs "$rollback_dir" \
            || die "unsafe APK destination in paths.json for variant $variant"
        printf '%s\t%s\t%s\n' "$variant" "$current_dir" "$rollback_dir"
    done < <(jq -r '.apk.destinations[]? | [.variant, .current_dir, .rollback_dir] | @tsv' "$BOE_PATHS_FILE")
}

# ── locking (plan §18: deploy and rollback share one lock) ──────────────────
boe_lock() {
    local lock="${P[lock_file]}"
    # fd 9 is held for the lifetime of the script; the kernel releases it on exit.
    exec 9>"$lock" || die "cannot open lock file: $lock"
    if ! flock -n 9; then
        die "another deploy or rollback is already running for ${P[stack]} (lock: $lock)"
    fi
    ok "acquired deployment lock"
}

# ── backup disk safety (plan §32) ───────────────────────────────────────────
# Without this, an unmounted backup disk silently writes to the root filesystem
# and the "backups" vanish the moment the disk is remounted.
boe_assert_backup_mounted() {
    local mp="${P[backup_mount]}"
    mountpoint -q "$mp" || die "backup disk is not mounted at $mp — refusing to write backups"
    ok "backup disk mounted at $mp"
}

# boe_assert_writable <dir...> — verify each directory exists (creating it if
# the parent permits) and is writable by the current user.
#
# This is the check that surfaces the known backup-tree ownership problem as a
# clear message instead of a confusing mkdir failure halfway through a deploy.
boe_assert_writable() {
    local d
    for d in "$@"; do
        if [[ ! -d "$d" ]]; then
            mkdir -p "$d" 2>/dev/null || die "cannot create $d — check ownership of its parent (see OPERATOR_MANUAL_STEPS.md §1)"
        fi
        [[ -w "$d" ]] || die "$d is not writable by $(id -un) — see OPERATOR_MANUAL_STEPS.md §1"
    done
}

# ── disk space (plan §18 step 4) ────────────────────────────────────────────
# boe_assert_space <dir> <required_mib>
boe_assert_space() {
    local dir="$1" need_mib="$2" avail_mib
    avail_mib="$(df -BM --output=avail "$dir" 2>/dev/null | tail -n1 | tr -dc '0-9')"
    [[ -n "$avail_mib" ]] || die "could not determine free space on $dir — refusing to guess"
    if (( avail_mib < need_mib )); then
        die "insufficient space on $dir: ${avail_mib}MiB free, need ${need_mib}MiB"
    fi
    info "space on $dir: ${avail_mib}MiB free (need ${need_mib}MiB)"
}

# boe_required_space_mib — total size of the incoming archives, doubled to
# leave room for the outgoing images that get archived for rollback.
boe_required_space_mib() {
    local total=0 key archive port f sz
    while IFS=$'\t' read -r key archive port; do
        f="${P[images_dir]}/$archive"
        [[ -f "$f" ]] || continue
        sz="$(stat -c %s "$f" 2>/dev/null || echo 0)"
        total=$(( total + sz ))
    done < <(boe_images)
    # bytes → MiB, ×3 (new archive + loaded image + rollback copy), floor 512
    local mib=$(( total / 1048576 * 3 ))
    (( mib < 512 )) && mib=512
    printf '%s\n' "$mib"
}

# ── .env handling ───────────────────────────────────────────────────────────
# env_get <key> [file] — last assignment wins, CR stripped (survives CRLF files).
env_get() {
    local key="$1" file="${2:-${P[env_file]}}"
    [[ -f "$file" ]] || return 0
    sed -n "s/^${key}=//p" "$file" | tail -n1 | tr -d '\r'
}

# boe_compose_env — validate and select the stack-local .env for Compose.
#
# Each stack owns one authoritative .env. Release shipping excludes this file,
# and deploy/rollback only read it; release identity is injected into Compose
# separately and recorded in the version JSON.
BOE_EFFECTIVE_ENV=""

boe_build_effective_env() {
    local file="${P[env_file]}" mode owner group links duplicates invalid unsafe_syntax
    require_cmds stat dirname getfacl
    [[ ! -L "$file" && -f "$file" ]] \
        || die "missing or unsafe $file — create it from ${P[env_example]} (symlinks are not allowed)"
    [[ -s "$file" ]] || die "$file is empty — fill in every required value before deploying"
    [[ -r "$file" ]] || die "$file is not readable by $(id -un)"

    mode="$(stat -c '%a' "$file" 2>/dev/null || true)"
    owner="$(stat -c '%u' "$file" 2>/dev/null || true)"
    group="$(stat -c '%g' "$file" 2>/dev/null || true)"
    links="$(stat -c '%h' "$file" 2>/dev/null || true)"
    [[ "$links" == "1" ]] || die "$file must not have hard links"
    if [[ "$owner" == "$(id -u)" ]]; then
        [[ "$mode" == "600" ]] || die "$file must have mode 600 when owned by $(id -un) (found $mode)"
    elif [[ "$owner" == "0" ]]; then
        [[ "$mode" == "640" ]] || die "$file must have mode 640 when root-owned (found $mode)"
        [[ "$group" == "$(id -g)" ]] || die "$file must use deploy group $(id -gn) when root-owned"
    else
        die "$file must be owned by $(id -un) or root"
    fi

    invalid="$(awk '!/^[[:space:]]*($|#)/ && !/^[A-Za-z_][A-Za-z0-9_]*=.*/ { print NR; exit }' "$file")"
    [[ -z "$invalid" ]] || die "$file has an invalid entry on line $invalid"
    unsafe_syntax="$(awk -F= '
        /^[A-Za-z_][A-Za-z0-9_]*=/ {
            value = substr($0, index($0, "=") + 1)
            first = substr(value, 1, 1)
            if (first == "\"" || first == sprintf("%c", 39) || value ~ /[[:space:]]+#/ || value ~ /\$/) {
                print NR
                exit
            }
        }
    ' "$file")"
    [[ -z "$unsafe_syntax" ]] \
        || die "$file line $unsafe_syntax uses quoting, dollar interpolation, or inline comments; use literal unquoted values"
    if grep -q $'\r' "$file"; then
        die "$file contains CRLF line endings — convert it to Unix LF"
    fi
    duplicates="$(awk -F= '
        /^[A-Za-z_][A-Za-z0-9_]*=/ { count[$1]++ }
        END { for (key in count) if (count[key] > 1) print key }
    ' "$file" | sort)"
    [[ -z "$duplicates" ]] || die "$file contains duplicate keys: $(printf '%s' "$duplicates" | tr '\n' ' ')"

    local directory directory_mode directory_owner directory_permissions named_acl
    directory="$(dirname "$file")"
    while :; do
        [[ ! -L "$directory" && -d "$directory" ]] || die "unsafe directory in .env path: $directory"
        directory_mode="$(stat -c '%a' "$directory")"
        directory_owner="$(stat -c '%u' "$directory")"
        directory_permissions=$((8#$directory_mode))
        if (( (directory_permissions & 8#022) != 0 )); then
            if (( directory_owner != 0 || (directory_permissions & 8#1000) == 0 )); then
                die "$directory must not be group/world writable (found mode $directory_mode)"
            fi
        fi
        named_acl="$(getfacl -cp "$directory" 2>/dev/null | awk -F: '($1 == "user" || $1 == "group") && $2 != "" { print; exit }')"
        [[ -z "$named_acl" ]] || die "$directory has an extended ACL; remove it before deploying"
        [[ "$directory" == "/" ]] && break
        directory="$(dirname "$directory")"
    done
    named_acl="$(getfacl -cp "$file" 2>/dev/null | awk -F: '($1 == "user" || $1 == "group") && $2 != "" { print; exit }')"
    [[ -z "$named_acl" ]] || die "$file has an extended ACL; remove it before deploying"

    BOE_EFFECTIVE_ENV="$file"
    ok "using authoritative environment: $file"
}

boe_cleanup_effective_env() {
    return 0
}

# boe_assert_env_keys <key...> — fail before touching docker if a required key
# is absent or empty. Cheaper than discovering it from a crash-looping container.
boe_assert_env_keys() {
    local missing=() k v
    for k in "$@"; do
        v="$(env_get "$k" "$BOE_EFFECTIVE_ENV")"
        [[ -n "$v" ]] || missing+=("$k")
    done
    (( ${#missing[@]} == 0 )) || die "missing required env keys: ${missing[*]}"
    ok "environment contains all ${#} required keys"
}

# ── docker / compose ────────────────────────────────────────────────────────
# All docker access funnels through these two functions.
docker_bin() { printf '%s\n' "${P[docker]:-docker}"; }

BOE_DOCKER_CONTROL_ENV=(
    DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG DOCKER_TLS_VERIFY DOCKER_CERT_PATH
    DOCKER_API_VERSION COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME
    COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR COMPOSE_PARALLEL_LIMIT
    COMPOSE_IGNORE_ORPHANS COMPOSE_REMOVE_ORPHANS COMPOSE_STATUS_STDOUT
)

boe_assert_clean_docker_environment() {
    local name
    local -a inherited=()
    for name in "${BOE_DOCKER_CONTROL_ENV[@]}"; do
        printenv "$name" >/dev/null 2>&1 && inherited+=("$name")
    done
    (( ${#inherited[@]} == 0 )) \
        || die "unset Docker/Compose control variables before deploying: ${inherited[*]}"
}

compose() {
    boe_assert_clean_docker_environment
    local version="${BOE_VERSION_FOR_COMPOSE:-}"
    local -a clean_environment=(env)
    local key
    while IFS= read -r key; do
        [[ -n "$key" ]] && clean_environment+=(-u "$key")
    done < <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$BOE_EFFECTIVE_ENV")
    "${clean_environment[@]}" \
        BOE_VERSION="$version" \
        BOE_CONTAINER_PREFIX="${P[container_prefix]}" \
        COMPOSE_PROJECT_NAME="${P[compose_project]}" \
        "$(docker_bin)" compose \
        --project-name "${P[compose_project]}" \
        --env-file "$BOE_EFFECTIVE_ENV" \
        -f "${P[compose_file]}" "$@"
}

boe_assert_docker() {
    boe_assert_clean_docker_environment
    require_cmds "$(docker_bin)"
    "$(docker_bin)" info >/dev/null 2>&1 \
        || die "cannot talk to the docker daemon as $(id -un) — is this user in the docker group?"
    "$(docker_bin)" compose version >/dev/null 2>&1 \
        || die "docker compose plugin not available"
    ok "docker $("$(docker_bin)" --version | awk '{print $3}' | tr -d ,) / compose $("$(docker_bin)" compose version --short)"
}

boe_validate_compose() {
    compose config --quiet 2>/dev/null \
        || die "compose file failed validation: ${P[compose_file]}"
    ok "compose file validates"
}

# ── checksum verification (plan §17.2) ──────────────────────────────────────
# A checksum failure must stop deployment immediately — a truncated upload must
# never be loaded as a "successful" partial image.
boe_verify_checksums() {
    local manifest="${P[manifest_file]}" key archive port expected actual path failed=0
    [[ -f "$manifest" ]] || die "manifest.json missing at $manifest"

    # compose file
    expected="$(jq -r '.compose.sha256 // empty' "$manifest")"
    if [[ "$expected" =~ ^[0-9a-f]{64}$ ]]; then
        actual="$(sha256sum "${P[compose_file]}" | cut -d' ' -f1)"
        if [[ "$actual" != "$expected" ]]; then
            warn "compose checksum mismatch"
            info "  expected $expected"
            info "  actual   $actual"
            failed=1
        else
            ok "checksum ok: ${P[compose_name]}"
        fi
    else
        warn "manifest has no compose checksum — skipping"
    fi

    # image archives
    while IFS=$'\t' read -r key archive port; do
        path="${P[images_dir]}/$archive"
        [[ -f "$path" ]] || die "image archive missing: $path"
        expected="$(jq -r --arg k "$key" '.images[$k].sha256 // empty' "$manifest")"
        if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
            warn "manifest has no checksum for image '$key' — skipping"
            continue
        fi
        actual="$(sha256sum "$path" | cut -d' ' -f1)"
        if [[ "$actual" != "$expected" ]]; then
            warn "checksum mismatch: $archive"
            info "  expected $expected"
            info "  actual   $actual"
            failed=1
        else
            ok "checksum ok: $archive"
        fi
    done < <(boe_images)

    (( failed == 0 )) || die "checksum verification failed — refusing to deploy"
}

# ── version state ───────────────────────────────────────────────────────────
# boe_current_version — the version currently recorded as deployed, or empty.
# A record left by a FAILED deploy is not a deployed version: .version keeps
# pointing at the previous release (the attempted one lives in last_attempted),
# and this function ignores failed records either way.
boe_current_version() {
    [[ -f "${P[version_file]}" ]] || return 0
    jq -r 'if (.status // "active") == "failed" then empty else (.version // empty) end' \
        "${P[version_file]}" 2>/dev/null || true
}

# boe_incoming_version — the version of the staged release bundle.
boe_incoming_version() {
    [[ -f "${P[manifest_file]}" ]] || die "manifest.json missing at ${P[manifest_file]}"
    local v; v="$(jq -r '.version // empty' "${P[manifest_file]}")"
    [[ -n "$v" ]] || die "manifest.json has no .version"
    [[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] \
        || die "manifest.json .version contains unsafe characters: $v"
    printf '%s\n' "$v"
}

# boe_write_version <version> <previous> <status> [last_attempted] — atomic
# version-file update (plan §17.3). Status "active" is written ONLY after
# health checks pass; a failed deploy records its attempted version in
# last_attempted while .version stays on the previous release.
boe_write_version() {
    local version="$1" previous="${2:-}" status="${3:-active}" attempted="${4:-}" tmp images_json
    images_json="$(jq -c '.images | with_entries(.value |= .tag)' "${P[manifest_file]}" 2>/dev/null || echo '{}')"
    tmp="$(mktemp "${P[version_file]}.XXXXXX")"
    jq -n \
        --arg environment "${P[environment]}" \
        --arg stack "${P[stack]}" \
        --arg version "$version" \
        --arg previous "$previous" \
        --arg attempted "$attempted" \
        --arg deployed_at "$(date -Is)" \
        --arg status "$status" \
        --argjson images "$images_json" \
        '{environment: $environment, stack: $stack, version: $version,
          previous_version: (if $previous == "" then null else $previous end),
          last_attempted: (if $attempted == "" then null else $attempted end),
          deployed_at: $deployed_at, status: $status, images: $images}' > "$tmp"
    jq empty "$tmp" || { rm -f "$tmp"; die "refusing to write malformed version file"; }
    mv "$tmp" "${P[version_file]}"
    ok "recorded version $version in ${P[version_name]}"
}

# boe_update_registry <version> — refresh this stack's entry in the shared
# BOE_APP/manifest.json so one file shows all three stacks at a glance.
# The registry is shared across stacks, so the read-modify-write runs under a
# sidecar flock; two stacks deploying at once must not lose each other's entry.
boe_update_registry() {
    local version="$1" reg="${P[registry]}" tmp
    [[ -n "$reg" ]] || return 0
    (
        flock -w 30 8 || exit 1
        [[ -f "$reg" ]] && [[ -s "$reg" ]] || printf '{}\n' > "$reg"
        jq empty "$reg" 2>/dev/null || printf '{}\n' > "$reg"
        tmp="$(mktemp "${reg}.XXXXXX")"
        jq \
            --arg stack "${P[stack]}" \
            --arg version "$version" \
            --arg environment "${P[environment]}" \
            --arg updated_at "$(date -Is)" \
            '.stacks[$stack] = {version: $version, environment: $environment, updated_at: $updated_at}
             | .updated_at = $updated_at' \
            "$reg" > "$tmp" && mv "$tmp" "$reg" || { rm -f "$tmp"; exit 1; }
    ) 8> "${reg}.lock" || warn "could not update registry $reg"
}

# ── image archive / load ────────────────────────────────────────────────────
# boe_archive_current_images <dest_dir> — save the images that are live right
# now, so a failed deploy has something to fall back to (plan §18 step 11).
#
# `.partial` staging then mv means an interrupted save never leaves a truncated
# archive that a later rollback would trust.
boe_archive_current_images() {
    local dest="$1" version="$2" key archive port tag saved=0
    [[ -n "$version" ]] || { info "no current version recorded — nothing to archive"; return 0; }

    boe_assert_writable "$dest"

    while IFS=$'\t' read -r key archive port; do
        tag="$(boe_image_tag "$key" "$version")"
        if ! "$(docker_bin)" image inspect "$tag" >/dev/null 2>&1; then
            warn "current image not present locally, cannot archive: $tag"
            continue
        fi
        # gzip -n keeps the archive byte-identical across runs (no timestamp).
        if "$(docker_bin)" image save "$tag" | gzip -n > "$dest/$archive.partial"; then
            mv "$dest/$archive.partial" "$dest/$archive"
            saved=$(( saved + 1 ))
            info "archived $tag"
        else
            rm -f "$dest/$archive.partial"
            warn "failed to archive $tag"
        fi
    done < <(boe_images)

    # Preserve exactly what is needed to bring this version back up.
    [[ -f "${P[compose_file]}" ]]   && cp "${P[compose_file]}"   "$dest/${P[compose_name]}"
    [[ -f "${P[manifest_file]}" ]]  && cp "${P[manifest_file]}"  "$dest/manifest.json"
    [[ -f "${P[version_file]}" ]]   && cp "${P[version_file]}"   "$dest/${P[version_name]}"

    # Checksums must cover everything a rollback trusts — not just the image
    # tarballs but also the compose, manifest, and version copies (mirrors the
    # monitoring stack's approach in ms_deploy.sh).
    ( cd "$dest" && find . -type f ! -name checksums.sha256 -exec sha256sum {} + > checksums.sha256 2>/dev/null ) || true
    ok "archived $saved image(s) for rollback → $dest"
}

# boe_rollback_verify <dir> — checksum the archive against its own
# checksums.sha256 before loading anything from it. Lives in the shared
# library because both the rollback flow and the deploy flow's auto-rollback
# must verify an archive before trusting it.
boe_rollback_verify() {
    local dir="$1"
    [[ -d "$dir" ]] || die "rollback directory missing: $dir"
    if [[ -f "$dir/checksums.sha256" ]]; then
        if ( cd "$dir" && sha256sum -c --quiet checksums.sha256 2>/dev/null ); then
            ok "rollback archive checksums verified"
        else
            die "rollback archive failed checksum verification: $dir"
        fi
    else
        warn "no checksums.sha256 in $dir — cannot verify integrity"
    fi
}

# boe_load_images — load the staged archives into the docker image store.
boe_load_images() {
    local key archive port path
    while IFS=$'\t' read -r key archive port; do
        path="${P[images_dir]}/$archive"
        [[ -f "$path" ]] || die "image archive missing: $path"
        log "loading $archive"
        gzip -dc "$path" | "$(docker_bin)" image load >/dev/null \
            || die "failed to load $archive"
        ok "loaded $archive"
    done < <(boe_images)
}

# boe_image_tag <key> <version> — must mirror stack_image_tag() in lib/stacks.sh.
boe_image_tag() {
    local key="$1" version="$2"
    case "${P[stack]}" in
        prod_release) printf 'boe-prod-%s:%s\n' "$key" "$version" ;;
        dev_release)  printf 'boe-dev-%s:%s\n'  "$key" "$version" ;;
        *)            printf 'boe-%s-%s:%s\n' "${P[short]}" "$key" "$version" ;;
    esac
}

# boe_assert_images_present <version> — every image the compose file will
# reference must exist before we try to start anything.
boe_assert_images_present() {
    local version="$1" key archive port tag missing=()
    while IFS=$'\t' read -r key archive port; do
        tag="$(boe_image_tag "$key" "$version")"
        "$(docker_bin)" image inspect "$tag" >/dev/null 2>&1 || missing+=("$tag")
    done < <(boe_images)
    (( ${#missing[@]} == 0 )) || die "images not in local store: ${missing[*]}"
    ok "all images present for $version"
}

# ── postgres ────────────────────────────────────────────────────────────────
pg_container() { printf '%s-postgres\n' "${P[container_prefix]}"; }

boe_wait_postgres() {
    local user db i tries=40
    user="$(env_get POSTGRES_USER "$BOE_EFFECTIVE_ENV")"
    db="$(env_get POSTGRES_DB "$BOE_EFFECTIVE_ENV")"
    log "waiting for postgres to accept connections"
    for (( i = 1; i <= tries; i++ )); do
        if "$(docker_bin)" exec "$(pg_container)" pg_isready -U "$user" -d "$db" >/dev/null 2>&1; then
            ok "postgres ready (after ${i}s window)"
            return 0
        fi
        sleep 2
    done
    die "postgres did not become ready within $(( tries * 2 ))s"
}

# boe_backup_database <dest_dir> <label> [required] — pre-deployment logical
# backup (plan §18 step 13, §30.3 naming). Never overwrites; always checksummed.
# With required=true the silent-skip paths become fatal — used when a rollback
# is about to restore the database and MUST have a fresh snapshot to fall back to.
boe_backup_database() {
    local dest="$1" label="$2" required="${3:-false}" user db stamp base dump meta size sha
    [[ "${P[has_database]}" == "true" ]] || { info "stack has no database — skipping backup"; return 0; }

    user="$(env_get POSTGRES_USER "$BOE_EFFECTIVE_ENV")"
    db="$(env_get POSTGRES_DB "$BOE_EFFECTIVE_ENV")"
    if [[ -z "$user" || -z "$db" ]]; then
        [[ "$required" == true ]] \
            && die "POSTGRES_USER/POSTGRES_DB unset — cannot take the mandatory pre-rollback backup"
        warn "POSTGRES_USER/POSTGRES_DB unset — skipping backup"
        return 0
    fi

    if ! "$(docker_bin)" ps --filter "name=^/$(pg_container)$" --filter status=running --format '{{.Names}}' \
         | grep -qx "$(pg_container)"; then
        [[ "$required" == true ]] \
            && die "postgres is not running — cannot take the mandatory pre-rollback backup"
        info "postgres not running — no pre-deploy backup to take"
        return 0
    fi

    boe_assert_writable "$dest"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    base="${P[short]}_${db}_${stamp}_${label}"
    dump="$dest/${base}.dump"

    log "backing up database $db → ${base}.dump"
    # umask 077: the staged dump contains the full database and must be
    # mode 600 from the moment it is created, not only after the mv.
    if ! ( umask 077; "$(docker_bin)" exec "$(pg_container)" \
            pg_dump -U "$user" -d "$db" --format=custom > "$dump.partial" 2>/dev/null ); then
        rm -f "$dump.partial"
        die "pg_dump failed — refusing to continue a deployment without a backup"
    fi
    mv "$dump.partial" "$dump"
    chmod 600 "$dump"

    size="$(stat -c %s "$dump")"
    (( size > 0 )) || die "backup file is empty: $dump"
    sha="$(sha256sum "$dump" | cut -d' ' -f1)"

    meta="$dest/${base}.metadata.json"
    jq -n \
        --arg environment "${P[environment]}" \
        --arg database "$db" \
        --arg created_at "$(date -Is)" \
        --arg backup_type "$label" \
        --arg sha256 "$sha" \
        --argjson size_bytes "$size" \
        --arg file "$(basename "$dump")" \
        '{environment: $environment, database: $database, created_at: $created_at,
          backup_type: $backup_type, status: "complete", file: $file,
          sha256: $sha256, size_bytes: $size_bytes}' > "$meta"
    chmod 600 "$meta"

    ok "database backup complete ($(numfmt --to=iec "$size"))"
    printf '%s\n' "$dump"
}

# ── health checks (plan §38) ────────────────────────────────────────────────
# wait_http <url> [tries] [sleep] — bounded polling. Never unbounded: a hung
# service must fail the deploy, not hang it forever.
wait_http() {
    local url="$1" tries="${2:-30}" nap="${3:-2}" i
    for (( i = 1; i <= tries; i++ )); do
        if curl -fsS --max-time 5 -o /dev/null "$url" 2>/dev/null; then
            ok "healthy: $url (${i} attempt(s))"
            return 0
        fi
        sleep "$nap"
    done
    warn "not healthy after $(( tries * nap ))s: $url"
    return 1
}

# boe_wait_compose_healthy [tries] — wait for every container that declares a
# healthcheck to report healthy. `docker compose up -d` returning 0 only means
# "containers created", never "application works" (plan §38).
boe_wait_compose_healthy() {
    local tries="${1:-40}" i ids id state health bad
    for (( i = 1; i <= tries; i++ )); do
        bad=""
        ids="$(compose ps --all -q 2>/dev/null || true)"
        [[ -n "$ids" ]] || { sleep 2; continue; }
        while read -r id; do
            [[ -n "$id" ]] || continue
            state="$("$(docker_bin)" inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo unknown)"
            health="$("$(docker_bin)" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo none)"
            case "$state" in
                running)
                    [[ "$health" == "healthy" || "$health" == "none" ]] || bad="$bad $(basename "$id")"
                    ;;
                exited)
                    # One-shot services (migrate/seed) legitimately exit 0.
                    local rc; rc="$("$(docker_bin)" inspect -f '{{.State.ExitCode}}' "$id" 2>/dev/null || echo 1)"
                    [[ "$rc" == "0" ]] || bad="$bad $(basename "$id"):exit$rc"
                    ;;
                *) bad="$bad $(basename "$id"):$state" ;;
            esac
        done <<< "$ids"
        if [[ -z "$bad" ]]; then
            ok "all containers healthy"
            return 0
        fi
        sleep 2
    done
    warn "containers not healthy:$bad"
    return 1
}

# ── retention (plan §41) ────────────────────────────────────────────────────
# boe_prune_rollbacks <dir> <keep> — delete oldest release dirs beyond `keep`.
# Deliberately refuses to leave zero rollback targets.
boe_prune_rollbacks() {
    local dir="$1" keep="$2" total victims v
    [[ -d "$dir" ]] || return 0
    total="$(find "$dir" -mindepth 1 -maxdepth 1 -type d | wc -l)"
    (( total > keep )) || { info "rollback retention: $total/$keep kept"; return 0; }

    # sort -V so 0.10.0 sorts after 0.9.0.
    victims="$(find "$dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | head -n $(( total - keep )))"
    while read -r v; do
        [[ -n "$v" ]] || continue
        rm -rf -- "$dir/$v" && info "pruned old rollback: $v"
    done <<< "$victims"
}

# ── logging setup ───────────────────────────────────────────────────────────
# Arms the append-to-file side of log()/ok()/warn()/die(). Called once the
# backup disk has been verified writable.
boe_open_log() {
    local action="$1"
    boe_assert_writable "${P[deploy_log]}"
    BOE_LOG_FILE="${P[deploy_log]}/${P[short]}-${action}-$(date -u +%Y%m%dT%H%M%SZ).log"
    : > "$BOE_LOG_FILE"
    info "log: $BOE_LOG_FILE"
}

# ── summary ─────────────────────────────────────────────────────────────────
boe_summary() {
    local title="$1"; shift
    printf '\n%s%s%s\n' "$_c_bold" "$title" "$_c_rst"
    local kv
    for kv in "$@"; do
        printf '  %s%-20s%s %s\n' "$_c_dim" "${kv%%=*}" "$_c_rst" "${kv#*=}"
    done
    printf '\n'
}
