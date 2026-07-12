#!/usr/bin/env bash
# Reproducible build of geogram (1.8.3, as vendored by autoremesher) → wasm32 static lib.
# Proven working 2026-07-09. Produces libgeogram.a containing GEO::FrameField +
# GEO::GlobalParam2d (QuadCover) + OpenNL — the exact modules autoremesher's algorithm needs.
#
# Prereqs (already installed on Matt's Mac 2026-07-09 via `brew install cmake emscripten`):
#   - emscripten (emcc/emcmake)   brew --prefix emscripten
#   - cmake >= 3.5
# Usage:  bash build_geogram_wasm.sh [workdir]
#   Default workdir: ./geogram_wasm_build (next to this script). Re-runnable/idempotent-ish.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${1:-$HERE/geogram_wasm_build}"
EMPREFIX="$(/opt/homebrew/bin/brew --prefix emscripten 2>/dev/null || echo /opt/homebrew/opt/emscripten)"
export PATH="/opt/homebrew/bin:$PATH"
export EMSCRIPTEN="$EMPREFIX/libexec"

echo "== emscripten: $(emcc --version 2>/dev/null | head -1)"
echo "== work dir:   $WORK"

# 1. Fetch autoremesher (has the vendored, TBB-patched geogram-1.8.3).
mkdir -p "$WORK" && cd "$WORK"
if [ ! -d autoremesher ]; then
  git clone --depth 1 https://github.com/huxingyi/autoremesher
fi
GEO="$WORK/autoremesher/thirdparty/geogram/geogram-1.8.3"

# 2. Apply the wasm-build fixes (CMake 4.x, stripped-copy refs, PoissonRecon, AMGCL, TBB path).
#    (These edit files under autoremesher/thirdparty/geogram; safe to re-apply via --forward.)
cd "$WORK/autoremesher"
git apply --reverse --check "$HERE/geogram_wasm_fixes.patch" 2>/dev/null \
  && echo "== patch already applied" \
  || git apply "$HERE/geogram_wasm_fixes.patch" && echo "== patch applied"

# 2b. Apply the face-group STEERING patch: makes geogram's FrameField + get_edge_constraints
#     honor a "seam" facet-corner attribute, so painted group borders steer the quad flow.
#     (mesh_frame_field.cpp + mesh_global_param.cpp — compiled INTO libgeogram.a.)
if [ -f "$HERE/geogram_steering.patch" ]; then
  git apply --reverse --check "$HERE/geogram_steering.patch" 2>/dev/null \
    && echo "== steering patch already applied" \
    || { git apply "$HERE/geogram_steering.patch" && echo "== steering patch applied"; }
fi

# 3. Install the serial TBB shims (autoremesher parallelized geogram's mesh_global_param.cpp;
#    the patch points geogram's include path at src/lib/geogram/tbb-shim).
mkdir -p "$GEO/src/lib/geogram/tbb-shim/tbb"
cp "$HERE/tbb-shim/tbb/"*.h "$GEO/src/lib/geogram/tbb-shim/tbb/"

# 4. Configure (emcmake sets the emcc toolchain BEFORE project(); geogram's own Emscripten
#    platform config is neutered by the patch so it doesn't fight emcmake) and build.
BUILD="$WORK/geo-wasm"
rm -rf "$BUILD" && mkdir -p "$BUILD" && cd "$BUILD"
emcmake cmake "$GEO" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DVORPALINE_PLATFORM=Emscripten-clang \
  -DGEOGRAM_LIB_ONLY=ON -DGEOGRAM_WITH_GRAPHICS=OFF -DGEOGRAM_WITH_LUA=OFF \
  -DGEOGRAM_WITH_TETGEN=OFF -DGEOGRAM_WITH_TRIANGLE=OFF -DGEOGRAM_WITH_EXPLORAGRAM=OFF \
  -DGEOGRAM_WITH_HLBFGS=OFF -DGEOGRAM_WITH_LEGACY_NUMERICS=ON \
  -DCMAKE_BUILD_TYPE=Release
cmake --build . --target geogram -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"

echo
echo "== DONE. Artifact: $BUILD/lib/libgeogram.a"
ls -la "$BUILD/lib/libgeogram.a"
echo "== sanity (should list FrameField / GlobalParam2d symbols):"
emnm "$BUILD/lib/libgeogram.a" 2>/dev/null | grep -iE "FrameField|GlobalParam2d" | head -4
