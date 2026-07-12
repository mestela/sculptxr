#pragma once
namespace tbb {
template<typename Range, typename Body>
inline void parallel_for(const Range& r, const Body& body) { body(r); }
}
