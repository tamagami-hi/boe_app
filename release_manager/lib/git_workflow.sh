#!/usr/bin/env bash
# Git-only collaboration workflow used by status.sh.
#
# This restores the useful repository behavior from the earlier control center:
# commit dirty linked worktrees, integrate their branches into main, synchronize
# main with origin, push it, and review open pull requests. It intentionally has
# no knowledge of exports, Docker, deployments, rollbacks, VERSION, or tags.

GIT_WORKFLOW_REVIEWED_PR_NUMBERS=()
GIT_WORKFLOW_REVIEWED_PR_SHAS=()
GIT_WORKFLOW_REVIEWED_PR_BRANCHES=()

git_workflow_confirm() {
    declare -F confirm >/dev/null && confirm "$1"
}

git_workflow_prompt_commit_message() {
    local _worktree="$1" label="$2" message
    printf '   ➜ commit message for %s [chore(%s): update working tree]: ' \
        "$label" "$label" >/dev/tty
    read -r message </dev/tty || return 1
    printf '%s\n' "${message:-chore($label): update working tree}"
}

git_workflow_main_worktree() {
    local repo="$1" line path branch
    while IFS= read -r line; do
        [[ "$line" == worktree\ * ]] || continue
        path="${line#worktree }"
        branch="$(git -C "$path" symbolic-ref --short -q HEAD 2>/dev/null || true)"
        if [[ "$branch" == main ]]; then
            printf '%s\n' "$path"
            return 0
        fi
    done < <(git -C "$repo" worktree list --porcelain)
    return 1
}

git_workflow_surface_worktrees() {
    local main_worktree="$1" line path branch
    while IFS= read -r line; do
        [[ "$line" == worktree\ * ]] || continue
        path="${line#worktree }"
        [[ "$path" != "$main_worktree" ]] || continue
        branch="$(git -C "$path" symbolic-ref --short -q HEAD 2>/dev/null || true)"
        case "$branch" in
            wt/admin|wt/client) : ;;
            *) continue ;;
        esac
        printf '%s\0%s\0' "$path" "$branch"
    done < <(git -C "$main_worktree" worktree list --porcelain)
}

git_workflow_is_sensitive_path() {
    local path="$1" name="${1##*/}"
    case "$name" in
        # Templates. The trusted marker is the .example/.sample/.template suffix,
        # so it must be honoured wherever it appears — including the
        # `.env.<environment>.example` shape. Without that middle pattern,
        # `.env.production.example` fell through to `.env.*` below and was
        # treated as a live secret file, which made it impossible to edit OR
        # delete through this workflow.
        .env.example|.env.sample|.env.template) return 1 ;;
        .env.*.example|.env.*.sample|.env.*.template) return 1 ;;
        *.env.example|*.env.sample|*.env.template) return 1 ;;
        *.env.*.example|*.env.*.sample|*.env.*.template) return 1 ;;
        .env|.env.*|*.env|*.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|*credentials*|id_*|*.ppk|.netrc|.npmrc)
            return 0 ;;
    esac
    case "/$path/" in
        */.ssh/*|*/.gnupg/*) return 0 ;;
    esac
    return 1
}

git_workflow_check_sensitive_changes() {
    local worktree="$1" path found=false
    while IFS= read -r -d '' path; do
        if git_workflow_is_sensitive_path "$path"; then
            printf '   ✗ refusing to stage sensitive path: %s\n' "$path" >&2
            found=true
        fi
    done < <(
        git -C "$worktree" diff --name-only -z
        git -C "$worktree" diff --cached --name-only -z
        git -C "$worktree" ls-files --others --exclude-standard -z
    )
    [[ "$found" == false ]]
}

git_workflow_commit_candidates() {
    local worktree="$1"
    {
        git -C "$worktree" diff --name-only --diff-filter=d -z
        git -C "$worktree" diff --cached --name-only --diff-filter=d -z
        git -C "$worktree" ls-files --others --exclude-standard -z
    } | tr '\0' '\n' | sort -u
}

git_workflow_is_text_path() {
    case "${1##*/}" in
        *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.woff|*.woff2|*.ttf|*.otf|*.eot) return 1 ;;
        *.apk|*.aab|*.jar|*.zip|*.gz|*.tgz|*.bz2|*.xz|*.7z|*.pdf|*.so|*.dex|*.class|*.keystore) return 1 ;;
    esac
    return 0
}

