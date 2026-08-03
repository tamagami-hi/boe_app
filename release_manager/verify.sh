#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# verify.sh — self-check for the release tooling. Changes nothing, anywhere.
#
# Catches the class of bug that is otherwise only discovered mid-deploy: a name
# that appears in two places and has silently drifted apart. Specifically it
# proves that
#
#   • every script parses, with local bash AND the VPS's bash
#   • the image tags lib/stacks.sh generates are exactly the tags the compose
#     files reference
#   • the container prefix in paths.json matches the compose container_name
#   • every port a compose file publishes is bound to 127.0.0.1
#   • postgres has no host port and lives only on the internal network
#   • the ports in .env.example match the ports in the nginx configs
#   • paths.json on disk matches what lib/stacks.sh would generate right now
#   • the VPS-native scripts have no unresolved dependencies
#
# Run before shipping, and after editing lib/stacks.sh or any compose file:
#     ./release_manager/verify.sh
#     ./release_manager/verify.sh --remote     also check the VPS
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RM_DIR="$ROOT_DIR/release_manager"
STACKS="$RM_DIR/stacks"
NGINX="$RM_DIR/nginx"

# shellcheck source=lib/ui.sh
source "$RM_DIR/lib/ui.sh"
# shellcheck source=lib/stacks.sh
source "$RM_DIR/lib/stacks.sh"
# shellcheck source=lib/paths.sh
source "$RM_DIR/lib/paths.sh"

CHECK_REMOTE=false
[[ "${1:-}" == "--remote" ]] && CHECK_REMOTE=true

PASS=0; FAIL=0; SKIP=0
pass() { ok   "$1"; PASS=$((PASS+1)); }
fail() { err  "$1"; FAIL=$((FAIL+1)); }
skip() { warn "$1 (skipped)"; SKIP=$((SKIP+1)); }

banner "VERIFY release tooling"

# ── 1. shell syntax ─────────────────────────────────────────────────────────
section "1  shell syntax (local bash $BASH_VERSION)"
while read -r f; do
    if bash -n "$f" 2>/dev/null; then pass "parses: ${f#"$RM_DIR"/}"
    else fail "SYNTAX ERROR: ${f#"$RM_DIR"/}"; fi
done < <(find "$RM_DIR" -name '*.sh' -not -path '*/build/*' | sort; echo "$ROOT_DIR/emu/boe_update.sh")

# ── 2. json validity + freshness ────────────────────────────────────────────
section "2  paths.json validity and freshness"
for s in "${BOE_STACKS[@]}"; do
    pj="$STACKS/$s/paths.json"
    if [[ ! -f "$pj" ]]; then fail "missing $s/paths.json"; continue; fi
    if ! jq empty "$pj" 2>/dev/null; then fail "$s/paths.json is not valid JSON"; continue; fi
    pass "$s/paths.json is valid JSON"

    # Regenerate into a temp file and compare, ignoring generated_at.
    tmp="$(mktemp)"
    if paths_write "$s" "$tmp" 2>/dev/null; then
        a="$(jq -S 'del(.generated_at)' "$pj")"
        b="$(jq -S 'del(.generated_at)' "$tmp")"
        if [[ "$a" == "$b" ]]; then pass "$s/paths.json is up to date with lib/stacks.sh"
        else fail "$s/paths.json is STALE — run status.sh option 7 to regenerate"; fi
    else
        fail "could not regenerate paths.json for $s"
    fi
    rm -f "$tmp"
done

if grep -q -- "--exclude='/.env'" "$RM_DIR/deploy.sh" \
    && ! find "$RM_DIR/build" -type f \( \( -name '.env*' ! -name '.env.example' \) -o -name '*.pem' -o -name '*.key' -o -name '*.swp' -o -name '*.swo' -o -name '*~' \) \
        -print -quit 2>/dev/null | grep -q .; then
    pass "release shipping and staged bundles exclude stack .env files"
else
    fail "release shipping could expose or overwrite a stack .env"
fi

# ── 2b. authoritative environment contract ─────────────────────────────────
section "2b stack-local .env contract"
if bash "$RM_DIR/tests/env_contract.test.sh" >/dev/null 2>&1; then
    pass "runtime accepts only a private stack-local .env"
else
    fail "stack-local .env contract tests failed"
