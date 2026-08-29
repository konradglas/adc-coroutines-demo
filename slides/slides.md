---
theme: default
title: std::future Is Not the Future
author: Konrad Glas
colorSchema: dark
transition: none
lineNumbers: false
mdc: true
---

<div class="eyebrow">Audio Developer Conference · Konrad Glas</div>

# std::future Is Not the Future

---

# The perfectly correct feature

```cpp
void loadPreset(App& app, Sampler& sampler, Preset preset) {
    app.setLoading(true);
    ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();

    auto tree = prepareSamplerTree(std::move(preset),
                                   std::move(mixer));

    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();

    app.notifyPresetLoaded();
}
```

<div v-click class="takeaway">Correct. Sequential. Exception-safe. And running entirely on main.</div>

---

# The hidden contract

```cpp {all|1|2}
sampler.installSamplerTree(tree);
sampler.rebuildKeySwitchMap();
```

<div v-click class="thought-actual">
  <div>
    <h3>The signature says</h3>
    <p>Rebuild the key-switch map.</p>
  </div>
  <div>
    <h3>The implementation means</h3>
    <p>Read the tree already installed in <code>sampler</code>, then derive the map from it.</p>
  </div>
</div>

<div v-click class="takeaway">The dependency is real—even though the type system cannot see it.</div>

---

# QA, round one

<div class="chat-stack">
  <ChatMessage v-click from="QA">Loading a preset freezes the application.</ChatMessage>
  <ChatMessage v-click from="Developer">Only while it is loading.</ChatMessage>
  <ChatMessage v-click from="QA">Yes. That is what “freezes” means.</ChatMessage>
</div>

---

# Easy: move the slow line away

```cpp {all|1-7|9-10}
workers.run(
    [preset, mixer] {
        return prepareSamplerTree(preset, mixer);
    },
    [&](PreparedSamplerTree tree) {
        sampler.installSamplerTree(tree);
    });

sampler.rebuildKeySwitchMap();
app.notifyPresetLoaded();
```

<div v-click class="thought-actual">
  <div><h3>What I think</h3><p>Same sequence, less blocking.</p></div>
  <div><h3>What actually happens</h3><p><code>workers.run()</code> starts work and returns.</p></div>
</div>

---

# The dependency vanished

<div class="thread-trace">
  <div class="thread-name">MAIN</div>
  <div class="thread-action">start worker</div>

  <div v-click class="thread-name">MAIN</div>
  <div v-click class="thread-action">rebuild map from the old tree → “loaded”</div>

  <div v-click class="thread-name">WORKER</div>
  <div v-click class="thread-action">prepare the new sampler tree</div>

  <div v-click class="thread-name">MAIN</div>
  <div v-click class="thread-action">install the new tree—too late</div>
</div>

<div v-click class="takeaway">No data race required. This ordering bug is deterministic.</div>

---

# QA, round two

<div class="chat-stack">
  <ChatMessage v-click from="QA">
    The mixer says Concert Grand.<br>
    The sampler says Concert Grand.<br>
    The key switches still belong to the previous preset.
  </ChatMessage>
  <ChatMessage v-click from="Developer">That is impossible.</ChatMessage>
  <ChatMessage v-click from="QA">It happens every time.</ChatMessage>
</div>

---

# Fine. Restore the order—and main-thread affinity.

```cpp {all|1-4|5-11}
workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);

    mainQueue.post([&, tree = std::move(tree)] {
        sampler.installSamplerTree(tree);
        sampler.rebuildKeySwitchMap();
        app.notifyPresetLoaded();
        app.setLoading(false);
        finished = true;
    });
});
```

<div v-click class="takeaway">The happy path works. Ship it.</div>

---

# QA asks for one nice thing

<div class="chat-stack">
  <ChatMessage v-click from="QA">When samples are missing, could we let the user locate them?</ChatMessage>
  <ChatMessage v-click from="Developer">No. That would make this much too complicated.</ChatMessage>
