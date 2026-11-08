#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::Sampler &sampler, demo::CallbackWorkers &workers,
                demo::Preset preset, bool &samplerFinished) {
    app.setLoading(true);
    demo::ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    const auto mixer = app.mixerSnapshot();

    workers.run([preset, mixer] { return demo::prepareInstrument(preset, mixer); },
                [&](demo::PreparedInstrument instrument) {
                    sampler.installInstrument(instrument);
                    app.notifyPresetLoaded(); // Fires again. Surely harmless.
                    samplerFinished = true;
                });

    // These statements still run now, not when loadSamplerAsync finishes.
    sampler
        .rebuildKeySwitchMap(); // Reads the instrument currently installed in sampler.
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
