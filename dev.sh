#!/usr/bin/env bash
# Dev loop: pocketbase --dev on :8090 + vite on :5173 (proxies /api → 8090).
# Same thing `nix run .#dev` does. Needs pocketbase + node on PATH (nix develop).
set -euo pipefail
cd "$(dirname "$0")"

[ -d frontend/node_modules ] || (cd frontend && npm ci)

pocketbase serve --dev \
  --http=127.0.0.1:8090 \
  --dir=./pb_data \
  --migrationsDir=./pb_migrations \
  --automigrate=false &
PB=$!
trap 'kill $PB 2>/dev/null' EXIT

cd frontend && exec npx vite --host 127.0.0.1
