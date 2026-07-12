#!/usr/bin/env bash
# Build autoremesher's AutoRemesher module + FFI -> wasm, linking the prebuilt
# libgeogram.a. Emits autoremesher.js (+ .wasm) as an ES6/worker module.
#
# Prereqs: emscripten (emcc), and:
#   - libgeogram.a next to ../ (docs/autoremesher_wasm/libgeogram.a)
#   - autoremesher source cloned at ../geogram_wasm_build/autoremesher
#     (run ../build_geogram_wasm.sh once if missing)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export PATH="/opt/homebrew/bin:$PATH"
EMPREFIX="$(/opt/homebrew/bin/brew --prefix emscripten 2>/dev/null || echo /opt/homebrew/opt/emscripten)"
export EMSCRIPTEN="$EMPREFIX/libexec"

AR="$ROOT/geogram_wasm_build/autoremesher"
ARSRC="$AR/src/AutoRemesher"
GEO="$AR/thirdparty/geogram/geogram-1.8.3/src/lib"
EXPLO="$GEO/exploragram/hexdom"
LIBGEO="$ROOT/libgeogram.a"

[ -d "$ARSRC" ] || { echo "!! autoremesher source missing at $ARSRC — run ../build_geogram_wasm.sh"; exit 1; }
[ -f "$LIBGEO" ] || { echo "!! libgeogram.a missing at $LIBGEO"; exit 1; }

# Apply the one wasm source fix (guard std::this_thread::sleep_for, unavailable
# without pthreads; that spin loop is dead code single-threaded). Idempotent.
PATCH="$ROOT/autoremesher_wasm_fixes.patch"
if [ -f "$PATCH" ]; then
  ( cd "$AR" && git apply --reverse --check "$PATCH" 2>/dev/null \
      && echo "== source patch already applied" \
      || { git apply "$PATCH" && echo "== source patch applied"; } )
fi

echo "== emcc: $(emcc --version | head -1)"

INCLUDES=(
  -I"$HERE/shim"          # QDebug stub
  -I"$AR/include"         # <AutoRemesher/...>
  -I"$GEO"                # <geogram/...>, <exploragram/...>
  -I"$AR/thirdparty/geogram"  # <geogram_report_progress.h>
  -I"$AR/thirdparty/eigen"    # <Eigen/Dense>
  -I"$AR/thirdparty/isotropicremesher"  # <isotropichalfedgemesh.h> etc.
  -I"$ROOT/tbb-shim"      # serial <tbb/...> shims
)

# AutoRemesher's own module + the two exploragram TUs the lib excludes
# (quad_cover = the QuadCover parametrization, polygon = quadextractor helper).
SOURCES=(
  "$HERE/ffi.cpp"
  "$ARSRC/autoremesher.cpp"
  "$ARSRC/parameterizer.cpp"
  "$ARSRC/quadextractor.cpp"
  "$ARSRC/isotropicremesher.cpp"
  "$ARSRC/meshseparator.cpp"
  "$ARSRC/positionkey.cpp"
  "$EXPLO/quad_cover.cpp"
  "$EXPLO/polygon.cpp"
  "$EXPLO/basic.cpp"
  "$AR/thirdparty/isotropicremesher/isotropicremesher.cpp"
  "$AR/thirdparty/isotropicremesher/isotropichalfedgemesh.cpp"
  "$AR/thirdparty/isotropicremesher/axisalignedboundingboxtree.cpp"
)

cd "$HERE"
emcc \
  -std=c++17 -O2 \
  -DGEO_STATIC_LIBS \
  "${INCLUDES[@]}" \
  "${SOURCES[@]}" \
  "$LIBGEO" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4gb \
  -sSTACK_SIZE=4mb \
  -sEXPORTED_FUNCTIONS='["_remesh_autoremesher","_free_mesh_result","_autoremesher_init","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPF32","HEAPU32"]' \
  -o "$HERE/autoremesher.js"

echo "== DONE:"
ls -la "$HERE/autoremesher.js" "$HERE/autoremesher.wasm"
