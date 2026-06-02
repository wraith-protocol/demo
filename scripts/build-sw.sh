#!/usr/bin/env bash
# scripts/build-sw.sh
#
# Compiles the notification service worker and scan worker to plain JS.
# Run this whenever src/sw/ or src/workers/ change, before pnpm dev.
#
# Requirements: esbuild (already a Vite dep — no extra install needed)
#
# Output:
#   public/stellar-notification-sw.js   — service worker (ESM, no bundled deps)
#   public/stellar-scan-worker.js       — scan web worker (IIFE, self-contained)
#
# The SW is built as ESM so it can use top-level await and dynamic import().
# The scan worker is built as IIFE so it runs without import() support in SW.

set -euo pipefail

ESBUILD="pnpm exec esbuild"

echo "▸ Building Stellar notification service worker…"
$ESBUILD \
  src/sw/stellar-notification-sw.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=chrome91 \
  --outfile=public/stellar-notification-sw.js \
  --define:global=globalThis \
  --log-level=warning

echo "▸ Building Stellar scan web worker…"
$ESBUILD \
  src/workers/stellar-scan-worker.ts \
  --bundle \
  --format=iife \
  --platform=browser \
  --target=chrome91 \
  --outfile=public/stellar-scan-worker.js \
  --define:global=globalThis \
  --log-level=warning

echo "✓ SW assets written to public/"
echo "  • public/stellar-notification-sw.js"
echo "  • public/stellar-scan-worker.js"