#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# apk_ship.sh — shared APK artifact publisher for the release tooling.
# Callers must source ui.sh and stacks.sh first.
#
# Design rules:
#   • Every destination comes from the selected stack's paths.json, resolved by
#     ONE seam — apk_contract_destination. The schema-3 contract carries an
#     explicit apk.destinations[] routing table (variant → current_dir +
#     rollback_dir); routing follows the declared variant only — never array
#     position, never a directory basename.
#   • Fail closed: symlinks (local and remote), unsafe paths, provenance or
#     digest mismatches all abort with a precise message.
#   • The expected remote digest always comes from the already validated
#     immutable sidecar/manifest — never recomputed from a mutable file after
#     validation.
#   • Publication is atomic: upload to a temporary remote filename, verify the
#     remote SHA-256, then rename into place. An interrupted upload can never
#     leave a partial current APK.
# ─────────────────────────────────────────────────────────────────────────────

# ── exact local artifact selection ───────────────────────────────────────────
# apk_ship_exact_apk <source_dir> <target> <variant> <version>
# Echo the exact artifact path, or return 1. Never globs, never picks by mtime,
# so retained older/newer builds in the source directory are always ignored.
apk_ship_exact_apk() {
    local source_dir="$1" target="$2" variant="$3" version="$4" apk
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
    apk="$source_dir/boe.$target.$variant.$version.apk"
    [[ -f "$apk" && ! -L "$apk" ]] || return 1
    printf '%s\n' "$apk"
}

# ── destination contract (the schema seam) ───────────────────────────────────
# apk_contract_destination <paths_file> <target> <variant>
# Echo "<current_dir>\t<rollback_dir>" for one variant, or return 1.
#
# Schema-3 reading: routing follows the explicit apk.destinations[] entry whose
# .variant matches the request — never the array position, and never anything
# inferred from a directory basename. The contract must declare apk.enabled,
# exactly one client and one admin destination, all paths shell-safe, each
# current_dir inside vps.stack_dir, and each rollback_dir inside the stack's
# backup rollback tree. The two variants must never share or overlap a
# directory.
apk_contract_destination() {
    local paths_file="$1" target="$2" variant="$3"
    local stack_dir backup_root rollback_root

    [[ "$target" =~ ^(dev|prod)$ ]] || { err "invalid APK target: $target"; return 1; }
    [[ "$variant" == client || "$variant" == admin ]] \
        || { err "invalid APK variant: $variant"; return 1; }
    [[ -f "$paths_file" && ! -L "$paths_file" ]] \
        || { err "APK paths contract missing or unsafe: $paths_file"; return 1; }

    jq -e --arg target "$target" --arg variant "$variant" \
        '.schema == 3 and .short == $target
         and (.stack | type == "string")
         and .apk.enabled == true
         and (.apk.destinations | type == "array")
         and ([.apk.destinations[].variant] | sort == ["admin", "client"])
         and ([.apk.destinations[] | select(.variant == $variant)] | length == 1)' \
        "$paths_file" >/dev/null 2>&1 \
        || { err "invalid or mismatched APK paths contract: $paths_file"; return 1; }

    stack_dir="$(jq -r '.vps.stack_dir // empty' "$paths_file")"
    backup_root="$(jq -r '.backup.root // empty' "$paths_file")"
    rollback_root="$(jq -r '.backup.rollback_root // empty' "$paths_file")"

    local dest current_dir rollback_dir
    dest="$(jq -r --arg variant "$variant" \
        '[.apk.destinations[] | select(.variant == $variant) | .current_dir, .rollback_dir] | @tsv' \
        "$paths_file")"
    current_dir="$(printf '%s' "$dest" | cut -f1)"
    rollback_dir="$(printf '%s' "$dest" | cut -f2)"

    assert_safe_remote_dir "$stack_dir" || return 1
    assert_safe_remote_dir "$backup_root" || return 1
    assert_safe_remote_dir "$rollback_root" || return 1
    assert_safe_remote_dir "$current_dir" || return 1
    assert_safe_remote_dir "$rollback_dir" || return 1
    [[ "$current_dir" == "$stack_dir/"* ]] \
        || { err "APK current dir escapes the selected stack directory: $current_dir"; return 1; }
    [[ "$rollback_root" == "$backup_root/"* ]] \
        || { err "stack rollback root escapes the backup root: $rollback_root"; return 1; }
    [[ "$rollback_dir" == "$rollback_root/"* ]] \
        || { err "APK rollback dir escapes the stack rollback root: $rollback_dir"; return 1; }

    # The two variants must never share or overlap a directory, in either
    # direction and across the current/rollback split.
    local other other_current other_rollback pair a b
    other=admin; [[ "$variant" == admin ]] && other=client
    other_current="$(jq -r --arg v "$other" \
        '.apk.destinations[] | select(.variant == $v) | .current_dir' "$paths_file")"
    other_rollback="$(jq -r --arg v "$other" \
        '.apk.destinations[] | select(.variant == $v) | .rollback_dir' "$paths_file")"
    for pair in "$current_dir $other_current" "$rollback_dir $other_rollback" \
                "$current_dir $other_rollback" "$rollback_dir $other_current"; do
        a="${pair%% *}"; b="${pair##* }"
        [[ "$a" != "$b" && "$a" != "$b/"* && "$b" != "$a/"* ]] || {
            err "APK destinations overlap: $a vs $b"
            return 1
        }
    done

    printf '%s\t%s\n' "$current_dir" "$rollback_dir"
}

