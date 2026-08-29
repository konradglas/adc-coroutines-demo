#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::Preset preset) {
    app.setLoading(true);
    demo::ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();

    auto tree = demo::prepareSamplerTree(std::move(preset), std::move(mixer));

    app.installSamplerTree(std::move(tree));
    app.rebuildKeySwitchMap();

    auto location = demo::askUserToLocateSamples(app.missingSamples());
    auto samples = demo::loadSamples(std::move(location));

    app.installSamples(std::move(samples));
    app.notifyPresetLoaded();
}

int main() {
    demo::App app;
    auto preset = demo::concertGrand();

    loadPreset(app, preset);
    return app.qaCheck(preset.name) ? 0 : 1;
}
