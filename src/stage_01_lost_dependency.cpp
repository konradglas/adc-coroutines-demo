#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::CallbackWorkers &workers, demo::Preset preset,
                bool &samplerFinished) {
    app.setLoading(true);
    demo::ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    const auto mixer = app.mixerSnapshot();

    workers.run([preset, mixer] { return demo::prepareSamplerTree(preset, mixer); },
                [&](demo::PreparedSamplerTree tree) {
                    app.installSamplerTree(std::move(tree));
                    app.notifyPresetLoaded(); // Fires again. Surely harmless.
                    samplerFinished = true;
                });

    // These statements still run now, not when loadSamplerAsync finishes.
    app.rebuildKeySwitchMap();
    auto location = demo::askUserToLocateSamples(app.missingSamples());
    auto samples = demo::loadSamples(std::move(location));
    app.installSamples(std::move(samples));
    app.notifyPresetLoaded();
}

int main() {
    demo::App app;
    demo::HostQueue mainQueue;
    demo::CallbackWorkers workers(mainQueue);
    auto preset = demo::concertGrand();
    bool samplerFinished = false;

    loadPreset(app, workers, preset, samplerFinished);
    mainQueue.pumpUntil([&] { return samplerFinished; });
    return app.qaCheck(preset.name) ? 0 : 1;
}