fi
if bash "$RM_DIR/tests/deploy_env_validation.test.sh" >/dev/null 2>&1; then
    pass "deployment rejects incomplete and accepts valid application security configuration"
else
    fail "application security configuration tests failed"
fi
if bash "$RM_DIR/tests/runtime_contract.test.sh" >/dev/null 2>&1; then
    pass "frontend hardening and worker health contracts are consistent"
else
    fail "runtime hardening and worker health contract tests failed"
fi
if bash "$RM_DIR/tests/database_backup.test.sh" >/dev/null 2>&1; then
    pass "database backups use a valid docker exec invocation"
else
    fail "database backup CLI contract tests failed"
fi
if bash "$RM_DIR/tests/git_workflow.test.sh" >/dev/null 2>&1; then
    pass "Git workflow commits, integrates and pushes dirty release work"
else
    fail "Git release preparation workflow tests failed"
fi
if bash "$RM_DIR/tests/git_pr_workflow.test.sh" >/dev/null 2>&1; then
    pass "PR workflow pins, checks, approves and integrates reviewed heads"
else
    fail "Git PR review and integration workflow tests failed"
fi
if bash "$RM_DIR/tests/input_validation.test.sh" >/dev/null 2>&1; then
    pass "remote log inputs reject command injection and traversal"
else
    fail "remote input validation tests failed"
fi
if bash "$RM_DIR/tests/release_tag_contract.test.sh" >/dev/null 2>&1; then
    pass "stable releases require a matching tag commit on origin"
else
    fail "remote release tag contract tests failed"
fi
if bash "$RM_DIR/tests/repo_sync.test.sh" >/dev/null 2>&1; then
    pass "repository sync handles main-worktree paths containing spaces"
else
    fail "repository worktree-path sync tests failed"
fi

for s in "${BOE_STACKS[@]}"; do
    pj="$STACKS/$s/paths.json"
    if jq -e '.schema == 2 and .vps.env_file == (.vps.stack_dir + "/.env") and (.vps | has("secrets_env") | not)' \
        "$pj" >/dev/null 2>&1; then
        pass "$s: paths.json has one authoritative .env"
    else
        fail "$s: paths.json still declares an external secrets source"
    fi
done

for s in "${BOE_STACKS[@]}"; do
    cf="$STACKS/$s/$(stack_attr "$s" compose)"
    missing_vars="$(
        grep -oE '\$\{[A-Z0-9_]+' "$cf" \
            | sed 's/^${//' \
            | sort -u \
            | grep -vE '^(BOE_CONTAINER_PREFIX|COMPOSE_PROJECT_NAME)$' \
            | while read -r key; do
                grep -qE "^${key}=" "$STACKS/$s/.env.example" || printf '%s\n' "$key"
            done
    )"
    if [[ -z "$missing_vars" ]]; then
        pass "$s: .env.example declares every Compose variable"
    else
        fail "$s: .env.example is missing: $(printf '%s' "$missing_vars" | tr '\n' ' ')"
    fi
done

# ── 3. image tag agreement between the libs and the compose files ───────────
section "3  image tags: lib/stacks.sh vs compose files"
for s in dev_release prod_release; do
    cf="$STACKS/$s/$(stack_attr "$s" compose)"
    [[ -f "$cf" ]] || { fail "missing compose file for $s"; continue; }
    while IFS=: read -r key archive port; do
        [[ -n "$key" ]] || continue
        # The tag the tooling will produce, with the version placeholder removed.
        want="$(stack_image_tag "$s" "$key" '@@V@@')"
        repo="${want%%:*}"
        if grep -qE "^[[:space:]]*image:[[:space:]]*${repo}:\\\$\{BOE_VERSION\}" "$cf"; then
            pass "$s: compose references $repo:\${BOE_VERSION}"
        else
            fail "$s: compose does NOT reference '$repo' — tag drift between lib/stacks.sh and $cf"
        fi
    done < <(stack_images "$s")

    # No floating tags: a rollback must be able to name an exact image.
    if grep -qE '^[[:space:]]*image:.*:latest[[:space:]]*$' "$cf"; then
        fail "$s: compose uses a :latest tag — rollback could not name an exact image"
    else
        pass "$s: no :latest tags"
    fi
done

