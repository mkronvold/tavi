#!/usr/bin/env bash
set -euo pipefail

script_dir="$(
  CDPATH= builtin cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  command pwd -P
)"
repo_root="$(
  CDPATH= builtin cd -- "${script_dir}/.."
  command pwd -P
)"
compose_file="${repo_root}/infra/docker/compose.yaml"
stats_format='table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}'

if [[ ! -f "${compose_file}" ]]; then
  printf 'Compose file not found: %s\n' "${compose_file}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker is required but was not found in PATH\n' >&2
  exit 1
fi

containers=()
while IFS= read -r container_name; do
  containers+=("${container_name}")
done < <(
  docker ps --format '{{.Names}}' | awk '
    /^tavi-/ {
      print
      count += 1
      if (count == 4) {
        exit
      }
    }
  '
)

if [[ "${#containers[@]}" -eq 0 ]]; then
  printf 'No running containers found with names starting with tavi-\n' >&2
  exit 1
fi

exec docker stats --no-stream --format "${stats_format}" "${containers[@]}"
