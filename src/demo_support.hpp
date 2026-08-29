#pragma once

#include <condition_variable>
#include <cstdint>
#include <exception>
#include <functional>
#include <mutex>
#include <optional>
#include <queue>
#include <stop_token>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace demo {

struct Preset {
    std::string name;
    std::vector<std::string> activeMicrophones;
    std::vector<std::string> articulations;
    std::string sampleLibrary;
};

struct MixerSnapshot {
    std::string presetName;
    std::vector<std::string> activeMicrophones;
};

struct PreparedSamplerTree {
    std::string presetName;
    std::vector<std::string> activeMicrophones;
    std::vector<std::string> articulations;
    std::string missingLibrary;
    std::vector<std::string> missingSamples;
};

struct MissingSamplesRequest {
    std::string presetName;
    std::string library;
    std::vector<std::string> samples;
};

struct SampleLibraryLocation {
    std::string presetName;
    std::string path;
};

struct LoadedSamples {
    std::string presetName;
    std::size_t count = 0;
};

template <class T> struct OperationResult {
    std::optional<T> value;
    std::exception_ptr error;
    bool cancelled = false;
};

Preset concertGrand();
Preset chamberStrings();

class ScopeExit {
  public:
    explicit ScopeExit(std::function<void()> cleanup);
    ScopeExit(ScopeExit &&other) noexcept;
    ScopeExit &operator=(ScopeExit &&) = delete;
    ScopeExit(const ScopeExit &) = delete;
    ScopeExit &operator=(const ScopeExit &) = delete;
    ~ScopeExit();

  private:
    std::function<void()> _cleanup;
};

class Sampler {
  public:
    Sampler();

    void installSamplerTree(const PreparedSamplerTree &tree);
    void rebuildKeySwitchMap();
    [[nodiscard]] MissingSamplesRequest missingSamples() const;
    void installSamples(LoadedSamples samples);

  private:
    friend class App;

    void requireMainThread() const;

    std::thread::id _mainThread;
    std::string _samplerPreset = "Initial preset";
    std::string _keySwitchPreset = "Initial preset";
    std::string _samplesPreset = "Initial preset";
    std::string _missingLibrary = "Initial Library";
    std::vector<std::string> _missingSamples{"Initial.sample"};
    std::vector<std::string> _articulations;
};

class App {
  public:
    App();

    void setLoading(bool loading);
    void loadMixerState(const Preset &preset);
    [[nodiscard]] MixerSnapshot mixerSnapshot() const;

    void notifyPresetLoaded();
    void notifyPresetLoadFailed();
    [[nodiscard]] bool qaCheck(const std::string &expectedPreset,
                               const Sampler &sampler) const;

  private:
    void requireMainThread() const;

    std::thread::id _mainThread;
    bool _loading = false;
    std::string _mixerPreset = "Initial preset";
    std::vector<std::string> _activeMicrophones;
};

PreparedSamplerTree prepareSamplerTree(Preset preset, MixerSnapshot mixer);

std::optional<PreparedSamplerTree>
prepareSamplerTree(Preset preset, MixerSnapshot mixer, std::stop_token stopToken);

SampleLibraryLocation askUserToLocateSamples(MissingSamplesRequest request);

std::optional<SampleLibraryLocation>
askUserToLocateSamples(MissingSamplesRequest request, std::stop_token stopToken);

LoadedSamples loadSamples(SampleLibraryLocation location);

std::optional<LoadedSamples> loadSamples(SampleLibraryLocation location,
                                         std::stop_token stopToken);

class HostQueue {
  public:
    void post(std::function<void()> callback);

    template <class Predicate> void pumpUntil(Predicate done) {
        while (!done()) {
            std::function<void()> callback;
            {
                std::unique_lock lock(_mutex);
                _ready.wait(lock, [&] { return done() || !_callbacks.empty(); });
                if (done() && _callbacks.empty())
                    return;
                callback = std::move(_callbacks.front());
                _callbacks.pop();
            }
            callback();
        }
    }

  private:
    std::mutex _mutex;
    std::condition_variable _ready;
    std::queue<std::function<void()>> _callbacks;
};

class CallbackWorkers {
  public:
    explicit CallbackWorkers(HostQueue &host) : _host(host) {}

    template <class Work, class Completion> void run(Work work, Completion completion) {
        _threads.emplace_back([this, work = std::move(work),
                               completion = std::move(completion)]() mutable {
            auto result = work();
            _host.post([result = std::move(result),
                        completion = std::move(completion)]() mutable {
                completion(std::move(result));
            });
        });
    }

  private:
    HostQueue &_host;
    std::vector<std::jthread> _threads;
};

} // namespace demo
