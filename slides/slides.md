---
theme: default
title: std::future Is Not the Future
author: Konrad Glas
colorSchema: dark
transition: none
lineNumbers: false
mdc: true
background: /title-card.png
---

---

# Let's load some data!

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

    auto tree = prepareSamplerTree(preset, mixer);

    sampler.installSamplerTree(tree);
    keySwitches.load(preset);
}
```

<div v-click class="takeaway">Correct. Sequential. Scope-bound. And running entirely on main. 👍</div>


<!--

Normal loading flow.

Loading flag set

Sampler Loads data

Code in there since ages

[click] all correct… all on main
-->

---

# QA, round one

<div class="chat-stack">
  <ChatMessage v-click from="Developer">Quick test?</ChatMessage>
  <ChatMessage v-click from="QA">Loading gives me the spinning wheel of death for about 2 seconds!</ChatMessage>
  <ChatMessage v-click from="Developer">Hm OK ...  Don't worry ...</ChatMessage>
  <ChatMessage v-click from="Developer">I know about THREADS!</ChatMessage>
</div>


<!--
proud, breezy

[click] "quick test?"

[click] QA: works · 2 s spinner

[click] With larger presets this is starting to hang the main thread!

[click] THREADS! — beat
-->

---

# Easy: move the slow line away

```cpp {none|1-4|6-7}
workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);
    sampler.installSamplerTree(tree);
});

keySwitches.load(preset);
app.notifyPresetLoaded();
```

<div v-click class="takeaway">Same sequence, less blocking. Ship it.</div>


<!--
slow line → worker

[click] off main

[click] rest on main

[click] ship it
-->

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
  <ChatMessage v-click from="Developer">LIES!</ChatMessage>
</div>


<!--
[click] "try it now"

[click] weird…

[click] let it land

[click] LIES!
-->

---

# The dependency vanished

<div class="race-pair">
<div>

```cpp {none|13|10,13|8-11|13,3|13,10}

ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);
    sampler.installSamplerTree(tree);
});

