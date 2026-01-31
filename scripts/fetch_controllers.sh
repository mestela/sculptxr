#!/bin/bash
set -e

# Target Directory
TARGET_DIR="src/resources/controllers_raw"
mkdir -p "$TARGET_DIR"

# Base URL for Meta Quest Touch Plus (Quest 3)
BASE_URL="https://raw.githubusercontent.com/immersive-web/webxr-input-profiles/master/packages/assets/profiles/meta-quest-touch-plus"

echo "Downloading Meta Quest Touch Plus (Quest 3) assets..."

# Download Left
echo "Fetching left.glb..."
curl -L -o "$TARGET_DIR/left.glb" "$BASE_URL/left.glb"

# Download Right
echo "Fetching right.glb..."
curl -L -o "$TARGET_DIR/right.glb" "$BASE_URL/right.glb"

echo "Download complete. Files saved to $TARGET_DIR"
