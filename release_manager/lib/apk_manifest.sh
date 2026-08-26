#!/usr/bin/env bash

apk_manifest_debuggable() {
    local aapt_bin="$1"
    local apk="$2"
    local badging

    [[ -x "$aapt_bin" && -f "$apk" ]] || return 1
    badging="$("$aapt_bin" dump badging "$apk" 2>/dev/null)" || return 1

    if grep -q 'application-debuggable' <<<"$badging"; then
        printf 'true\n'
    else
        printf 'false\n'
    fi
}
