#!/usr/bin/env bash
# scripts/build-sw.sh
#
# Compiles the notification service worker and scan worker to plain JS using
# esbuild. Run this if vite-plugin-pwa is not installed.
#
# Usage:
#   pnpm exec bash scripts/build-sw.sh
#   # Outputs:
#   #   public/stellar-notification-sw.js
#   #   public/stellar-scan-worker.js

set -euo pipefail

echo "Building Stellar notification service worker…"

pnpm exec esbuild \
  src/sw/stellar-notification-sw.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --outfile=public/stellar-notification-sw.js \
  --define:global=globalThis \
  --log-level=info

echo "Building Stellar scan web worker…"

pnpm exec esbuild \
  src/workers/stellar-scan-worker.ts \
  --bundle \
  --format=iife \
  --platform=browser \
  --outfile=public/stellar-scan-worker.js \
  --define:global=globalThis \
  --external:@wraith-protocol/sdk \
  --log-level=info

echo "Done. SW assets written to public/."