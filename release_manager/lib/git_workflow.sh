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
            wt/admin|wt/client|wt/landing) : ;;
            *) continue ;;
        esac
        printf '%s\0%s\0' "$path" "$branch"
    done < <(git -C "$main_worktree" worktree list --porcelain)
}

git_workflow_is_sensitive_path() {
    local path="$1" name="${1##*/}"
    case "$name" in
        .env.example|.env.sample|.env.template|*.env.example|*.env.sample|*.env.template)
            return 1 ;;
        .env|.env.*|*.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|*credentials*)
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

git_workflow_commit_dirty() {
    local worktree="$1" label="$2" message
    [[ -n "$(git -C "$worktree" status --porcelain)" ]] || return 0

    printf '\n   changes in %s (%s):\n' "$label" "$worktree"
    git -C "$worktree" status --short
    git_workflow_check_sensitive_changes "$worktree" || return 1
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

git_workflow_review_pull_requests() {
    local _main_worktree="$1" number branch author decision mergeable rows details prompt
    local head_sha refreshed_sha current_mergeable approval_count
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
        gh pr checks "$number" --repo "$github_repo" --required || {
            printf '   ! PR #%s required checks are not green; approval skipped\n' "$number"
            continue
        }
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
        gh pr checks "$number" --repo "$github_repo" --required || return 1
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
        gh pr checks "$number" --repo "$github_repo" --required || return 1
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

git_workflow_run() {
    local repo="$1" main_worktree path branch ahead
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
        git_workflow_confirm "Merge $branch into main ($ahead commit(s))?" || return 1
        git -C "$main_worktree" merge --no-edit "$branch" || return 1
    done

    git_workflow_sync_main "$main_worktree" || return 1

    for i in "${!surface_paths[@]}"; do
        path="${surface_paths[$i]}"
        branch="${surface_branches[$i]}"
        git -C "$main_worktree" merge-base --is-ancestor "$branch" main || continue
        git -C "$path" merge --ff-only main || return 1
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
