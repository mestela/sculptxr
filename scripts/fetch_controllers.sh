#!/bin/bash
set -e

# Target Directory
TARGET_DIR="src/resources/controllers_raw"
mkdir -p "$TARGET_DIR"

# Base URL for Oculus Touch v3 (Quest 2/3)
BASE_URL="https://raw.githubusercontent.com/immersive-web/webxr-input-profiles/master/packages/assets/profiles/oculus-touch-v3"

echo "Downloading Oculus Touch v3 assets..."

# Download Left
echo "Fetching left.glb..."
curl -L -o "$TARGET_DIR/left.glb" "$BASE_URL/left.glb"

# Download Right
echo "Fetching right.glb..."
curl -L -o "$TARGET_DIR/right.glb" "$BASE_URL/right.glb"

echo "Download complete. Files saved to $TARGET_DIR"
