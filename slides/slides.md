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

<!--
Hello, and welcome to my talk: std::future is not the future.
-->

---

# About me

<div class="thought-actual">
  <div>
    <h3>MuseSampler · network</h3>
    <p>Rendering AI instruments<br>Authentication flows</p>
    <p class="takeaway"><code>co_await</code> everywhere ❤️ <span class="muted">(mostly)</span></p>
  </div>
  <div v-click>
    <h3>Sample players · main thread</h3>
    <p>GUI · host callbacks · plugin state</p>
    <p class="takeaway"><code>co_await</code> here? 🤔</p>
  </div>
</div>

<!--
Quickly about me. I've been working a lot on the MuseSampler, for MuseScore.
A big part of that is rendering AI instruments. So there's a lot of networking going on: logins, authentication flows, fetching stuff from the internet.
That's how I stumbled into coroutines, with Asio. And now I use them basically everywhere. (beat) Mostly.

[click]
But I also build sample players and other plugins. And those have a main thread: the GUI, host callbacks, plugin state.
So I asked myself: can I use coroutines there too? Right on the main thread? (beat) Let's try.
-->

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

    auto instrument = prepareInstrument(preset, mixer);

    sampler.installInstrument(instrument);
    keySwitches.load(preset);
}
```

<div v-click class="takeaway">Correct. Sequential. Scope-bound. And running entirely on main. 👍</div>

<!--
Here's a concrete example: loading a preset.
Set the loading flag. Load the mixer state. Prepare the instrument, install it. And a ScopeExit turns the spinner off at the end, whatever happens.
This code has been running for years. But over the years, things got more complex. Bigger presets, more and more license checks.

[click]
But it's still correct. It's sequential, it's scope-bound, and it runs entirely on Main.
-->

---

# QA, round one

<div class="chat-stack">
  <ChatMessage v-click from="QA">Loading gives me the spinning wheel of death!</ChatMessage>
  <ChatMessage v-click from="Developer">Hm OK ...  Don't worry ...</ChatMessage>
  <ChatMessage v-click from="Developer">I know about THREADS!</ChatMessage>
</div>

<!--
So this code has been fine for years. Nobody asked QA to test anything.

[click]
And then one day, QA comes with a little complaint: loading gives me the spinning wheel of death. (beat)

[click]
Hm, OK. Don't worry. With bigger presets, this starts to hang the main thread.

[click]
But I know about THREADS! (beat)
-->

---

# Easy: move the slow line away

```cpp {none|1-4|6-7}
workers.run([&, preset, mixer] {
    auto instrument = prepareInstrument(preset, mixer);
    sampler.installInstrument(instrument);
});

keySwitches.load(preset);
app.notifyPresetLoaded();
```

<div v-click class="takeaway">Same sequence, less blocking. Ship it.</div>

<!--
Easy. Move the slow line away.

[click]
We hand it over to a worker thread. It runs off Main: it builds the instrument there, and installs it on the sampler.

[click]
And the rest stays on Main.

[click]
Awesome. Same sequence, less blocking. Ship it.
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
  <ChatMessage v-click from="Developer">LIES! Must be your machine.</ChatMessage>
</div>

<!--
(confident)

[click]
Fixed. Try it now.

[click]
Uh-oh. This is weird…

[click]
Sometimes it looks fine. Sometimes part of the old preset is still in there. And sometimes it just crashes. (let it land)

[click]
And I react the way everyone would: I deny it. (beat) Lies! There must be something wrong with your machine.
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
    auto instrument = prepareInstrument(preset, mixer);
    sampler.installInstrument(instrument);
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
    <p>reads the installed instrument</p>
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
So, let's look at it again. (beat) Maybe QA was right.

[click]
Here's what I assumed: keySwitches.load() only needs the preset. Nothing else.

[click]
But it reads the installed instrument. The one the worker installs.

[click]
And the worker installs that instrument… whenever. Whenever it's done building.

[click]
Main doesn't wait. It loads the key switches right away, and reports the preset as loaded. So now they race.

[click]
Either Main reads the old instrument: that's the old preset QA saw. Or both touch it at the same time: undefined behaviour. That's the crash.
(beat) The order of the lines was the dependency. And I moved it away.
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
    auto instrument = prepareInstrument(preset, mixer);

    mainQueue.post([&, instrument = std::move(instrument)] {
        sampler.installInstrument(instrument);
        keySwitches.load(preset);
    });
});
```

<div v-if="$clicks >= 3" class="takeaway">Ordering restored. Main-thread affinity restored. Ship it 🚢</div>

<!--
Alright, let's restore that order. We can dispatch to Main, right?

[click]
prepareInstrument still runs on the worker thread. Otherwise this wouldn't make any sense.

[click]
And once it's done, we post back to Main. Install the instrument, then load the key switches. In that order, on Main.

[click]
Order restored. Everything runs in sequence again. Nice! Ship it!
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
(breezy)

[click]
All right. All fixed. Can you test it again?