# ── 4. container prefix agreement ───────────────────────────────────────────
section "4  container prefix: paths.json vs compose"
for s in dev_release prod_release monitor_service; do
    pj="$STACKS/$s/paths.json"; cf="$STACKS/$s/$(stack_attr "$s" compose)"
    [[ -f "$pj" && -f "$cf" ]] || { skip "$s"; continue; }
    prefix="$(jq -r '.vps.container_prefix' "$pj")"
    if grep -q "BOE_CONTAINER_PREFIX:-${prefix}}" "$cf"; then
        pass "$s: prefix '$prefix' matches compose default"
    else
        fail "$s: paths.json says prefix '$prefix' but compose defaults differ — pg_container would look for the wrong container"
    fi
done

# ── 5. port bindings are loopback-only ──────────────────────────────────────
section "5  every published port is bound to 127.0.0.1"
for s in dev_release prod_release monitor_service; do
    cf="$STACKS/$s/$(stack_attr "$s" compose)"
    [[ -f "$cf" ]] || { skip "$s"; continue; }
    bad="$(grep -nE '^[[:space:]]*-[[:space:]]*"[^"]*:[0-9]+:[0-9]+"' "$cf" | grep -v '"127\.0\.0\.1:' || true)"
    if [[ -z "$bad" ]]; then
        pass "$s: all published ports bound to 127.0.0.1"
    else
        fail "$s: found a port NOT bound to loopback:"
        printf '%s\n' "$bad" | sed 's/^/        /'
    fi
done

# ── 6. postgres isolation ───────────────────────────────────────────────────
section "6  postgres has no host port and no external network"
for s in dev_release prod_release; do
    cf="$STACKS/$s/$(stack_attr "$s" compose)"
    [[ -f "$cf" ]] || { skip "$s"; continue; }
    # Extract the postgres service block and check for a ports: key.
    block="$(awk '/^  postgres:/{f=1} f&&/^  [a-z_]+:/&&!/^  postgres:/{f=0} f' "$cf")"
    if printf '%s' "$block" | grep -qE '^[[:space:]]+ports:'; then
        fail "$s: postgres publishes a host port — it must be internal only"
    else
        pass "$s: postgres has no host port"
    fi
    internal_net="$([[ "$s" == prod_release ]] && echo prod_internal || echo dev_internal)"
    if printf '%s' "$block" | grep -q -- "- $internal_net"; then
        pass "$s: postgres is on $internal_net"
    else
        fail "$s: postgres is not on $internal_net"
    fi
    if grep -A2 "^  ${internal_net}:" "$cf" | grep -q 'internal: true'; then
        pass "$s: $internal_net is internal:true (no route off-host)"
    else
        fail "$s: $internal_net is NOT internal:true"
    fi
done

# ── 7. ports agree between .env.example and the nginx configs ──────────────
section "7  ports: .env.example vs nginx configs"
env_port() { sed -n "s/^$2=//p" "$STACKS/$1/.env.example" | tail -n1 | tr -d '\r'; }

check_nginx_port() {
    local conf="$NGINX/$1" port="$2" label="$3"
    if [[ ! -f "$conf" ]]; then skip "$1 not found"; return; fi
    if grep -q "127\.0\.0\.1:${port}" "$conf"; then
        pass "$1: proxies to $port ($label)"
    else
        fail "$1: does NOT reference port $port ($label) — nginx and .env disagree"
    fi
}

pb="$(env_port prod_release BACKEND_PORT)"
pa="$(env_port prod_release APP_FRONTEND_PORT)"
pad="$(env_port prod_release ADMIN_FRONTEND_PORT)"
pl="$(env_port prod_release LANDING_PORT)"
db="$(env_port dev_release BACKEND_PORT)"
da="$(env_port dev_release APP_FRONTEND_PORT)"
dad="$(env_port dev_release ADMIN_FRONTEND_PORT)"
gp="$(env_port monitor_service GRAFANA_PORT)"

check_nginx_port app.beonedge.in.conf       "$pb"  "prod backend"
check_nginx_port app.beonedge.in.conf       "$pa"  "prod user SPA"
check_nginx_port admin.beonedge.in.conf     "$pad" "prod admin SPA"
check_nginx_port beonedge.in.conf           "$pl"  "prod landing"
check_nginx_port dev-app.beonedge.in.conf   "$db"  "dev backend"
check_nginx_port dev-app.beonedge.in.conf   "$da"  "dev user SPA"
check_nginx_port dev-admin.beonedge.in.conf "$dad" "dev admin SPA"
check_nginx_port monitor.beonedge.in.conf   "$gp"  "grafana"

# Ports must be unique across stacks, or two stacks fight over one binding.
# Only HOST-BINDING variables count. EMAIL_SMTP_PORT is an outbound destination,
# not a listener, so it legitimately has the same value in every stack.
section "7b uniqueness of host ports across all stacks"
HOST_PORT_VARS='BACKEND_PORT|LANDING_PORT|APP_FRONTEND_PORT|ADMIN_FRONTEND_PORT|GRAFANA_PORT|PROMETHEUS_PORT|ALERTMANAGER_PORT|BLACKBOX_PORT'
allports="$(for s in "${BOE_STACKS[@]}"; do
    grep -hE "^(${HOST_PORT_VARS})=" "$STACKS/$s/.env.example" 2>/dev/null | cut -d= -f2
done | grep -E '^[0-9]+$' | tr -d '\r' | sort)"
dupes="$(printf '%s\n' "$allports" | uniq -d)"
if [[ -z "$dupes" ]]; then
    pass "all $(printf '%s\n' "$allports" | grep -c .) host-binding ports are unique"
