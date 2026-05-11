#!/usr/bin/env bash
# PandaHead Anchor Calibrate Tool launcher (Mac / Linux)
# usage: ./dev-calibrate.sh   (or:   bash dev-calibrate.sh)

set -e

cd "$(dirname "$0")"

echo
echo "================================================"
echo "  PandaHead Anchor Calibrate Tool (DEV-only)"
echo "================================================"
echo
echo "Starting vite on port 5173..."
echo "Browser will open in 6 seconds."
echo "Press Ctrl+C to stop the dev server."
echo "================================================"
echo

# open browser after 6s (give vite time to boot)
URL="http://localhost:5173/?page=calibrate"
(
  sleep 6
  if command -v open >/dev/null 2>&1; then
    open "$URL"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"      # Linux
  else
    echo "Please open: $URL"
  fi
) &

# run vite directly with forced port
if command -v bun >/dev/null 2>&1; then
  bun x vite --port 5173 --strictPort
else
  npx vite --port 5173 --strictPort
fi
