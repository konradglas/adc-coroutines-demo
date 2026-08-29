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
void loadPreset(...) {
    app.setLoading(true);
    ScopeExit finish([&] {
        app.notifyPresetLoaded();
        app.setLoading(false);
        finished = true;
    });

    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();

    auto tree = prepareSamplerTree(std::move(preset),
                                   std::move(mixer));

    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();
}
```

<div v-click class="takeaway">Correct. Sequential. Scope-bound. And running entirely on main.</div>

---

# QA, round one

<div class="chat-stack">
  <ChatMessage v-click from="Developer">Done. Can you give it a quick test?</ChatMessage>
  <ChatMessage v-click from="QA">Loading a preset freezes the application.</ChatMessage>
  <ChatMessage v-click from="Developer">Do you want a working slow application or a broken fast one??</ChatMessage>
  <ChatMessage v-click from="QA">I would like to have both...</ChatMessage>
</div>

---

# Easy: move the slow line away

```cpp {none|1-4|6-7}
workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);
    sampler.installSamplerTree(tree);
});

sampler.rebuildKeySwitchMap();
app.notifyPresetLoaded();
```

<div v-click class="takeaway">Same sequence, less blocking. Ship it.</div>

---

# QA, round two

<div class="chat-stack compact-chat">
  <ChatMessage v-click from="Developer">Fixed. Try it now.</ChatMessage>
  <ChatMessage v-click from="QA">
    This is weird ...<br>
  </ChatMessage>
  <ChatMessage v-click from="QA">
    Sometimes it looks fine.<br>
    Sometimes some part of the old preset is still in there.<br>
    And sometimes it plainly crashes.
  </ChatMessage>
  <ChatMessage v-click from="Developer">Those cannot all be the same bug.</ChatMessage>
  <ChatMessage v-click from="QA">They are all the same button.</ChatMessage>
</div>

---

# What QA found

```cpp {none|1|2}
sampler.installSamplerTree(tree);
sampler.rebuildKeySwitchMap();
```

<div v-click class="thought-actual">
  <div>
    <h3>What I assumed</h3>
    <p><code>rebuildKeySwitchMap()</code> rebuilds whatever it needs.</p>
  </div>
  <div>
    <h3>What QA uncovered</h3>
    <p>It reads the tree already installed in <code>sampler</code>.</p>
  </div>
</div>

<div v-click class="takeaway">I encoded the dependency in statement order—and then casually split the statements apart.</div>

---

# The dependency vanished

<div class="race-pair">
<div>

```cpp {none|none|1-4|6-7|3,6-7}
workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);
    sampler.installSamplerTree(tree);
});

sampler.rebuildKeySwitchMap();
app.notifyPresetLoaded();
```

</div>
<div class="race-story">
  <div v-if="$clicks === 1" class="race-step race-assumption">
    <h3>What I think</h3>
    <p>Same sequence, less blocking.</p>
  </div>

  <div v-if="$clicks >= 2" class="race-step race-thread">
    <h3>Worker</h3>
    <p>Installs the new tree whenever it finishes.</p>
  </div>

  <span v-if="$clicks >= 3" class="race-car-icon" aria-hidden="true">🏎️</span>

  <div v-if="$clicks >= 3" class="race-step race-thread">
    <h3>Main</h3>
    <p>Immediately rebuilds the map and announces “loaded.”</p>
  </div>

  <div v-if="$clicks >= 4" class="race-step race-result">
    <h3>What actually happens</h3>
    <p>No ordering: stale state if main wins; undefined behavior if they overlap.</p>
  </div>
</div>
</div>

<div v-click="5" class="takeaway">Sometimes worker wins. Sometimes main wins. Sometimes they overlap.</div>

---

# Fine. Restore the order—and main-thread affinity.

```cpp {none|7-9|10-17|none}
ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

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

<div v-if="$clicks >= 3" class="takeaway">Ordering restored. Main-thread affinity restored. Ship it.</div>

---

# QA, round three

<div class="chat-stack">
  <ChatMessage v-click from="Developer">All fixed. Can you test it again?</ChatMessage>
  <ChatMessage v-click from="QA">
    The spinner disappears immediately.<br>
    For a moment, the old sound is still there.<br>
    Then the new preset appears—and the UI refreshes again.
  </ChatMessage>
  <ChatMessage v-click from="Developer">So it is fast now.</ChatMessage>
  <ChatMessage v-click from="QA">The UI is lying now.</ChatMessage>
</div>

---

<h1>{{ $clicks < 5 ? 'The function returned. The operation didn’t.' : 'Fine. Complete it manually.' }}</h1>

<div v-show="$clicks < 5">
<div class="race-pair">
<div>

```cpp {none|7|1-5|all|none}
ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

workers.run(...);
```

</div>
<div class="race-story">
  <div v-if="$clicks >= 1" class="race-step">
    <h3>Main</h3>
    <p><code>workers.run()</code> starts work and returns.</p>
  </div>

  <div v-if="$clicks >= 2" class="race-step">
    <h3>Scope exit</h3>
    <p><code>loadPreset()</code> returns, so completion fires immediately.</p>
  </div>

  <div v-if="$clicks >= 3" class="race-step race-result">
    <h3>Later</h3>
    <p>The posted callback publishes the preset and completes everything again.</p>
  </div>
</div>
</div>

