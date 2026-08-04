#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATION_LIB="$ROOT_DIR/release_manager/lib/input_validation.sh"
STATUS_SCRIPT="$ROOT_DIR/release_manager/status.sh"

fail_test() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[[ -f "$VALIDATION_LIB" ]] || fail_test 'input-validation library is missing'
# shellcheck source=../lib/input_validation.sh
source "$VALIDATION_LIB"

is_safe_log_basename 'dev-deploy-20260803T110730Z.log' \
    || fail_test 'valid deploy log basename was rejected'
for unsafe_name in '' '..' '../deploy.log' 'nested/deploy.log' "bad'file.log" $'bad\nfile.log'; do
    if is_safe_log_basename "$unsafe_name"; then
        fail_test "unsafe deploy log basename was accepted: $unsafe_name"
    fi
done

is_safe_absolute_remote_path '/srv/backup/BOE_APP/LOGS/DEV_LOGS' \
    || fail_test 'valid absolute remote path was rejected'
for unsafe_path in '' 'relative/path' '/srv/../etc' "/srv/bad'path" $'/srv/bad\npath'; do
    if is_safe_absolute_remote_path "$unsafe_path"; then
        fail_test "unsafe remote path was accepted: $unsafe_path"
    fi
done

grep -qF 'is_safe_log_basename "$f"' "$STATUS_SCRIPT" \
    || fail_test 'status log action does not validate the operator filename'
grep -qF 'tail -n 80 -- "$dir/$file"' "$STATUS_SCRIPT" \
    || fail_test 'status log action does not pass the remote path as data'

# ── rollback --to: remote command injection guard ────────────────────────────
# rollback.sh splices its arguments into a remotely-parsed ssh command string,
# so the version is validated locally (strict semver) and every argument is
# individually shell-quoted before the command is built. This also covers the
# version status.sh reads interactively — it is passed straight through here.
ROLLBACK_SCRIPT="$ROOT_DIR/release_manager/rollback.sh"

grep -qF "%q" "$ROLLBACK_SCRIPT" \
    || fail_test 'rollback.sh does not shell-quote the remote command arguments'
grep -qF '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$' "$ROLLBACK_SCRIPT" \
    || fail_test 'rollback.sh has no strict --to version validation'

RB_DIR="$(mktemp -d)"

# the healthy-VPS case below runs the real rollback.sh, which mutates the real
# ledger — back it up now and restore it from the EXIT trap (BEFORE the temp
# dir holding the backup is removed) so a mid-test failure cannot strand the
# mutated state
LEDGER="$ROOT_DIR/release_manager/state/versions.json"
had_ledger=false
[[ -f "$LEDGER" ]] && { cp "$LEDGER" "$RB_DIR/ledger.bak"; had_ledger=true; }
trap 'if [[ "$had_ledger" == true ]]; then cp "$RB_DIR/ledger.bak" "$LEDGER"; else rm -f "$LEDGER"; fi; rm -rf "$RB_DIR"' EXIT

# injection-style versions are rejected during argument parsing, before any
# remote command is built (no ssh stub needed — validation exits first)
for bad in '1.4.1; id' '1.4.1;id' '$(id)' '1.4.1`id`' '1.4.1 $(id)' '1.4' 'x.y.z' '1.4.1 '; do
    if bash "$ROLLBACK_SCRIPT" --dev --to "$bad" --yes >/dev/null 2>&1; then
        fail_test "rollback --to accepted an unsafe version: $bad"
    fi
done

# clean versions pass local validation and only fail at the (stubbed) SSH stage
mkdir -p "$RB_DIR/bin"
printf '#!/usr/bin/env bash\nexit 1\n' > "$RB_DIR/bin/ssh"
chmod +x "$RB_DIR/bin/ssh"
for good in '1.4.1' '1.4.1-dev.3'; do
    out="$(PATH="$RB_DIR/bin:$PATH" bash "$ROLLBACK_SCRIPT" --dev --to "$good" --yes 2>&1 || true)"
    if grep -q 'invalid rollback version' <<< "$out"; then
        fail_test "rollback --to rejected a clean version at local validation: $good"
    fi
    grep -q 'cannot reach' <<< "$out" \
        || fail_test "rollback with a clean version did not reach the SSH stage: $good"
done

# the remote command carries the validated arguments as one shell-quoted string
cat > "$RB_DIR/bin/ssh" <<EOF
#!/usr/bin/env bash
{ printf 'CALL'; printf ' <%s>' "\$@"; printf '\n'; } >> "$RB_DIR/ssh.log"
case "\$*" in
    *"bash -s --"*)
        cat >/dev/null 2>&1 || true
        printf 'script_present=yes\npaths_present=yes\nlib_present=yes\nbackup_mounted=yes\nbackup_writable=yes\ndocker_ok=yes\n' ;;
    *jq*) printf '1.4.0\nactive\n' ;;
esac
exit 0
EOF
chmod +x "$RB_DIR/bin/ssh"
: > "$RB_DIR/ssh.log"

PATH="$RB_DIR/bin:$PATH" bash "$ROLLBACK_SCRIPT" --dev --to 1.4.1 --yes </dev/null >/dev/null 2>&1 \
    || fail_test 'rollback with a clean version and a healthy (stubbed) VPS failed'

remote_line="$(grep 'dev_rollback.sh' "$RB_DIR/ssh.log" | tail -1)"
[[ -n "$remote_line" ]] || fail_test 'no remote rollback invocation was logged'
grep -qF -- '--to 1.4.1 --yes' <<< "$remote_line" \
    || fail_test "the remote rollback command lacks the validated arguments: $remote_line"
# the whole remote command must be ONE ssh argument (no word splitting)
grep -qE '<cd .*dev_rollback\.sh.*>' <<< "$remote_line" \
    || fail_test "the remote rollback command was not passed as one argument: $remote_line"

# ── BOE_SSH_ALIAS / BOE_SSH_KEY: operator env can never become ssh options ──
# shellcheck source=../lib/stacks.sh
source "$ROOT_DIR/release_manager/lib/stacks.sh"

BOE_SSH_ALIAS='beonedge'
unset BOE_SSH_KEY
boe_ssh_opts || fail_test 'the default SSH alias was rejected'

for bad_alias in '-oProxyCommand=evil' '-alias' 'bad alias' 'ali;as' 'ali$(id)as' ''; do
    BOE_SSH_ALIAS="$bad_alias"
    if boe_ssh_opts >/dev/null 2>&1; then
        fail_test "unsafe BOE_SSH_ALIAS was accepted: $bad_alias"
    fi
done

BOE_SSH_ALIAS='beonedge'
BOE_SSH_KEY='~/.ssh/id_ed25519'
boe_ssh_opts || fail_test 'a sane BOE_SSH_KEY path was rejected'
for bad_key in '-oProxyCommand=evil' '-i' 'key with spaces' 'key;rm' ''; do
    BOE_SSH_KEY="$bad_key"
    [[ -z "$bad_key" ]] && continue  # empty means "no key", which is valid
    if boe_ssh_opts >/dev/null 2>&1; then
        fail_test "unsafe BOE_SSH_KEY was accepted: $bad_key"
    fi
done
unset BOE_SSH_KEY

printf 'PASS: remote log inputs reject shell metacharacters and traversal\n'
