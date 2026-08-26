#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SCRIPT_DIR/out"

source "$PROJECT_ROOT/release_manager/lib/ui.sh"

SECONDS_LIMIT=30
MAX_SECONDS_LIMIT=300
DO_CLEAR=false
DO_DUMP=false
SERIAL=""
OUT_FILE=""
FILTERS=()

usage() {
    cat <<'USAGE'
Usage: ./emu/boe_logcat.sh [options] TAG:LEVEL [TAG:LEVEL ...]

Collects Android logcat output through the BeOnEdge diagnostic policy: an
explicit tag allowlist, no wildcards, and credential redaction before anything
is written to disk.

Filters (required, at least one):
  TAG:LEVEL     exact tag plus one of V D I W E F, e.g. ActivityManager:I

Options:
  --clear       clear the device log buffer before capturing
  --dump        capture the current buffer once instead of streaming
  --seconds N   stop streaming after 1-300 seconds (default 30)
  --serial ID   adb device serial (default: adb's own selection)
  --out FILE    output file (default emu/out/logcat.<utc-timestamp>.log)
  --help, -h    this message

The Capacitor bridge tags, WebView/chromium tags and wildcard filters are
refused outright. For WebView diagnostics use chrome://inspect instead.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --clear)   DO_CLEAR=true; shift ;;
        --dump)    DO_DUMP=true;  shift ;;
        --seconds)
            [[ "${2:-}" =~ ^[1-9][0-9]{0,2}$ && "${2:-0}" -le "$MAX_SECONDS_LIMIT" ]] \
                || { err "--seconds requires an integer from 1 to $MAX_SECONDS_LIMIT (got: '${2:-<none>}')"; exit 1; }
            SECONDS_LIMIT="$2"; shift 2 ;;
        --serial)
            [[ -n "${2:-}" ]] || { err "--serial requires a device serial"; exit 1; }
            SERIAL="$2"; shift 2 ;;
        --out)
            [[ -n "${2:-}" ]] || { err "--out requires a file path"; exit 1; }
            OUT_FILE="$2"; shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *:*)       FILTERS+=("$1"); shift ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

(( ${#FILTERS[@]} > 0 )) || { err "at least one TAG:LEVEL filter is required"; usage >&2; exit 1; }

for filter in "${FILTERS[@]}"; do
    [[ "$filter" =~ ^([A-Za-z0-9_./-]+):([VDIWEF])$ ]] \
        || { err "invalid filter: $filter (expected TAG:LEVEL, level one of V D I W E F)"; exit 1; }
    tag="${BASH_REMATCH[1]}"
    [[ "$tag" != "*" ]] || { err "wildcard filters are refused: $filter"; exit 1; }
    case "${tag,,}" in
        capacitor|capacitor/*|chromium|chromium/*|webview|webview/*)
            err "tag refused by the diagnostic logging policy: $tag"
            err "bridge and WebView tags can carry session credentials — use chrome://inspect"
            exit 1 ;;
    esac
done

ADB_BIN=""
for candidate in "$(command -v adb || true)" \
                 "${ANDROID_HOME:-}/platform-tools/adb" \
                 "$HOME/Android/Sdk/platform-tools/adb" \
                 "$HOME/android-sdk/platform-tools/adb" \
                 /opt/android-sdk/platform-tools/adb \
                 /usr/lib/android-sdk/platform-tools/adb; do
    [[ -n "$candidate" && -x "$candidate" ]] && { ADB_BIN="$candidate"; break; }
done
[[ -n "$ADB_BIN" ]] || { err "adb not found; set ANDROID_HOME or install platform-tools"; exit 1; }

ADB_ARGS=()
[[ -n "$SERIAL" ]] && ADB_ARGS+=(-s "$SERIAL")

redact_stream() {
    sed -E \
        -e 's/(Authorization:[[:space:]]*)(Basic|Bearer)[[:space:]]+[^[:space:]]+/\1\2 [REDACTED]/gi' \
        -e 's/((Cookie|Set-Cookie):[[:space:]]*).*/\1[REDACTED]/gi' \
        -e 's/Bearer [A-Za-z0-9._~+\/-]+=*/Bearer [REDACTED]/gi' \
        -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.\/+_-]*/[REDACTED-JWT]/g' \
        -e 's/("(accessToken|refreshToken|access_token|refresh_token|csrfToken|idToken|authorization|token|paymentToken|sdkOrderToken|clientSecret|client_secret|password|callbackPassword|cookie)"[[:space:]]*:[[:space:]]*")[^"]*/\1[REDACTED]/gi' \
        -e 's/\b(accessToken|refreshToken|access_token|refresh_token|csrfToken|idToken|authorization|token|paymentToken|sdkOrderToken|clientSecret|client_secret|password|callbackPassword|cookie)=[^&[:space:]]+/\1=[REDACTED]/gi'
}

mkdir -p "$OUT_DIR"
[[ -n "$OUT_FILE" ]] || OUT_FILE="$OUT_DIR/logcat.$(date -u +%Y%m%dT%H%M%SZ).log"
[[ ! -L "$OUT_FILE" ]] || { err "capture output must not be a symlink: $OUT_FILE"; exit 1; }
[[ ! -e "$OUT_FILE" || -f "$OUT_FILE" ]] \
    || { err "capture output must be a regular file: $OUT_FILE"; exit 1; }

banner "LOGCAT · ${FILTERS[*]}"
field "adb" "$ADB_BIN"
field "out" "${OUT_FILE#"$PROJECT_ROOT"/}"

if [[ "$DO_CLEAR" == true ]]; then
    "$ADB_BIN" "${ADB_ARGS[@]}" logcat -c
    ok "device log buffer cleared"
fi

: > "$OUT_FILE"
chmod 600 "$OUT_FILE"
printf '# BeOnEdge diagnostic capture — redacted at collection. Inspect before sharing; never paste into tickets or collectors.\n' >> "$OUT_FILE"

if [[ "$DO_DUMP" == true ]]; then
    "$ADB_BIN" "${ADB_ARGS[@]}" logcat -d -v threadtime "${FILTERS[@]}" '*:S' | redact_stream >> "$OUT_FILE"
else
    timeout "$SECONDS_LIMIT" "$ADB_BIN" "${ADB_ARGS[@]}" logcat -v threadtime "${FILTERS[@]}" '*:S' \
        | redact_stream >> "$OUT_FILE" || [[ $? -eq 124 ]]
fi

if grep -q '\[REDACTED' "$OUT_FILE"; then
    err "credential-shaped content was redacted from this capture: $OUT_FILE"
    err "treat this as an incident: revoke the session and clear the device log buffer"
    exit 2
fi

ok "capture written to ${OUT_FILE#"$PROJECT_ROOT"/} ($(wc -l < "$OUT_FILE" | tr -d ' ') lines)"