git_workflow_check_worktree_hygiene() {
    local worktree="$1" path clean=true size lines
    local max_bytes=$((5 * 1024 * 1024))

    if ! git -C "$worktree" diff HEAD --check; then
        printf '   ✗ the changes above introduce whitespace errors\n' >&2
        clean=false
    fi

    while IFS= read -r path; do
        [[ -n "$path" ]] || continue
        [[ -f "$worktree/$path" ]] || continue

        size=$(wc -c <"$worktree/$path" 2>/dev/null || echo 0)
        if [[ "$size" -gt "$max_bytes" ]]; then
            printf '   ✗ %s is %s MB; commit large artifacts deliberately, not through this workflow\n' \
                "$path" "$((size / 1024 / 1024))" >&2
            clean=false
        fi

        git_workflow_is_text_path "$path" || continue

        if grep -qIE '^(<{7}|={7}|>{7})( |$)' "$worktree/$path" 2>/dev/null; then
            printf '   ✗ %s still contains merge conflict markers\n' "$path" >&2
            clean=false
        fi
    done < <(git_workflow_commit_candidates "$worktree")

    while IFS= read -r path; do
        [[ -n "$path" ]] || continue
        [[ -f "$worktree/$path" ]] || continue
        git_workflow_is_text_path "$path" || continue

        lines="$(git diff --no-index --check -- /dev/null "$worktree/$path" 2>/dev/null \
            | grep -E ':[0-9]+: (trailing whitespace|space before tab|indent with non-tab)\.' \
            | sed -E 's/^[^:]*:([0-9]+):.*/\1/' | tr '\n' ',' | sed 's/,$//')"
        if [[ -n "$lines" ]]; then
            printf '   ✗ new file %s has trailing whitespace on: %s\n' "$path" "$lines" >&2
            clean=false
        fi

        if [[ -s "$worktree/$path" ]] && [[ -n "$(tail -c 1 "$worktree/$path")" ]]; then
            printf '   ✗ new file %s has no newline at end of file\n' "$path" >&2
            clean=false
        fi
    done < <(git -C "$worktree" ls-files --others --exclude-standard)

    if [[ "$clean" != true ]]; then
        printf '   nothing was staged. Fix the files above, then run this again.\n' >&2
        printf '   to strip trailing whitespace across the pending files:\n' >&2
        printf "     git -C %s ls-files -m -o --exclude-standard | xargs -r sed -i 's/[ \\t]*\$//'\n" \
            "$worktree" >&2
        return 1
    fi
}

git_workflow_commit_dirty() {
    local worktree="$1" label="$2" message
    [[ -n "$(git -C "$worktree" status --porcelain)" ]] || return 0

    printf '\n   changes in %s (%s):\n' "$label" "$worktree"
    git -C "$worktree" status --short
    git_workflow_check_sensitive_changes "$worktree" || return 1
    git_workflow_check_worktree_hygiene "$worktree" || return 1
    git_workflow_confirm "Commit all listed changes in $label?" || {
        printf '   ! commit skipped for %s\n' "$label" >&2
        return 1
    }
    message="$(git_workflow_prompt_commit_message "$worktree" "$label")" || return 1
    [[ -n "$message" && "$message" != *$'\n'* ]] || {
        printf '   ✗ commit message must be one non-empty line\n' >&2
        return 1
    }

    command -v gitleaks >/dev/null 2>&1 || {
        printf '   ✗ gitleaks is required before status.sh can stage changes\n' >&2
        return 1
    }
    git -C "$worktree" add -A || {
        printf '   ✗ could not stage changes in %s\n' "$label" >&2
        return 1
    }
    git_workflow_check_sensitive_changes "$worktree" || {
        printf '   ✗ sensitive path appeared during prompting; staged changes were preserved for inspection\n' >&2
        return 1
    }
    git -C "$worktree" diff --cached --check || return 1
    gitleaks git --staged --no-banner --redact "$worktree" || {
        printf '   ✗ staged secret scan failed; changes remain staged for inspection\n' >&2
        return 1
    }
    git -C "$worktree" commit -m "$message" || {
        printf '   ✗ commit failed in %s; staged changes were preserved\n' "$label" >&2
        return 1
    }
}

git_workflow_sanitize_terminal() {
    LC_ALL=C tr -d '\000-\010\013-\037\177'
}

git_workflow_render_file_summary() {
    jq -r '.files[]? | "      \(.path) (+\(.additions) -\(.deletions))"' \
        | git_workflow_sanitize_terminal
}

