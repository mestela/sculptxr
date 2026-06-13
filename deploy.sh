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

# Copy Voxel Workers and wasm to dist in the correct relative path
mkdir -p dist/src/workers
cp -r src/workers/* dist/src/workers/
cp node_modules/manifold-3d/manifold.wasm dist/

echo "🚀 Deploying to ${HOST}:${DEST}..."

# Reuse SSH connection to avoid multiple key prompts
SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/ssh_mux_%h_%p_%r -o ControlPersist=24h -o PasswordAuthentication=no"

# 1. Ensure remote directory exists
ssh ${SSH_OPTS} ${USER}@${HOST} "mkdir -p ${DEST}"


# 2. Rsync files
rsync -avz -e "ssh ${SSH_OPTS}" dist/ ${USER}@${HOST}:${DEST}/

echo "✨ Deployment Complete! ($CURRENT_VERSION)"
echo "$CURRENT_VERSION" > "$LAST_VERSION_FILE"