[click]
The spinner disappears immediately. But the UI doesn't refresh with the new state.

[click]
(proud) So it's fast now! (beat)
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
    auto instrument = prepareInstrument(preset, mixer);

    mainQueue.post([&, instrument = std::move(instrument)] {
        sampler.installInstrument(instrument);
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
Oh no. What did I do? (beat)
I left something in there: the ScopeExit. The RAII guard that's supposed to cover the whole load.

[click]
workers.run() hands the work to the worker, and returns immediately. On Main.

[click]
So the function ends, and the ScopeExit fires. It reports the preset as loaded and turns the spinner off. Way too early.

[click]
The worker installs the instrument later. Silently. Nobody tells the UI.

[click]
RAII is so nice. But I can't use it here.

[click]
Fine. Then I complete it manually, inside the callback. (sigh) Not so nice.

[click]
The happy path works again. But RAII is gone: if anything in there throws, nobody turns the spinner off.
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
Okay. But at least it seems to work now. (beat)

[click]
And then QA asks for one nice thing: when samples are missing, could we let the user locate them?

[click]
Hm. That doesn't look trivial. First wait for another asynchronous file dialog. Then load the samples, away from Main. In yet another callback.

[click]
Good idea. Let's put it on the feature request list. (beat)
-->

---

# Then I try anyway

```cpp {none|1,4-6|8-11|12-17}
app.setLoading(true);
...

prepareInstrumentAsync(..., [&](auto instrument) {
    sampler.installInstrument(instrument);
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
But then I try it anyway. Because why not, right? It can't be that hard.

[click]
We build the instrument, and give it a completion handler: install the instrument, load the key switches.

[click]
Inside that handler, another one: ask the user to locate the samples. If there's no location, we return. Obviously. (don't linger on the return)

[click]
Otherwise, load the samples asynchronously, and complete inside that third callback.
(beat) Looks actually fine.
-->

---

# QA, one last time

<div class="bug-pair dense-code">
<div>

```cpp {hide|hide|hide|none|1,9-10}
app.setLoading(true);
...

prepareInstrumentAsync(..., [&](auto instrument) {
    sampler.installInstrument(instrument);
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
(frustrated)

[click]
That's it?? Fine. Test it one last time. Then we ship it. Come on, it's Friday.

[click]
When I cancel the file dialog, the spinner stays forever.

[click]
What did I do? (beat)

[click]
Right. There's the bug. The spinner goes on up here. If the user cancels, I return. And nothing turns it off.
I'd have to reset that state by hand. And I forgot. Again.
-->

---

# Okay. Deep breath.

```text
prepare instrument
install instrument
load key switches
ask user
load samples
install samples
notify
```

<div v-click class="takeaway">It looks pretty simple! But it's blocking ...</div>

<!--
All right. Deep breath. (beat)
It doesn't look that hard, does it? Prepare the instrument. Install the instrument. Load the key switches. Ask the user for the missing samples. Load the samples. Install them. Notify.

[click]
It looks so simple. The only problem: it's blocking.
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
    auto instrument = prepareInstrument(preset, mixer);
    sampler.installInstrument(instrument);
    keySwitches.load(preset);







}
```

</div>
<div v-click="1">

<div class="eyebrow">{{ $clicks < 3 ? 'Non-blocking version' : 'Coroutine' }}</div>

<div v-if="$clicks < 2">

```cpp
void loadPreset(App& app, Sampler& sampler,
                Preset preset, bool& finished) {
    app.setLoading(true);
    app.loadMixerState(preset);
    auto mixer = app.mixerSnapshot();
    prepareInstrumentAsync(preset, mixer, [&, preset](auto instrument) {
        sampler.installInstrument(instrument);
        keySwitches.load(preset);
        askUserToLocateSamples(sampler.missingSamples(),
                               [&](auto location) {
            if (!location) {
                app.notifyPresetLoaded();
                app.setLoading(false);
                finished = true;
                return;
            }
            loadSamplesAsync(*location, [&](auto samples) {
                sampler.installSamples(std::move(samples));
                app.notifyPresetLoaded();
                app.setLoading(false);
                finished = true;
            });
        });
    });
}
```

</div>
<div v-else>

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
    auto instrument = co_await starts_on(workers,
        prepareInstrument(preset, mixer));
    sampler.installInstrument(instrument);
    keySwitches.load(preset);
    auto location = co_await askUserToLocateSamples(
        sampler.missingSamples());
    if (!location)
        co_return;
    auto samples = co_await starts_on(workers, loadSamples(*location));
    sampler.installSamples(std::move(samples));
}
```

</div>

</div>
</div>

<span v-click="2" style="display: none"></span>
<span v-click="3" style="display: none"></span>

<div v-click="4" class="stdexec-note">
  built on <code>stdexec</code> · <code>std::execution</code>, C++26 · plus a little of my own
</div>

<!--
Here's our synchronous version from the beginning. Correct, but blocking.

[click]
And here's the non-blocking callback version, with QA's new feature. Fixed this time, so it's correct.
But look at it. Three nested callbacks. And the cleanup is copied into every exit.

[click]
So what if we could keep the shape of the left side, but without blocking? Same feature. Same order as the synchronous version.

[click]
And this non-blocking version has a name: it's a coroutine.

[click]
Quick note on what I'm using: starts_on and friends are from std::execution, new in C++26. I use stdexec, its reference implementation. Plus a bit of extra work on top, for the things I found missing. More on that at the end.
-->

---

# What coroutines give back

<div class="code-compare dense-code">
<div class="wheel-host">

```cpp
ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

auto instrument = prepareInstrument(
    preset, mixer);

sampler.installInstrument(instrument);
keySwitches.load(preset);
```

<span v-click="5" class="wheel-overlay"><img src="/spinning-wheel.png" alt="spinning wheel of death"></span>

</div>
<div v-click class="wheel-host">

```cpp
ScopeExit finish([&] {
    app.notifyPresetLoaded();
    app.setLoading(false);
    finished = true;
});

auto instrument = co_await starts_on(workers,
    prepareInstrument(preset, mixer));

sampler.installInstrument(instrument);
keySwitches.load(preset);
```

<span v-click="5" class="wheel-overlay struck-wheel"><img src="/spinning-wheel.png" alt="spinning wheel of death, struck out"></span>

</div>
</div>

<div class="payoff-grid">
  <div v-click><h3>Sequential order</h3></div>
  <div v-click><h3>Visible dependencies</h3></div>
  <div v-click><h3>RAII</h3></div>
</div>


<!--
So let's have a quick look at what this funny syntax actually gives us back.

[click]
The difference: co_await. And starts_on says where the heavy part runs: on the workers.

[click]
We still have the sequential order. It looks exactly the same.

[click]
All the dependencies between the lines are plainly visible.

[click]
And we get RAII back. The ScopeExit fires at the end again, when the work is really done.

[click]
And the difference: on the left, Main is blocked. Spinning wheel of death. On the right, it's not blocking. No more spinning wheel. (beat)
-->

---

# What actually changed?

<div class="code-compare coroutine-syntax">
<div>

<div class="eyebrow">Synchronous function</div>

```cpp
void loadPreset(...) {
    auto instrument = prepareInstrument(...);
    // ...
    return;
}
```

</div>
<div>

<div class="eyebrow">Coroutine</div>

```cpp {none|1|2-3|5}
task<void> loadPreset(...) {
    auto instrument = co_await starts_on(workers,
        prepareInstrument(...));
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
Okay. Let's have another look at what actually changed between the two versions.

[click]
The return type. We don't have void anymore, we have task<void>. And task defines how this coroutine starts, how it ends, and how it resumes.

[click]
At co_await, it may suspend. But it doesn't block.

[click]
And co_return is just the return you use in a coroutine. RAII still runs.
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
So, the first question: why don't coroutines block?
A coroutine is a function that can stop halfway, and continue later.
Here's one: snapshot, fetch from the internet, process, send to the UI.

[click]
Every co_await is an exit door. At that door, the function returns to its caller. The thread is free.
And here's the important part: the rest does not continue by itself.

[click]
So the function falls apart into chunks. Chunk one runs until the first door. Then control goes back to the event loop.

[click]
Chunk two only runs when someone calls resume(). Who? Whatever delivers the answer. Most of the time, that's an executor. Hold that thought.

[click]
Chunk three: same question again. Someone has to call resume().

[click]
But wait. If the function returns at the door, where does localData go?
A normal function would lose it. A coroutine doesn't: its locals live in a frame on the heap, not on the stack.
That's why it can give the thread back without losing anything.

[click]
Three chunks. One frame. Between the chunks, no thread is stuck in this function. The frame just sits on the heap.
(beat) So who calls resume()? Before I answer that, let's look at a call stack without coroutines.
-->

---
clicks: 3
---

# Blocking: Main does it all

<CallStacks scenario="blocking" :step="$clicks" />

<!--
This is Main's stack. Just its event loop, waiting for events.
And that loop is already an executor: a queue of work, and a loop that runs it. It sleeps until something lands in the queue, then it wakes up and runs it. Remember that.

[click]
The user clicks "load". The event loop calls onLoadClicked(), which calls loadPreset(). Our synchronous version from the beginning.

[click]
Now buildInstrument() runs. On Main. As long as it's on top of the stack, the event loop below can't do anything.
No paint events. No mouse events. That's QA's spinning wheel.

[click]
Only when it returns does Main get its stack back.
(beat) Now the same code, with two hops.
-->

---
clicks: 7
---

# Resumed by an executor

<CallStacks scenario="coroutine" :step="$clicks" />

<!--
Let me walk you through this picture first. We'll use it a few times. (pause)
Top left: the code. Top right: what's happening right now.
Below, three columns. Left: Main's call stack. Right: the worker's call stack. And in the middle: the coroutine frame, on the heap. That's where the locals live while no stack holds the function.
(let it sink in)
Same function as before. Two new lines: resumeOn(workers) and resumeOn(mainThread).
And the worker is an executor too: its own queue, its own loop.

[click]
The click starts the coroutine on Main. Look at the stack: exactly the same as the synchronous version. Until the first co_await, it's just a function call.

[click]
Then: co_await resumeOn(workers). resumeOn means: put me in that thread's queue, and wake it up.

[click]
And Main? Main is back in its event loop. Painting. Handling mouse events. (pause)

[click]
The worker takes us out of its queue and calls resume(). Same frame, different stack. Now we build the instrument on the worker.

[click]
Done. co_await resumeOn(mainThread). Put me in Main's queue, and wake Main up.

[click]
Main's event loop picks us up and calls resume(). We install the instrument on Main.

[click]
Nobody waited. That's all an executor is: a queue, a loop that calls resume(), and a way to wake it up. resumeOn just picks which one.
(beat) But often there is no queue to pick. Sometimes we're just waiting for something to arrive from the outside.
-->


---
clicks: 3
---

# Events with callbacks

<CallStacks scenario="callbacks" :step="$clicks" :slots="6" />

<!--
Here's an example. Before my instrument can play, I need two things: the license from our server, and the samples from the download.
Both arrive at some point. And I don't know which comes first.
Today we'd write it like this: one callback per event, and both call enableInstrument().

[click]
The license arrives first. Store it, call enableInstrument(). No samples yet. Return.

[click]
Later, the download finishes. Store it, call enableInstrument(). Both are there. Enable.

[click]
It works. But one simple idea, wait for both and then enable, is spread over three functions.
The order hides in an if. The state lives in members.
(beat) What I want to write is: wait for the license, wait for the samples, enable.
-->

---
clicks: 4
---

# Resumed by an event

<CallStacks scenario="event" :step="$clicks" :slots="6" />

<!--
So let's write exactly that. startInstrument(): wait for both, then enable.
_license and _samples are awaitable events: a slot you fill once with setValue(), and co_await with value().
The user selects the instrument, and that starts it. Inline, a plain call on Main. Nothing is there yet, so it suspends right away.

[click]
Main keeps doing its job. Events. Painting.

[click]
The license arrives. The callback just hands it over: setValue(). when_all still needs the samples, so nothing resumes yet. setValue() simply returns.

[click]
The download finishes. setValue() completes the when_all and resumes our coroutine right there, inside the callback. On Main.
No queue. No executor. Whoever delivers the event calls resume().

[click]
And the callbacks didn't block either. (beat)
So this isn't faster. But now it's one function, and it reads like what I wanted: wait for both, then enable.
One more. Back to queues, but slightly different.
-->

---
clicks: 4
---

# Resumed by polling

<CallStacks scenario="polled" :step="$clicks" />

<div v-click="4" class="rt-caveats">
  <h3>Conceptual only: not real-time safe</h3>
  <span>frame freed on the audio thread</span>
  <span>the queue must be lock-free</span>
  <span>everything after the <code>co_await</code> runs in the audio callback</span>
</div>

<!--
Sometimes the thread you want to hop on has no event queue you can wake up.
The audio thread, for example. The host calls it every block, on its own schedule.
Here's a little example: the user clicks a note on the on-screen MIDI keyboard. That click arrives on Main. But the note has to play on the audio thread. So we co_await the audio thread.

[click]
So we hop into its queue, and wait for it to come by the next time.

[click]
Next block: processBlock() checks the queue, finds us, and calls resume(). We get the audio block back.

[click]
Now we're on the audio thread. The note plays, in this very block.
It's the same as the executor. Just without the wakeup.

[click]
(beat) One honest note: this is really just conceptual. As written, this is not real-time safe.
When the coroutine ends, its frame is freed on the audio thread. The queue we hop into has to be lock-free. And everything after the co_await runs inside the audio callback.
So: a nice picture of polling. Not something to copy into your audio code.
-->

---

# Same top, different bottom

<StackShapes />

<!--
Let's put all four stacks next to each other.
The top is always the same: handle.resume(), then our function body.
Only the bottom changes. A thread pool. Main's event loop. The audio callback. Or just a callback from outside, like our download.
(beat) The coroutine doesn't care who calls resume().
So, to sum up: three ways to get resumed. An executor: a queue, a loop, a wakeup. An event: whoever delivers it resumes us inline. And polling: a queue without a wakeup.
-->

---
clicks: 4
---

# Zoom out: chunks on threads

<ThreadTimeline name="loadPreset" :step="$clicks" />

<!--
Now let's zoom out, and look at time instead of stacks. Time runs downwards.
On the left, the blocking version. Main runs the first part, then it builds the instrument itself. Heavy work, right on Main. Nothing else runs. No painting.

[click]
On the right, the coroutine. Chunk one runs on Main. Then it hops to a worker.

[click]
And Main is free. It paints, it handles the mouse, while chunk two runs on the worker.

[click]
Meanwhile, the user plays a note. A second coroutine starts on Main and hops to the audio thread. The audio thread picks it up at its next block.

[click]
Then chunk three of loadPreset comes back to Main.
Two coroutines, three threads. And nobody waited.
-->

---
clicks: 5
---

# Which thread am I on?

<ThreadBadges name="tracking" :step="$clicks" />

<!--
That covers why coroutines don't block. Okay, another question.
Code like this always made me nervous. I come from a world with the main thread, worker threads and processing threads. Every line of code belongs to one of them.
So after a co_await, I ask myself: which thread am I on now? Can I see it? Or do I have to read through all the code to find out?
Let's go through loadPreset, line by line.

[click]
setLoading and the ScopeExit: Main. That's where we started.

[click]
resumeOn(workers). From here on: worker. buildInstrument runs there.

[click]
resumeOn(mainThread). Back on Main. We install the instrument.

[click]
Now we ask the user to locate the samples. That's a dialog.
Where are we after that? (beat) It depends on who finishes the dialog. I don't know.

[click]
And the rest? installSamples. The closing brace, where the ScopeExit runs. Question marks.
(beat) Basically, I'm the scheduler now. For every line, I have to know where I am.
And if I forget one hop, setLoading(false) runs on a worker.
-->

---
clicks: 1
---

# What if the task knew where it belongs?

<ThreadBadges name="mainActor" :step="$clicks" />

<!--
All those question marks. What if the task itself knew where it belongs?

[click]
This is a MainActorTask. Same function, no resumeOn anywhere. And every line runs on Main.
(beat) Enjoy that for a second.
-->

---
clicks: 4
---

# The line disappeared

<CallStacks scenario="affine" :step="$clicks" />

<!--
So how does it get home? Same start as before: loadPreset starts on Main.

[click]
Now it awaits prepareInstrument(). That's a child task. And starts_on says where the child runs: on the workers.
So the child goes into the worker's queue, not started yet. The parent just waits for it.

[click]
The child builds the instrument on the worker. Main is free. It paints.

[click]
The child is done. And now MainActorTask does what I used to write by hand: it posts the parent back into Main's queue.

[click]
Main drains its queue and resumes loadPreset. Back on Main, by itself.
The resumeOn(mainThread) line is just gone.
So: the way home is now part of the type. MainActorTask always comes back to Main. I don't have to remember it in every function.
-->

---

# Why give the plugin workflow a home?

<div class="code-compare main-actor-motivation">
<div>

```cpp
MainActorTask<void> loadPreset(...) {
    app.setLoading(true);
    app.loadMixerState(preset);

    auto instrument = co_await starts_on(workers,
        prepareInstrument(...));

    sampler.installInstrument(instrument);
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
    <p><code>prepareInstrument()</code> → worker</p>
  </div>
</div>
</div>

<!--
Why Main? Look at what loadPreset touches: the loading state, the mixer state, the sampler, the notification.

[click]
That's where the plugin lives. The host calls us on Main. The editor runs on Main. The plugin state belongs to Main.

[click]
Only the heavy part leaves. prepareInstrument goes to the worker. Everything else stays home.
-->

---

# The cozy part: everything on Main

<div class="code-compare actor-safety">
<div>

```cpp {none|2,3,7-9|all}
MainActorTask<void> loadPreset(...) {
    app.setLoading(true);
    auto mixer = app.mixerSnapshot();

    auto instrument = co_await starts_on(workers, prepareInstrument(...));

    sampler.installInstrument(instrument);
    keySwitches.load(preset);
    app.setLoading(false);
}
```

</div>
<div class="actor-safety-notes">
  <div v-click="1" class="safe-region-note"><strong>UI · plugin state: on Main</strong></div>
  <div v-click="2" class="safe-region-note"><strong>No locks · no data races</strong></div>
</div>
</div>

<!--
And because everything runs on Main, we get something really cozy.

[click]
Look at every line that touches state: the loading flag, the mixer, the sampler, the key switches. All of them run on Main. The same thread as the UI and the host callbacks.

[click]
So: no locks. No mutexes, no atomics, no data races. We just touch the plugin state, like in a plain single-threaded program.
Only the heavy part leaves. And it comes back home with its result.
-->
---

# Yes! This is actually nice.

<div class="structured-celebration-code">

```cpp
MainActorTask<void> loadPreset(...) {
    ScopeExit finish([&] { app.setLoading(false); });

    auto instrument = co_await starts_on(workers, prepareInstrument(...));
    sampler.installInstrument(instrument);

    auto location = co_await askUserToLocateSamples(...);
    if (!location)
        co_return;

    auto samples = co_await starts_on(workers, loadSamples(*location));
    sampler.installSamples(samples);
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
So let's put it all together. The ScopeExit is back. The dialog is back. And the early return.
In the last callback version, that return was the bug: the spinner stayed forever.
Here it's correct. co_return leaves the function, the ScopeExit runs, the spinner goes away.

[click]
So why is this so nice?
Sequential: you read it top to bottom, and that's exactly the order it runs in.
RAII: the ScopeExit cleans up on every path. Success, cancel, exception. There's no line to forget.
Main-affine: every line runs on Main. So we can touch the UI and the plugin state without a single lock.
And structured: every child finishes before its parent continues. Nothing escapes, nothing is left dangling.
(beat) Everything the callbacks took away from us: it's back.
(beat) But… hmm.
-->

---

# The plugin boundary

<div class="code-compare root-task-problem">
<div>

<div class="eyebrow">Inside the coroutine tree</div>

```cpp
MainActorTask<void> loadPreset(...) {
    auto instrument = co_await starts_on(workers, prepareInstrument(...));
    auto samples = co_await starts_on(workers, loadSamples(...));
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

<div v-click="5" class="scope-bridge">
  <strong>Needed: a scope</strong>
  <span>starts it · owns it · waits for it at the end</span>
</div>

<!--
Okay. One tiny question.
Inside the coroutine tree, everything is beautifully owned by the parent.
But it has to start somewhere. The user clicks in our editor, and the editor calls onLoadPreset(). A plain function, no coroutine. And there we call loadPreset().

[click]
And that does… nothing. The task is lazy. It's created, and thrown away.

[click]
There's no parent. Nobody co_awaits it.

[click]
Nobody owns it.

[click]
It never even starts.

[click]
So we need an owner for tasks that have no parent. That's a scope.
A scope starts the task, owns it, and at the end it waits for it. Like a parent, but for the top level.
std::execution has the building block for that: counting_scope. My root_scope is a small layer on top of it.
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
One way out: cross the boundary only once.

[click]
In the constructor, we spawn one coroutine: run(). It's like main(), but for the plugin. That's the only spawn.

[click]
The callback doesn't start anything. It just reports: here's a preset. It sends it into a channel.

[click]
run() waits on that channel.

[click]
And then it loads the preset. If the user clicks again in the meantime, the next preset waits in the channel. B runs after A.

[click]
In the destructor: one close_and_wait().
(beat) But maybe I don't want B after A. If the user clicks again, the latest click should win. So I need to stop A.
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
The other way: one task per request. Same callback as before. We just give the task a home.

[click]
One scope: the root_scope.

[click]
In the callback, we spawn. Spawn starts the task, and the scope owns it. We keep a handle.

[click]
onLoadPreset returns at once. But the task isn't detached. The destructor waits for it. A bit like a jthread.

[click]
And if the user clicks again? Close the old one first, then spawn the new one. Latest wins.
So: every task has an owner. Inside the tree, that's the parent. At the boundary, it's the scope.
-->

---

# Cancellation

<div class="code-compare cancellation-exit-code">
<div>

```cpp {all|9|2-4|1}{at:2}
MainActorTask<void> loadPreset(...) {
    ScopeExit finish([&] {
        app.setLoading(false);
    });

    auto samples = co_await starts_on(workers,
        loadSamples(...));

    sampler.installSamples(std::move(samples));
}
```

</div>
<div>

```cpp {all|4-5}{at:1}
Task<Samples> loadSamples(...) {
    auto stop = co_await read_env(get_stop_token);
    for (auto& file : files) {
        if (stop.stop_requested())
            co_await just_stopped();
        samples.add(readFile(file));
    }
    co_return samples;
}
```

</div>
</div>

<div class="cancellation-exit-flow">
  <span v-click="1"><code>loadSamples</code>: stopped</span>
  <b v-click="2">→</b>
  <span v-click="2">rest never runs</span>
  <b v-click="3">→</b>
  <span v-click="3">unwinds like an exception · without one</span>
  <b v-click="4">→</b>
  <span v-click="4">caller: stopped too</span>
</div>

<!--
But what does close() actually do? It's a request. It can't just kill the coroutine.
It asks the coroutines to stop. And they have to cooperate.

[click]
loadSamples checks before every file. When stop is requested, it ends with co_await just_stopped(). Not with a value, not with an error. And not with a throw.

[click]
And then our coroutine is never resumed. The rest never runs. No install.

[click]
Instead, the frame unwinds right there, at that co_await. Like an exception. But there is no exception.
The locals are destroyed, the ScopeExit runs. Spinner off. Plain RAII. And it all happens on Main.

[click]
And whoever awaits loadPreset gets "stopped" as well, and unwinds the same way. Up the chain, until the scope.
So, to sum up: close() is a request. A wait that sees it ends with "stopped". And then the frame unwinds, and RAII cleans up. On Main.
-->

---
clicks: 4
---

# Actor reentrancy

<div class="reentrancy-layout">
<div class="reentrancy-code">

<div class="owned-code">

```cpp {all|all|3|all}
app.setLoading(true);
ScopeExit finish([&] {
    app.setLoading(false);
});
```

<span v-click="2" class="owner-tag shared">app's flag · not A's</span>
</div>

<div v-click="3" class="owned-code">

```cpp
auto busy = app.beginLoading();
```

<span class="owner-tag own">busy · in A's frame</span>
</div>

<div v-click="3">

```cpp
Busy App::beginLoading() { ++count; return {this}; }
Busy::~Busy()            { --app->count; }
bool App::isLoading()    { return count > 0; }
```

</div>
</div>

<ThreadTimeline class="compact" name="reentrancy" :step="$clicks" />

</div>

<!--
Spinner off. (beat) But wait. With latest wins, two loads can run at the same time.
I click preset A. It hops to a worker. Spinner on.

[click]
Then I click B. A gets close(). And we just saw: that's only a request. A is still loading while B already runs.

[click]
Then A sees the stop and unwinds. On Main. Its ScopeExit does its job: loading false. But B is still loading. (beat)
The ScopeExit isn't wrong. The flag just isn't A's. It's the app's.
Main still runs one thing at a time. No data races. But at every co_await, someone else can get a turn. Swift calls this actor reentrancy.

[click]
So each load takes its own share. beginLoading() counts up. busy's destructor counts down. Only its own.

[click]
A starts: one. B starts: two. A unwinds: one. Spinner stays on. B is done: zero.
Same RAII. It just gives back exactly what it took.
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


<!--
So there are two ways to stop.

[click]
During normal use, we stop one operation: loading.close().

[click]
That requests stop for this one task, and returns immediately. It doesn't wait. Everything else keeps running.

[click]
Now the other one. The plugin is going away: root.close_and_wait().
Then we have to make sure that nothing will ever call into our plugin again. All our work on the worker threads is joined, and nothing is left half done.

[click]
It requests stop for everything, and waits right there, until every task has unwound.
(beat) But our tasks resume on Main. And Main is stuck in this destructor. So how do they ever finish? Let's look inside.
-->

---
clicks: 4
---

# Inside <code>close_and_wait()</code>

<CallStacks scenario="teardown" :step="$clicks" :slots="7" code-size="0.6rem" />

<!--
Let's look inside. The host destroys the plugin, and a preset is still loading on the worker.
Here's close_and_wait(), simplified.

[click]
It requests stop. And then it doesn't just block. It runs a small event loop of its own: drain Main's queue, then sleep until someone posts something.
Right now the queue is empty. So Main sleeps. In the destructor.

[click]
loadSamples on the worker sees the stop between two files. It ends with just_stopped(). That "stopped" is posted into Main's queue. And that wakes Main up.

[click]
Now drain() picks it up. loadPreset is never resumed. Its frame is destroyed, busy gives back its share, the spinner goes off.
And look where this happens: on top of ~Plugin(). (pause)

[click]
Now everything is joined. The loop ends, and the destructor returns to the host.
So, to sum up: close_and_wait() asks everything to stop, and then drains Main's queue right there in the destructor, until every task has unwound. When it returns, nothing of ours is left running.
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
Before stdexec, I used two other libraries. I shipped both, and I liked both.

[click]
Boost.Cobalt. Coroutines on top of Boost.Asio. Races, scopes, cancellation. Really nice, and it's in production.

[click]
But it's single-threaded by design. Hopping between workers and Main is not what it's built for.

[click]
Then libcoro. A small toolbox: tasks, thread pools, awaitables. Also in production.

[click]
That was my first favourite. It's small enough that you can actually read the code.
(beat) But neither of them knew about the host's thread. That part I always wrote myself.
(only if asked: Folly? Too big for us, and the Windows build.)
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
So why did I end up with stdexec? I wanted to build on what C++26 chose.

[click]
And it won. The senders and receivers proposal, P2300, was voted into C++26. It's std::execution now.

[click]
stdexec is the reference implementation. Senders, schedulers, stop tokens.

[click]
On top of that, my part. It's small: a scheduler for the main thread, with the drain we just saw.

[click]
And stdexec::task gives us the affinity for free. It always comes back to the scheduler it started on.

[click]
The piping is great. But the way I see it: I write as few lines of pipes as possible. I build the single pieces as senders, when I need them. Everything else is a coroutine.
-->

---

# About readability

<div class="code-compare readability-compare">
<div>

```cpp
void loadPreset(Preset preset) {
    app.setLoading(true);
    prepareInstrumentAsync(preset, [&](auto instrument) {
        sampler.installInstrument(instrument);
        keySwitches.load(preset);
        askUserToLocateSamples([&](auto location) {
            if (!location) {
                app.setLoading(false);
                return;
            }
            loadSamplesAsync(*location, [&](auto samples) {
                sampler.installSamples(samples);
                app.notifyPresetLoaded();
                app.setLoading(false);
            });
        });
    });
}
```

<div class="readability-verdicts">
  <span v-click="1" class="ok">✓ works</span>
  <span v-click="2" class="hard">hard to verify</span>
</div>

</div>
<div>

```cpp
MainActorTask<void> loadPreset(Preset preset) {
    app.setLoading(true);
    ScopeExit finish([&] { app.setLoading(false); });

    auto instrument = co_await starts_on(workers, prepareInstrument(preset));
    sampler.installInstrument(instrument);
    keySwitches.load(preset);

    auto location = co_await askUserToLocateSamples();
    if (!location)
        co_return;

    auto samples = co_await starts_on(workers, loadSamples(*location));
    sampler.installSamples(samples);
    app.notifyPresetLoaded();
}
```

<div class="readability-verdicts">
  <span v-click="1" class="ok">✓ works</span>
  <span v-click="2" class="ok">reads like the intent</span>
</div>

</div>
</div>

<!--
One last thing: readability.
These days, reading code matters more than ever. More and more code, we didn't type ourselves. But we still have to understand it.

[click]
And let's be honest. An agent can write the left one. Even bug-free. Both of these work.

[click]
But try to verify the left one. The meaning is hidden in the callback chain. Is the spinner turned off on every path? You have to follow every lambda to find out.
On the right, I read it top to bottom, and I can check it. And that's good for agents too: a readable workflow is easier for them to get right, and easier for us to check.
-->

---

# QA, after the coroutines

<div class="chat-stack">
  <ChatMessage v-click from="QA">WHAT THE HELL?!</ChatMessage>
  <ChatMessage v-click from="Developer">What is it now? 😓</ChatMessage>
  <ChatMessage v-click from="QA">It works. And loading my template is 3× faster.</ChatMessage>
  <ChatMessage v-click from="Developer">😌</ChatMessage>
</div>

<!--
And then, one more message from QA. Unasked, this time.

[click]
(read it out) What the hell?! (beat)

[click]
(nervous) What is it now?

[click]
(read it out) It works. And loading my template is three times faster.
(pause, let it land)

[click]
(relieved, just breathe out)
-->

---

# Questions?

<div class="code-compare">
<div>

```cpp
MainActorTask<void> loadPreset(Preset preset) {
    app.setLoading(true);
    ScopeExit finish([&] { app.setLoading(false); });

    auto instrument = co_await starts_on(workers,
        prepareInstrument(preset));
    sampler.installInstrument(instrument);

    auto location = co_await askUserToLocateSamples();
    if (!location)
        co_return;

    auto samples = co_await starts_on(workers, loadSamples(*location));
    sampler.installSamples(samples);
}
```

</div>
<div>

<div class="eyebrow">GitHub</div>

- [konradglas/adc-coroutines-demo](https://github.com/konradglas/adc-coroutines-demo)
- [konradglas/stdexec-affine](https://github.com/konradglas/stdexec-affine)
- [NVIDIA/stdexec](https://github.com/NVIDIA/stdexec)

</div>
</div>

<!--
So this is where we ended up. It's the function we started with: the synchronous one. Same order. RAII is back. The early return is correct again.
But it doesn't block, and it knows where it runs.
(beat) Thank you! The demo and the library are on GitHub. Questions?
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

| In this talk                  | On stdexec                                       |
| ----------------------------- | ------------------------------------------------ |
| `affine::create_root_scope()` | `stdexec::counting_scope root;`                  |
| `affine::spawn(task, root)`   | `spawn(loop, task, root.get_token())`            |
| `loading.close()`             | `loading->request_stop()`                        |
| `root.close_and_wait()`       | `root.request_stop();` `sync_wait(root.join());` |

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

auto instrument = co_await starts_on(workers,
    prepareInstrument(preset, mixer));

sampler.installInstrument(std::move(instrument));
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

auto instrument = co_await starts_on(workers,
    prepareInstrument(preset, mixer));

{
    ScopedLock lock(stateMutex);
    sampler.installInstrument(std::move(instrument));
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
    auto instrument = co_await starts_on(workers, prepareInstrument(...));
}
```

<div class="coroutine-keywords type-overview">
  <div v-click="1"><h3>Return object</h3><p>The <code>stdexec::task</code> object handed to the caller. It represents this coroutine.</p></div>
  <div v-click="2"><h3>Promise type</h3><p><code>stdexec::task::promise_type</code>: compiler-facing state stored inside the coroutine frame.</p></div>
  <div v-click="3"><h3>Awaitable</h3><p><code>prepareInstrument(...)</code> returns one. It defines the suspension point: whether execution pauses, what runs next, and what value the coroutine receives when it continues.</p></div>
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
Task<void> prepareInstrument(...) {
    co_await ScheduleOn{workers};

    buildExpensiveInstrument(preset, mixer);
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
    <small>The compiler calls it inside resumed <code>prepareInstrument()</code>; then building begins.</small>
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
Task<void> prepareInstrument(...) {
    co_await ScheduleOn{workers};

    // continues on a worker
    buildExpensiveInstrument(preset, mixer);
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
  <div v-click="3"><h3><code>continuation.resume()</code></h3><p>A worker runs the job and resumes <code>prepareInstrument()</code> there.</p></div>
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
    <div v-click="2" class="lane-step"><code>prepareInstrument()</code><span>build expensive instrument</span></div>
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

[click] worker builds the instrument · fine so far

[click] install() on the worker · Main paints the sampler → race

[click] scope ends on the worker → finish runs there · setLoading(false) off main · no line shows it

[click] frame destroyed on the worker
-->
