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

# Lets load some data!

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
    sampler.buildKeyswitchMap(preset);
}
```

<div v-click class="takeaway">Correct. Sequential. Scope-bound. And running entirely on main. 👍</div>


<!--
the real workflow: mixer → tree → install → keyswitch map
ScopeExit = "done", always — even on exceptions
(don't hint at the ordering dependency yet)

[click] all correct… all on main
-->

---

# QA, round one

<div class="chat-stack">
  <ChatMessage v-click from="Developer">Done. Can you give it a quick test?</ChatMessage>
  <ChatMessage v-click from="QA">Seems to do it's job ... but I get the spinning wheel of death for about 2 seconds! </ChatMessage>
  <ChatMessage v-click from="Developer">Hm OK ...  Don't worry ...</ChatMessage>
  <ChatMessage v-click from="Developer">I know THREADS!</ChatMessage>
</div>


<!--
proud, breezy

[click] "quick test?"

[click] QA: works · 2 s spinner

[click] defensive

[click] THREADS! — beat
-->

---

# Easy: move the slow line away

```cpp {none|1-4|6-7}
workers.run([&, preset, mixer] {
    auto tree = prepareSamplerTree(preset, mixer);
    sampler.installSamplerTree(tree);
});

sampler.buildKeyswitchMap(preset);
app.notifyPresetLoaded();
```

<div v-click class="takeaway">Same sequence, less blocking. Ship it.</div>


<!--
slow line → worker, done

[click] build + install off main

[click] the rest stays on main

[click] confident. ship it
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
[click] terser: "try it now"

[click] QA: weird…

[click] three symptoms — let them land

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

sampler.rebuildKeySwitchMap();
```

</div>
<div class="race-story">
  <div v-if="$clicks >= 1 && $clicks <= 2" class="race-step race-assumption">
    <h3>What I assumed</h3>
    <p>needs only the preset</p>
  </div>

  <div v-if="$clicks === 2" class="race-step race-result">
    <h3>What QA uncovered</h3>
    <p>reads the installed tree</p>
  </div>

  <div v-if="$clicks >= 3" class="race-step race-thread">
    <h3>Worker</h3>
    <p>installs… whenever</p>
  </div>

<span v-if="$clicks >= 4" class="race-car-icon" aria-hidden="true">🏎️</span>

  <div v-if="$clicks >= 4" class="race-step race-thread">
    <h3>Main</h3>
    <p>rebuilds right away</p>
  </div>

  <div v-if="$clicks >= 5" class="race-step race-result">
    <h3>What actually happens</h3>
    <p>stale state, or UB</p>
  </div>
</div>
</div>


<!--
same code as shipped

[click] the map rebuild…

[click] assumed: preset only · QA: it reads the installed tree

[click] worker installs the tree whenever it's done

[click] main rebuilds + says "loaded" right away 🏎️

[click] main wins → stale map · overlap → UB
→ sometimes worker wins, sometimes main, sometimes both — the order WAS the dependency
-->

---

# Fine. Restore the order - and main-thread affinity.

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
        sampler.rebuildKeySwitchMap();
    });
});
```

<div v-if="$clicks >= 3" class="takeaway">Ordering restored. Main-thread affinity restored. Ship it 🚢</div>


<!--
[click] post back to main

[click] install + rebuild, in order, on main

[click] ordering ✓ affinity ✓ — ship 🚢
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
[click] "all fixed" — getting short

[click] QA: spinner gone instantly, UI stale

[click] "so it's fast now!"
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

  <div v-if="$clicks >= 3" class="race-step race-result">
    <h3>Later</h3>
    <p>completes again</p>
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


<!--
oops — the ScopeExit is still armed

[click] run() only schedules → returns immediately

[click] loadPreset() returns → ScopeExit: "loaded", spinner off — too early

[click] later the posted callback installs + completes a 2nd time

[click] RAII would be so nice… can't use it here

[click] so: delete the guard, complete by hand in the callback

[click] happy path ✓ · early exits / exceptions: nobody cleans up
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
[click] QA: let the user locate missing samples

[click] wait for a dialog, then load off main

[click] "feature list" 👍 — deflect
-->

---

# Then I try anyway

```cpp {none|1-3|5-8|9-14}
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



<!--
tries anyway

[click] tree, async