</div>

<div v-click class="thought-actual">
  <div><h3>Wait for</h3><p>An asynchronous file dialog</p></div>
  <div><h3>Then do</h3><p>Sample loading away from main</p></div>
</div>

---

# Then I try anyway

```cpp {all|1-3|5-9|11-16}
prepareSamplerTreeAsync(..., [&](auto tree) {
    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();

    askUserToLocateSamples(..., [&](auto location) {
        if (!location)
            return;

        loadSamplesAsync(*location, [&](auto samples) {
            sampler.installSamples(samples);
            app.notifyPresetLoaded();
            app.setLoading(false);
            finished = true;
        });
    });
});
```

<div v-click class="takeaway">The product workflow is now three nested completion scopes.</div>

---

# QA, round three

<div class="chat-stack">
  <ChatMessage v-click from="QA">Cancel the dialog. The spinner stays forever.</ChatMessage>
</div>

<div v-click>

```cpp
if (!location)
    return; // exits this callback—not the preset load
```

</div>

<div v-click class="thought-actual">
  <div><h3>What I think</h3><p>Cancel is not an error. Do nothing.</p></div>
  <div><h3>What QA gets</h3><p>A half-published sampler and an operation that never completes.</p></div>
</div>

---

# Production-ready callbacks

```text
loadPreset()
  └─ completeSampler(request, token, result)
       └─ completeLocation(request, token, result)
            └─ completeSamples(request, result)
```

<div class="compact-list">

- <span v-click>request identity and stale-result rejection</span>
- <span v-click>stop-token propagation</span>
- <span v-click>weak lifetime</span>
- <span v-click>value / cancellation / exception translation</span>
- <span v-click>one shared completion convention</span>

</div>

<div v-click class="takeaway">It works. It is also hard to audit.</div>

---

# We rebuilt a state machine by hand

```text
prepare tree
install tree
rebuild derived state
ask user
load samples
install samples
notify
```

<div v-click class="takeaway">The scheduling implementation now dominates the product requirement.</div>

---

# The same workflow as a coroutine

```cpp {all|1-7|9-13|15-17}
MainActorTask loadPreset(App& app, Sampler& sampler,
                         Preset preset, Scheduler worker) {
    app.setLoading(true);
    ScopeExit stopLoading([&] { app.setLoading(false); });

    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();

    auto tree = co_await prepareSamplerTree(preset, mixer, worker);
    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();

    auto location = co_await askUserToLocateSamples(
        sampler.missingSamples(), worker);
    auto samples = co_await loadSamples(location, worker);
    sampler.installSamples(std::move(samples));
    app.notifyPresetLoaded();
}
```

---

# What actually runs where

<div class="thread-trace">
  <div v-click class="thread-name">MAIN</div>
  <div v-click class="thread-action">capture application state</div>

  <div v-click class="thread-name">WORKER</div>
  <div v-click class="thread-action">prepare sampler tree</div>

  <div v-click class="thread-name">MAIN</div>
  <div v-click class="thread-action">install tree + rebuild key switches</div>

  <div v-click class="thread-name">USER</div>
  <div v-click class="thread-action">choose missing-sample location</div>

  <div v-click class="thread-name">WORKER</div>
  <div v-click class="thread-action">load samples</div>

  <div v-click class="thread-name">MAIN</div>
  <div v-click class="thread-action">install samples + notify + clear spinner</div>
</div>

---

# The first and final versions tell the same story

<div class="code-compare">
<div>

```cpp
auto tree = prepareSamplerTree(
    preset, mixer);

sampler.installSamplerTree(tree);
sampler.rebuildKeySwitchMap();
```

</div>
<div v-click>

```cpp
auto tree = co_await prepareSamplerTree(
    preset, mixer, worker);

sampler.installSamplerTree(tree);
sampler.rebuildKeySwitchMap();
```

</div>
</div>

<div v-click class="takeaway">The function can suspend without surrendering its structure.</div>
