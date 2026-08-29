#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::CallbackWorkers &workers, demo::Preset preset,
                bool &finished) {
    app.setLoading(true);
    app.loadMixerState(preset);
    const auto mixer = app.mixerSnapshot();

    workers.run([preset, mixer] { return demo::prepareSamplerTree(preset, mixer); },
                [&](demo::PreparedSamplerTree tree) {
                    app.installSamplerTree(std::move(tree));
                    app.rebuildKeySwitchMap();

                    const auto missingSamples = app.missingSamples();
                    workers.run(
                        [missingSamples] {
                            return demo::askUserToLocateSamples(missingSamples);
                        },
                        [&](demo::SampleLibraryLocation location) {
                            workers.run(
                                [location] { return demo::loadSamples(location); },
                                [&](demo::LoadedSamples samples) {
                                    app.installSamples(std::move(samples));
                                    app.notifyPresetLoaded();
                                    app.setLoading(false);
                                    finished = true;
                                });
                        });
                });
}

int main() {
    demo::App app;
    demo::HostQueue mainQueue;
    demo::CallbackWorkers workers(mainQueue);
    auto preset = demo::concertGrand();
    bool finished = false;

    // The happy path works. Ship it to QA.
    loadPreset(app, workers, preset, finished);
    mainQueue.pumpUntil([&] { return finished; });
    return app.qaCheck(preset.name) ? 0 : 1;
}