else
    fail "duplicate host-binding ports across stacks: $(printf '%s' "$dupes" | tr '\n' ' ')"
fi

# A host binding must not collide with something already listening on the VPS.
# These were verified in use at capture time; re-checked live by --remote.
section "7c host ports avoid known VPS listeners"
KNOWN_BUSY="22 53 80 443 631 3789 4000 5432 9000 20241 44667"
clash=""
for p in $allports; do
    for b in $KNOWN_BUSY; do [[ "$p" == "$b" ]] && clash="$clash $p"; done
done
[[ -z "$clash" ]] && pass "no port collides with a known VPS listener" \
    || fail "ports collide with known VPS listeners:$clash"

# ── 8. no secrets committed ─────────────────────────────────────────────────
section "8  no real secrets in the shipped templates"
leak=0
for s in "${BOE_STACKS[@]}"; do
    f="$STACKS/$s/.env.example"
    [[ -f "$f" ]] || continue
    # Every secret-ish key must be present but EMPTY in the template.
    while read -r line; do
        k="${line%%=*}"; v="${line#*=}"
        case "$k" in
            *PASSWORD*|*SECRET*|*_KEY|*_KEY_*|*DSN*|*TOKEN*)
                if [[ -n "$v" ]]; then
                    fail "$s/.env.example has a non-empty value for $k"
                    leak=1
                fi ;;
        esac
    done < <(grep -E '^[A-Z_]+=' "$f")
done
(( leak == 0 )) && pass "no populated secret values in any .env.example"

for s in "${BOE_STACKS[@]}"; do
    if [[ -f "$STACKS/$s/.env" ]]; then
        fail "$s/.env exists in the repo — it must only ever live on the VPS"
    fi
done
pass "no .env files staged in release_manager/stacks"

