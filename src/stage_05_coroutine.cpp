#include "demo_async.hpp"

#include <affine/affine_task.hpp>
#include <affine/main_thread_executor.hpp>
#include <affine/stdexec.hpp>
#include <exec/static_thread_pool.hpp>

using MainActorTask = affine::affine_task<void, affine::main_thread_executor>;

template <class WorkerScheduler>
MainActorTask loadPreset(demo::App &app, demo::Sampler &sampler, demo::Preset preset,
                         WorkerScheduler worker) {
    app.setLoading(true);
    demo::ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();

    auto tree =
        co_await demo::prepareSamplerTree(std::move(preset), std::move(mixer), worker);

    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();

    auto location =
        co_await demo::askUserToLocateSamples(sampler.missingSamples(), worker);
    auto samples = co_await demo::loadSamples(std::move(location), worker);

    sampler.installSamples(std::move(samples));
    app.notifyPresetLoaded();
}

int main() {
    demo::App app;
    demo::Sampler sampler;
    demo::HostQueue hostQueue;
    exec::static_thread_pool workers(2);

    affine::main_thread_executor mainActor(
        std::this_thread::get_id(),
        [&](std::function<void()> callback) { hostQueue.post(std::move(callback)); },
        [&](std::function<bool()> done) { hostQueue.pumpUntil(std::move(done)); });

    auto task = loadPreset(app, sampler, demo::concertGrand(), workers.get_scheduler());
    affine::sync_wait(std::move(task).scheduleOn(mainActor));

    return app.qaCheck("Concert Grand", sampler) ? 0 : 1;
}
