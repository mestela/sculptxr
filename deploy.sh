#!/bin/bash
# Usage: ./deploy.sh [USER] [HOST] [DEST_PATH]
USER=${1:-tokeruadmin}
HOST=${2:-tokeru.com}
DEST=${3:-'~/tokeru.com/sculptxr/'}


# --- VERSION SAFETY CHECK ---
CURRENT_VERSION=$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' index.html | head -n 1)

# Select state file based on destination
if [[ "$DEST" == *"beta"* ]]; then
    LAST_VERSION_FILE=".last_deployed_beta"
    echo "🔧 Detected BETA deployment. Tracking in $LAST_VERSION_FILE"
else
    LAST_VERSION_FILE=".last_deployed_version"
    echo "📦 Detected PROD deployment. Tracking in $LAST_VERSION_FILE"
fi

if [ -f "$LAST_VERSION_FILE" ]; then
    LAST_VERSION=$(cat "$LAST_VERSION_FILE")
    if [ "$CURRENT_VERSION" == "$LAST_VERSION" ]; then
        echo "⚠️  Version $CURRENT_VERSION was already deployed."
        echo "   Auto-incrementing patch version (safety net)..."
        # Bump via the single source of truth so package.json / Version.js /
        # index.html all stay in sync (no divergence).
        node bump.mjs patch
        CURRENT_VERSION=$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' index.html | head -n 1)
        echo "   -> $CURRENT_VERSION"
    fi
fi
echo "Current Version: $CURRENT_VERSION"

# --- SYNC VERSION.JS ---
# Extract the full version description string from index.html comment
# Matches: "VERSION: v0.6.154 - Fix VR Sculpting Interactions"
FULL_VERSION_STR=$(grep -oE "VERSION: .*" index.html | head -n 1 | sed 's/VERSION: //')

if [ -z "$FULL_VERSION_STR" ]; then
  FULL_VERSION_STR="$CURRENT_VERSION"
fi

echo "🔄 Syncing src/Version.js -> $FULL_VERSION_STR"
echo "export const VERSION = '$FULL_VERSION_STR';" > src/Version.js
# ----------------------------

echo "🚧 Running Vite build..."
npm run build

echo "{\"version\": \"$FULL_VERSION_STR\"}" > dist/version.json

# Copy static assets that Vite doesn't bundle automatically
cp -r app dist/
# THE DEFAULT ENVIRONMENT MAP IS GITIGNORED (*.hdr), so a build from a clean checkout or worktree
# does not contain it and ships a site whose lighting environment 404s. Found on production
# 2026-10-09. Build from a tree that has the .hdr files, or copy them in first.
if [ ! -f dist/app/resources/environments/ferndale_studio_07_1k.hdr ]; then
  echo "❌ WARNING: dist/app/resources/environments/ferndale_studio_07_1k.hdr is MISSING (gitignored)."
  echo "   The deployed site will have no default environment. Copy app/resources/environments/*.hdr"
  echo "   from your main working tree into this tree and re-run, unless the server already has them."
  if [ -z "$ALLOW_NO_HDR" ]; then echo "   (set ALLOW_NO_HDR=1 to deploy anyway)"; exit 1; fi
fi

# Copy Voxel Workers and wasm to dist in the correct relative path
mkdir -p dist/src/workers
cp -r src/workers/* dist/src/workers/
cp node_modules/manifold-3d/manifold.wasm dist/
node scripts/gen-sw.mjs
# NO_SW=1 ./deploy.sh  -> ship WITHOUT the service worker. Used for the first production deploy of a
# build that carries one: with no sw.js a rollback is a pure file swap, with no browser-side cache
# to clean up. (pwa.js registers it with a caught .catch, so a 404 is harmless.)
if [ -n "$NO_SW" ]; then
  rm -f dist/sw.js
  echo "⚠️  NO_SW set: sw.js NOT included in this deploy"
fi

echo "🚀 Deploying to ${HOST}:${DEST}..."

# Reuse SSH connection to avoid multiple key prompts
SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/ssh_mux_%h_%p_%r -o ControlPersist=24h -o PasswordAuthentication=no"

# 1. Ensure remote directory exists
ssh ${SSH_OPTS} ${USER}@${HOST} "mkdir -p ${DEST}"


# 1b. ROLLBACK SNAPSHOT of what is live right now, BEFORE it is overwritten.
#
# A server-side HARDLINK copy (cp -al): instant and almost free, and safe because rsync replaces a
# file by writing a new one and renaming it over the old, so the snapshot keeps the old content.
# Lives in ~/rollbacks/<site>/, outside the web root. Keeps the newest three. ./rollback.sh puts
# one back. See rollback.sh.
SITE=$(basename "${DEST%/}")
ssh ${SSH_OPTS} ${USER}@${HOST} "
  set -e
  LIVE=${DEST%/}
  if [ -d \"\$LIVE\" ]; then
    PREV=\$(grep -o 'v[0-9][0-9.]*' \"\$LIVE/version.json\" 2>/dev/null | head -1)
    SNAP=\$HOME/rollbacks/${SITE}/\${PREV:-unknown}_\$(date +%Y%m%d-%H%M%S)
    mkdir -p \$HOME/rollbacks/${SITE} && cp -al \"\$LIVE\" \"\$SNAP\" && echo \"📸 snapshot -> \$SNAP\"
    ls -1d \$HOME/rollbacks/${SITE}/v*/ 2>/dev/null | sed 's|/\$||' | awk -F_ '{print \$NF\" \"\$0}' | sort -r | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf
  fi
" || { echo "❌ ROLLBACK SNAPSHOT FAILED -- refusing to overwrite the live site without one."; exit 1; }

# 2. Rsync files
rsync -avz -e "ssh ${SSH_OPTS}" dist/ ${USER}@${HOST}:${DEST}/

echo "✨ Deployment Complete! ($CURRENT_VERSION)"
echo "$CURRENT_VERSION" > "$LAST_VERSION_FILE"