# ── 9. shipped-file completeness ────────────────────────────────────────────
section "9  each stack can be shipped self-sufficient"
for s in "${BOE_STACKS[@]}"; do
    missing=()
    for f in "$(stack_attr "$s" compose)" "$(stack_attr "$s" deploy)" \
             "$(stack_attr "$s" rollback)" "$(stack_attr "$s" guide)" \
             .env.example paths.json; do
        [[ -f "$STACKS/$s/$f" ]] || missing+=("$f")
    done
    if (( ${#missing[@]} == 0 )); then pass "$s has every required artifact"
    else fail "$s is missing: ${missing[*]}"; fi
done
for f in _boe_lib.sh _boe_deploy.sh _boe_rollback.sh; do
    [[ -f "$STACKS/_shared/$f" ]] && pass "shared: $f" || fail "shared library missing: $f"
done

# ── 10. the deploy/rollback lock is shared per stack ────────────────────────
section "10 deploy and rollback share one lock per stack"
for s in "${BOE_STACKS[@]}"; do
    l="$(jq -r '.vps.lock_file' "$STACKS/$s/paths.json" 2>/dev/null)"
    if [[ "$l" == "/run/lock/boe-${s}.lock" ]]; then
        pass "$s: lock is $l (used by both scripts via boe_lock)"
    else
        fail "$s: unexpected lock path '$l'"
    fi
done

# ── 11. remote checks ───────────────────────────────────────────────────────
if [[ "$CHECK_REMOTE" == true ]]; then
    section "11 remote (VPS) checks"
    if boe_ssh true 2>/dev/null; then
        pass "SSH to $BOE_SSH_ALIAS"

        rbash="$(boe_ssh 'echo $BASH_VERSION' 2>/dev/null)"
        field "remote bash" "$rbash"
        rf=0
        while read -r f; do
            if ! boe_ssh 'bash -n /dev/stdin' < "$f" 2>/dev/null; then
                fail "remote bash rejects: ${f#"$RM_DIR"/}"; rf=1
            fi
        done < <(find "$STACKS" -name '*.sh' | sort)
        (( rf == 0 )) && pass "all VPS-native scripts parse with the VPS's own bash"

        for c in docker jq sha256sum flock mountpoint rsync gzip curl numfmt getfacl openssl base64; do
            if boe_ssh "command -v $c >/dev/null" 2>/dev/null; then pass "remote tool: $c"
            else fail "remote tool MISSING: $c"; fi
        done

        boe_ssh 'docker info >/dev/null 2>&1' && pass "remote docker usable without sudo" \
            || fail "remote docker not usable"
        boe_ssh "mountpoint -q $BOE_BACKUP_MOUNT" && pass "remote $BOE_BACKUP_MOUNT is mounted" \
            || fail "remote $BOE_BACKUP_MOUNT NOT mounted"
        if boe_ssh "test -w $BOE_BACKUP_ROOT" 2>/dev/null; then
            pass "remote $BOE_BACKUP_ROOT is writable"
        else
            fail "remote $BOE_BACKUP_ROOT NOT writable — see OPERATOR_MANUAL_STEPS.md §1"
        fi

        for s in "${BOE_STACKS[@]}"; do
            remote_env="$BOE_VPS_ROOT/$s/.env"
            if ! boe_ssh "test -s '$remote_env'" 2>/dev/null; then
                skip "$s: remote .env missing/empty"
                continue
            fi
            if boe_ssh "bash -s -- '$remote_env'" <<'REMOTE_ENV' >/dev/null 2>&1
file="$1"
[[ ! -L "$file" && -f "$file" && -r "$file" ]] || exit 1
mode="$(stat -c '%a' "$file")"
owner="$(stat -c '%u' "$file")"
links="$(stat -c '%h' "$file")"
[[ "$links" == 1 ]] || exit 1
[[ "$owner" == "$(id -u)" && "$mode" == 600 ]] || [[ "$owner" == 0 && "$mode" == 640 ]]
REMOTE_ENV
            then
                pass "$s: remote .env ownership and permissions are secure"
            else
                fail "$s: remote .env must be deploy-user mode 600 or readable root-owned mode 640"
            fi
        done

        # Ports we intend to publish must actually be free.
        busy=""
        for p in $allports; do
            boe_ssh "ss -lntu 2>/dev/null | grep -q ':$p '" && busy="$busy $p"
        done
        [[ -z "$busy" ]] && pass "all intended host ports are free on the VPS" \
            || fail "ports already in use on the VPS:$busy"
    else
        fail "cannot reach $BOE_SSH_ALIAS over SSH"
    fi
else
    section "11 remote (VPS) checks"
    skip "pass --remote to include them"
fi

# ── summary ─────────────────────────────────────────────────────────────────
printf '\n%s══════════════════════════════════════════%s\n' "$c_bold" "$c_rst"
printf '  %spassed%s  %d\n' "$c_grn" "$c_rst" "$PASS"
printf '  %sfailed%s  %d\n' "$([[ $FAIL -gt 0 ]] && printf '%s' "$c_red" || printf '%s' "$c_dim")" "$c_rst" "$FAIL"
printf '  %sskipped%s %d\n' "$c_dim" "$c_rst" "$SKIP"
printf '%s══════════════════════════════════════════%s\n\n' "$c_bold" "$c_rst"

(( FAIL == 0 )) || exit 1
