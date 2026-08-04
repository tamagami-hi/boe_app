#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# paths.sh — validator and reader for the per-stack `paths.json` contract.
#
# THE CONTRACT (schema 3)
# Each stack's tracked paths.json is the SOLE authoritative source for every
# deployment, backup, log, database, image, configuration, APK and runtime
# path. Nothing in the tooling generates or regenerates these files: they are
# hand-edited canonical configuration, validated here, and shipped byte-for-byte
# by export.sh. A path change is made by editing the stack's paths.json and
# re-shipping the contract — never by editing shell code.
#
# This library provides:
#   stack_paths_file            where a stack's canonical contract lives
#   paths_validate              full fail-closed validation of one contract
#   paths_validate_cross_stack  uniqueness/consistency across all contracts
#   paths_get                   read one validated value out of a contract
#   paths_images                typed reader: image descriptors
#   paths_apk_destinations      typed reader: APK routing table
#
# Requires lib/stacks.sh to be sourced first (stack identity, safe-path rules,
# SSH plumbing). Every value a caller interpolates into SSH, rsync or a remote
# shell command must come from a contract that passed paths_validate.
# ─────────────────────────────────────────────────────────────────────────────

# stack_paths_file <stack> — echo the tracked canonical contract for a stack.
stack_paths_file() {
    local stack="$1" lib_dir
    is_stack "$stack" || { printf 'stack_paths_file: unknown stack %s\n' "$stack" >&2; return 1; }
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    printf '%s\n' "$(cd "$lib_dir/.." && pwd)/stacks/$stack/paths.json"
}

