#pragma once
#include <cstddef>
namespace tbb {
template<typename T> class blocked_range {
  T b_, e_;
public:
  blocked_range(T b, T e, std::size_t = 1) : b_(b), e_(e) {}
  T begin() const { return b_; }
  T end()   const { return e_; }
};
}
