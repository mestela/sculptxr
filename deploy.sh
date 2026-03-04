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
        echo "   Auto-incrementing patch version..."
        
        # Extract major, minor, patch
        MAJOR=$(echo $CURRENT_VERSION | cut -d. -f1)
        MINOR=$(echo $CURRENT_VERSION | cut -d. -f2)
        PATCH=$(echo $CURRENT_VERSION | cut -d. -f3)
        
        # Increment patch
        PATCH=$((PATCH + 1))
        NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
        
        echo "   -> Updating index.html to $NEW_VERSION"
        # Update index.html (works on both macOS and Linux sed)
        sed -i.bak "s/$CURRENT_VERSION/$NEW_VERSION/g" index.html
        rm index.html.bak
        
        # Update CURRENT_VERSION for the rest of the script
        CURRENT_VERSION=$NEW_VERSION
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

echo "🚧 Preparing distribution package..."
rm -rf dist_stage && mkdir -p dist_stage
cp index.html dist_stage/index.html
cp -r src lib dist_stage/
mkdir -p dist_stage/resources
cp -r app/resources/* dist_stage/resources/
mkdir -p dist_stage/app/css
cp -r app/css/* dist_stage/app/css/

echo "🚀 Deploying to ${HOST}:${DEST}..."

# Reuse SSH connection to avoid multiple key prompts
SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/ssh_mux_%h_%p_%r -o ControlPersist=24h -o PasswordAuthentication=no"

# 1. Ensure remote directory exists
ssh ${SSH_OPTS} ${USER}@${HOST} "mkdir -p ${DEST}"


# 2. Rsync files
rsync -avz -e "ssh ${SSH_OPTS}" dist_stage/ ${USER}@${HOST}:${DEST}/

echo "✨ Deployment Complete! ($CURRENT_VERSION)"
echo "$CURRENT_VERSION" > "$LAST_VERSION_FILE"
