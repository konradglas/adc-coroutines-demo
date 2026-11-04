#include "demo_async.hpp"

#include <affine/main_actor_task.hpp>
#include <affine/task_scope.hpp>
#include <exec/static_thread_pool.hpp>

using affine::MainActorTask;

template <class WorkerScheduler>
MainActorTask<void> loadPreset(demo::App &app, demo::Sampler &sampler,
                               demo::Preset preset, WorkerScheduler worker) {
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

    // The host owns the main thread: the scope only posts into its event loop.
    affine::root_scope scope(
        [&](std::function<void()> callback) { hostQueue.post(std::move(callback)); });

    auto loading =
        affine::spawn(loadPreset(app, sampler, demo::concertGrand(), workers.get_scheduler()),
                      scope);
    hostQueue.pumpUntil([&] { return loading.completed(); });
    scope.shutdown_and_wait();

    return app.qaCheck("Concert Grand", sampler) ? 0 : 1;
}
