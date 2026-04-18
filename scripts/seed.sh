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

usage() {
  printf 'Usage: %s --password <initial-admin-password>\n' "${0##*/}" >&2
}

initial_admin_password=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --password=*)
      initial_admin_password="${1#*=}"
      shift
      ;;
    --password | -p)
      if [[ $# -lt 2 ]]; then
        printf 'Missing value for %s\n' "$1" >&2
        usage
        exit 1
      fi

      initial_admin_password="$2"
      shift 2
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${initial_admin_password}" ]]; then
  printf 'The initial admin password is required.\n' >&2
  usage
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'DATABASE_URL must be set before running %s\n' "${0##*/}" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  printf 'pnpm is required but was not found in PATH\n' >&2
  exit 1
fi

CDPATH= builtin cd -- "${repo_root}"
export TAVI_INITIAL_ADMIN_PASSWORD="${initial_admin_password}"

pnpm --filter @tavi/api prisma:migrate
pnpm --filter @tavi/api prisma:seed:admin