# ── local validation ─────────────────────────────────────────────────────────
# apk_validate_local_artifact <apk> <target> <variant> <version> [expected_git] [mode]
# Validate the APK and its immutable sidecar; echo the sidecar-recorded SHA-256
# (the expected remote digest) on success. mode=prod additionally enforces the
# production gate: clean tree, exact release label, and approved signing.
apk_validate_local_artifact() {
    local apk="$1" target="$2" variant="$3" version="$4"
    local expected_git="${5:-}" mode="${6:-dev}"
    local sidecar="${apk%.apk}.json" expected actual sidecar_commit signing

    [[ -f "$apk" && ! -L "$apk" ]] \
        || { err "missing or unsafe APK artifact: $apk"; return 1; }
    [[ -f "$sidecar" && ! -L "$sidecar" ]] \
        || { err "missing or unsafe APK sidecar: $sidecar"; return 1; }
    jq empty "$sidecar" 2>/dev/null \
        || { err "malformed APK sidecar: $sidecar"; return 1; }
    jq -e --arg target "$target" --arg variant "$variant" --arg version "$version" \
        '.target == $target and .variant == $variant and .version == $version' \
        "$sidecar" >/dev/null \
        || { err "APK sidecar provenance mismatch: $sidecar"; return 1; }

    expected="$(jq -r '.sha256 // empty' "$sidecar")"
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] \
        || { err "APK sidecar has no valid sha256: $sidecar"; return 1; }
    actual="$(sha256sum "$apk" | cut -d' ' -f1)"
    [[ "$expected" == "$actual" ]] || {
        err "APK sidecar checksum mismatch: $(basename "$apk")"
        return 1
    }

    if [[ -n "$expected_git" ]]; then
        sidecar_commit="$(jq -r '.gitCommit // empty' "$sidecar")"
        # The sidecar is JSON input: treat its commit strictly as data. Only a
        # plain hex SHA may take part in the comparison, and the prefix match
        # must use fixed strings — never a pattern, or a sidecar value like
        # "0123*" would glob-match commits it does not name.
        [[ "$sidecar_commit" =~ ^[0-9a-f]{7,40}$ ]] || {
            err "APK sidecar records no valid git commit: $sidecar"
            return 1
        }
        case "$expected_git" in
            "$sidecar_commit"*) ;;
            *)
                err "APK sidecar commit does not match the gated commit: $sidecar"
                return 1
                ;;
        esac
    fi

    if [[ "$mode" == prod ]]; then
        jq -e '.gitDirty == false' "$sidecar" >/dev/null || {
            err "production APK was built from a dirty tree: $sidecar"
            return 1
        }
        jq -e --arg version "$version" '.buildLabel == $version' "$sidecar" >/dev/null || {
            err "production APK build label is not the exact release version: $sidecar"
            return 1
        }
        signing="$(jq -r '.signing // "unknown"' "$sidecar")"
        jq -e '.signing == "release" and .buildType == "release"' \
            "$sidecar" >/dev/null || {
            err "production APK must be release-signed, but the sidecar records signing=$signing"
            err "emu/boe_update.sh runs assembleRelease when android/keystore.properties is"
            err "present and falls back to assembleDebug when it is not — check the keystore"
            return 1
        }
        jq -e '.debuggable == false' "$sidecar" >/dev/null || {
            err "production APK must be proven non-debuggable, but the sidecar records debuggable=$(jq -r '.debuggable // "unknown"' "$sidecar")"
            err "rebuild with emu/boe_update.sh — it measures the final APK with aapt"
            err "and refuses a release artifact whose manifest is debuggable"
            return 1
        }
    fi

    printf '%s\n' "$expected"
}

