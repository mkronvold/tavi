#!/usr/bin/env bash
set -euo pipefail

runtime_config_path="/tmp/tavi-runtime-config.js"
vite_entrypoint="/app/apps/web/node_modules/vite/bin/vite.js"
web_static_server="/app/apps/web/scripts/serve-dist.mjs"
web_command="${1:-start}"

node -e "process.stdout.write('window.__TAVI_RUNTIME_CONFIG__ = ' + JSON.stringify({ apiBaseUrl: process.env.TAVI_API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? '', appHomeUrl: process.env.TAVI_HOME_URL ?? '' }) + ';\n')" > "${runtime_config_path}"

if [[ "$#" -gt 0 ]]; then
  shift
fi

case "${web_command}" in
  preview)
    exec node "${vite_entrypoint}" preview --host 0.0.0.0 --port 4173 "$@"
    ;;
  start)
    exec node "${web_static_server}" "$@"
    ;;
  start:preview)
    exec node "${vite_entrypoint}" preview --host 0.0.0.0 --port 4173 "$@"
    ;;
  dev)
    exec node "${vite_entrypoint}" --host 0.0.0.0 --port 5173 "$@"
    ;;
  *)
    exec "${web_command}" "$@"
    ;;
esac
