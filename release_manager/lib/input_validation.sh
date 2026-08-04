#!/usr/bin/env bash
# Validation for values that cross the local-shell → SSH → remote-shell boundary.

is_safe_log_basename() {
    local name="${1:-}"
    [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
    [[ "$name" != . && "$name" != .. ]]
}

# is_safe_absolute_remote_path <path> — sanity check for absolute remote paths
# supplied by config or an operator. Deliberately looser than _paths_is_safe_abs
# (lib/paths.sh): top-level roots like /srv and trailing slashes are legitimate
# here, while paths.json contract values must pass the stricter validator.
is_safe_absolute_remote_path() {
    local path="${1:-}"
    [[ "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
    [[ "$path" != *'//'* ]] || return 1
    case "/$path/" in
        */../*|*/./*) return 1 ;;
    esac
    return 0
}
