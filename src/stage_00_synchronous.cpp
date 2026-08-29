#include "demo_support.hpp"

void loadPreset(demo::App &app, demo::Sampler &sampler, demo::Preset preset) {
    app.setLoading(true);
    demo::ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();

    auto tree = demo::prepareSamplerTree(std::move(preset), std::move(mixer));

    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();

    app.notifyPresetLoaded();
}

int main() {
    demo::App app;
    demo::Sampler sampler;
    auto preset = demo::concertGrand();

    loadPreset(app, sampler, preset);
    return app.qaCheck(preset.name, sampler) ? 0 : 1;
}
