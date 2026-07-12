#!/usr/bin/env bash
# Build the Node smoke-test (test_main.cpp + FFI + autoremesher) -> test_ar.cjs.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export PATH="/opt/homebrew/bin:$PATH"
EMPREFIX="$(/opt/homebrew/bin/brew --prefix emscripten)"; export EMSCRIPTEN="$EMPREFIX/libexec"
AR="$ROOT/geogram_wasm_build/autoremesher"; ARSRC="$AR/src/AutoRemesher"
GEO="$AR/thirdparty/geogram/geogram-1.8.3/src/lib"; EXPLO="$GEO/exploragram/hexdom"
emcc -std=c++17 -O2 -DGEO_STATIC_LIBS \
  -I"$HERE/shim" -I"$AR/include" -I"$GEO" -I"$AR/thirdparty/geogram" \
  -I"$AR/thirdparty/eigen" -I"$AR/thirdparty/isotropicremesher" -I"$ROOT/tbb-shim" \
  "$HERE/test_main.cpp" "$HERE/ffi.cpp" \
  "$ARSRC/autoremesher.cpp" "$ARSRC/parameterizer.cpp" "$ARSRC/quadextractor.cpp" \
  "$ARSRC/isotropicremesher.cpp" "$ARSRC/meshseparator.cpp" "$ARSRC/positionkey.cpp" \
  "$EXPLO/quad_cover.cpp" "$EXPLO/polygon.cpp" "$EXPLO/basic.cpp" \
  "$AR/thirdparty/isotropicremesher/isotropicremesher.cpp" \
  "$AR/thirdparty/isotropicremesher/isotropichalfedgemesh.cpp" \
  "$AR/thirdparty/isotropicremesher/axisalignedboundingboxtree.cpp" \
  "$ROOT/libgeogram.a" \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4gb -sSTACK_SIZE=4mb -sENVIRONMENT=node \
  -sFORCE_FILESYSTEM -lnodefs.js -o "$HERE/test_ar.cjs"