<div v-if="$clicks >= 4" class="takeaway premature-completion">The guard covered the function call—not the asynchronous operation.</div>
</div>

<div v-show="$clicks >= 5">

```cpp
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

<div v-if="$clicks >= 6" class="takeaway premature-completion">The happy path works again. RAII does not.</div>
</div>

<span v-click="5" style="display: none"></span>
<span v-click="6" style="display: none"></span>

---

# QA asks for one nice thing

<div class="chat-stack">
  <ChatMessage v-click from="QA">When samples are missing, could we let the user locate them?</ChatMessage>
</div>

<div v-click class="thought-actual">
  <div><h3>Wait for</h3><p>An asynchronous file dialog</p></div>
  <div><h3>Then do</h3><p>Sample loading away from main</p></div>
</div>

<div class="chat-stack">
  <ChatMessage v-click from="Developer">Good idea. Let’s add it to the feature request list. 👍</ChatMessage>
</div>

---

# Then I try anyway

```cpp {none|1-3|5-9|11-16}
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

# QA, round four

<div class="bug-pair dense-code">
<div>

```cpp {hide|hide|hide|none|3}
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
```

</div>
<div class="bug-report">
  <div v-click="4" class="bug-link" aria-hidden="true">
    <span class="bug-arrow">←</span>
    <span class="bug-icon">🐛</span>
  </div>
  <div class="chat-stack" style="margin: 0">
    <ChatMessage v-click="1" from="Developer">Fine. Test the missing-sample dialog.</ChatMessage>
    <ChatMessage v-click="2" from="QA">Cancel it. The spinner stays forever.</ChatMessage>
  </div>
</div>
</div>

<div v-click="5" class="thought-actual">
  <div><h3>What I think</h3><p><code>return</code> means “cancel the operation.”</p></div>
  <div><h3>What actually happens</h3><p>It exits one callback. <code>completion(false)</code> is never called.</p></div>
</div>

---

# QA, one last time

<div class="bug-pair dense-code">
<div>

```cpp {hide|hide|hide|none|10-11}
void loadMissingSamplesAsync(
    Location location,
    std::function<void(bool)> completion)
{
    workers.run(
        [location] {
            return tryLoadSampleContent(location);
        },
        [&, completion = std::move(completion)](auto content) {
            if (!content)
                return;

            sampler.installSamples(*content);
            completion(true);
        });
}
```

</div>
<div class="bug-report deep-callback-bug">
  <div v-click="4" class="bug-link" aria-hidden="true">
    <span class="bug-arrow">←</span>
    <span class="bug-icon">🐛</span>
  </div>
  <div class="chat-stack" style="margin: 0">
    <ChatMessage v-click="1" from="Developer">That’s it?? Fine. Test it one last time. Then ship it.</ChatMessage>
    <ChatMessage v-click="2" from="QA">The file is there. But when its sample content is missing, the spinner stays forever.</ChatMessage>
  </div>
</div>
</div>

<div v-click="5" class="takeaway premature-completion">We replaced structured programming with a rule every <code>return</code> must remember.</div>

---

# Okay. Deep breath.

```text
prepare tree
install tree
rebuild derived state
ask user
load samples
install samples
notify
```

<div v-click class="takeaway">We rebuilt a state machine by hand. Maybe the code could look sequential again.</div>

---

# The same workflow as a coroutine

<div class="code-compare dense-code coroutine-compare">
<div>

<div class="eyebrow">Previous synchronous version</div>

```cpp
void loadPreset(App& app, Sampler& sampler,
                Preset preset, bool& finished) {
    app.setLoading(true);
    ScopeExit finish([&] {
        app.notifyPresetLoaded();
        app.setLoading(false);
        finished = true;
    });
    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();
    auto tree = prepareSamplerTree(preset, mixer);
    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();






}
```

</div>
<div v-click="1">

<div class="eyebrow">Coroutine</div>

```cpp {none|none|13-18}
MainActorTask loadPreset(...) {
    app.setLoading(true);
    ScopeExit finish([&] {
        app.notifyPresetLoaded();
        app.setLoading(false);
        finished = true;
    });
    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();
    auto tree = co_await prepareSamplerTree(preset, mixer);
    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();
    auto location = co_await askUserToLocateSamples(
        sampler.missingSamples());
    if (!location)
        co_return;
    auto samples = co_await loadSamples(*location);
    sampler.installSamples(std::move(samples));
}
```

</div>
</div>

---

# What coroutines give back

<div class="code-compare dense-code">
<div>

```cpp
ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

auto tree = prepareSamplerTree(
    preset, mixer);

sampler.installSamplerTree(tree);
sampler.rebuildKeySwitchMap();
```

</div>
<div v-click>

```cpp
ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

auto tree = co_await prepareSamplerTree(
    preset, mixer);

sampler.installSamplerTree(tree);
sampler.rebuildKeySwitchMap();
```

</div>
</div>

<div v-click class="payoff-grid">
  <div><h3>Sequential order</h3><p>The source reads in the order the work happens.</p></div>
  <div><h3>Visible dependencies</h3><p><code>tree</code>, <code>location</code>, and <code>samples</code> remain ordinary local values.</p></div>
  <div><h3>RAII</h3><p><code>ScopeExit</code> lives across suspension and runs when the operation exits.</p></div>
</div>

<div v-click class="takeaway">The function can suspend without surrendering its structure.</div>