keySwitches.load(preset);
```

</div>
<div class="race-story">
  <div v-if="$clicks >= 1 && $clicks <= 2" class="race-step race-assumption">
    <h3>What I assumed</h3>
    <p>needs only the preset</p>
  </div>

  <div v-if="$clicks === 2" class="race-step race-result">
    <h3>What QA uncovered</h3>
    <p>reads the sampler's tree</p>
  </div>

  <div v-if="$clicks >= 3" class="race-step race-thread">
    <h3>Worker</h3>
    <p>installs… whenever</p>
  </div>

<span v-if="$clicks >= 4" class="race-car-icon" aria-hidden="true">🏎️</span>

  <div v-if="$clicks >= 4" class="race-step race-thread">
    <h3>Main</h3>
    <p>loads key switches at once</p>
  </div>

  <div v-if="$clicks >= 5" class="race-step race-result">
    <h3>What actually happens</h3>
    <p>stale state, or UB</p>
  </div>
</div>
</div>


<!--
[click] load…

[click] only the preset? · sampler inside

[click] worker: whenever

[click] main: at once 🏎️

[click] stale or UB
→ order was the dependency
-->

---

# Restore the order. Dispatch to main

```cpp {none|7-9|10-13|none}
ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);

    mainQueue.post([&, tree = std::move(tree)] {
        sampler.installSamplerTree(tree);
        keySwitches.load(preset);
    });
});
```

<div v-if="$clicks >= 3" class="takeaway">Ordering restored. Main-thread affinity restored. Ship it 🚢</div>


<!--
[click] post to main

[click] in order, on main

[click] ship 🚢
-->

---

# QA, round three

<div class="chat-stack">
  <ChatMessage v-click from="Developer">All fixed. Can you test it again?</ChatMessage>
  <ChatMessage v-click from="QA">
    The spinner disappears immediately.<br>
    But the UI doesn't refresh with the new state!<br>
  </ChatMessage>
  <ChatMessage v-click from="Developer">So it is fast now!</ChatMessage>
</div>


<!--
[click] "all fixed"

[click] spinner gone, UI stale

[click] fast now!
-->

---

<h1>{{ $clicks < 5 ? "Oops!" : 'Fine. Complete it manually.' }}</h1>

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
    <p><code>workers.run()</code> → returns</p>
  </div>

  <div v-if="$clicks >= 2" class="race-step">
    <h3>Scope exit</h3>
    <p>completion fires</p>
  </div>
</div>
</div>

<div v-if="$clicks >= 4" class="takeaway premature-completion">RAII is so nice! But cannot use it here :(</div>
</div>

<div v-show="$clicks >= 5">

```cpp
workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);

    mainQueue.post([&, tree = std::move(tree)] {
        sampler.installSamplerTree(tree);
        keySwitches.load(preset);
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


<!--
ScopeExit still armed

[click] run() returns

[click] done too early

[click] silent install

[click] RAII… :(

[click] complete by hand

[click] exceptions: nobody cleans
-->

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


<!--
[click] locate samples?

[click] dialog, then load

[click] feature list 👍
-->

---

# Then I try anyway

```cpp {none|1,4-6|8-11|12-17}
app.setLoading(true);
...

prepareSamplerTreeAsync(..., [&](auto tree) {
    sampler.installSamplerTree(tree);
    keySwitches.load(preset);

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



<!--
tries anyway

[click] tree

[click] dialog (not the return)

[click] samples · complete
→ three nested scopes
-->

---

# QA, one last time

<div class="bug-pair dense-code">
<div>

```cpp {hide|hide|hide|none|1,9-10}
app.setLoading(true);
...

prepareSamplerTreeAsync(..., [&](auto tree) {
    sampler.installSamplerTree(tree);
    keySwitches.load(preset);

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

</div>
<div class="bug-report deep-callback-bug">
  <div v-click="4" class="bug-link" aria-hidden="true">
    <span class="bug-arrow">←</span>
    <span class="bug-icon">🐛</span>
  </div>
  <div class="chat-stack" style="margin: 0">
    <ChatMessage v-click="1" from="Developer">That’s it?? Fine. Test it one last time. Then ship it.</ChatMessage>
    <ChatMessage v-click="2" from="QA">When I cancel the file dialog, the spinner stays forever.</ChatMessage>
  </div>
</div>
</div>



<!--
[click] one last time — frustrated

[click] cancel → spinner forever

[click] the code

[click] on · never off 🐛
→ every return must remember
-->

---

# Okay. Deep breath.

```text
prepare tree
install tree
load key switches
ask user
load samples
install samples
notify
```

<div v-click class="takeaway">It looks pretty simple! But it's blocking ...</div>


<!--
just the steps

[click] but blocking
-->

---

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
    keySwitches.load(preset);






}
```

</div>
<div v-click="1">

<div class="eyebrow">Coroutine</div>

<div v-if="$clicks < 2">

```cpp
task<void> loadPreset(App& app, Sampler& sampler,
                Preset preset, bool& finished) {
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
    keySwitches.load(preset);






}
```

</div>
<div v-else>

```cpp {14-19}
task<void> loadPreset(App& app, Sampler& sampler,
                Preset preset, bool& finished) {
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
    keySwitches.load(preset);
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
</div>

<span v-click="2" style="display: none"></span>


<!--
sync: correct, blocking

[click] same shape

[click] new feature, still linear
-->

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
keySwitches.load(preset);
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
keySwitches.load(preset);
```

</div>
</div>

<div v-click class="payoff-grid">
  <div><h3>Sequential order</h3></div>
  <div><h3>Visible dependencies</h3></div>
  <div><h3>RAII</h3></div>
</div>



<!--
[click] only co_await

[click] order · locals · RAII
-->

---

# What actually changed?

<div class="code-compare coroutine-syntax">
<div>

<div class="eyebrow">Synchronous function</div>

```cpp
void loadPreset(...) {
    auto tree = prepareSamplerTree(...);
    // ...
    return;
}
```

</div>
<div>

<div class="eyebrow">Coroutine</div>

```cpp {none|1|2|4}
task<void> loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
    // ...
    co_return;
}
```

</div>
</div>

<div class="coroutine-keywords">
  <div v-click="1"><h3><code>task</code></h3><p>how it starts, ends, resumes</p></div>
  <div v-click="2"><h3><code>co_await</code></h3><p>may suspend</p></div>
  <div v-click="3"><h3><code>co_return</code></h3><p>completes</p></div>
</div>



<!--
[click] start, end, resume

[click] may suspend · not blocking

[click] RAII still runs
-->

---

# But how does this work? And how do I use it?

<div class="agenda-questions">
<v-clicks>

- Why are coroutines non-blocking
- What thread am I on after the `co_await`
- How do I get from `void` to `task<void>`
- How do I cancel obsolete work
- How do I safely tear down the whole thing
- Which libraries are out there to get my hands dirty with

</v-clicks>
</div>

---

# Why are coroutines non-blocking?

<p class="muted">Coroutines are functions that can be suspended and resumed.</p>

<div class="dense-code">

```cpp {all|5,8|1-3,5|4-5,7-8|7-10|2,8|all}
task<void> mySuspendingFunction() {
  auto localData =
    createSomeStateSnapshot();
  auto networkData =
    co_await gatherSomeDataFromTheInternet(localData.url);

  auto processedData =
    co_await processData(networkData, localData.settings);
  sendToUI(processedData);
}
```

</div>

<div class="coro-anatomy" :class="{ focusing: $clicks >= 1 && $clicks <= 5 }">
  <div v-click="1" :class="{ active: $clicks === 1 }"><h3>Suspension point</h3><p>every <code>co_await</code></p></div>
  <div v-click="2" :class="{ active: $clicks >= 2 && $clicks <= 4 }"><h3>Chunk of work</h3><p>runs uninterrupted</p></div>
  <div v-click="5" :class="{ active: $clicks === 5 }"><h3>State in the frame</h3><p>locals survive</p></div>
</div>



<!--
suspend + resume

[click] pause points

[click] chunk 1

[click] chunk 2

[click] chunk 3

[click] lives in the frame

[click] 3 chunks, 1 frame
→ who calls resume()?
-->

---
clicks: 3
---

# Waiting by blocking

<CallStacks scenario="blocking" :step="$clicks" />


<!--
both idle

[click] click → loadPreset

[click] stuck in get()

[click] back when done
-->

---
clicks: 7
---

# Resumed by an executor

<CallStacks scenario="coroutine" :step="$clicks" />

<!--
both idle

[click] executor resumes

[click] handle → worker queue

[click] Main free · **PAUSE**

[click] same frame, other stack

[click] posted to Main

[click] Main resumes

[click] nobody waited
-->

---
clicks: 3
---

# Events with callbacks

<CallStacks scenario="callbacks" :step="$clicks" :slots="6" />


<!--
arrive later, any order

[click] license → return

[click] library → enable

[click] spread out
-->

---
clicks: 4
---

# Resumed by an event

<CallStacks scenario="event" :step="$clicks" :slots="6" />


<!--
starts, suspends

[click] Main paints

[click] license → nothing yet

[click] library → resumed inline

[click] top to bottom
-->

---
clicks: 3
---

# Resumed by polling

<CallStacks scenario="polled" :step="$clicks" />


<!--
key click → co_await

[click] waits in queue

[click] next block resumes

[click] real-time safe!
-->

---

# Same top, different bottom

<StackShapes />



<!--
same top
→ different caller
-->

---
clicks: 4
---

# Zoom out: chunks on threads

<ThreadTimeline name="loadPreset" :step="$clicks" />


<!--
blocking: stuck

[click] hop to worker

[click] Main free

[click] 2nd task → audio

[click] nobody waited
-->

---
clicks: 5
---

# Which thread am I on?

<ThreadBadges name="tracking" :step="$clicks" />

<!--
threads: always knew

[click] Main

[click] worker now

[click] back

[click] dialog… ?

[click] I'm the scheduler
→ forget one → cleanup on worker
-->

---
clicks: 1
---

# What if the task knew where it belongs?

<ThreadBadges name="mainActor" :step="$clicks" />

<!--
all those ?…

[click] all Main · enjoy
-->

---
clicks: 4
---

# The line disappeared

<CallStacks scenario="affine" :step="$clicks" />

<!--
how home?

[click] child hops

[click] Main paints

[click] posted home

[click] back, by itself
-->

---

# Two kinds of tasks

<div class="code-compare task-kind-question" :class="{ 'show-task-kinds': $clicks >= 1 }">
<div>

<div class="eyebrow">Background work</div>

```cpp
Task<PreparedSamplerTree> prepareSamplerTree(...) {
    co_await ScheduleOn{workers};
    co_return buildExpensiveSamplerTree(...);
}
```

</div>
<div>

<div class="eyebrow">Plugin workflow</div>

```cpp
MainActorTask<void> loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
    sampler.installSamplerTree(std::move(tree));
}
```

</div>
</div>

<div v-click="1" class="task-kind-answer">
  <code>Task&lt;T&gt;</code>
  <span>versus</span>
  <code>MainActorTask</code>
</div>



<!--
`Task<T>` vs MainActorTask

[click] type says where
-->

---

# Why give the plugin workflow a home?

<div class="code-compare main-actor-motivation">
<div>

```cpp
MainActorTask<void> loadPreset(...) {
    app.setLoading(true);
    app.loadMixerState(preset);

    auto tree = co_await
        prepareSamplerTree(...);

    sampler.installSamplerTree(tree);
    app.notifyPresetLoaded();
}
```

</div>
<div class="motivation-stack">
  <div v-click="1">
    <h3>Where the plugin lives</h3>
    <p>host callbacks · editor · plugin state</p>
  </div>
  <div v-click="2">
    <h3>Only the heavy part leaves</h3>
    <p><code>prepareSamplerTree()</code> → worker</p>
  </div>
</div>
</div>



<!--
why main?

[click] plugin lives there

[click] only heavy part leaves
-->

---

# The cozy part: main-owned state is serialized

<div class="code-compare actor-safety">
<div class="actor-region-code" :class="{
  'show-first-region': $clicks === 1,
  'show-suspension-boundary': $clicks === 2,
  'show-second-region': $clicks >= 3,
}">

```cpp
MainActorTask<void> loadPreset(...) {
    app.setLoading(true);
    auto mixer = app.mixerSnapshot();

    auto tree = co_await prepareSamplerTree(...);

    sampler.installSamplerTree(tree);
    keySwitches.load(preset);
    app.setLoading(false);
}
```

</div>
<div class="actor-safety-notes">
  <div v-click="1" class="safe-region-note"><strong>Nothing interleaves</strong></div>
  <div v-click="2" class="suspension-note"><strong><code>co_await</code>: others may run</strong></div>
  <div v-click="3" class="safe-region-note"><strong>No locks needed</strong></div>
</div>
</div>



<!--
one home thread

[click] uninterrupted

[click] only at co_await

[click] no locks
-->

---

# Yes! This is actually nice.

<div class="structured-celebration-code">

```cpp
MainActorTask<void> loadPreset(...) {
    ScopeExit finish([&] { app.setLoading(false); });

    auto tree = co_await prepareSamplerTree(...);
    sampler.installSamplerTree(tree);

    auto location = co_await askUserToLocateSamples(...);
    if (!location)
        co_return;

    sampler.installSamples(co_await loadSamples(*location));
}
```

</div>

<div v-click="1" class="structured-win-grid">
  <div><strong>Sequential</strong></div>
  <div><strong>RAII</strong></div>
  <div><strong>Main-affine</strong></div>
  <div><strong>Structured</strong></div>
</div>


<!--
top to bottom

[click] enjoy
→ structured = contained · no child escapes its parent
→ "But… hmmm."
-->

---

# The plugin boundary

<div class="code-compare root-task-problem">
<div>

<div class="eyebrow">Inside the coroutine tree</div>

```cpp
MainActorTask<void> loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
    auto samples = co_await loadSamples(...);
    // beautifully owned by the parent task
}
```

</div>
<div class="root-call-code" :class="{ 'show-orphan-call': $clicks >= 1 }">

<div class="eyebrow">At the plugin boundary</div>

```cpp
void onLoadPreset(Preset preset) {
    loadPreset(preset);
}
```

<div v-click="1" class="orphan-caption">lazy task, thrown away</div>

</div>
</div>

<div class="root-questions">
  <div v-click="2"><strong>No parent</strong></div>
  <div v-click="3"><strong>No owner</strong></div>
  <div v-click="4"><strong>Never even starts</strong></div>
</div>

<!--
"Okay. One tiny question…"

[click] lazy task, dropped

[click] nobody awaits

[click] nobody owns

[click] never starts
-->

---

# One root coroutine

```cpp {none|11|14|7|8|12}
class Plugin {
    affine::root_scope root;
    Channel<Preset> presetRequests;

    MainActorTask<void> run() {
        for (;;) {
            auto preset = co_await presetRequests.receive();
            co_await loadPreset(preset);
        }
    }
    Plugin()  { affine::spawn(run(), root); }
    ~Plugin() { root.close_and_wait(); }

    void onLoadPreset(Preset preset) { presetRequests.send(preset); }
};
```

<!--
cross the boundary once

[click] one spawn · like main()

[click] callback: just report

[click] wait for preset

[click] queue: B after A

[click] one join
→ latest wins → close()
-->

---

# Or: one task per request

<div v-show="$clicks < 4">

```cpp {none|2|6-7|10}
class Plugin {
    affine::root_scope root;
    affine::task_handle loading;

    void onLoadPreset(Preset preset) {
        loading = affine::spawn(
            loadPreset(preset), root);
    }

    ~Plugin() { root.close_and_wait(); }
};
```

</div>
<div v-show="$clicks >= 4">

```cpp {6}
class Plugin {
    affine::root_scope root;
    affine::task_handle loading;

    void onLoadPreset(Preset preset) {
        loading.close();
        loading = affine::spawn(
            loadPreset(preset), root);
    }

    ~Plugin() { root.close_and_wait(); }
};
```

</div>

<div v-click="3" class="scope-ownership-note">
  <code>onLoadPreset</code> returns at once · <code>~Plugin()</code> waits for it
</div>

<span v-click="4" style="display: none"></span>

<!--
same callback · give the task a home

[click] one scope

[click] spawn = start + own

[click] not detached · jthread

[click] click again? → close
-->

---

# Cancellation

<div class="code-compare cooperative-cancellation">
<div class="cooperative-code" :class="{
  'show-stop-token': $clicks === 1,
  'show-cancellable-wait': $clicks === 2,
  'show-stop-check': $clicks === 3,
  'show-publication': $clicks >= 4,
}">

```cpp
MainActorTask<void> loadPreset(...) {
    auto stop = co_await stdexec::read_env(stdexec::get_stop_token);

    auto samples = co_await loadSamples(...);

    if (stop.stop_requested())
        co_return;

    sampler.installSamples(std::move(samples));
}
```

</div>
<div class="cooperation-notes">
  <div v-click="1"><strong>Observe</strong></div>
  <div v-click="2"><strong>Cooperate early</strong></div>
  <div v-click="3"><strong>Check after the last wait</strong></div>
  <div v-click="4"><strong>Publish safely</strong></div>
</div>
</div>

<!--
close() = request

[click] stop token

[click] waits end early

[click] check after last wait

[click] check + publish, no gap
→ all on Main → no locks
-->

---

# Cancellation

<div class="cancellation-exit-code">

```cpp {all|9|10|2-4|13|13}
MainActorTask<void> loadPreset(...) {
    ScopeExit finish([&] {
        app.setLoading(false);
    });

    auto stop = co_await stdexec::read_env(stdexec::get_stop_token);
    auto samples = co_await loadSamples(...);

    if (stop.stop_requested())
        co_return;

    sampler.installSamples(std::move(samples));
}
```

</div>

<div class="cancellation-exit-flow">
  <span v-click="1">stop observed</span>
  <b v-click="2">→</b>
  <span v-click="2"><code>co_return</code></span>
  <b v-click="3">→</b>
  <span v-click="3">locals + RAII cleanup</span>
  <b v-click="4">→</b>
  <span v-click="4"><code>final_suspend()</code></span>
  <b v-click="5">→</b>
  <span v-click="5">scope releases completed frame</span>
</div>

<!--
same task, RAII

[click] stop seen

[click] co_return

[click] ScopeExit → spinner off

[click] parent told

[click] then frame freed
-->

---

# Teardown

<div class="code-compare scope-close-compare">
<div v-click="1" class="scope-close-card child-close-card">

<div class="eyebrow">Stop one operation during normal use</div>

```cpp
loading.close();
```

<div v-click="2" class="close-effects">
  <span>request stop for this task</span>
  <span>return immediately</span>
  <span>leave the executor open</span>
</div>

</div>
<div v-click="3" class="scope-close-card root-close-card">

<div class="eyebrow">The plugin is going away</div>

```cpp
root.close_and_wait();
```

<div v-click="4" class="close-effects">
  <span>request stop for everything</span>
  <span>wait until all have unwound</span>
  <span>then destroy frames</span>
  <span>runs the remaining tasks on Main</span>
</div>

</div>
</div>

<div v-click="5" class="scope-boundary-summary">
  <span>many asynchronous tasks</span>
  <b>→</b>
  <strong>one synchronous lifetime boundary</strong>
</div>

<!--
two ways to stop

[click] close one

[click] request, return

[click] plugin goes away

[click] stop all, wait, free
→ they resume on Main → join drives them · no UI events
→ plain blocking wait = deadlock
→ needed my own bit
→ forget join → terminate
→ every wait must end
→ like the last callback bug

[click] one sync point
-->


---
clicks: 4
---

# Inside <code>close_and_wait()</code>

<CallStacks scenario="teardown" :step="$clicks" :slots="8" code-size="0.64rem" />

<!--
host kills plugin · load still on worker

[click] stop · then wait right here, in the dtor

[click] child ignores stop · posts home

[click] join drives it · spinner off · ON TOP of ~Plugin() · **PAUSE**

[click] joined · frames gone · back to host
-->
---

# Before <code>stdexec</code>

<div class="framework-pair">
  <div v-click="1" class="framework-card">
    <div class="framework-name">Boost.Cobalt</div>
    <strong>coroutines on top of Boost.Asio</strong>
    <span>races · scopes · implicit cancellation</span>
    <div v-click="2" class="framework-hesitation framework-tradeoff">
      <b>single-threaded by design</b>
      worker ↔ main hops: not its shape
    </div>
  </div>
  <div v-click="3" class="framework-card">
    <div class="framework-name">jbaldwin/libcoro</div>
    <strong>small toolbox</strong>
    <span>tasks · thread pools · awaitables</span>
    <div v-click="4" class="framework-hesitation framework-tradeoff">
      <b>my first favourite</b>
      small enough to read
    </div>
  </div>
</div>

<!--
shipped both · liked both

[click] Cobalt: Asio + nice coroutines · in production

[click] one thread · hopping not its thing

[click] libcoro: threads + pools · in production

[click] read it in an afternoon
→ neither knew the host thread → my bit
→ Folly? too big, Windows build (only if asked)
-->
---

# Why I ended up with <code>stdexec</code>

<div class="stdexec-choice-layout stdexec-stack-only">
<div class="stdexec-stack">
  <div v-click="1" class="standards-winner"><strong>It won.</strong><span><a href="https://wg21.link/P2300">P2300</a> sender/receiver became C++26 <code>std::execution</code>.</span></div>
  <div v-click="4" class="stdexec-layer coroutine-layer"><strong><code>stdexec::task</code></strong><span>sticky resumption · stop tokens</span></div>
  <div v-click="3" class="stdexec-layer affine-layer"><strong>Plug-in layer</strong><span>main-loop scheduler · scope handles</span></div>
  <div v-click="2" class="stdexec-layer sender-layer"><strong>stdexec</strong><span>Reference implementation · senders · schedulers · stop environments</span></div>
</div>
</div>

<div v-click="5" class="stdexec-operation-flow">
  <span>senders implement individual operations</span>
  <b>→</b>
  <span>coroutines express the workflow</span>
</div>

<!--
so: build on what C++26 chose

[click] C++26

[click] senders, schedulers

[click] ours: loop + scopes

[click] task: free affinity

[click] direction
-->


---

# Questions?

<div class="code-compare">
<div>

```cpp
MainActorTask<void> loadPreset(Preset preset) {
    app.setLoading(true);
    ScopeExit finish([&] { app.setLoading(false); });

    auto tree = co_await prepareSamplerTree(preset);
    sampler.installSamplerTree(tree);

    auto location = co_await askUserToLocateSamples();
    if (!location)
        co_return;

    sampler.installSamples(co_await loadSamples(*location));
}
```

</div>
<div>

- [github.com/konradglas/adc-coroutines-demo](https://github.com/konradglas/adc-coroutines-demo)
- [github.com/konradglas/stdexec-affine](https://github.com/konradglas/stdexec-affine)
- [github.com/NVIDIA/stdexec](https://github.com/NVIDIA/stdexec)

</div>
</div>

<!--
back to the start

thanks
-->

---

# Backup

<!--
backup: how coroutines work under the hood (promise_type, awaitables, continuations)
-->

---

# It’s just <code>stdexec::task</code>

```cpp
struct MainEnv {
    using start_scheduler_type = MainThreadLoop::Scheduler;
};

template <class T>
using MainActorTask = stdexec::task<T, MainEnv>;
```

<div v-click>

```cpp
stdexec::sync_wait(loadPreset(preset));
```

<p class="muted">✗ does not compile</p>

</div>

<div v-click>

```cpp
co_await stdexec::schedule(workers);
```

<p class="muted">→ straight back on Main</p>

</div>

<!--
three lines

[click] won't compile

[click] every co_await comes home
-->

---

# Where did all that machinery come from?

<div class="runtime-origin-layout">
<div class="runtime-origin-code">

<div class="eyebrow">The API we just used</div>

```cpp
MainActorTask<void> loadPreset(...);

auto loading = affine::spawn(
    loadPreset(...), root);

loading.close();
root.close_and_wait();
```

</div>
<div class="runtime-origin-answer">
  <div v-click="1" class="not-from-standard">None of this came with C++20.</div>
  <div class="runtime-origin-split">
    <div v-click="2">
      <strong>C++20 gave us</strong>
      <span><code>co_await</code>, coroutine frames and the compiler’s suspend/resume protocol.</span>
    </div>
    <div v-click="3" class="runtime-still-needed">
      <strong>We still needed</strong>
      <span>Tasks, schedulers, ownership, cancellation propagation and message-thread integration.</span>
    </div>
  </div>
</div>
</div>

<div v-click="4" class="takeaway">That API is the result of choosing a foundation - and filling its plug-in-specific gaps.</div>


---

# The larger ecosystems

<div class="framework-pair">
  <div v-click="1" class="framework-card">
    <div class="framework-name">Folly</div>
    <strong>Mature production ecosystem</strong>
    <span>Tasks, executors, cancellation, scopes and a huge collection of async primitives.</span>
    <div v-click="2" class="framework-hesitation framework-tradeoff">
      <b>Why I moved on</b>
      A much larger dependency than I wanted for a plug-in, and I could not get my Windows build into a state I was happy with.
    </div>
  </div>
  <div v-click="3" class="framework-card production-framework">
    <div class="framework-name">Boost.Cobalt</div>
    <strong>A pleasant coroutine-first API</strong>
    <span>Tasks, structured composition, races, scopes and implicit cancellation. I have shipped this in production.</span>
    <div v-click="4" class="framework-hesitation framework-tradeoff">
      <b>The shape</b>
      Cobalt is deliberately single-threaded. That makes its concurrency model wonderfully simple, but worker ↔ main executor hopping is not what it is built around.
    </div>
  </div>
</div>

<div v-click="5" class="takeaway">Cobalt has served me well in production. Folly was simply the one I could not make fit this plug-in environment.</div>


---

# The focused options

<div class="framework-pair">
  <div v-click="1" class="framework-card">
    <div class="framework-name">jbaldwin/libcoro</div>
    <strong>The nicest toolbox</strong>
    <span>Small enough to understand, with tasks, schedulers, thread pools and useful awaitables. Initially my favourite - and used in production.</span>
    <div v-click="2" class="framework-hesitation framework-tradeoff">
      <b>What remains ours</b>
      It gives flexible primitives; I still decide how task trees are owned and synchronously torn down with the plug-in.
    </div>
  </div>
  <div v-click="3" class="framework-card selected-framework">
    <div class="framework-name">stdexec</div>
    <strong>The committee chose this model</strong>
    <span>P2300 sender/receiver became C++26 <code>std::execution</code>; stdexec is its reference implementation.</span>
    <div v-click="4" class="framework-hesitation framework-tradeoff">
      <b>The price</b>
      Sender/receiver is harder to learn and considerably more template-heavy.
    </div>
  </div>
</div>

<div v-click="5" class="framework-shared-gap">
  <strong>Shared plug-in gap:</strong> none of these libraries knows about the host-owned message thread. Every option needs a plug-in-specific integration layer.
</div>

<!--
the smaller libraries

[click] libcoro: a toolbox I liked · used it in production

[click] ownership and shutdown with the plug-in stay my job

[click] stdexec: what C++26 chose

[click] the price: harder to learn, lots of templates

[click] same gap everywhere: the host's message thread → the teardown bit from before
-->


---

# The way home can’t fail

<div class="code-compare">
<div>

<div class="eyebrow">MainThreadLoop before</div>

```cpp
using completion_signatures =
    stdexec::completion_signatures<
        stdexec::set_value_t(),
        stdexec::set_stopped_t()>;
```

</div>
<div v-click>

<div class="eyebrow">MainThreadLoop now</div>

```cpp
using completion_signatures =
    stdexec::completion_signatures<
        stdexec::set_value_t()>;
```

</div>
</div>

<!--
schedule() = "get me onto this thread" · before: the hop itself could end in stopped

[click] infallible: the hop home always arrives

→ otherwise: work finished, result exists, coroutine silently never continues

→ cancellation still works — the awaited work can stop, only the way home can't

→ "loop never drains" is a lifetime problem → finish() / scope join
-->


---

# Scopes on stdexec

<div class="dense-code">

| In this talk | On stdexec |
|---|---|
| `affine::create_root_scope()` | `stdexec::counting_scope root;` |
| `affine::spawn(task, root)` | `spawn(loop, task, root.get_token())` |
| `loading.close()` | `loading->request_stop()` |
| `root.close_and_wait()` | `root.request_stop();` `sync_wait(root.join());` |

</div>

<!--
the names from the scope slides → what they are on stdexec

spawn + handle: ~70 lines of our own on top of counting_scope + associate

tested: stopping the root reaches the task · cleanup still runs on main
-->


---

# Excellent. The abstractions will save us.

<div class="framework-confidence-grid">
  <div v-click="1"><strong>Execution</strong><span>explicit schedulers</span></div>
  <div v-click="1"><strong>Ownership</strong><span>structured task scopes</span></div>
  <div v-click="1"><strong>Affinity</strong><span>sticky main-thread tasks</span></div>
  <div v-click="1"><strong>Cancellation</strong><span>cooperative stop propagation</span></div>
</div>

<div v-click="2" class="framework-confidence-punchline">C++ is still C++.</div>


---

# Footgun #1: one harmless refactor

<div class="capture-refactor-lead">

```cpp
auto myResource = Object{};
```

</div>

<div class="code-compare capture-refactor-compare">
<div class="capture-variant safe-capture-variant">

<div class="eyebrow">Directly awaited</div>

```cpp
co_await [myResource]() -> Task {
    co_await something();
    useResource(myResource);
}();
```

<div v-click="1" class="capture-caption safe-caption">The closure temporary survives until this full expression finishes.</div>

</div>
<div v-click="2" class="capture-variant broken-capture-variant">

<div class="eyebrow">Stored first</div>

```cpp
auto task = [myResource]() -> Task {
    co_await something();
    useResource(myResource);
}();

co_await std::move(task);
```

<div class="capture-caption broken-caption">The first full expression ends before the task is awaited. The closure dies there.</div>

</div>
</div>

<div v-click="3" class="capture-lifetime-flow">
  <span>capture lives in closure</span><b>→</b><span>coroutine frame keeps <code>this</code></span><b>→</b><span class="dead-closure">dangling closure pointer</span>
</div>

<div v-click="4" class="llm-footgun">LLMs ALWAYS get this wrong: “capture by value copied it into the coroutine frame.” Nope. 👋</div>


---

# Put coroutine state in coroutine parameters

<div class="code-compare coroutine-parameter-fix">
<div>

```cpp
auto task = [](Object resource) -> Task {
    co_await something();
    useResource(resource);
}(std::move(myResource));

co_await std::move(task);
```

</div>
<div class="parameter-frame-flow">
  <div v-click="1"><code>myResource</code><span>call argument</span></div>
  <b v-click="2">→</b>
  <div v-click="2" class="frame-owned-parameter"><code>resource</code><span>coroutine parameter copied into frame</span></div>
  <b v-click="3">✓</b>
</div>
</div>

<div v-click="4" class="takeaway">A capture belongs to the callable object. A coroutine parameter belongs to the coroutine frame.</div>


---

# Footgun #2: RAII works a little too well

<div class="code-compare lock-footgun-compare">
<div class="lock-footgun-broken">

<div class="eyebrow">Ordinary scoped lock</div>

```cpp
ScopedLock lock(stateMutex);
auto mixer = app.mixerSnapshot();

auto tree = co_await
    prepareSamplerTree(preset, mixer);

sampler.installSamplerTree(std::move(tree));
```

<div v-click="1" class="lock-held-caption">The coroutine scope survives suspension. So does the lock.</div>

<div v-click="2" class="lock-consequences">
  <span>other work blocks</span>
  <span>suspension can last arbitrarily long</span>
  <span>resumption may happen on another thread</span>
</div>

</div>
<div v-click="3" class="lock-footgun-fixed">

<div class="eyebrow">Snapshot, release, then await</div>

```cpp
MixerSnapshot mixer;
{
    ScopedLock lock(stateMutex);
    mixer = app.mixerSnapshot();
}

auto tree = co_await
    prepareSamplerTree(preset, mixer);

{
    ScopedLock lock(stateMutex);
    sampler.installSamplerTree(std::move(tree));
}
```

</div>
</div>

<div v-click="4" class="takeaway">RAII spans suspension. Never suspend while holding an ordinary blocking or thread-owned lock.</div>


---

# Footgun #3: sometimes the frame itself is broken

<div class="code-compare cobalt-footgun-layout">
<div>

<div class="eyebrow">Our Windows-only Boost.Cobalt patch</div>

```cpp
#ifdef _MSC_VER
#define COBALT_PROMISE_ALIGN alignas(32)
#else
#define COBALT_PROMISE_ALIGN
#endif

template<class Return>
struct COBALT_PROMISE_ALIGN task_promise
    : promise_memory_resource_base,
      /* ... */
{};
```

</div>
<div class="cobalt-bug-story">
  <div v-click="1"><strong>The symptom</strong><span>Release-only access violations on MSVC when returning particular object layouts from <code>cobalt::task&lt;T&gt;</code>.</span></div>
  <div v-click="2"><strong>The workaround</strong><span>Patch Cobalt’s promise type to <code>alignas(32)</code> while Conan generates the Windows build.</span></div>
  <div v-click="3"><strong>The state in August 2026</strong><span><a href="https://github.com/boostorg/cobalt/issues/172">boostorg/cobalt#172</a> is still open; current <code>task_promise</code> remains unannotated.</span></div>
</div>
</div>

<div v-click="4" class="takeaway">Sometimes the lifetime model is fine and the compiler-generated frame still falls through the floor.</div>


---

# Three footguns. Three different layers.

<div class="footgun-summary-grid">
  <div v-click="1"><strong>Outside the frame</strong><span>The lambda capture died with its closure.</span></div>
  <div v-click="2"><strong>Inside the frame too long</strong><span>The lock survived across suspension.</span></div>
  <div v-click="3"><strong>The frame itself</strong><span>MSVC needed stronger promise alignment.</span></div>
</div>

<div v-click="4" class="takeaway">Frameworks remove repeated control-flow plumbing. They do not repeal C++ lifetime rules - or compiler bugs.</div>



---

# <code>close()</code> is a request - not a wrecking ball

<div class="close-request-call">

```cpp
loading.close();
```

</div>

<div class="close-request-flow">
  <div v-click="1"><code>loading</code><span>close this task</span></div>
  <b v-click="2">→</b>
  <div v-click="2" class="stop-request-node"><code>stop requested</code><span>this task</span></div>
  <b v-click="3">→</b>
  <div v-click="3"><code>close()</code> returns<span>caller keeps running</span></div>
</div>

<div v-click="4" class="close-does-not-grid">
  <div><strong>No thread killed</strong></div>
  <div><strong>No frame destroyed</strong></div>
  <div><strong>Not finished yet</strong></div>
</div>

<!--
loading.close() — what actually happens?

[click] the handle closes this task

[click] → stop requested for it · whatever it awaits sees the stop too

[click] → close() returns right away · the caller keeps going

[click] running code isn't interrupted · suspended frames stay alive · the task still has to cooperate
-->


---

# Three types, three jobs

```cpp {none|1|1|2}
stdexec::task loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
}
```

<div class="coroutine-keywords type-overview">
  <div v-click="1"><h3>Return object</h3><p>The <code>stdexec::task</code> object handed to the caller. It represents this coroutine.</p></div>
  <div v-click="2"><h3>Promise type</h3><p><code>stdexec::task::promise_type</code>: compiler-facing state stored inside the coroutine frame.</p></div>
  <div v-click="3"><h3>Awaitable</h3><p><code>prepareSamplerTree(...)</code> returns one. It defines the suspension point: whether execution pauses, what runs next, and what value the coroutine receives when it continues.</p></div>
</div>

<div v-click="4" class="takeaway">The return type defines the coroutine. Each awaitable defines one wait.</div>

---

# Calling a coroutine creates a frame

<div class="coroutine-call">

```cpp
auto task = loadPreset(...);
```

</div>

<div class="coroutine-object-map">
  <div v-click="2" class="return-object">
    <div class="eyebrow">Visible to the caller</div>
    <h3><code>MainActorTask task</code></h3>
    <p>The return object holds a coroutine handle.</p>
  </div>

  <div class="object-links">
    <div v-click="2"><span>←</span><strong>promise creates</strong></div>
    <div v-click="3"><strong>handle points to</strong><span>→</span></div>
  </div>

  <div v-click="1" class="coroutine-frame">
    <div class="eyebrow">Hidden coroutine frame</div>
    <div class="frame-part">parameters and local variables</div>
    <div class="frame-part">current suspension point</div>
    <div class="frame-promise"><code>MainActorTask::promise_type</code><small>start · finish · result · exception policy</small></div>
  </div>
</div>

<div v-click="4" class="takeaway">The task is the public handle. The promise is private machinery inside the frame.</div>

---

# <code>promise_type</code>: the coroutine's control panel

```cpp {none|1|2|3-4|5-6|7|none}
struct MainActorTask::promise_type {
    MainActorTask get_return_object();
    auto initial_suspend();
    auto final_suspend();
    void return_void();
    void unhandled_exception();
    template<class T> auto await_transform(T&&);
};
```

<div class="promise-notes">
  <div v-click="1">The compiler creates it <strong>inside the coroutine frame</strong>.</div>
  <div v-click="2"><code>get_return_object()</code> creates the <code>MainActorTask</code> seen by the caller.</div>
  <div v-click="3" class="promise-hook-roles">
    <div>
      <code>initial_suspend()</code>
      <strong>Startup policy</strong>
      <span>Should the task start eagerly - or wait until someone starts it?</span>
    </div>
    <div>
      <code>final_suspend()</code>
      <strong>Continuation handoff</strong>
      <span>Usually hands control back to the parent task that was awaiting this one.</span>
    </div>
  </div>
  <div v-click="4"><code>co_return</code> and uncaught exceptions are routed through it.</div>
  <div v-click="5"><code>await_transform</code> can customize every <code>co_await</code> in this coroutine.</div>
</div>

<div v-click="6" class="takeaway">This is a compiler protocol - not <code>std::promise</code>.</div>

---

# One <code>co_await</code>, step by step

<div v-click="1" class="awaitable-creation">
  <div><span>evaluate expression</span><code>ScheduleOn{workers}</code></div>
  <b>creates →</b>
  <div><span>awaitable</span><code>ScheduleOn</code></div>
  <b>used directly as →</b>
  <div><span>awaiter</span><code>ScheduleOn</code></div>
</div>

<div class="await-runtime-layout">
<div class="await-parent-frame">

<div class="eyebrow">The coroutine using the awaitable</div>

```cpp
Task<void> prepareSamplerTree(...) {
    co_await ScheduleOn{workers};

    buildExpensiveSamplerTree(preset, mixer);
}
```

<div v-click="3" class="passed-parent-handle"><code>prepareHandle</code> points to this coroutine, suspended at <code>co_await</code>.</div>

</div>

<div class="await-runtime-steps">
  <div v-click="2" class="await-runtime-step">
    <span>2 · ask the awaiter</span>
    <strong><code>awaiter.await_ready()</code></strong>
    <small>If <code>true</code>, skip suspension and call <code>await_resume()</code> immediately.</small>
  </div>

  <div v-click="3" class="await-runtime-step active-suspend-step">
    <span>3 · if it returns <code>false</code></span>
    <strong><code>awaiter.await_suspend(prepareHandle)</code></strong>
    <small>The current coroutine is suspended; its handle is passed to the awaiter.</small>
  </div>

  <div v-click="4" class="await-runtime-step active-resume-step">
    <span>4 · when that handle is resumed</span>
    <strong><code>awaiter.await_resume()</code></strong>
    <small>The compiler calls it inside resumed <code>prepareSamplerTree()</code>; then building begins.</small>
  </div>
</div>
</div>

<div v-click="4" class="await-handle-story">
  <code>prepareHandle</code><span>passed into <code>await_suspend()</code></span><b>→ worker resumes it →</b><span>compiler calls <code>await_resume()</code></span>
</div>

<div v-click="5" class="takeaway await-runtime-takeaway">An awaitable defines this protocol around one suspension point.</div>

---

# A tiny awaitable: prepare on a worker

<div class="code-compare schedule-awaitable">
<div class="suspended-coroutine-code" :class="{
  'show-suspended-line': $clicks === 2,
  'show-resumed-line': $clicks === 4,
}">

<div class="eyebrow">Inside the worker operation</div>

```cpp
Task<void> prepareSamplerTree(...) {
    co_await ScheduleOn{workers};

    // continues on a worker
    buildExpensiveSamplerTree(preset, mixer);
}
```

</div>
<div>

<div class="eyebrow">The awaitable</div>

```cpp {none|4-6|7-11|9|12}
struct ScheduleOn {
    ThreadPool& pool;

    bool await_ready() const noexcept {
        return pool.isCurrentThread();
    }
    void await_suspend(std::coroutine_handle<> continuation) {
        pool.enqueue([continuation] {
            continuation.resume();
        });
    }
    void await_resume() const noexcept {}
};
```

</div>
</div>

<div class="awaiter-grid schedule-steps">
  <div v-click="1"><h3><code>await_ready()</code></h3><p>Already on the pool? Continue immediately.</p></div>
  <div v-click="2"><h3><code>await_suspend()</code></h3><p><code>continuation</code> points to the packed-up coroutine state. Enqueue the job.</p></div>
  <div v-click="3"><h3><code>continuation.resume()</code></h3><p>A worker runs the job and resumes <code>prepareSamplerTree()</code> there.</p></div>
  <div v-click="4"><h3><code>await_resume()</code></h3><p>The compiler calls this first; then execution continues after <code>co_await</code>.</p></div>
</div>

---

# Task types usually play both sides

<div class="code-compare task-duality">
<div>

<div class="eyebrow">Returned by a coroutine</div>

```cpp
MainActorTask<void> loadPreset() {
    // ...
    co_return;
}
```

</div>
<div v-click="1">

<div class="eyebrow">Awaited by another coroutine</div>

```cpp
MainActorTask openProject() {
    co_await loadPreset();
    co_return;
}
```

</div>
</div>

<div v-click="2" class="task-shape">

```cpp
struct MainActorTask {
    struct promise_type; // lets the compiler build the task
    struct awaiter;      // await_ready / suspend / resume

    awaiter operator co_await() && noexcept;
};
```

</div>

<div v-click="3" class="takeaway">A task is commonly awaitable - so one task can suspend for another.</div>

---

# Step 1: <code>child()</code> returns a task

<div class="code-compare task-return-step">
<div class="task-return-source" :class="{
  'task-create-click': $clicks === 1,
  'task-return-click': $clicks === 2,
}">

<div class="eyebrow">Parent source</div>

```cpp {none|2|2|none}
Task<void> parent() {
    co_await child();
    // parent continues here
}
```

<div v-if="$clicks === 1" class="step-explanation"><code>child()</code> creates a child coroutine frame.</div>
<div v-if="$clicks === 2" class="step-explanation"><code>child()</code> returns a <code>Task</code> holding that frame’s handle.</div>

</div>

<div class="task-return-picture" :class="{
  'task-create-click': $clicks === 1,
  'task-return-click': $clicks === 2,
}">
  <div class="coro-frame-card parent-source-frame">
    <div class="eyebrow">Parent coroutine frame</div>
    <div class="frame-row"><span>state</span><strong>running</strong></div>
    <div class="frame-code"><code>co_await child()</code></div>
  </div>

  <div v-click="1" class="task-create-arrow"><code>child()</code> creates ↓</div>

  <div v-click="1" class="coro-frame-card child-created-frame">
    <div class="eyebrow">Child coroutine frame</div>
    <div class="frame-row"><span>contains</span><strong>coroutine body</strong></div>
    <div class="frame-row"><span>promise</span><code>Task::promise_type</code></div>
  </div>

  <div v-click="2" class="returned-task-handle"><code>Task</code><span>returned to parent · handle points to child frame ↑</span></div>
</div>
</div>

<div v-click="3" class="takeaway"><code>co_await</code> receives a task that already holds the child frame’s handle.</div>

---

# Step 2: the parent becomes the continuation

<div class="code-compare continuation-step">
<div class="continuation-code" :class="{
  'save-continuation-click': $clicks === 1,
  'transfer-child-click': $clicks === 2,
}">

<div class="eyebrow">Child <code>Task</code> is awaitable → this is its awaiter</div>

```cpp {none|6|7|none}
struct Task::awaiter {
    task_handle child;

    std::coroutine_handle<> await_suspend(
        std::coroutine_handle<> parent) {
        child.promise().continuation = parent;
        return child;
    }
};
```

</div>
<div class="continuation-picture" :class="{
  'save-continuation-click': $clicks === 1,
  'transfer-child-click': $clicks === 2,
}">
  <div class="coro-frame-card suspended-frame">
    <div class="eyebrow">Parent frame</div>
    <div class="frame-row"><span>state</span><strong>suspended</strong></div>
    <div class="frame-code"><code>co_await child()</code></div>
  </div>

  <div v-click="1" class="continuation-pointer">← <code>continuation</code></div>

  <div class="coro-frame-card">
    <div class="eyebrow">Child frame</div>
    <div v-click="1" class="frame-promise-slot"><span>promise.continuation</span><code>parent handle</code></div>
    <div v-click="2" class="frame-row active-row"><span>next</span><strong>run child</strong></div>
  </div>
</div>
</div>

<div v-click="3" class="takeaway">The parent is parked in its frame. Returning the child handle transfers control to the child.</div>

---

# Step 3: <code>final_suspend()</code> returns to the parent

<div class="code-compare final-suspend-step final-handoff-layout">
<div class="final-handoff-code" :class="{
  'child-finishes-click': $clicks === 1,
  'parent-resumes-click': $clicks === 2,
}">

<div class="eyebrow">The child finishes</div>

<div class="child-finish-code">

```cpp
Task<void> child() {
    co_return;
}
```

</div>

<div class="eyebrow final-awaiter-label">Its final awaiter follows the saved link</div>

<div class="final-awaiter-code">

```cpp
final_awaiter final_suspend() noexcept {
    return {};
}

std::coroutine_handle<> final_awaiter::await_suspend(
    task_handle child) noexcept {
    return child.promise().continuation;
}
```

</div>
</div>

<div class="final-handoff-picture" :class="{
  'child-finishes-click': $clicks === 1,
  'parent-resumes-click': $clicks === 2,
}">
  <div class="coro-frame-card final-child-frame">
    <div class="eyebrow">Child frame</div>
    <div v-click="1"><strong>at <code>final_suspend()</code></strong><small>the saved continuation is the parent handle</small></div>
  </div>
  <div v-click="2" class="return-arrow"><code>continuation</code> ↓</div>
  <div v-click="2" class="coro-frame-card resumed-parent-frame"><div class="eyebrow">Parent frame</div><strong><code>await_resume()</code> → next line</strong></div>
</div>
</div>

<div v-click="3" class="takeaway">The child frame survives the handoff and can be destroyed after <code>await_resume()</code>.</div>

---

# Step 4: the same rule builds a chain

<div class="nested-frame-chain" :class="{
  'chain-links-click': $clicks === 1,
  'chain-unwind-click': $clicks === 2,
}">
  <div class="coro-frame-card">
    <div class="eyebrow">Grandparent frame</div>
    <div class="frame-code"><code>co_await parent()</code></div>
  </div>

  <div v-click="1" class="nested-link">← <code>continuation</code></div>

  <div class="coro-frame-card">
    <div class="eyebrow">Parent frame</div>
    <div class="frame-code"><code>co_await child()</code></div>
  </div>

  <div v-click="1" class="nested-link">← <code>continuation</code></div>

  <div class="coro-frame-card active-frame">
    <div class="eyebrow">Child frame</div>
    <div class="frame-code"><code>running</code></div>
  </div>
</div>

<div v-click="2" class="unwind-flow chain-unwind-highlight">
  <span>child <code>final_suspend</code></span><b>→</b><span>parent resumes</span><b>→</b><span>parent <code>final_suspend</code></span><b>→</b><span>grandparent resumes</span>
</div>

<div v-click="3" class="takeaway">A linked chain of coroutine frames - not a growing chain of native stack frames.</div>

---

# The completion handoff is solved once

<div class="code-compare completion-abstraction">
<div v-click="1">

<div class="eyebrow">Callbacks: repeated in every operation</div>

```cpp
void loadSamplesAsync(Completion completion) {
    workers.run([completion](auto samples) {
        if (!samples)
            return; // completion lost

        completion(true);
    });
}
```

<p class="comparison-note">Completion is ordinary data. Every branch must remember to invoke it.</p>

</div>
<div v-click="2">

<div class="eyebrow">Tasks: implemented once by the type</div>

```cpp
Task<bool> loadSamplesAsync() {
    auto samples = co_await workers.run(...);
    if (!samples)
        co_return false;

    co_return true;
}
```

<p class="comparison-note">The task awaiter stores the continuation. <code>final_suspend()</code> hands control back.</p>

</div>
</div>

<div v-click="3" class="mechanism-compare">
  <span>Every callback site reinvents the handoff</span>
  <b>→</b>
  <span>Every <code>Task&lt;T&gt;</code> shares one tested handoff</span>
</div>

<div v-click="4" class="takeaway">The control-flow plumbing moved out of the feature code and into one reusable abstraction.</div>

---

# <code>MainActorTask</code> makes affinity the default

<div class="actor-execution-flow">
  <div class="execution-lane main-lane">
    <div class="lane-label">Main actor</div>
    <div v-click="1" class="lane-step"><code>loadPreset()</code><span>touch plugin state</span></div>
    <div v-click="3" class="lane-step resumed-step"><code>continue after co_await</code><span>touch plugin state again</span></div>
  </div>

  <div class="actor-trip">
    <div v-click="2" class="trip-arrow">↘ <code>co_await</code></div>
    <div v-click="3" class="trip-arrow return-trip"><code>resume on main</code> ↖</div>
  </div>

  <div class="execution-lane worker-lane">
    <div class="lane-label">Worker pool</div>
    <div v-click="2" class="lane-step"><code>prepareSamplerTree()</code><span>build expensive tree</span></div>
  </div>
</div>

<div v-click="4" class="actor-contract">
  <code>MainActorTask</code>
  <span>Every continuation of this coroutine is routed back to the serialized main actor.</span>
</div>

<div v-click="5" class="takeaway">The return type turns “remember to get back to main” into a reusable guarantee.</div>

---

# Remember this line in <code>promise_type</code>?

<div class="code-compare await-transform-recall">
<div class="promise-transform-code" :class="{ 'highlight-await-transform': $clicks >= 1 }">

```cpp
struct MainActorTask::promise_type {
    MainActorTask get_return_object();
    auto initial_suspend();
    auto final_suspend();
    void return_void();
    void unhandled_exception();

    template<class Awaitable>
    auto await_transform(Awaitable&&);
};
```

<div v-click="1" class="transform-caption">Every <code>co_await</code> in this coroutine passes through this hook.</div>

</div>
<div>

<div v-click="2" class="conceptual-transform">
  <div class="eyebrow">Conceptually</div>

```cpp
template<class Awaitable>
auto promise_type::await_transform(
        Awaitable&& operation) {
    return ResumeOnMain{
        std::forward<Awaitable>(operation)
    };
}
```

  <p>The returned wrapper implements the affinity - not the hook by itself.</p>
</div>

</div>
</div>

<div v-click="3" class="await-transform-flow">
  <span>operation finishes<br><small>worker</small></span>
  <b>→</b>
  <span>wrapped awaiter posts continuation<br><small>main queue</small></span>
  <b>→</b>
  <span>coroutine resumes<br><small>main actor</small></span>
</div>

<div v-click="4" class="takeaway"><code>await_transform</code> lets the return type apply one resumption policy to every suspension point.</div>

---
clicks: 4
---

# Forgot the hop back

<CallStacks scenario="forgotHop" :step="$clicks" />

<!--
same code, RAII style · minus the way back

[click] worker builds the tree · fine so far

[click] install() on the worker · Main paints the sampler → race

[click] scope ends on the worker → finish runs there · setLoading(false) off main · no line shows it

[click] frame destroyed on the worker
-->