[click] dialog, async (don't point at the return)

[click] samples, async · complete at the bottom
→ three nested scopes
-->

---

# QA, one last time

<div class="bug-pair dense-code">
<div>

```cpp {hide|hide|hide|none|10-11}
void loadMissingSamplesAsync(
    Location location,
    std::function<void(bool)> completion)
{
    workers.run([location] () {
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



<!--
[click] "one last time. then ship it." — frustrated

[click] QA: content missing → spinner forever

[click] the "production-ready" function

[click] the quiet return 🐛
→ every return must remember
-->

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

<div v-click class="takeaway">It looks pretty simple! But it's blocking ...</div>


<!--
just the steps, plain

[click] simple — but blocking
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
    sampler.rebuildKeySwitchMap();






}
```

</div>
<div v-click="1">

<div class="eyebrow">Coroutine</div>

<div v-if="$clicks < 2">

```cpp
stdexec::task<void> loadPreset(App& app, Sampler& sampler,
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
    sampler.rebuildKeySwitchMap();






}
```

</div>
<div v-else>

```cpp {14-19}
stdexec::task<void> loadPreset(App& app, Sampler& sampler,
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
</div>

<span v-click="2" style="display: none"></span>


<!--
the sync version — correct, but blocking

[click] coroutine: same shape, co_await

[click] the new feature: dialog + load, still linear
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
  <div><h3>Sequential order</h3></div>
  <div><h3>Visible dependencies</h3></div>
  <div><h3>RAII</h3></div>
</div>



<!--
[click] same code — only co_await added

[click] reads in the order it runs · tree / location / samples are plain locals · ScopeExit survives the suspension
→ suspend without giving up the structure
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
stdexec::task<void> loadPreset(...) {
    auto tree = co_await prepareSamplerTree(...);
    // ...
    co_return;
}
```

</div>
</div>

<div class="coroutine-keywords">
  <div v-click="1"><h3><code>stdexec::task</code></h3><p>how it starts, ends, resumes</p></div>
  <div v-click="2"><h3><code>co_await</code></h3><p>may suspend</p></div>
  <div v-click="3"><h3><code>co_return</code></h3><p>completes</p></div>
</div>



<!--
[click] task: the type decides — starts lazily · hands result/error/cancel to the awaiter · resumes on its scheduler

[click] co_await: may suspend — the thread is NOT blocked

[click] co_return: completes · locals + RAII still run
→ co_ keywords → coroutine · return type → which kind
-->

---

# But how does this work? And how do I use it?

<div class="agenda-questions">
<v-clicks>

- What is an asynchronous operation
- Why are coroutines non-blocking
- How do I get from `void` to `task<void>`
- What thread am I on after the `co_await`
- How do I cancel obsolete work
- How do I safely tear down the whole thing
- Which libraries are out there to get my hands dirty

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
a function that can suspend and resume

[click] each co_await may pause and hand control back

[click] chunk 1: snapshot → up to the first co_await

[click] chunk 2: network data → up to the next co_await

[click] chunk 3: process → send to UI

[click] localData is used after two suspensions → it lives in the frame, not on a stack

[click] one function = 3 chunks, 1 frame
→ between chunks someone calls resume() — who, on which thread? → next slides
-->

---
clicks: 3
---

# Waiting by blocking

<CallStacks scenario="blocking" :step="$clicks" />


<!--
both idle

[click] click → loadPreset() on main

[click] main stuck in get() · no events, no paint

[click] stack back only when worker is done
-->

---
clicks: 8
---

# Who is on the stack?

<CallStacks scenario="coroutine" :step="$clicks" />

<!--
both idle · waiting for a click

[click] spawn → frame on heap, nothing ran yet

[click] executor resumes → body = just a call under resume()

[click] awaitable decides where → handle into worker queue

[click] returns, resume() returns → Main free. **PAUSE** — that's the answer

[click] same frame, other stack · Main paints, spinner spins

[click] co_await → Main's queue · worker idle again

[click] Main drains → resumes

[click] frame gone · nobody waited
-->

---
clicks: 3
---

# Where does this logic live?

<CallStacks scenario="callbacks" :step="$clicks" :slots="6" />


<!--
async ≠ another thread · values arrive later, any order

[click] layout first → check → return

[click] rate → both there → create, inside host callback

[click] decision spread: 3 functions, 2 members
-->

---
clicks: 4
---

# The same logic, in one place

<CallStacks scenario="event" :step="$clicks" code-size="0.62rem" :slots="6" />


<!--
spawned in initialise → suspends at once

[click] no executor, no queue · main paints

[click] layout → setValue() returns

[click] rate → resumed inline, inside the callback

[click] parks again · one function, top to bottom
-->

---
clicks: 3
---

# Polled by the audio thread

<CallStacks scenario="polled" :step="$clicks" />


<!--
key click → coroutine starts in mouseDown()

[click] mouseDown returns · handle waits · nobody wakes audio

[click] next block polls → resumes, gets the block

[click] note plays · real-time safe!
-->

---

# Same top, different bottom

<StackShapes />



<!--
top two rows: always body + resume()
→ only the caller differs
-->

---
clicks: 4
---

# Zoom out: chunks on threads

<ThreadTimeline name="loadPreset" :step="$clicks" />


<!--
blocking: main stuck in get()

[click] chunk 1 → hop to worker

[click] main is free: paint, mouse

[click] 2nd coroutine → audio, next block

[click] back on main · nobody waited
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

<div v-click="1" class="orphan-caption">This merely creates a lazy task - and then throws the task object away.</div>

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
  Keep a <code>TaskHandle</code> only when you need to close - and request cancellation for - that subtree later.
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
  <span>wait until every owned task has completed and unwound</span>
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

---

# <code>close()</code> is a request - not a wrecking ball

<div class="close-request-call">

```cpp
loading.close();
```

</div>

<div class="close-request-flow">
  <div v-click="1"><code>TaskHandle</code><span>close this subtree</span></div>
  <b v-click="2">→</b>
  <div v-click="2" class="stop-request-node"><code>stop requested</code><span>task + descendants</span></div>
  <b v-click="3">→</b>
  <div v-click="3"><code>close()</code> returns<span>caller keeps running</span></div>
</div>

<div v-click="4" class="close-does-not-grid">
  <div><strong>Does not kill a thread</strong><span>Running code is not interrupted.</span></div>
  <div><strong>Does not destroy a frame</strong><span>Suspended state remains alive.</span></div>
  <div><strong>Does not mean “finished”</strong><span>The subtree still has to cooperate.</span></div>
</div>

<div v-click="5" class="takeaway"><code>close()</code> changes cancellation state. The task decides when that state affects control flow.</div>

---

# Cancellation is cooperative

<div class="code-compare cooperative-cancellation">
<div class="cooperative-code" :class="{
  'show-stop-token': $clicks === 1,
  'show-cancellable-wait': $clicks === 2,
  'show-stop-check': $clicks === 3,
  'show-publication': $clicks >= 4,
}">

