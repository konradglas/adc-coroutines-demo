#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::CallbackWorkers &workers, demo::Preset preset,
                bool &dialogReturned, bool &finished) {
    app.setLoading(true);
    app.loadMixerState(preset);
    const auto mixer = app.mixerSnapshot();

    workers.run([preset, mixer] { return demo::prepareSamplerTree(preset, mixer); },
                [&](demo::PreparedSamplerTree tree) {
                    app.installSamplerTree(std::move(tree));
                    app.rebuildKeySwitchMap();

                    const auto missingSamples = app.missingSamples();
                    std::stop_source dialog;
                    dialog.request_stop(); // The user presses Cancel.

                    workers.run(
                        [missingSamples, token = dialog.get_token()] {
                            return demo::askUserToLocateSamples(missingSamples, token);
                        },
                        [&](std::optional<demo::SampleLibraryLocation> location) {
                            dialogReturned = true;

                            if (!location)
                                return; // Forgot to complete the outer preset load.

                            workers.run(
                                [location = std::move(*location)] {
                                    return demo::loadSamples(std::move(location));
                                },
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
    bool dialogReturned = false;
    bool finished = false;

    loadPreset(app, workers, preset, dialogReturned, finished);
    mainQueue.pumpUntil([&] { return dialogReturned; });

    // QA: "Cancel the dialog. The spinner stays forever."
    return app.qaCheck(preset.name) && finished ? 0 : 1;
}
