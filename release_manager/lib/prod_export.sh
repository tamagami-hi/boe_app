#!/usr/bin/env bash

PROD_EXPORT_APK_INPUTS=(
    frontend_stack_ts/android/keystore.properties
    frontend_stack_ts/android/local.properties
    frontend_stack_ts/android/keystore
)

bundle_prune_oldest() {
    local dir="$1" keep="$2" v
    local -a old=()
    mapfile -t old < <(bundle_dirs_oldest_first "$dir")
    (( ${#old[@]} > keep )) || return 0
    for v in "${old[@]:0:$(( ${#old[@]} - keep ))}"; do
        rm -rf -- "${dir:?}/$v" && info "pruned old bundle $v" 2>/dev/null || true
    done
}

prod_export_worktree_parent() {
    printf '%s/.temp/prod-export\n' "$1"
}

prod_export_link_file() {
    local source="$1" wt="$2" rel="$3"
    if ! git -C "$wt" check-ignore -q -- "$rel"; then
        err "$rel is not ignored at this tag; linking it would make the export tree dirty"
        return 1
    fi
    ln -s -- "$source" "$wt/$rel"
}

prod_export_link_input() {
    local root="$1" wt="$2" rel="$3" file
    if [[ -f "$root/$rel" ]]; then
        prod_export_link_file "$root/$rel" "$wt" "$rel"
        return
    fi
    [[ -d "$root/$rel" ]] || return 0
    mkdir -p -- "$wt/$rel" || return 1
    while IFS= read -r -d '' file; do
        prod_export_link_file "$file" "$wt" "$rel/${file##*/}" || return 1
    done < <(find "$root/$rel" -mindepth 1 -maxdepth 1 -type f -print0)
}

prod_export_prepare_apk() {
    local root="$1" wt="$2" rel pkg
    section "APK BUILD INPUTS" "signing material is linked from this checkout; dependencies come from the tag's lockfiles"
    for rel in "${PROD_EXPORT_APK_INPUTS[@]}"; do
        prod_export_link_input "$root" "$wt" "$rel" || return 1
    done
    for pkg in packages/contracts frontend_stack_ts; do
        step "npm ci in $pkg"
        ( cd "$wt/$pkg" && npm ci ) || { err "npm ci failed in $pkg at the tag"; return 1; }
    done
    ok "APK build inputs ready"
}

prod_export_check_manifest() {
    local manifest="$1" version="$2" commit="$3" facts expected
    facts="$(jq -r '[.stack, .kind, .version, .git_sha, (if .git_dirty == false then "false" elif .git_dirty == true then "true" else "invalid" end)] | @tsv' \
        "$manifest" 2>/dev/null)" || { err "the bundle manifest cannot be read"; return 1; }
    expected="$(printf 'prod_release\tstable\t%s\t%s\tfalse' "$version" "$commit")"
    [[ "$facts" == "$expected" ]] && return 0
    err "the export at v$version did not produce a stable production bundle of ${commit:0:9}"
    err "  manifest: $(tr '\t' ' ' <<< "$facts")"
    err "  a release cut before production-branch exports runs its own older export.sh; push a newer release"
    return 1
}

prod_export_remove_worktree() {
    local root="$PROD_EXPORT_ROOT" wt="$PROD_EXPORT_WT" parent
    [[ -n "$wt" ]] || return 0
    parent="$(prod_export_worktree_parent "$root")"
    [[ "$wt" == "$parent/"* ]] || { err "refusing to remove an unexpected path: $wt"; return 1; }
    if [[ -e "$wt" ]]; then
        git -C "$root" worktree remove --force --force "$wt" >/dev/null 2>&1 || rm -rf -- "$wt"
    fi
    git -C "$root" worktree prune >/dev/null 2>&1 || true
    rmdir -- "$parent" 2>/dev/null || true
    PROD_EXPORT_WT=""
    if [[ -e "$wt" ]]; then
        err "could not remove the temporary worktree: $wt"
        return 1
    fi
    info "removed the temporary worktree"
}

prod_export_stage_bundle() {
    local bundle="$1" dest="$2" name incoming
    name="${bundle##*/}"
    incoming="$dest/.incoming.$name.part"
    mkdir -p -- "$dest" || { err "cannot create $dest"; return 1; }
    [[ ! -e "$dest/$name" && ! -e "$incoming" ]] || { err "a bundle named $name already exists in $dest"; return 1; }
    if ! mv -- "$bundle" "$incoming"; then
        rm -rf -- "$incoming"
        err "could not move the bundle into $dest"
        return 1
    fi
    mv -- "$incoming" "$dest/$name" || { rm -rf -- "$incoming"; err "could not finish staging $name"; return 1; }
}

prod_export_mode() {
    local root="$1" requested="$2" parent
    if [[ "$requested" != true ]]; then
        printf 'parent\n'
        return 0
    fi
    parent="$(dirname -- "$root")"
    if [[ "${parent##*/}" != prod-export || "$(dirname -- "$parent")" != */.temp ]]; then
        err "--production-worktree runs only inside .temp/prod-export/, not in $root"
        return 1
    fi
    if git -C "$root" symbolic-ref -q HEAD >/dev/null 2>&1; then
        err "--production-worktree needs a detached checkout of the release tag"
        return 1
    fi
    printf 'child\n'
}

prod_export_resolve_release() {
    local root="$1" local_tag
    mkdir -p -- "$root/.temp" || { err "cannot create $root/.temp"; return 1; }
    production_origin_refs "$root" || { err "could not read origin's production branch (git ls-remote failed)"; return 1; }
    if [[ -z "$PO_PRODUCTION" ]]; then
        err "origin has no production branch yet"
        err "push a release first: ./release_manager/status.sh → Git → Push a release to production"
        return 1
    fi
    PROD_RELEASE_SHA="$PO_PRODUCTION"
    PROD_RELEASE_TAG="$(production_tag_at "$PROD_RELEASE_SHA")"
    if [[ -z "$PROD_RELEASE_TAG" ]]; then
        err "origin's production tip ${PROD_RELEASE_SHA:0:9} is not exactly a release tag vX.Y.Z"
        err "push a release onto it: ./release_manager/status.sh → Git → Push a release to production"
        return 1
    fi
    PROD_RELEASE_VERSION="${PROD_RELEASE_TAG#v}"
    GIT_TERMINAL_PROMPT=0 git -C "$root" fetch -q --no-tags origin refs/heads/production >/dev/null 2>&1 || true
    git -C "$root" cat-file -e "$PROD_RELEASE_SHA^{commit}" 2>/dev/null \
        || { err "could not fetch production's tip ${PROD_RELEASE_SHA:0:9} from origin"; return 1; }
    local_tag="$(git -C "$root" rev-parse -q --verify "refs/tags/$PROD_RELEASE_TAG^{commit}" 2>/dev/null || true)"
    if [[ -z "$local_tag" ]]; then
        GIT_TERMINAL_PROMPT=0 git -C "$root" fetch -q origin \
            "refs/tags/$PROD_RELEASE_TAG:refs/tags/$PROD_RELEASE_TAG" >/dev/null 2>&1 || true
        local_tag="$(git -C "$root" rev-parse -q --verify "refs/tags/$PROD_RELEASE_TAG^{commit}" 2>/dev/null || true)"
    fi
    if [[ "$local_tag" != "$PROD_RELEASE_SHA" ]]; then
        err "the local tag $PROD_RELEASE_TAG names ${local_tag:-nothing}, but origin's names ${PROD_RELEASE_SHA:0:9}"
        err "replace the local tag with origin's before a production export"
        return 1
    fi
    if [[ "$(git -C "$root" show "$PROD_RELEASE_SHA:VERSION" 2>/dev/null | tr -d '[:space:]')" != "$PROD_RELEASE_VERSION" ]]; then
        err "VERSION at $PROD_RELEASE_TAG is not $PROD_RELEASE_VERSION"
        return 1
    fi
    production_release_matches "$root" "$PROD_RELEASE_VERSION" "$PROD_RELEASE_SHA" || {
        err "origin's production and $PROD_RELEASE_TAG no longer both resolve to ${PROD_RELEASE_SHA:0:9}; try again"
        return 1
    }
    ok "origin's production is $PROD_RELEASE_TAG (${PROD_RELEASE_SHA:0:9})"
}

prod_export_open_worktree() {
    local root="$1" parent
    PROD_EXPORT_ROOT="$root"
    PROD_EXPORT_WT=""
    trap prod_export_remove_worktree EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP
    parent="$(prod_export_worktree_parent "$root")"
    mkdir -p -- "$parent" || { err "cannot create $parent"; return 1; }
    PROD_EXPORT_WT="$(mktemp -d "$parent/$PROD_RELEASE_TAG.XXXXXX")" \
        || { PROD_EXPORT_WT=""; err "cannot create a worktree directory"; return 1; }
    git -C "$root" worktree add --quiet --detach "$PROD_EXPORT_WT" "$PROD_RELEASE_SHA" \
        || { err "could not create a worktree at $PROD_RELEASE_TAG"; return 1; }
    ok "temporary worktree at $PROD_RELEASE_TAG: ${PROD_EXPORT_WT#"$root"/}"
}

prod_export_run() {
    local root="$1" dest="$2" keep="$3" with_apk="$4" bundle staged
    local -a child_args=(--prod --production-worktree)
    prod_export_resolve_release "$root" || return 1
    prod_export_open_worktree "$root" || return 1
    if [[ "$with_apk" == true ]]; then
        prod_export_prepare_apk "$root" "$PROD_EXPORT_WT" || return 1
        child_args+=(--with-apk)
    fi
    bash "$PROD_EXPORT_WT/release_manager/export.sh" "${child_args[@]}" \
        || { err "the export at $PROD_RELEASE_TAG failed; nothing was staged"; return 1; }
    bundle="$(bundle_path_newest "$PROD_EXPORT_WT/release_manager/build/prod_release")"
    [[ -n "$bundle" && -f "$bundle/manifest.json" ]] \
        || { err "the export at $PROD_RELEASE_TAG produced no bundle"; return 1; }
    prod_export_check_manifest "$bundle/manifest.json" "$PROD_RELEASE_VERSION" "$PROD_RELEASE_SHA" || return 1
    prod_export_stage_bundle "$bundle" "$dest" || return 1
    bundle_prune_oldest "$dest" "$keep"
    staged="$dest/${bundle##*/}"
    ok "staged ${staged#"$root"/} from $PROD_RELEASE_TAG (${PROD_RELEASE_SHA:0:9})"
}

prod_export_from_production() {
    ( prod_export_run "$@" )
}

prod_apk_run() {
    local root="$1" paths="$2"
    prod_export_resolve_release "$root" || return 1
    prod_export_open_worktree "$root" || return 1
    prod_export_prepare_apk "$root" "$PROD_EXPORT_WT" || return 1
    BOE_APK_VERSION="$PROD_RELEASE_VERSION" bash "$PROD_EXPORT_WT/emu/boe_update.sh" --prod --no-install --both \
        || { err "the APK build at $PROD_RELEASE_TAG failed; nothing was published"; return 1; }
    section "SHIP APKs" "publish $PROD_RELEASE_TAG to the production paths.json directories"
    paths_validate prod_release "$paths" || return 1
    apk_ship_release "$paths" "$PROD_EXPORT_WT/emu/out" prod "$PROD_RELEASE_VERSION" true "$PROD_RELEASE_SHA" prod
}

prod_apk_from_production() {
    ( prod_apk_run "$@" )
}
