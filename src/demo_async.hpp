#pragma once

#include "demo_support.hpp"

#include <stdexec/execution.hpp>

namespace demo {

template <class Scheduler>
auto prepareSamplerTree(Preset preset, MixerSnapshot mixer, Scheduler worker) {
    return stdexec::starts_on(std::move(worker),
                              stdexec::just(std::move(preset), std::move(mixer)) |
                                  stdexec::then([](Preset preset, MixerSnapshot mixer) {
                                      return prepareSamplerTree(std::move(preset),
                                                                std::move(mixer));
                                  }));
}

template <class Scheduler>
auto askUserToLocateSamples(MissingSamplesRequest request, Scheduler eventSource) {
    return stdexec::starts_on(std::move(eventSource),
                              stdexec::just(std::move(request)) |
                                  stdexec::then([](MissingSamplesRequest request) {
                                      return askUserToLocateSamples(std::move(request));
                                  }));
}

template <class Scheduler>
auto loadSamples(SampleLibraryLocation location, Scheduler worker) {
    return stdexec::starts_on(std::move(worker),
                              stdexec::just(std::move(location)) |
                                  stdexec::then([](SampleLibraryLocation location) {
                                      return loadSamples(std::move(location));
                                  }));
}

} // namespace demo
