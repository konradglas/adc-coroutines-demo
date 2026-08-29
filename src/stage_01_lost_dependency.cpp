#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::Sampler &sampler, demo::CallbackWorkers &workers,
                demo::Preset preset, bool &samplerFinished) {
    app.setLoading(true);
    demo::ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    const auto mixer = app.mixerSnapshot();

    workers.run([preset, mixer] { return demo::prepareSamplerTree(preset, mixer); },
                [&](demo::PreparedSamplerTree tree) {
                    sampler.installSamplerTree(tree);
                    app.notifyPresetLoaded(); // Fires again. Surely harmless.
                    samplerFinished = true;
                });

    // These statements still run now, not when loadSamplerAsync finishes.
    sampler.rebuildKeySwitchMap(); // Reads the tree currently installed in sampler.
    auto location = demo::askUserToLocateSamples(sampler.missingSamples());
    auto samples = demo::loadSamples(std::move(location));
    sampler.installSamples(std::move(samples));
    app.notifyPresetLoaded();
}

int main() {
    demo::App app;
    demo::Sampler sampler;
    demo::HostQueue mainQueue;
    demo::CallbackWorkers workers(mainQueue);
    auto preset = demo::concertGrand();
    bool samplerFinished = false;

    loadPreset(app, sampler, workers, preset, samplerFinished);
    mainQueue.pumpUntil([&] { return samplerFinished; });
    return app.qaCheck(preset.name, sampler) ? 0 : 1;
}
