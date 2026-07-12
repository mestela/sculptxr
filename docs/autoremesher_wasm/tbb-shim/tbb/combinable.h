#pragma once
#include <functional>
namespace tbb {
template<typename T> class combinable {
  std::function<T()> init_;
  T value_;
  bool has_ = false;
public:
  combinable() {}
  template<typename F> combinable(F f) : init_(f) {}
  T& local() { if (!has_) { value_ = init_ ? init_() : T(); has_ = true; } return value_; }
  template<typename F> void combine_each(F f) { if (has_) f(value_); }
};
}
