#include "demo_support.hpp"

#include <memory>

class PresetLoader : public std::enable_shared_from_this<PresetLoader> {
  public:
    PresetLoader(demo::App &app, demo::CallbackWorkers &workers)
        : _app(app), _workers(workers) {}

    void loadPreset(demo::Preset preset) {
        _stopSource.request_stop();
        _stopSource = std::stop_source{};

        const auto request = ++_currentRequest;
        const auto token = _stopSource.get_token();
        _finished = false;

        _app.setLoading(true);
        _app.loadMixerState(preset);
        const auto mixer = _app.mixerSnapshot();

        _workers.run(
            [preset, mixer, token]() mutable {
                demo::OperationResult<demo::PreparedSamplerTree> result;
                try {
                    result.value =
                        demo::prepareSamplerTree(std::move(preset), mixer, token);
                    result.cancelled = !result.value.has_value();
                } catch (...) {
                    result.error = std::current_exception();
                }
                return result;
            },
            [weak = weak_from_this(), request, token](auto result) mutable {
                if (auto self = weak.lock())
                    self->completeSampler(request, token, std::move(result));
            });
    }

    [[nodiscard]] bool finished() const {
        return _finished;
    }

  private:
    void completeSampler(std::uint64_t request, std::stop_token token,
                         demo::OperationResult<demo::PreparedSamplerTree> result) {
        if (request != _currentRequest)
            return;

        if (!continueRequest(result))
            return;

        _app.installSamplerTree(std::move(*result.value));
        _app.rebuildKeySwitchMap();

        const auto missingSamples = _app.missingSamples();
        _workers.run(
            [missingSamples, token]() mutable {
                demo::OperationResult<demo::SampleLibraryLocation> result;
                try {
                    result.value =
                        demo::askUserToLocateSamples(std::move(missingSamples), token);
                    result.cancelled = !result.value.has_value();
                } catch (...) {
                    result.error = std::current_exception();
                }
                return result;
            },
            [weak = weak_from_this(), request, token](auto result) mutable {
                if (auto self = weak.lock())
                    self->completeLocation(request, token, std::move(result));
            });
    }

    void completeLocation(std::uint64_t request, std::stop_token token,
                          demo::OperationResult<demo::SampleLibraryLocation> result) {
        if (request != _currentRequest)
            return;

        if (!continueRequest(result))
            return;

        _workers.run(
            [location = std::move(*result.value), token]() mutable {
                demo::OperationResult<demo::LoadedSamples> result;
                try {
                    result.value = demo::loadSamples(std::move(location), token);
                    result.cancelled = !result.value.has_value();
                } catch (...) {
                    result.error = std::current_exception();
                }
                return result;
            },
            [weak = weak_from_this(), request](auto result) mutable {
                if (auto self = weak.lock())
                    self->completeSamples(request, std::move(result));
            });
    }

    void completeSamples(std::uint64_t request,
                         demo::OperationResult<demo::LoadedSamples> result) {
        if (request != _currentRequest)
            return;

        if (!continueRequest(result))
            return;

        _app.installSamples(std::move(*result.value));
        _app.notifyPresetLoaded();
        finishRequest();
    }

    template <class T> bool continueRequest(const demo::OperationResult<T> &result) {
        if (result.cancelled) {
            finishRequest();
            return false;
        }

        if (result.error) {
            _app.notifyPresetLoadFailed();
            finishRequest();
            return false;
        }

        return true;
    }

    void finishRequest() {
        _app.setLoading(false);
        _finished = true;
    }

    demo::App &_app;
    demo::CallbackWorkers &_workers;
    std::stop_source _stopSource;
    std::uint64_t _currentRequest = 0;
    bool _finished = false;
};

int main() {
    demo::App app;
    demo::HostQueue mainQueue;
    demo::CallbackWorkers workers(mainQueue);
    auto loader = std::make_shared<PresetLoader>(app, workers);

    loader->loadPreset(demo::concertGrand());
    loader->loadPreset(demo::chamberStrings()); // QA clicks another preset quickly.

    mainQueue.pumpUntil([&] { return loader->finished(); });
    return app.qaCheck("Chamber Strings") ? 0 : 1;
}