# git_workflow_required_checks <pr-number> <repo> — echo the required-check
# list for a PR. Returns 1 when the checks are red, and 2 when the list is
# EMPTY: zero required checks proves nothing about the head commit, so an
# empty list can never justify an approval or a merge.
git_workflow_required_checks() {
    local number="$1" repo="$2" out
    out="$(gh pr checks "$number" --repo "$repo" --required 2>/dev/null)" || return 1
    [[ -n "$out" ]] || return 2
    printf '%s\n' "$out"
}

git_workflow_review_pull_requests() {
    local _main_worktree="$1" number branch author decision mergeable rows details prompt
    local head_sha refreshed_sha current_mergeable approval_count checks_rc
    local github_repo='tamagami-hi/boe_app'
    GIT_WORKFLOW_REVIEWED_PR_NUMBERS=()
    GIT_WORKFLOW_REVIEWED_PR_SHAS=()
    GIT_WORKFLOW_REVIEWED_PR_BRANCHES=()
    command -v gh >/dev/null 2>&1 || {
        printf '   ✗ gh CLI is required for the Git workflow\n' >&2
        return 1
    }
    gh auth status >/dev/null 2>&1 || {
        printf '   ✗ gh is not authenticated\n' >&2
        return 1
    }

    printf '\n   open pull requests into main:\n'
    rows="$(gh pr list --repo "$github_repo" --base main --state open \
        --json number,headRefName,author,reviewDecision,mergeable \
        --jq '.[] | [.number, .headRefName, .author.login, (.reviewDecision // "REVIEW_REQUIRED"), .mergeable] | @tsv')" || {
            printf '   ✗ could not list pull requests\n' >&2
            return 1
        }
    [[ -n "$rows" ]] || { printf '   (none)\n'; return 0; }

    while IFS=$'\t' read -r number branch author decision mergeable; do
        [[ -n "$number" ]] || continue
        printf '   #%s  %-24s  %-16s  %-18s  %s\n' \
            "$number" "$branch" "$author" "$decision" "$mergeable"

        details="$(gh pr view "$number" --repo "$github_repo" \
            --json headRefOid,mergeable,files)" || return 1
        head_sha="$(jq -r '.headRefOid' <<< "$details")"
        current_mergeable="$(jq -r '.mergeable' <<< "$details")"
        [[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || {
            printf '   ✗ PR #%s returned an invalid head SHA\n' "$number" >&2
            return 1
        }
        printf '%s\n' "$details" | git_workflow_render_file_summary || return 1
        gh pr diff "$number" --repo "$github_repo" --patch --color never \
            | git_workflow_sanitize_terminal || return 1
        [[ "$current_mergeable" == MERGEABLE ]] || {
            printf '   ! PR #%s is not mergeable; approval skipped\n' "$number"
            continue
        }
        checks_rc=0
        git_workflow_required_checks "$number" "$github_repo" >/dev/null || checks_rc=$?
        if (( checks_rc == 2 )); then
            printf '   ! PR #%s has no required checks configured; approval skipped\n' "$number"
            continue
        elif (( checks_rc != 0 )); then
            printf '   ! PR #%s required checks are not green; approval skipped\n' "$number"
            continue
        fi
        if [[ "$decision" == APPROVED ]]; then
            prompt="Accept the displayed patch for approved PR #$number at ${head_sha:0:12}?"
        else
            prompt="Approve PR #$number at ${head_sha:0:12} ($branch by $author)?"
        fi
        git_workflow_confirm "$prompt" || continue
        refreshed_sha="$(gh pr view "$number" --repo "$github_repo" --json headRefOid --jq .headRefOid)" \
            || return 1
        [[ "$refreshed_sha" == "$head_sha" ]] || {
            printf '   ✗ PR #%s changed during review; approval blocked\n' "$number" >&2
            return 1
        }
        git_workflow_required_checks "$number" "$github_repo" >/dev/null || {
            printf '   ✗ PR #%s required checks are red or absent after confirmation\n' "$number" >&2
            return 1
        }
        gh api --method POST "repos/$github_repo/pulls/$number/reviews" \
            -f event=APPROVE \
            -f commit_id="$head_sha" \
            -f body="Reviewed by release_manager/status.sh at $head_sha" \
            >/dev/null || return 1
        approval_count="$(gh api "repos/$github_repo/pulls/$number/reviews?per_page=100" \
            --jq "[.[] | select(.state == \"APPROVED\" and .commit_id == \"$head_sha\")] | length")" \
            || return 1
        [[ "$approval_count" =~ ^[0-9]+$ && "$approval_count" -gt 0 ]] || {
            printf '   ✗ PR #%s has no approval bound to %s\n' "$number" "${head_sha:0:12}" >&2
            return 1
        }
        GIT_WORKFLOW_REVIEWED_PR_NUMBERS+=("$number")
        GIT_WORKFLOW_REVIEWED_PR_SHAS+=("$head_sha")
        GIT_WORKFLOW_REVIEWED_PR_BRANCHES+=("$branch")
    done <<< "$rows"
    return 0
}

git_workflow_merge_pull_requests() {
    local main_worktree="$1" number branch details
    local head_sha refreshed_sha refreshed_mergeable approval_count
    local github_repo='tamagami-hi/boe_app'

    command -v gh >/dev/null 2>&1 || return 1
    gh auth status >/dev/null 2>&1 || return 1
    local i
    for i in "${!GIT_WORKFLOW_REVIEWED_PR_NUMBERS[@]}"; do
        number="${GIT_WORKFLOW_REVIEWED_PR_NUMBERS[$i]}"
        head_sha="${GIT_WORKFLOW_REVIEWED_PR_SHAS[$i]}"
        branch="${GIT_WORKFLOW_REVIEWED_PR_BRANCHES[$i]}"
        git_workflow_confirm "Merge approved PR #$number at ${head_sha:0:12} into main?" || continue

        details="$(gh pr view "$number" --repo "$github_repo" \
            --json headRefOid,mergeable)" || return 1
        refreshed_sha="$(jq -r '.headRefOid' <<< "$details")"
        refreshed_mergeable="$(jq -r '.mergeable' <<< "$details")"
        [[ "$refreshed_sha" == "$head_sha" && "$refreshed_mergeable" == MERGEABLE ]] || {
            printf '   ✗ PR #%s changed before merge; merge blocked\n' "$number" >&2
            return 1
        }
        git_workflow_required_checks "$number" "$github_repo" >/dev/null || {
            printf '   ✗ PR #%s required checks are red or absent before merge\n' "$number" >&2
            return 1
        }
        approval_count="$(gh api "repos/$github_repo/pulls/$number/reviews?per_page=100" \
            --jq "[.[] | select(.state == \"APPROVED\" and .commit_id == \"$head_sha\")] | length")" \
            || return 1
        [[ "$approval_count" =~ ^[0-9]+$ && "$approval_count" -gt 0 ]] || {
            printf '   ✗ exact-SHA approval disappeared before merging PR #%s\n' "$number" >&2
            return 1
        }
        gh pr merge "$number" --repo "$github_repo" --merge \
            --match-head-commit "$head_sha" || return 1
        git -C "$main_worktree" fetch origin || return 1
        git -C "$main_worktree" merge-base --is-ancestor "$head_sha" origin/main || {
            printf '   ✗ PR #%s has not landed on origin/main yet\n' "$number" >&2
            return 1
        }
        printf '   ✓ merged reviewed PR #%s (%s at %s)\n' "$number" "$branch" "${head_sha:0:12}"
    done
}

git_workflow_sync_main() {
    local main_worktree="$1" ahead behind
    git -C "$main_worktree" fetch origin || {
        printf '   ✗ could not fetch origin\n' >&2
        return 1
    }
    git -C "$main_worktree" rev-parse --verify --quiet origin/main >/dev/null || {
        printf '   ✗ origin/main does not exist\n' >&2
        return 1
    }

    ahead="$(git -C "$main_worktree" rev-list --count origin/main..main)"
    behind="$(git -C "$main_worktree" rev-list --count main..origin/main)"
    if (( behind > 0 )); then
        git_workflow_confirm "Merge $behind origin/main commit(s) into local main?" || return 1
        if (( ahead == 0 )); then
            git -C "$main_worktree" merge --ff-only origin/main || return 1
        else
            git -C "$main_worktree" merge --no-edit origin/main || return 1
        fi
    fi

    ahead="$(git -C "$main_worktree" rev-list --count origin/main..main)"
    if (( ahead > 0 )); then
        git_workflow_confirm "Push $ahead local main commit(s) to origin/main?" || return 1
        git -C "$main_worktree" push origin refs/heads/main:refs/heads/main || return 1
    fi
}

git_workflow_untracked_collision_path() {
    local worktree="$1" incoming_path="$2" remainder="$2" candidate="" component

    while [[ "$remainder" == */* ]]; do
        component="${remainder%%/*}"
        remainder="${remainder#*/}"
        candidate="${candidate:+$candidate/}$component"
        if ! git -C "$worktree" ls-files --error-unmatch -- "$candidate" \
                >/dev/null 2>&1 \
           && { [[ -L "$worktree/$candidate" ]] \
                || { [[ -e "$worktree/$candidate" ]] && [[ ! -d "$worktree/$candidate" ]]; }; }; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    if ! git -C "$worktree" ls-files --error-unmatch -- "$incoming_path" \
            >/dev/null 2>&1 \
       && [[ -e "$worktree/$incoming_path" || -L "$worktree/$incoming_path" ]]; then
        printf '%s\n' "$incoming_path"
        return 0
    fi
    return 1
}

git_workflow_assert_worktree_merge_safe() {
    local main_worktree="$1" worktree="$2" branch="$3" target_ref="${4:-main}"
    local incoming_path collision paths_file is_safe=true

    paths_file="$(mktemp)" || return 1
    if ! git -C "$main_worktree" diff --name-only -z "$branch"..."$target_ref" \
            > "$paths_file"; then
        printf '   ✗ could not inspect incoming main paths for %s\n' "${branch#wt/}" >&2
        rm -f "$paths_file"
        return 1
    fi
    while IFS= read -r -d '' incoming_path; do
        if git_workflow_is_sensitive_path "$incoming_path"; then
            printf '   ✗ refusing to merge sensitive main path into %s: %s\n' \
                "${branch#wt/}" "$incoming_path" >&2
            is_safe=false
            break
        fi
        collision="$(git_workflow_untracked_collision_path "$worktree" "$incoming_path")" \
            || collision=""
        if [[ -n "$collision" ]]; then
            printf '   ✗ refusing to overwrite untracked or ignored path in %s: %s\n' \
                "${branch#wt/}" "$collision" >&2
            is_safe=false
            break
        fi
    done < "$paths_file"
    rm -f "$paths_file"
    [[ "$is_safe" == true ]]
}

git_workflow_sync_worktrees() {
    local repo="$1" main_worktree path branch ahead behind main_sha
    local found=false

    main_worktree="$(git_workflow_main_worktree "$repo")" || {
        printf '   ✗ no worktree is checked out on main\n' >&2
        return 1
    }
    while IFS= read -r -d '' path && IFS= read -r -d '' branch; do
        found=true
        main_sha="$(git -C "$main_worktree" rev-parse main)" || return 1
        ahead="$(git -C "$main_worktree" rev-list --count "$main_sha".."$branch")"
        behind="$(git -C "$main_worktree" rev-list --count "$branch".."$main_sha")"
        if (( behind == 0 )); then
            printf '   ✓ %-10s already contains main' "${branch#wt/}"
            (( ahead > 0 )) && printf ' (%s unintegrated commit(s))' "$ahead"
            printf '\n'
            continue
        fi
        [[ -z "$(git -C "$path" status --porcelain)" ]] || {
            printf '   ✗ %s is dirty; commit it with the full Git workflow first\n' \
                "${branch#wt/}" >&2
            return 1
        }
        git_workflow_assert_worktree_merge_safe "$main_worktree" "$path" "$branch" "$main_sha" \
            || return 1
        local pre_confirm_head
        pre_confirm_head="$(git -C "$path" rev-parse HEAD)" || return 1
        git_workflow_confirm "Merge main into ${branch#wt/} ($behind commit(s) behind)?" \
            || return 1
        # Revalidate the destination after confirmation: the operator may have
        # switched the worktree to another branch, moved its HEAD, or dirtied
        # it while the prompt was open. Merging into anything but the exact
        # state that was reviewed is a silent branch-switch race.
        [[ "$(git -C "$main_worktree" rev-parse main)" == "$main_sha" ]] || {
            printf '   ✗ main changed during confirmation; synchronization cancelled\n' >&2
            return 1
        }
        [[ "$(git -C "$path" symbolic-ref --short -q HEAD)" == "$branch" ]] || {
            printf '   ✗ %s switched branches during confirmation; synchronization cancelled\n' \
                "${branch#wt/}" >&2
            return 1
        }
        [[ "$(git -C "$path" rev-parse HEAD)" == "$pre_confirm_head" ]] || {
            printf '   ✗ %s HEAD moved during confirmation; synchronization cancelled\n' \
                "${branch#wt/}" >&2
            return 1
        }
        [[ -z "$(git -C "$path" status --porcelain)" ]] || {
            printf '   ✗ %s became dirty during confirmation; synchronization cancelled\n' \
                "${branch#wt/}" >&2
            return 1
        }
        if (( ahead == 0 )); then
            git -C "$path" merge --no-overwrite-ignore --ff-only "$main_sha" || return 1
        else
            git -C "$path" merge --no-overwrite-ignore --no-edit "$main_sha" || return 1
        fi
        printf '   ✓ synchronized main → %s\n' "${branch#wt/}"
    done < <(git_workflow_surface_worktrees "$main_worktree")

    [[ "$found" == true ]] || printf '   ! no wt/admin or wt/client worktrees found\n'
}

git_workflow_run() {
    local repo="$1" main_worktree path branch ahead main_sha
    local incoming_path incoming_paths
    local -a surface_paths=() surface_branches=()

    main_worktree="$(git_workflow_main_worktree "$repo")" || {
        printf '   ✗ no worktree is checked out on main\n' >&2
        return 1
    }
    while IFS= read -r -d '' path && IFS= read -r -d '' branch; do
        surface_paths+=("$path")
        surface_branches+=("$branch")
    done < <(git_workflow_surface_worktrees "$main_worktree")

    git_workflow_review_pull_requests "$main_worktree" || return 1
    git_workflow_merge_pull_requests "$main_worktree" || return 1

    local i
    for i in "${!surface_paths[@]}"; do
        git_workflow_commit_dirty "${surface_paths[$i]}" "${surface_branches[$i]#wt/}" || return 1
    done
    git_workflow_commit_dirty "$main_worktree" main || return 1

    for i in "${!surface_paths[@]}"; do
        branch="${surface_branches[$i]}"
        ahead="$(git -C "$main_worktree" rev-list --count main.."$branch")"
        (( ahead > 0 )) || continue
        # Scan the incoming commits BEFORE they can reach main: a sensitive
        # path is refused outright, and a content scan runs when gitleaks is
        # available. The operator then confirms against the actual diff stat.
        incoming_paths="$(
            git -C "$main_worktree" diff --name-only main.."$branch"
        )" || return 1
        while IFS= read -r incoming_path; do
            [[ -n "$incoming_path" ]] || continue
            if git_workflow_is_sensitive_path "$incoming_path"; then
                printf '   ✗ refusing to merge %s into main: sensitive path %s\n' \
                    "$branch" "$incoming_path" >&2
                return 1
            fi
        done <<< "$incoming_paths"
        if command -v gitleaks >/dev/null 2>&1; then
            gitleaks git --no-banner --redact --log-opts="main..$branch" "$main_worktree" || {
                printf '   ✗ secret scan failed for incoming commits on %s\n' "$branch" >&2
                return 1
            }
        fi
        git -C "$main_worktree" log --stat main.."$branch" || return 1
        git_workflow_confirm "Merge $branch into main ($ahead commit(s))?" || return 1
        git -C "$main_worktree" merge --no-edit "$branch" || return 1
    done

    git_workflow_sync_main "$main_worktree" || return 1
    main_sha="$(git -C "$main_worktree" rev-parse main)" || return 1

    for i in "${!surface_paths[@]}"; do
        path="${surface_paths[$i]}"
        branch="${surface_branches[$i]}"
        git -C "$main_worktree" merge-base --is-ancestor "$branch" "$main_sha" || {
            printf '   ✗ %s diverged from main; run explicit worktree synchronization\n' \
                "${branch#wt/}" >&2
            return 1
        }
        git_workflow_assert_worktree_merge_safe "$main_worktree" "$path" "$branch" "$main_sha" \
            || return 1
        git -C "$path" merge --no-overwrite-ignore --ff-only "$main_sha" || return 1
    done

    [[ -z "$(git -C "$main_worktree" status --porcelain)" ]] || {
        printf '   ✗ main is still dirty after Git preparation\n' >&2
        return 1
    }
    git -C "$main_worktree" fetch origin || return 1
    [[ "$(git -C "$main_worktree" rev-parse main)" == \
       "$(git -C "$main_worktree" rev-parse origin/main)" ]] || {
        printf '   ✗ local main does not match origin/main\n' >&2
        return 1
    }
    printf '\n   ✓ Git workflow complete: worktrees integrated and main pushed\n'
}
