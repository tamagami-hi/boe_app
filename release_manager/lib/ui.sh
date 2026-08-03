#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ui.sh — shared presentation + prompt helpers for the release tooling.
# Sourced by export.sh, deploy.sh, rollback.sh. Colors auto-disable off a TTY.
# ─────────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
    c_bold=$'\033[1m'; c_dim=$'\033[2m'; c_grn=$'\033[32m'
    c_yel=$'\033[33m'; c_red=$'\033[31m'; c_cyn=$'\033[36m'; c_rst=$'\033[0m'
else
    c_bold=''; c_dim=''; c_grn=''; c_yel=''; c_red=''; c_cyn=''; c_rst=''
fi

banner()  { printf '\n%s═══ %s ═══%s\n' "$c_bold" "$1" "$c_rst"; }
section() { printf '\n%s━━ %s%s\n' "$c_bold" "$1" "$c_rst"
            [[ -n "${2:-}" ]] && printf '%s   %s%s\n' "$c_dim" "$2" "$c_rst"; return 0; }
step()    { printf '   %s•%s %s\n' "$c_cyn" "$c_rst" "$1"; }
ok()      { printf '   %s✓%s %s\n' "$c_grn" "$c_rst" "$1"; }
warn()    { printf '   %s!%s %s\n' "$c_yel" "$c_rst" "$1"; }
err()     { printf '   %s✗%s %s\n' "$c_red" "$c_rst" "$1" >&2; }
field()   { printf '   %s%-18s%s %s\n' "$c_dim" "$1" "$c_rst" "$2"; }
# Dimmed commentary — subordinate to ok/warn/err, used for context that is
# worth printing but is not a result.
info()    { printf '   %s%s%s\n' "$c_dim" "$1" "$c_rst"; }

# Interactive y/N — true only on a real terminal, reading the controlling tty.
UI_INTERACTIVE=false; [[ -t 0 && -t 1 ]] && UI_INTERACTIVE=true
confirm() {
    local ans
    [[ "$UI_INTERACTIVE" == true ]] || return 1
    printf '%s   ➜ %s [y/N] %s' "$c_bold" "$1" "$c_rst" >/dev/tty
    read -r ans </dev/tty || return 1
    [[ "$ans" == [yY] || "$ans" == [yY][eE][sS] ]]
}
