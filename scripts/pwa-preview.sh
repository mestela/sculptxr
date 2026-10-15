#!/bin/bash
# Build + assemble dist exactly as deploy.sh does (no upload), then serve it with the dev HTTPS/headers.
set -e
cd "$(dirname "$0")/.."
npm run build
echo "{\"version\": \"$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' index.html | head -n 1)\"}" > dist/version.json
cp -r app dist/
mkdir -p dist/src/workers && cp -r src/workers/* dist/src/workers/
cp node_modules/manifold-3d/manifold.wasm dist/
node scripts/gen-sw.mjs
npx vite preview --host 0.0.0.0 --port 8081