# ── manifest reading ─────────────────────────────────────────────────────────
# apk_manifest_artifact <manifest_file> <variant>
# Echo "<file>\t<sha256>\t<target>\t<version>\t<git_sha>" from a bundle
# manifest's .apk.<variant> entry, or return 1.
apk_manifest_artifact() {
    local manifest="$1" variant="$2"
    [[ -f "$manifest" && ! -L "$manifest" ]] \
        || { err "bundle manifest missing or unsafe: $manifest"; return 1; }
    # The filename and version are later spliced into a remotely-reparsed
    # command string, so they must match the strict artifact-name and
    # semver/dev-label charsets here — never arbitrary bundle-controlled text.
    jq -er --arg v "$variant" '
        (.apk[$v] // {}) |
        [(.file // ""), (.sha256 // ""), (.target // ""), (.version // ""), (.git_sha // "")] |
        if (.[0] | test("^boe\\.[a-z]+\\.[a-z]+\\.[A-Za-z0-9._-]+\\.apk$"))
           and (.[1] | test("^[0-9a-f]{64}$"))
           and (.[2] | length > 0) and (.[3] | test("^[A-Za-z0-9._-]+$"))
        then join("\t")
        else error("invalid or missing APK manifest entry for variant " + $v)
        end' "$manifest" 2>/dev/null || {
        err "invalid or missing APK manifest entry for variant $variant"
        return 1
    }
}

# ── remote plumbing ──────────────────────────────────────────────────────────
# These three are the only functions that touch the VPS; tests stub boe_ssh
# and rsync, so everything above stays locally testable.

# apk_contract_lock_file <paths_file> — echo the stack's remote deploy lock
# from the contract. APK archive/publish take this lock on the VPS so they can
# never interleave with a concurrent deploy or rollback.
apk_contract_lock_file() {
    local paths_file="$1" lock_file
    lock_file="$(jq -r '.vps.lock_file // empty' "$paths_file")"
    assert_safe_remote_dir "$lock_file" \
        || { err "APK contract has no safe remote lock file: $paths_file"; return 1; }
    printf '%s\n' "$lock_file"
}

# apk_contract_keep_releases <paths.json> — the stack's APK retention count.
#
# Read from the contract rather than hardcoded, because retention.keep_releases
# is the single declared answer for the stack and paths_validate already checks
# it agrees with lib/stacks.sh. Falls back to 3 only if the key is somehow absent,
# so retirement still bounds the holder instead of silently doing nothing.
apk_contract_keep_releases() {
    local paths_file="$1" keep
    keep="$(jq -r '.retention.keep_releases // empty' "$paths_file" 2>/dev/null)"
    [[ "$keep" =~ ^[0-9]+$ && "$keep" -ge 1 ]] || keep=3
    printf '%s\n' "$keep"
}

apk_ship_prepare_remote_dir() {
    local remote_dir="$1"
    assert_safe_remote_dir "$remote_dir" || return 1
    boe_ssh "test ! -L '$remote_dir' && install -d -m 755 -- '$remote_dir'"
}

apk_ship_transfer_file() {
    local local_file="$1" remote_path="$2" rsync_ssh
    boe_ssh_opts
    printf -v rsync_ssh '%q ' ssh "${BOE_SSH_OPTS[@]}"
    rsync -az --checksum --chmod=F644 -e "$rsync_ssh" \
        "$local_file" "${BOE_SSH_ALIAS}:${remote_path}"
}

# apk_retire_remote_variant <current_dir> <rollback_dir> <lock_file> <keep>
#
# Retire superseded APKs out of a variant's holder directory and enforce
# retention on the archive. Prints nothing on success; returns non-zero on
# failure. Takes the stack's remote deploy lock first, so a concurrent deploy or
# rollback can never interleave.
#
# This replaced a whole-directory snapshot (`cp` every *.apk and *.json into a
# fresh apk-archive-<stamp>/ dir) that had two compounding faults:
#
#   • It copied instead of moving, so nothing ever left the holder. dev_apk
#     accumulated ten versions, and the in-app update feed had to sift ten
#     sidecars to answer one question.
#   • Because each snapshot copied the *whole* holder, and the holder only ever
#     grew, archive size grew quadratically with release count. Measured on the
#     dev stack: 16 snapshots holding 310 MB of near-duplicate APKs.
#
# The model now matches how the Docker images are handled: the holder carries
# only the live release, and history lives per-version under the rollback
# directory (DEPLOY_IMAGES/<version>/ for images, <rollback_dir>/<version>/ for
# APKs), pruned to retention.keep_releases from the stack's path contract.
#
# Every superseded version is moved out, so after the caller publishes the
# incoming APK the holder holds exactly that one — which also means the in-app
# update feed reads one sidecar rather than ten. `keep` bounds the archive, not
# the holder.
#
# Archive pruning is by directory mtime, not version string: APK versions can
# carry -dev.N.gSHA prereleases, which version sort ranks above the release they
# precede. It also applies to the legacy apk-archive-<stamp>/ and
# pre-deploy-<version>/ directories, so the historical backlog drains instead of
# being stranded forever.
#
# The move happens before pruning, and pruning never removes the last remaining
# archive, so no failure path can leave an artifact unrecoverable.
apk_retire_remote_variant() {
    local current_dir="$1" rollback_dir="$2" lock_file="$3" keep="${4:-3}"
    local live_version="${5:-}" output remote_cmd
    assert_safe_remote_dir "$current_dir" || return 1
    assert_safe_remote_dir "$rollback_dir" || return 1
    assert_safe_remote_dir "$lock_file" || return 1
    [[ "$keep" =~ ^[0-9]+$ && "$keep" -ge 1 ]] \
        || { err "invalid APK retention count: $keep"; return 1; }
    [[ -n "$live_version" ]] \
        || { err "retirement needs the live version to preserve"; return 1; }

    # Every argument is individually shell-quoted before it is spliced into the
    # remotely-parsed command string, so no argument can ever break out and be
    # re-interpreted by the remote shell.
    printf -v remote_cmd 'bash -s -- %q %q %q %q %q' \
        "$current_dir" "$rollback_dir" "$lock_file" "$keep" "$live_version"
    output="$(boe_ssh "$remote_cmd" <<'REMOTE'
set -euo pipefail
current_dir="$1"
rollback_dir="$2"
lock_file="$3"
keep="$4"
live_version="$5"
[[ ! -L "$current_dir" ]]  || { printf 'APK holder is a symlink: %s\n' "$current_dir" >&2; exit 1; }
[[ ! -L "$rollback_dir" ]] || { printf 'rollback APK dir is a symlink: %s\n' "$rollback_dir" >&2; exit 1; }

exec 9>"$lock_file"
flock -n 9 || { printf 'another deploy or rollback holds the stack lock: %s\n' "$lock_file" >&2; exit 1; }

if ! compgen -G "$current_dir/*.apk" >/dev/null 2>&1; then
    printf 'none\n'
    exit 0
fi

install -d -m 755 -- "$rollback_dir"
[[ -w "$rollback_dir" ]] || { printf 'rollback APK dir is not writable: %s\n' "$rollback_dir" >&2; exit 1; }

# Move every currently published version into its own archive directory. The
# caller publishes the incoming APK next, so the holder ends up with just it.
moved=0
while IFS= read -r apk_path; do
    [[ -f "$apk_path" && ! -L "$apk_path" ]] || continue
    apk_name="${apk_path##*/}"
    version="${apk_name%.apk}"
    version="${version##*.client.}"
    version="${version##*.admin.}"
    [[ -n "$version" ]] || continue
    # The release just published stays put; only what it superseded moves.
    [[ "$version" != "$live_version" ]] || continue

    dest="$rollback_dir/$version"
    install -d -m 755 -- "$dest"
    for artifact in "$apk_path" "${apk_path%.apk}.json"; do
        [[ -f "$artifact" && ! -L "$artifact" ]] || continue
        mv -f -- "$artifact" "$dest/"
    done
    ( cd "$dest" && find . -maxdepth 1 -type f \( -name '*.apk' -o -name '*.json' \) \
        -exec sha256sum {} + > checksums.sha256 )
    moved=$(( moved + 1 ))
done < <(find "$current_dir" -maxdepth 1 -type f -name '*.apk' | LC_ALL=C sort)

# Retention on the archive, oldest first, never leaving zero targets.
pruned=0
mapfile -t archives < <(find "$rollback_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@\t%f\n' \
    | LC_ALL=C sort -k1,1n | cut -f2-)
excess=$(( ${#archives[@]} - keep ))
for (( i = 0; i < excess; i++ )); do
    rm -rf -- "$rollback_dir/${archives[$i]}"
    pruned=$(( pruned + 1 ))
done

printf 'retired=%s pruned=%s\n' "$moved" "$pruned"
REMOTE
)" || return 1

    case "$output" in
        none) info "no published APKs in ${current_dir##*/} yet" ;;
        *)    ok "${current_dir##*/}: $output (archive keep=$keep)" ;;
    esac
}

# apk_publish_remote_atomic <apk> <sidecar> <current_dir> <expected_sha> <lock_file>
# Upload both files to temporary remote names, verify BOTH remote SHA-256
# digests against the expected (already validated) values, and only then
# rename both into place. Fails closed on remote symlinks and digest
# mismatches. On any verification failure both temp files are removed and the
# previous current APK/sidecar pair is left untouched. If the APK rename
# succeeds but the sidecar rename fails, the exact resulting holder state is
# reported (new APK beside the old sidecar). The verify-then-rename runs under
# the stack's remote deploy lock, so a concurrent rollback can never
# interleave with it.
apk_publish_remote_atomic() {
    local apk="$1" sidecar="$2" current_dir="$3" expected_sha="$4" lock_file="$5"
    local filename sidecar_name sidecar_sha remote_cmd
    filename="$(basename "$apk")"
    sidecar_name="$(basename "$sidecar")"
    [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] \
        || { err "invalid expected digest for $filename"; return 1; }
    assert_safe_remote_dir "$lock_file" || return 1
    sidecar_sha="$(sha256sum "$sidecar" | cut -d' ' -f1)"

    apk_ship_prepare_remote_dir "$current_dir" || {
        err "remote APK directory missing or unsafe: $current_dir"
        return 1
    }
    apk_ship_transfer_file "$apk" "$current_dir/.$filename.upload" || return 1
    apk_ship_transfer_file "$sidecar" "$current_dir/.$sidecar_name.upload" || return 1

    # Every argument is individually shell-quoted before it is spliced into the
    # remotely-parsed command string, so no argument can ever break out and be
    # re-interpreted by the remote shell.
    printf -v remote_cmd 'bash -s -- %q %q %q %q %q %q' \
        "$current_dir" "$filename" "$expected_sha" "$sidecar_name" "$sidecar_sha" "$lock_file"
    if ! boe_ssh "$remote_cmd" <<'REMOTE'
set -euo pipefail
dir="$1"
apk_name="$2"
want_apk="$3"
sc_name="$4"
want_sc="$5"
lock_file="$6"
[[ ! -L "$dir" ]] || { printf 'remote APK dir is a symlink: %s\n' "$dir" >&2; exit 1; }
apk_tmp="$dir/.$apk_name.upload"
sc_tmp="$dir/.$sc_name.upload"
apk_final="$dir/$apk_name"
sc_final="$dir/$sc_name"
exec 9>"$lock_file"
if ! flock -n 9; then
    rm -f -- "$apk_tmp" "$sc_tmp"
    printf 'another deploy or rollback holds the stack lock: %s\n' "$lock_file" >&2
    exit 1
fi

# Phase 1: verify BOTH uploads before anything is renamed into place. Any
# failure here leaves the live pair untouched; clean up both temp files.
verify_upload() {
    local tmp="$1" want="$2" got
    [[ -f "$tmp" && ! -L "$tmp" ]] || { printf 'uploaded artifact missing or unsafe: %s\n' "$tmp" >&2; return 1; }
    got="$(sha256sum -- "$tmp" | awk '{print $1}')"
    [[ "$got" == "$want" ]] || { printf 'remote checksum mismatch for %s\n' "$tmp" >&2; return 1; }
}
if ! verify_upload "$apk_tmp" "$want_apk" || ! verify_upload "$sc_tmp" "$want_sc"; then
    rm -f -- "$apk_tmp" "$sc_tmp"
    printf 'publication aborted; the previous current APK and sidecar are intact\n' >&2
    exit 1
fi
for final in "$apk_final" "$sc_final"; do
    if [[ -L "$final" ]]; then
        rm -f -- "$apk_tmp" "$sc_tmp"
        printf 'remote destination is a symlink: %s\n' "$final" >&2
        exit 1
    fi
done

# Phase 2: both digests verified — rename both into place.
mv -T -- "$apk_tmp" "$apk_final"
if ! mv -T -- "$sc_tmp" "$sc_final"; then
    printf 'APK renamed into place but the sidecar rename failed: %s now holds the NEW %s beside the OLD sidecar\n' \
        "$dir" "$apk_name" >&2
    rm -f -- "$sc_tmp"
    exit 1
fi
REMOTE
    then
        err "atomic publish failed for $filename — see the remote diagnostic above for the exact holder state"
        return 1
    fi
}

# ── orchestration ────────────────────────────────────────────────────────────
# apk_ship_variant <paths_file> <source_dir> <target> <variant> <version>
#                  [archive=true|false] [expected_git] [mode=dev|prod]
apk_ship_variant() {
    local paths_file="$1" source_dir="$2" target="$3" variant="$4" version="$5"
    local archive="${6:-true}" expected_git="${7:-}" mode="${8:-dev}"
    local dest current_dir rollback_dir apk sha lock_file

    dest="$(apk_contract_destination "$paths_file" "$target" "$variant")" || return 1
    current_dir="${dest%%$'\t'*}"
    rollback_dir="${dest#*$'\t'}"
    lock_file="$(apk_contract_lock_file "$paths_file")" || return 1

    apk="$(apk_ship_exact_apk "$source_dir" "$target" "$variant" "$version")" || {
        err "no regular $target $variant APK for exact version $version in $source_dir"
        return 1
    }
    sha="$(apk_validate_local_artifact "$apk" "$target" "$variant" "$version" \
        "$expected_git" "$mode")" || return 1

    step "publishing $target $variant APK → $current_dir"
    apk_publish_remote_atomic "$apk" "${apk%.apk}.json" "$current_dir" "$sha" \
        "$lock_file" || return 1
    ok "published $(basename "$apk") → ${current_dir##*/}"

    # Retire only after the new APK is verifiably in place: retirement moves
    # artifacts out of the holder, and the in-app update feed reads the holder,
    # so retiring first would mean an empty holder — "no update available" to
    # every installed app — if the publish then failed.
    if [[ "$archive" == true ]]; then
        apk_retire_remote_variant "$current_dir" "$rollback_dir" "$lock_file" \
            "$(apk_contract_keep_releases "$paths_file")" "$version" || return 1
    fi
}

# apk_ship_release <paths_file> <source_dir> <target> <version>
#                  [archive=true|false] [expected_git] [mode=dev|prod]
# Ship BOTH variants of one target at one exact version. Fails if either is
# missing or invalid — a half-published release never reports success.
#
# Ordering is deliberate: BOTH variants are validated and their outgoing
# artifacts archived FIRST; only then is either variant published. A failure
# mid-publish can therefore never leave a live client/admin pair in which one
# variant's previous release was never archived.
apk_ship_release() {
    local paths_file="$1" source_dir="$2" target="$3" version="${4:-}"
    local archive="${5:-true}" expected_git="${6:-}" mode="${7:-dev}"
    local tool variant

    [[ "$target" =~ ^(dev|prod)$ ]] || { err "invalid APK target: $target"; return 1; }
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
        || { err "an exact APK version is required"; return 1; }
    [[ "$archive" == true || "$archive" == false ]] \
        || { err "invalid APK archive mode: $archive"; return 1; }
    [[ "$mode" == dev || "$mode" == prod ]] \
        || { err "invalid APK publish mode: $mode"; return 1; }
    [[ "$mode" != prod || "$target" == prod ]] \
        || { err "production gating requires the prod target"; return 1; }
    for tool in jq rsync sha256sum; do
        command -v "$tool" >/dev/null 2>&1 || { err "$tool is required to ship APKs"; return 1; }
    done
    [[ -d "$source_dir" && ! -L "$source_dir" ]] \
        || { err "APK source directory missing or unsafe: $source_dir"; return 1; }

    # Phase 1: resolve, validate and archive BOTH variants before publishing.
    local dest current_dir rollback_dir apk sha lock_file
    lock_file="$(apk_contract_lock_file "$paths_file")" || return 1
    local -a phase_variants=() phase_apks=() phase_shas=() phase_currents=() phase_rollbacks=() phase_versions=()
    for variant in client admin; do
        dest="$(apk_contract_destination "$paths_file" "$target" "$variant")" || return 1
        current_dir="${dest%%$'\t'*}"
        rollback_dir="${dest#*$'\t'}"

        apk="$(apk_ship_exact_apk "$source_dir" "$target" "$variant" "$version")" || {
            err "no regular $target $variant APK for exact version $version in $source_dir"
            return 1
        }
        sha="$(apk_validate_local_artifact "$apk" "$target" "$variant" "$version" \
            "$expected_git" "$mode")" || return 1

        phase_rollbacks+=("$rollback_dir")
        phase_variants+=("$variant")
        phase_apks+=("$apk")
        phase_shas+=("$sha")
        phase_currents+=("$current_dir")
        phase_versions+=("$version")
    done

    # Phase 2: publish both variants.
    local i
    for i in "${!phase_variants[@]}"; do
        variant="${phase_variants[$i]}"
        apk="${phase_apks[$i]}"
        current_dir="${phase_currents[$i]}"
        step "publishing $target $variant APK → $current_dir"
        apk_publish_remote_atomic "$apk" "${apk%.apk}.json" "$current_dir" \
            "${phase_shas[$i]}" "$lock_file" || return 1
        ok "published $(basename "$apk") → ${current_dir##*/}"
    done

    # Phase 3: retire the superseded versions, only once BOTH variants are
    # published. Retirement moves artifacts out of the holder, so doing it
    # earlier would leave the holder empty if a publish then failed — and the
    # in-app update feed reads the holder, so "empty" means "no update
    # available" to every installed app. Publishing first keeps the previous
    # release serveable until the new one is verifiably in place.
    if [[ "$archive" == true ]]; then
        local keep
        keep="$(apk_contract_keep_releases "$paths_file")"
        for i in "${!phase_variants[@]}"; do
            apk_retire_remote_variant "${phase_currents[$i]}" "${phase_rollbacks[$i]}" \
                "$lock_file" "$keep" "${phase_versions[$i]}" || return 1
        done
    fi
}

# apk_ship_bundle <paths_file> <bundle_dir> <target> [archive=true|false] [mode=dev|prod]
# Publish the exact manifest-bound APKs of a staged bundle. The manifest is the
# selection authority: filename, digest, target, version and git commit must
# all match the staged files; the expected remote digest comes from the
# manifest/sidecar, never recomputed after validation.
#
# Ordering mirrors apk_ship_release: BOTH variants are validated and archived
# first; only then is either published, so a mid-failure cannot leave a mixed
# client/admin pair live.
apk_ship_bundle() {
    local paths_file="$1" bundle_dir="$2" target="$3"
    local archive="${4:-true}" mode="${5:-dev}"
    local manifest="$bundle_dir/manifest.json"
    local variant entry file msha mtarget mversion mgit dest
    local current_dir rollback_dir apk actual lock_file

    [[ "$target" =~ ^(dev|prod)$ ]] || { err "invalid APK target: $target"; return 1; }
    [[ "$mode" == dev || "$mode" == prod ]] \
        || { err "invalid APK publish mode: $mode"; return 1; }
    [[ -d "$bundle_dir/apk" && ! -L "$bundle_dir/apk" ]] \
        || { err "bundle has no staged APK directory: $bundle_dir"; return 1; }
    [[ -f "$manifest" && ! -L "$manifest" ]] \
        || { err "bundle manifest missing or unsafe: $manifest"; return 1; }
    lock_file="$(apk_contract_lock_file "$paths_file")" || return 1

    # Phase 1: validate the manifest-bound artifacts and archive the outgoing
    # release for BOTH variants before publishing either.
    local -a phase_variants=() phase_apks=() phase_shas=() phase_currents=() phase_rollbacks=() phase_versions=()
    for variant in client admin; do
        entry="$(apk_manifest_artifact "$manifest" "$variant")" || return 1
        file="$(printf '%s' "$entry" | cut -f1)"
        msha="$(printf '%s' "$entry" | cut -f2)"
        mtarget="$(printf '%s' "$entry" | cut -f3)"
        mversion="$(printf '%s' "$entry" | cut -f4)"
        mgit="$(printf '%s' "$entry" | cut -f5)"

        [[ "$mtarget" == "$target" ]] || {
            err "manifest $variant APK targets $mtarget, not $target"
            return 1
        }
        [[ "$file" == "boe.$target.$variant.$mversion.apk" ]] || {
            err "manifest $variant filename is not the exact artifact name: $file"
            return 1
        }
        apk="$bundle_dir/apk/$file"
        [[ -f "$apk" && ! -L "$apk" ]] \
            || { err "manifest-bound APK missing or unsafe: $apk"; return 1; }
        actual="$(sha256sum "$apk" | cut -d' ' -f1)"
        [[ "$actual" == "$msha" ]] || {
            err "manifest digest does not match the staged file: $file"
            return 1
        }
        # Sidecar re-validation covers provenance, the git gate and signing.
        apk_validate_local_artifact "$apk" "$target" "$variant" "$mversion" \
            "$mgit" "$mode" >/dev/null || return 1

        dest="$(apk_contract_destination "$paths_file" "$target" "$variant")" || return 1
        current_dir="${dest%%$'\t'*}"
        rollback_dir="${dest#*$'\t'}"

        phase_rollbacks+=("$rollback_dir")
        phase_variants+=("$variant")
        phase_apks+=("$apk")
        phase_shas+=("$msha")
        phase_currents+=("$current_dir")
        phase_versions+=("$mversion")
    done

    # Phase 2: publish both variants.
    local i
    for i in "${!phase_variants[@]}"; do
        variant="${phase_variants[$i]}"
        apk="${phase_apks[$i]}"
        current_dir="${phase_currents[$i]}"
        step "publishing $target $variant APK → $current_dir"
        apk_publish_remote_atomic "$apk" "${apk%.apk}.json" "$current_dir" \
            "${phase_shas[$i]}" "$lock_file" || return 1
        ok "published $(basename "$apk") → ${current_dir##*/}"
    done

    # Phase 3: retire the superseded versions, only once BOTH variants are
    # published. Retirement moves artifacts out of the holder, so doing it
    # earlier would leave the holder empty if a publish then failed — and the
    # in-app update feed reads the holder, so "empty" means "no update
    # available" to every installed app. Publishing first keeps the previous
    # release serveable until the new one is verifiably in place.
    if [[ "$archive" == true ]]; then
        local keep
        keep="$(apk_contract_keep_releases "$paths_file")"
        for i in "${!phase_variants[@]}"; do
            apk_retire_remote_variant "${phase_currents[$i]}" "${phase_rollbacks[$i]}" \
                "$lock_file" "$keep" "${phase_versions[$i]}" || return 1
        done
    fi
}
