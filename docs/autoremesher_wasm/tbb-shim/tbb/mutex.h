#pragma once
// Serial shim for tbb::mutex. autoremesher includes this header but the wasm
// build is single-threaded, so a std::mutex-compatible no-contention type suffices.
#include <mutex>
namespace tbb {
using mutex = std::mutex;
using spin_mutex = std::mutex;
}