```cpp
MainActorTask loadPreset(...) {
    auto stop = co_await affine::this_task::stop_token;

    auto samples = co_await loadSamples(...);

    if (stop.stop_requested())
        co_return;

    sampler.installSamples(std::move(samples));
}
```

</div>
<div class="cooperation-notes">
  <div v-click="1"><strong>Observe</strong><span>The token is a view of this task’s inherited cancellation state.</span></div>
  <div v-click="2"><strong>Cooperate early</strong><span>Child tasks inherit the request; cancellation-aware waits may finish early.</span></div>
  <div v-click="3"><strong>Check after the final wait</strong><span>Even a non-cancellable operation can finish without publishing stale work.</span></div>
  <div v-click="4"><strong>Publish safely</strong><span>No suspension separates the check from this main-actor state change.</span></div>
</div>
</div>

<div v-click="5" class="takeaway">A stop request becomes cancellation only at a cooperation point.</div>

---

# Cancellation leaves through the front door

<div class="cancellation-exit-code">

```cpp
MainActorTask loadPreset(...) {
    ScopeExit finish([&] {
        app.setLoading(false);
    });

    auto stop = co_await affine::this_task::stop_token;
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

<div v-click="6" class="takeaway">Cancellation preserves structured exit: cleanup first, frame destruction only after completion.</div>

---

# Where did all that machinery come from?

<div class="runtime-origin-layout">
<div class="runtime-origin-code">

<div class="eyebrow">The API we just used</div>

```cpp
MainActorTask loadPreset(...);

auto loading = affine::spawn(
    loadPreset(...), root);

loading.close();
root.shutdown_and_wait();
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

---

# Why I ended up with <code>stdexec</code>

<div class="stdexec-choice-layout">
<div class="stdexec-orchestration">

```cpp
MainActorTask loadPreset(...) {
    auto bytes = co_await readPreset(...);
    auto tree = co_await prepareSamplerTree(bytes);

    sampler.installSamplerTree(tree);
}
```

</div>
<div class="stdexec-stack">
  <div v-click="1" class="standards-winner"><strong>It won.</strong><span><a href="https://wg21.link/P2300">P2300</a> sender/receiver became C++26 <code>std::execution</code>.</span></div>
  <div v-click="4" class="stdexec-layer coroutine-layer"><strong>Coroutine tasks</strong><span>Readable orchestration</span></div>
  <div v-click="3" class="stdexec-layer affine-layer"><strong>stdexec-affine</strong><span>Sticky main-thread resumption · root ownership · synchronous teardown</span></div>
  <div v-click="2" class="stdexec-layer sender-layer"><strong>stdexec</strong><span>Reference implementation · senders · schedulers · stop environments</span></div>
</div>
</div>

<div v-click="5" class="stdexec-operation-flow">
  <span>senders implement individual operations</span>
  <b>→</b>
  <span>coroutines express the workflow</span>
</div>

<div v-click="6" class="takeaway">The deciding factor was direction: build the plug-in-specific affinity layer on the execution model C++26 chose.</div>

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
