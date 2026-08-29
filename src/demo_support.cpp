#include "demo_support.hpp"

#include <chrono>
#include <iostream>
#include <stdexcept>

using namespace std::chrono_literals;

namespace demo {
namespace {

std::mutex outputMutex;
std::thread::id applicationMainThread;

void print(const char *context, const std::string &message) {
    std::lock_guard lock(outputMutex);
    std::cout << '[' << context << "] " << message << '\n';
}

void printCurrentThread(const std::string &message) {
    print(std::this_thread::get_id() == applicationMainThread ? "main" : "worker",
          message);
}

} // namespace

Preset concertGrand() {
    return {
        "Concert Grand",
        {"Close", "Room"},
        {"Sustain", "Staccato", "Tremolo"},
        "Synchron Pianos",
    };
}

Preset chamberStrings() {
    return {
        "Chamber Strings",
        {"Main", "Mid"},
        {"Legato", "Spiccato", "Pizzicato"},
        "Synchron Strings",
    };
}

ScopeExit::ScopeExit(std::function<void()> cleanup) : _cleanup(std::move(cleanup)) {}

ScopeExit::ScopeExit(ScopeExit &&other) noexcept
    : _cleanup(std::exchange(other._cleanup, {})) {}

ScopeExit::~ScopeExit() {
    if (_cleanup)
        _cleanup();
}

App::App() : _mainThread(std::this_thread::get_id()) {
    applicationMainThread = _mainThread;
}

Sampler::Sampler() : _mainThread(std::this_thread::get_id()) {}

void Sampler::installSamplerTree(const PreparedSamplerTree &tree) {
    requireMainThread();
    _samplerPreset = tree.presetName;
    _samplesPreset = tree.presetName;
    _articulations = tree.articulations;
    _missingLibrary = tree.missingLibrary;
    _missingSamples = tree.missingSamples;
    print("main", "installed sampler tree: " + _samplerPreset);
}

void Sampler::rebuildKeySwitchMap() {
    requireMainThread();
    _keySwitchPreset = _samplerPreset;
    print("main", "key-switch map now points at: " + _keySwitchPreset);
}

MissingSamplesRequest Sampler::missingSamples() const {
    requireMainThread();
    return {_samplerPreset, _missingLibrary, _missingSamples};
}

void Sampler::installSamples(LoadedSamples samples) {
    requireMainThread();
    _samplesPreset = std::move(samples.presetName);
    _missingLibrary.clear();
    _missingSamples.clear();
    print("main", "installed " + std::to_string(samples.count) + " sample files");
}

void Sampler::requireMainThread() const {
    if (std::this_thread::get_id() != _mainThread)
        throw std::logic_error("sampler state escaped the main thread");
}

void App::setLoading(bool loading) {
    requireMainThread();
    _loading = loading;
    print("main", loading ? "loading indicator ON" : "loading indicator OFF");
}

void App::loadMixerState(const Preset &preset) {
    requireMainThread();
    _mixerPreset = preset.name;
    _activeMicrophones = preset.activeMicrophones;
    print("main", "mixer state: " + preset.name);
}

MixerSnapshot App::mixerSnapshot() const {
    requireMainThread();
    return {_mixerPreset, _activeMicrophones};
}

void App::notifyPresetLoaded() {
    requireMainThread();
    print("main", "PresetLoaded: GUI may inspect the preset");
}

void App::notifyPresetLoadFailed() {
    requireMainThread();
    print("main", "PresetLoadFailed");
}

bool App::qaCheck(const std::string &expectedPreset, const Sampler &sampler) const {
    requireMainThread();
    sampler.requireMainThread();
    const bool consistent = !_loading && _mixerPreset == expectedPreset &&
                            sampler._samplerPreset == expectedPreset &&
                            sampler._keySwitchPreset == expectedPreset &&
                            sampler._samplesPreset == expectedPreset;

    print("QA", consistent ? "PASS: every subsystem contains " + expectedPreset
                           : "FAIL: mixer=" + _mixerPreset +
                                 ", sampler=" + sampler._samplerPreset +
                                 ", key-switches=" + sampler._keySwitchPreset +
                                 ", samples=" + sampler._samplesPreset + ", missing=" +
                                 std::to_string(sampler._missingSamples.size()) +
                                 ", loading=" + (_loading ? "true" : "false"));
    return consistent;
}

void App::requireMainThread() const {
    if (std::this_thread::get_id() != _mainThread)
        throw std::logic_error("live application state escaped the main thread");
}

PreparedSamplerTree prepareSamplerTree(Preset preset, MixerSnapshot mixer) {
    auto result =
        prepareSamplerTree(std::move(preset), std::move(mixer), std::stop_token{});
    return std::move(*result);
}

std::optional<PreparedSamplerTree>
prepareSamplerTree(Preset preset, MixerSnapshot mixer, std::stop_token stopToken) {
    printCurrentThread("preparing sampler tree: " + preset.name);

    for (int step = 0; step != 6; ++step) {
        std::this_thread::sleep_for(30ms);
        if (stopToken.stop_requested()) {
            printCurrentThread("cancelled sampler tree: " + preset.name);
            return std::nullopt;
        }
    }

    if (mixer.presetName != preset.name)
        throw std::logic_error("sampler received mixer state from another preset");

    std::vector<std::string> missingSamples;
    missingSamples.reserve(preset.articulations.size());
    for (const auto &articulation : preset.articulations)
        missingSamples.push_back(articulation + ".sample");

    printCurrentThread("prepared sampler tree: " + preset.name);
    return PreparedSamplerTree{
        preset.name,
        std::move(mixer.activeMicrophones),
        std::move(preset.articulations),
        std::move(preset.sampleLibrary),
        std::move(missingSamples),
    };
}

SampleLibraryLocation askUserToLocateSamples(MissingSamplesRequest request) {
    auto result = askUserToLocateSamples(std::move(request), std::stop_token{});
    return std::move(*result);
}

std::optional<SampleLibraryLocation>
askUserToLocateSamples(MissingSamplesRequest request, std::stop_token stopToken) {
    print("user", "Locate missing library: " + request.library);

    for (int step = 0; step != 3; ++step) {
        std::this_thread::sleep_for(30ms);
        if (stopToken.stop_requested()) {
            print("user", "dismissed obsolete missing-content dialog");
            return std::nullopt;
        }
    }

    print("user", "selected /Libraries/" + request.library);
    return SampleLibraryLocation{
        std::move(request.presetName),
        "/Libraries/" + request.library,
    };
}

LoadedSamples loadSamples(SampleLibraryLocation location) {
    auto result = loadSamples(std::move(location), std::stop_token{});
    return std::move(*result);
}

std::optional<LoadedSamples> loadSamples(SampleLibraryLocation location,
                                         std::stop_token stopToken) {
    printCurrentThread("loading samples from: " + location.path);

    for (int step = 0; step != 5; ++step) {
        std::this_thread::sleep_for(30ms);
        if (stopToken.stop_requested()) {
            printCurrentThread("cancelled sample loading: " + location.path);
            return std::nullopt;
        }
    }

    printCurrentThread("loaded samples from: " + location.path);
    return LoadedSamples{std::move(location.presetName), 3};
}

void HostQueue::post(std::function<void()> callback) {
    {
        std::lock_guard lock(_mutex);
        _callbacks.push(std::move(callback));
    }
    _ready.notify_one();
}

} // namespace demo