# _paths_is_safe_abs <path> — an absolute, normalized remote path with nothing
# a shell could misread: no traversal, empty segments, trailing slash, control
# bytes, whitespace, quotes or metacharacters.
# Stricter than is_safe_absolute_remote_path (lib/input_validation.sh): contract
# paths must also be at least two levels deep and must not end in a slash.
_paths_is_safe_abs() {
    local p="$1"
    [[ "$p" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
    [[ "$p" != *'//'* && "$p" != */ ]] || return 1
    [[ "$p" == */*/* ]] || return 1
    [[ "$p" != *'..'* ]] || return 1
    return 0
}

# _paths_is_safe_name <name> — a bare filename or identifier (no slashes).
_paths_is_safe_name() {
    [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]
}

# _paths_beneath <child> <parent> — true if child is strictly inside parent.
_paths_beneath() {
    [[ "$1" == "$2/"* ]]
}

# Rejected values may carry control bytes; strip them before they reach a
# terminal so a hostile contract cannot forge or overwrite messages.
_paths_err() {
    local msg
    msg="$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\010\013-\037\177')"
    printf 'paths_validate: %s\n' "$msg" >&2
    return 1
}

# Required non-empty string fields of a schema-3 contract.
_PATHS_STRING_FIELDS=(
    .vps.root .vps.stack_dir .vps.paths_file .vps.images_dir
    .vps.compose_file .vps.compose_name .vps.env_file .vps.env_example
    .vps.version_file .vps.version_name .vps.manifest_file .vps.checksums_file
    .vps.deploy_script .vps.rollback_script .vps.guide .vps.registry
    .vps.docker .vps.container_prefix .vps.compose_project .vps.lock_file
    .backup.mount_check .backup.root .backup.rollback_root .backup.rollback_images
    .backup.rollback_apk .backup.rollback_db .backup.db_backups .backup.emergency_db
    .backup.logs_root .backup.deploy_log .backup.image_log .backup.db_log .backup.app_log
)

# Of those, the fields that must be absolute remote paths.
_PATHS_ABS_FIELDS=(
    .vps.root .vps.stack_dir .vps.paths_file .vps.images_dir
    .vps.compose_file .vps.env_file .vps.env_example
    .vps.version_file .vps.manifest_file .vps.checksums_file
    .vps.deploy_script .vps.rollback_script .vps.guide .vps.registry
    .vps.lock_file
    .backup.mount_check .backup.root .backup.rollback_root .backup.rollback_images
    .backup.rollback_apk .backup.rollback_db .backup.db_backups .backup.emergency_db
    .backup.logs_root .backup.deploy_log .backup.image_log .backup.db_log .backup.app_log
)

# Stack-owned paths: must live strictly beneath vps.stack_dir.
_PATHS_STACK_OWNED=(
    paths_file images_dir compose_file env_file env_example version_file
    manifest_file checksums_file deploy_script rollback_script guide
)

# Backup paths: must live strictly beneath backup.root.
_PATHS_BACKUP_OWNED=(
    rollback_root rollback_images rollback_apk rollback_db db_backups
    emergency_db logs_root deploy_log image_log db_log app_log
)

# paths_validate <stack> <file> — fail-closed validation of one contract.
# Returns 0 only if every check passes; prints the first failure to stderr.
paths_validate() {
    local stack="$1" file="$2"
    is_stack "$stack" || { _paths_err "unknown stack: $stack"; return 1; }
    [[ -f "$file" && ! -L "$file" ]] \
        || { _paths_err "contract missing or unsafe: $file"; return 1; }
    jq empty "$file" 2>/dev/null \
        || { _paths_err "not valid JSON: $file"; return 1; }

    # ── 1. schema and identity ───────────────────────────────────────────────
    jq -e --arg stack "$stack" \
          --arg env "$(stack_attr "$stack" env)" \
          --arg short "$(stack_attr "$stack" short)" \
        '.schema == 3 and .stack == $stack
         and .environment == $env and .short == $short' \
        "$file" >/dev/null 2>&1 \
        || { _paths_err "$file: schema must be 3 and stack/environment/short must match $stack"; return 1; }

    # ── 2. required fields: present, correctly typed, non-empty ─────────────
    local field value
    for field in "${_PATHS_STRING_FIELDS[@]}"; do
        jq -e "($field | type == \"string\") and ($field | length > 0)" \
            "$file" >/dev/null 2>&1 \
            || { _paths_err "$file: $field must be a non-empty string"; return 1; }
    done
    jq -e '(.vps.database_dir == null) or (.vps.database_dir | type == "string" and length > 0)' \
        "$file" >/dev/null \
        || { _paths_err "$file: vps.database_dir must be null or a non-empty string"; return 1; }
    jq -e '(.vps.config_dir == null) or (.vps.config_dir | type == "string" and length > 0)' \
        "$file" >/dev/null \
        || { _paths_err "$file: vps.config_dir must be null or a non-empty string"; return 1; }
    jq -e '.has_database | type == "boolean"' "$file" >/dev/null \
        || { _paths_err "$file: has_database must be a boolean"; return 1; }
    jq -e '.retention.keep_releases | type == "number" and . >= 1 and floor == .' \
        "$file" >/dev/null \
        || { _paths_err "$file: retention.keep_releases must be a positive integer"; return 1; }
    jq -e '.images | type == "array"' "$file" >/dev/null \
        || { _paths_err "$file: images must be an array"; return 1; }
    jq -e '.apk | type == "object" and (.enabled | type == "boolean")
           and (.destinations | type == "array")' "$file" >/dev/null \
        || { _paths_err "$file: apk must carry a boolean enabled and a destinations array"; return 1; }

    local key archive port
    while IFS=$'\t' read -r key archive port; do
        [[ -n "$key" ]] || continue
        _paths_is_safe_name "$key" && _paths_is_safe_name "$archive" \
            || { _paths_err "$file: unsafe image descriptor: $key/$archive"; return 1; }
        [[ "$port" =~ ^[0-9]+$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) \
            || { _paths_err "$file: invalid container port for image $key"; return 1; }
    done < <(jq -r '.images[]? | [(.key // ""), (.archive // ""), (.container_port // "" | tostring)] | @tsv' "$file")

    # ── 3. every remote path is absolute, normalized and shell-safe ──────────
    for field in "${_PATHS_ABS_FIELDS[@]}"; do
        value="$(jq -r "$field" "$file")"
        _paths_is_safe_abs "$value" \
            || { _paths_err "$file: unsafe remote path at $field: $value"; return 1; }
    done
    for field in .vps.database_dir .vps.config_dir .apk.reserved_current_dir; do
        value="$(jq -r "$field // empty" "$file")"
        [[ -z "$value" ]] && continue
        _paths_is_safe_abs "$value" \
            || { _paths_err "$file: unsafe remote path at $field: $value"; return 1; }
    done
    # Bare names and identifiers.
    for field in .vps.compose_name .vps.version_name; do
        value="$(jq -r "$field" "$file")"
        _paths_is_safe_name "$value" \
            || { _paths_err "$file: unsafe name at $field: $value"; return 1; }
    done
    for field in .vps.container_prefix .vps.compose_project; do
        value="$(jq -r "$field" "$file")"
        [[ "$value" =~ ^[a-z0-9_-]+$ ]] \
            || { _paths_err "$file: unsafe identifier at $field: $value"; return 1; }
    done
    value="$(jq -r '.vps.docker' "$file")"
    [[ "$value" =~ ^[A-Za-z0-9_/-]+([[:space:]][A-Za-z0-9_/-]+)*$ ]] \
        || { _paths_err "$file: unsafe docker command: $value"; return 1; }

    local stack_dir backup_root backup_mount
    stack_dir="$(jq -r '.vps.stack_dir' "$file")"
    backup_root="$(jq -r '.backup.root' "$file")"
    backup_mount="$(jq -r '.backup.mount_check' "$file")"

    # ── 4. stack-owned paths are contained beneath vps.stack_dir ─────────────
    _paths_beneath "$stack_dir" "$(jq -r '.vps.root' "$file")" \
        || { _paths_err "$file: vps.stack_dir escapes vps.root"; return 1; }
    for field in "${_PATHS_STACK_OWNED[@]}"; do
        value="$(jq -r ".vps.$field" "$file")"
        _paths_beneath "$value" "$stack_dir" \
            || { _paths_err "$file: vps.$field escapes vps.stack_dir"; return 1; }
    done
    for field in database_dir config_dir; do
        value="$(jq -r ".vps.$field // empty" "$file")"
        [[ -z "$value" ]] && continue
        _paths_beneath "$value" "$stack_dir" \
            || { _paths_err "$file: vps.$field escapes vps.stack_dir"; return 1; }
    done
    value="$(jq -r '.apk.reserved_current_dir // empty' "$file")"
    if [[ -n "$value" ]]; then
        _paths_beneath "$value" "$stack_dir" \
            || { _paths_err "$file: apk.reserved_current_dir escapes vps.stack_dir"; return 1; }
    fi
    _paths_beneath "$(jq -r '.vps.registry' "$file")" "$(jq -r '.vps.root' "$file")" \
        || { _paths_err "$file: vps.registry escapes vps.root"; return 1; }

    # ── 5. backup containment ────────────────────────────────────────────────
    [[ "$backup_root" == "$backup_mount" ]] || _paths_beneath "$backup_root" "$backup_mount" \
        || { _paths_err "$file: backup.root is outside backup.mount_check"; return 1; }
    for field in "${_PATHS_BACKUP_OWNED[@]}"; do
        value="$(jq -r ".backup.$field" "$file")"
        _paths_beneath "$value" "$backup_root" \
            || { _paths_err "$file: backup.$field escapes backup.root"; return 1; }
    done

    # ── 6. lock files live beneath /run/lock ─────────────────────────────────
    _paths_beneath "$(jq -r '.vps.lock_file' "$file")" /run/lock \
        || { _paths_err "$file: vps.lock_file must live beneath /run/lock"; return 1; }

    # ── apk destinations: routing by explicit variant only ───────────────────
    local -a dest_variants=() dest_currents=() dest_rollbacks=()
    local variant current_dir rollback_dir
    while IFS=$'\t' read -r variant current_dir rollback_dir; do
        [[ -n "$variant" ]] || continue
        [[ "$variant" =~ ^[a-z][a-z0-9_-]*$ ]] \
            || { _paths_err "$file: unsafe APK variant name: $variant"; return 1; }
        _paths_is_safe_abs "$current_dir" && _paths_is_safe_abs "$rollback_dir" \
            || { _paths_err "$file: unsafe APK destination path for variant $variant"; return 1; }
        _paths_beneath "$current_dir" "$stack_dir" \
            || { _paths_err "$file: APK current_dir for $variant escapes vps.stack_dir"; return 1; }
        _paths_beneath "$rollback_dir" "$backup_root" \
            || { _paths_err "$file: APK rollback_dir for $variant escapes backup.root"; return 1; }
        dest_variants+=("$variant")
        dest_currents+=("$current_dir")
        dest_rollbacks+=("$rollback_dir")
    done < <(jq -r '.apk.destinations[]? | [(.variant // ""), (.current_dir // ""), (.rollback_dir // "")] | @tsv' "$file")

    # ── 7. destinations are unique and non-overlapping within the contract ───
    local -a all_apk_dirs=("${dest_currents[@]}" "${dest_rollbacks[@]}")
    local i j
    for (( i = 0; i < ${#all_apk_dirs[@]}; i++ )); do
        for (( j = i + 1; j < ${#all_apk_dirs[@]}; j++ )); do
            [[ "${all_apk_dirs[$i]}" != "${all_apk_dirs[$j]}" ]] \
                || { _paths_err "$file: duplicate APK directory ${all_apk_dirs[$i]}"; return 1; }
            ! _paths_beneath "${all_apk_dirs[$i]}" "${all_apk_dirs[$j]}" \
                && ! _paths_beneath "${all_apk_dirs[$j]}" "${all_apk_dirs[$i]}" \
                || { _paths_err "$file: overlapping APK directories ${all_apk_dirs[$i]} and ${all_apk_dirs[$j]}"; return 1; }
        done
    done
    for (( i = 0; i < ${#dest_variants[@]}; i++ )); do
        for (( j = i + 1; j < ${#dest_variants[@]}; j++ )); do
            [[ "${dest_variants[$i]}" != "${dest_variants[$j]}" ]] \
                || { _paths_err "$file: duplicate APK variant ${dest_variants[$i]}"; return 1; }
        done
    done

    # ── 8/9. per-stack APK policy ────────────────────────────────────────────
    if [[ "$(jq -r '.apk.enabled' "$file")" == true ]]; then
        [[ "$stack" != monitor_service ]] \
            || { _paths_err "$file: monitoring must keep apk.enabled false until an APK exists"; return 1; }
        (( ${#dest_variants[@]} == 2 )) \
            || { _paths_err "$file: $stack must define exactly a client and an admin APK destination"; return 1; }
        local has_client=false has_admin=false
        for variant in "${dest_variants[@]}"; do
            [[ "$variant" == client ]] && has_client=true
            [[ "$variant" == admin ]] && has_admin=true
        done
        [[ "$has_client" == true && "$has_admin" == true ]] \
            || { _paths_err "$file: $stack must define exactly a client and an admin APK destination"; return 1; }
    else
        (( ${#dest_variants[@]} == 0 )) \
            || { _paths_err "$file: destinations must be empty while apk.enabled is false"; return 1; }
        [[ "$stack" == monitor_service ]] \
            || { _paths_err "$file: $stack ships APKs; apk.enabled must be true"; return 1; }
    fi

    # ── 10. has_database agrees with vps.database_dir ────────────────────────
    local has_db db_dir
    has_db="$(jq -r '.has_database' "$file")"
    db_dir="$(jq -r '.vps.database_dir // empty' "$file")"
    if [[ "$has_db" == true ]]; then
        [[ -n "$db_dir" ]] \
            || { _paths_err "$file: has_database is true but vps.database_dir is null"; return 1; }
    else
        [[ -z "$db_dir" ]] \
            || { _paths_err "$file: has_database is false but vps.database_dir is set"; return 1; }
    fi

    # ── 11. filenames and absolute file paths agree ──────────────────────────
    [[ "$(jq -r '.vps.compose_file' "$file")" == "$stack_dir/$(jq -r '.vps.compose_name' "$file")" ]] \
        || { _paths_err "$file: vps.compose_file disagrees with vps.compose_name"; return 1; }
    [[ "$(jq -r '.vps.version_file' "$file")" == "$stack_dir/$(jq -r '.vps.version_name' "$file")" ]] \
        || { _paths_err "$file: vps.version_file disagrees with vps.version_name"; return 1; }
    # Identity metadata still defined in lib/stacks.sh must match the contract,
    # so the two cannot drift apart silently.
    local attr expect
    for attr in compose:compose_name version_file:version_name prefix:container_prefix project:compose_project; do
        expect="$(stack_attr "$stack" "${attr%%:*}")" \
            || { _paths_err "stack_attr ${attr%%:*} unknown for $stack"; return 1; }
        [[ "$(jq -r ".vps.${attr##*:}" "$file")" == "$expect" ]] \
            || { _paths_err "$file: vps.${attr##*:} disagrees with lib/stacks.sh ($expect)"; return 1; }
    done
    [[ "$(basename "$(jq -r '.vps.deploy_script' "$file")")" == "$(stack_attr "$stack" deploy)" ]] \
        || { _paths_err "$file: vps.deploy_script disagrees with lib/stacks.sh"; return 1; }
    [[ "$(basename "$(jq -r '.vps.rollback_script' "$file")")" == "$(stack_attr "$stack" rollback)" ]] \
        || { _paths_err "$file: vps.rollback_script disagrees with lib/stacks.sh"; return 1; }
    [[ "$(basename "$(jq -r '.vps.guide' "$file")")" == "$(stack_attr "$stack" guide)" ]] \
        || { _paths_err "$file: vps.guide disagrees with lib/stacks.sh"; return 1; }
    [[ "$(jq -r '.retention.keep_releases' "$file")" == "$(stack_attr "$stack" keep)" ]] \
        || { _paths_err "$file: retention.keep_releases disagrees with lib/stacks.sh"; return 1; }
    [[ "$(jq -r '.vps.lock_file' "$file")" == "/run/lock/boe-$stack.lock" ]] \
        || { _paths_err "$file: vps.lock_file must be /run/lock/boe-$stack.lock"; return 1; }

    return 0
}

# paths_validate_cross_stack — checks that span contracts (validation
# requirements 7 and 12): APK directories unique and non-overlapping across
# stacks, and the shared roots identical where the contracts are meant to agree.
paths_validate_cross_stack() {
    local stack file value
    local -a all_dirs=() stack_dirs=()
    local root="" backup_root="" backup_mount="" registry=""
    local i j

    for stack in "${BOE_STACKS[@]}"; do
        file="$(stack_paths_file "$stack")" || return 1
        paths_validate "$stack" "$file" || return 1

        stack_dirs+=("$(jq -r '.vps.stack_dir' "$file")")

        for field in .vps.root .backup.root .backup.mount_check .vps.registry; do
            value="$(jq -r "$field" "$file")"
            case "$field" in
                .vps.root)           [[ -z "$root" ]] && root="$value"
                                     [[ "$value" == "$root" ]] \
                                         || { _paths_err "vps.root differs across contracts"; return 1; } ;;
                .backup.root)        [[ -z "$backup_root" ]] && backup_root="$value"
                                     [[ "$value" == "$backup_root" ]] \
                                         || { _paths_err "backup.root differs across contracts"; return 1; } ;;
                .backup.mount_check) [[ -z "$backup_mount" ]] && backup_mount="$value"
                                     [[ "$value" == "$backup_mount" ]] \
                                         || { _paths_err "backup.mount_check differs across contracts"; return 1; } ;;
                .vps.registry)       [[ -z "$registry" ]] && registry="$value"
                                     [[ "$value" == "$registry" ]] \
                                         || { _paths_err "vps.registry differs across contracts"; return 1; } ;;
            esac
        done

        while IFS=$'\t' read -r _ current_dir rollback_dir; do
            [[ -n "$current_dir" ]] && all_dirs+=("$current_dir")
            [[ -n "$rollback_dir" ]] && all_dirs+=("$rollback_dir")
        done < <(jq -r '.apk.destinations[]? | [(.variant // ""), (.current_dir // ""), (.rollback_dir // "")] | @tsv' "$file")
        value="$(jq -r '.apk.reserved_current_dir // empty' "$file")"
        [[ -n "$value" ]] && all_dirs+=("$value")
    done

    for (( i = 0; i < ${#all_dirs[@]}; i++ )); do
        for (( j = i + 1; j < ${#all_dirs[@]}; j++ )); do
            [[ "${all_dirs[$i]}" != "${all_dirs[$j]}" ]] \
                || { _paths_err "APK directory reused across stacks: ${all_dirs[$i]}"; return 1; }
            ! _paths_beneath "${all_dirs[$i]}" "${all_dirs[$j]}" \
                && ! _paths_beneath "${all_dirs[$j]}" "${all_dirs[$i]}" \
                || { _paths_err "APK directories overlap across stacks: ${all_dirs[$i]} and ${all_dirs[$j]}"; return 1; }
        done
    done

    # Stack directories must be disjoint too: a shared or nested stack_dir
    # would let one stack's deploy or rollback delete another stack's tree.
    for (( i = 0; i < ${#stack_dirs[@]}; i++ )); do
        for (( j = i + 1; j < ${#stack_dirs[@]}; j++ )); do
            [[ "${stack_dirs[$i]}" != "${stack_dirs[$j]}" ]] \
                || { _paths_err "vps.stack_dir reused across stacks: ${stack_dirs[$i]}"; return 1; }
            ! _paths_beneath "${stack_dirs[$i]}" "${stack_dirs[$j]}" \
                && ! _paths_beneath "${stack_dirs[$j]}" "${stack_dirs[$i]}" \
                || { _paths_err "vps.stack_dir nested across stacks: ${stack_dirs[$i]} and ${stack_dirs[$j]}"; return 1; }
        done
    done
    return 0
}

# paths_get <paths.json> <jq-path> — read one value out of a contract.
# Returns 1 (and prints nothing) if the key is absent, so callers can default.
# Absolute paths are re-checked against the safe-path rule before they are
# handed back, so a caller can never interpolate an unsafe value into SSH,
# rsync or a remote shell command.
paths_get() {
    local file="$1" query="$2" value
    # Same file-safety rule as paths_validate: never read a contract through a
    # symlink — it could resolve to an attacker-controlled file.
    [[ -f "$file" && ! -L "$file" ]] \
        || { printf 'paths.json not found or unsafe: %s\n' "$file" >&2; return 1; }
    value="$(jq -r "$query // empty" "$file" 2>/dev/null)" || return 1
    [[ -n "$value" ]] || return 1
    if [[ "$value" == /* ]]; then
        _paths_is_safe_abs "$value" \
            || { printf 'paths_get: refusing unsafe path at %s in %s\n' "$query" "$file" >&2; return 1; }
    fi
    printf '%s\n' "$value"
}

# paths_images <paths.json> — echo one "key:archive:container_port" triple per
# line, in contract order. Mirrors the old stack_images() output shape.
paths_images() {
    local file="$1"
    [[ -f "$file" ]] || { printf 'paths.json not found: %s\n' "$file" >&2; return 1; }
    jq -r '.images[]? | [.key, .archive, (.container_port | tostring)] | join(":")' "$file"
}

# paths_apk_destinations <paths.json> — echo one
# "variant<TAB>current_dir<TAB>rollback_dir" row per APK destination.
paths_apk_destinations() {
    local file="$1"
    [[ -f "$file" ]] || { printf 'paths.json not found: %s\n' "$file" >&2; return 1; }
    jq -r '.apk.destinations[]? | [.variant, .current_dir, .rollback_dir] | @tsv' "$file"
}
