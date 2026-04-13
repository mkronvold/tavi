#!/usr/bin/env bash
set -euo pipefail

runtime_config_path="/app/apps/web/dist/runtime-config.js"

node -e "process.stdout.write('window.__TAVI_RUNTIME_CONFIG__ = ' + JSON.stringify({ apiBaseUrl: process.env.TAVI_API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? '', appHomeUrl: process.env.TAVI_HOME_URL ?? '' }) + ';\n')" > "${runtime_config_path}"

exec pnpm --filter @tavi/web start
