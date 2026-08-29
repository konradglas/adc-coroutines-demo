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
MainActorTask loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
    // ...
    co_return;
}
```

</div>
</div>

<div class="coroutine-keywords">
  <div v-click="1"><h3><code>MainActorTask</code></h3><p>A coroutine-aware return type. It defines how the operation completes and where its body resumes.</p></div>
  <div v-click="2"><h3><code>co_await</code></h3><p>May suspend this function until the operation completes—without blocking the thread.</p></div>
  <div v-click="3"><h3><code>co_return</code></h3><p>Completes the coroutine. Normal scope exit still destroys locals and runs RAII cleanup.</p></div>
</div>

<div v-click="4" class="takeaway">The <code>co_</code> keywords make it a coroutine. The return type tells C++ what kind.</div>

---

# Three types, three jobs

```cpp {none|1|1|2}
MainActorTask loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
}
```

<div class="coroutine-keywords type-overview">
  <div v-click="1"><h3>Return object</h3><p>The <code>MainActorTask</code> object handed to the caller. It represents this coroutine.</p></div>
  <div v-click="2"><h3>Promise type</h3><p><code>MainActorTask::promise_type</code>: compiler-facing state stored inside the coroutine frame.</p></div>
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
      <span>Should the task start eagerly—or wait until someone starts it?</span>
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

<div v-click="6" class="takeaway">This is a compiler protocol—not <code>std::promise</code>.</div>

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
MainActorTask loadPreset() {
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

<div v-click="3" class="takeaway">A task is commonly awaitable—so one task can suspend for another.</div>

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

<div v-click="3" class="takeaway">A linked chain of coroutine frames—not a growing chain of native stack frames.</div>

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

# Did anyone spot the other difference?

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
MainActorTask loadPreset(...) {
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

<div v-click="2" class="takeaway">They carry different execution contracts.</div>

---

# Why give the plugin workflow a home?

<div class="code-compare main-actor-motivation">
<div>

```cpp
MainActorTask loadPreset(...) {
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
    <h3>That is where the plugin already lives</h3>
    <p>Host callbacks, editors, and much of the plugin state are main-thread-bound.</p>
  </div>
  <div v-click="2">
    <h3>Only the expensive part needs to leave</h3>
    <p><code>prepareSamplerTree()</code> can move to a worker without moving the whole workflow there.</p>
  </div>
</div>
</div>

<div v-click="3" class="takeaway">Keep the orchestration at home; explicitly send only the heavy work away.</div>

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

# The cozy part: main-owned state is serialized

<div class="code-compare actor-safety">
<div class="actor-region-code" :class="{
  'show-first-region': $clicks === 1,
  'show-suspension-boundary': $clicks === 2,
  'show-second-region': $clicks >= 3,
}">

```cpp
MainActorTask loadPreset(...) {
    app.setLoading(true);
    auto mixer = app.mixerSnapshot();

    auto tree = co_await prepareSamplerTree(...);

    sampler.installSamplerTree(tree);
    sampler.rebuildKeySwitchMap();
    app.setLoading(false);
}
```

</div>
<div class="actor-safety-notes">
  <div v-click="1" class="safe-region-note"><strong>One uninterrupted main-actor region</strong><span>No other main-actor task interleaves here.</span></div>
  <div v-click="2" class="suspension-note"><strong><code>co_await</code> is the boundary</strong><span>Other main-actor work may run while this task is suspended.</span></div>
  <div v-click="3" class="safe-region-note"><strong>Then another serialized region</strong><span>After resumption, ordinary main-owned state needs no extra locking.</span></div>
</div>
</div>

<div v-click="4" class="takeaway">For state confined to the main actor, the task body is a sequence of race-free regions separated by visible suspension points.</div>

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

  <p>The returned wrapper implements the affinity—not the hook by itself.</p>
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

# Yes! This is actually nice.

<div class="structured-celebration-code">

