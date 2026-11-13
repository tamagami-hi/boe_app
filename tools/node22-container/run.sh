#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: tools/node22-container/run.sh <command> [args...]" >&2
  exit 2
fi

image="boe-node22-check:22.20.0-alpine3.22"
context_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work_root="$(git rev-parse --show-toplevel)"
work_prefix="$(git rev-parse --show-prefix)"
git_common_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
socket="/var/run/docker.sock"
cache_dir="${work_root}/.temp/npm-cache"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --quiet --tag "$image" "$context_dir" >/dev/null
fi

mkdir -p "$cache_dir"

exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  --group-add "$(stat -c %g "$socket")" \
  --network host \
  --env HOME=/tmp \
  --env npm_config_cache=/npm-cache \
  --env DOCKER_HOST="unix://${socket}" \
  --env TESTCONTAINERS_HOST_OVERRIDE=localhost \
  --volume "${socket}:${socket}" \
  --volume "${cache_dir}:/npm-cache" \
  --volume "${git_common_dir}:${git_common_dir}" \
  --volume "${work_root}:${work_root}" \
  --workdir "${work_root}/${work_prefix}" \
  "$image" "$@"
