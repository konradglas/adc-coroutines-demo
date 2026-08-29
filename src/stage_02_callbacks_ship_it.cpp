#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::Sampler &sampler, demo::CallbackWorkers &workers,
                demo::Preset preset, bool &finished) {
    app.setLoading(true);
    app.loadMixerState(preset);
    const auto mixer = app.mixerSnapshot();

    workers.run([preset, mixer] { return demo::prepareSamplerTree(preset, mixer); },
                [&](demo::PreparedSamplerTree tree) {
                    sampler.installSamplerTree(tree);
                    sampler.rebuildKeySwitchMap();
                    app.notifyPresetLoaded();
                    app.setLoading(false);
                    finished = true;
                });
}

int main() {
    demo::App app;
    demo::Sampler sampler;
    demo::HostQueue mainQueue;
    demo::CallbackWorkers workers(mainQueue);
    auto preset = demo::concertGrand();
    bool finished = false;

    // The original workflow works. Ship it to QA.
    loadPreset(app, sampler, workers, preset, finished);
    mainQueue.pumpUntil([&] { return finished; });

    // QA: "Could we let the user locate missing samples?"
    return app.qaCheck(preset.name, sampler) ? 0 : 1;
}