```cpp
MainActorTask loadPreset(...) {
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
  <div><strong>Sequential</strong><span>The workflow reads from top to bottom.</span></div>
  <div><strong>RAII</strong><span>Cleanup survives every suspension.</span></div>
  <div><strong>Main-affine</strong><span>Plugin state stays on its cozy actor.</span></div>
  <div><strong>Composable</strong><span>Child tasks own their continuation handoff.</span></div>
</div>

<div v-click="2" class="structured-celebration-summary">Structured control flow. Structured execution. Structured lifetime.</div>

<div class="celebration-doubt">
  <strong v-click="3">But...</strong>
  <span v-click="4">hmmm.</span>
</div>

---

# Okay. One tiny question...

<div class="code-compare root-task-problem">
<div>

<div class="eyebrow">Inside the coroutine tree</div>

```cpp
MainActorTask loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
    auto samples = co_await loadSamples(...);
    // beautifully owned by the parent task
}
```

</div>
<div class="root-call-code" :class="{ 'show-orphan-call': $clicks >= 1 }">

<div class="eyebrow">At the plugin boundary</div>

```cpp
void onLoadPreset() {
    loadPreset(...);
}
```

<div v-click="1" class="orphan-caption">This merely creates a lazy task—and then throws the task object away.</div>

</div>
</div>

<div class="root-questions">
  <div v-click="2"><strong>No parent coroutine</strong><span>Nothing awaits it or provides a continuation.</span></div>
  <div v-click="3"><strong>No structural owner</strong><span>Nothing is responsible for keeping its frame alive.</span></div>
  <div v-click="4"><strong>Remember <code>initial_suspend()</code>?</strong><span>A lazy root does not even start until something starts it.</span></div>
</div>

<div v-click="5" class="takeaway">The coroutine tree still needs a root.</div>

---

# One root scope owns the whole forest

<div class="code-compare root-scope-slide">
<div>

```cpp
auto root = affine::create_root_scope();

auto loading = affine::spawn(
    loadPreset(...), root);

auto scan = affine::spawn(
    scanMissingSamples(...), loading);

auto preview = affine::spawn(
    renderPreview(...), loading);
```

</div>
<div class="scope-tree">
  <div v-click="1" class="scope-node root-scope-node"><code>root_scope</code><span>plugin lifetime</span></div>
  <div v-click="2" class="scope-branch">↓ owns</div>
  <div v-click="2" class="scope-node task-scope-node"><code>loadPreset</code><span><code>TaskHandle loading</code></span></div>
  <div v-click="3" class="scope-fork"><span>↙ owns</span><span>owns ↘</span></div>
  <div v-click="3" class="scope-leaves">
    <div class="scope-node"><code>scanMissingSamples</code></div>
    <div class="scope-node"><code>renderPreview</code></div>
  </div>
</div>
</div>

<div v-click="4" class="scope-ownership-note">
  Keep a <code>TaskHandle</code> only when you need to close—and request cancellation for—that subtree later.
</div>

<div v-click="5" class="takeaway">Each spawned task is retained by its structural parent until that subtree completes.</div>

---

# Only the root pays the teardown bill

<div class="code-compare scope-close-compare">
<div v-click="1" class="scope-close-card child-close-card">

<div class="eyebrow">Stop one operation during normal use</div>

```cpp
loading.close();
```

<div v-click="2" class="close-effects">
  <span>request stop for this subtree</span>
  <span>return immediately</span>
  <span>leave the executor open</span>
</div>

</div>
<div v-click="3" class="scope-close-card root-close-card">

<div class="eyebrow">The plugin is going away</div>

```cpp
root.shutdown_and_wait();
```

<div v-click="4" class="close-effects">
  <span>request stop for the entire tree</span>
  <span>drain every outstanding continuation</span>
  <span>destroy frames only after completion</span>
</div>

</div>
</div>

<div v-click="5" class="scope-boundary-summary">
  <span>many asynchronous tasks</span>
  <b>→</b>
  <strong>one synchronous lifetime boundary</strong>
</div>

<div v-click="6" class="takeaway">Child handles only need to close their branch. The root guarantees that nothing survives plugin teardown.</div>
