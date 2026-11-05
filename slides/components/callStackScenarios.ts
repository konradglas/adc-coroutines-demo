// Call stack walkthroughs for <CallStacks>.
// Frames are listed innermost first, like a debugger. Prefix a frame with
// "kind|" to style it: wait, block, loop, executor, resume, body, call.

export type FrameKind =
  | "wait"
  | "block"
  | "loop"
  | "executor"
  | "resume"
  | "body"
  | "call";

export interface CoroutineFrame {
  name: string;
  state: "created" | "running" | "suspended" | "done";
  note?: string;
  locals?: string[];
}

export interface CallStackStep {
  line?: number | number[];
  caption: string;
  // Short on-screen text; the full caption then lives in the slide notes.
  label?: string;
  threads: Record<string, string[]>;
  status?: Record<string, string>;
  heap: CoroutineFrame[];
}

export interface CallStackScenario {
  code: string[];
  threads: [string] | [string, string];
  heapEmpty?: string;
  hideHeap?: boolean;
  steps: CallStackStep[];
}

const mainIdle = [
  "wait|waitForEvents()",
  "loop|NativeEventLoop::run()",
  "loop|main()",
];
const mainLoop = [
  "loop|NativeEventLoop::dispatch()",
  "loop|NativeEventLoop::run()",
  "loop|main()",
];
const workerIdle = [
  "wait|queue.waitForWork()",
  "executor|ThreadPool::run()",
  "loop|thread_start()",
];
const workerLoop = ["executor|ThreadPool::run()", "loop|thread_start()"];

export const scenarios: Record<string, CallStackScenario> = {
  blocking: {
    threads: ["Main"],
    hideHeap: true,
    code: [
      "void loadPreset(Preset preset) {",
      "  app.setLoading(true);",
      "  auto instrument = buildInstrument(preset);",
      "  sampler.install(instrument);",
      "  app.setLoading(false);",
      "}",
    ],
    steps: [
      {
        label: "Main idle in its loop",
        caption: "Main waits for events in its loop.",
        threads: { Main: mainIdle },
        heap: [],
      },
      {
        line: 2,
        label: "Click → loadPreset()",
        caption: "A click calls loadPreset() on Main.",
        threads: {
          Main: ["call|loadPreset()", "call|onLoadClicked()", ...mainLoop],
        },
        heap: [],
      },
      {
        line: 3,
        label: "Main builds the instrument itself",
        caption: "Main runs buildInstrument() itself: no events, no painting.",
        threads: {
          Main: [
            "call|buildInstrument()",
            "call|loadPreset()",
            "call|onLoadClicked()",
            ...mainLoop,
          ],
        },
        heap: [],
      },
      {
        line: 4,
        label: "Main gets its stack back",
        caption: "Only when the instrument is built does Main get its stack back.",
        threads: {
          Main: ["call|loadPreset()", "call|onLoadClicked()", ...mainLoop],
        },
        heap: [],
      },
    ],
  },

  coroutine: {
    threads: ["Main", "Worker"],
    code: [
      "task<void> loadPreset(Preset preset) {",
      "  app.setLoading(true);",
      "  co_await resumeOn(workers);",
      "  auto instrument = buildInstrument(preset);",
      "  co_await resumeOn(mainThread);",
      "  sampler.install(instrument);",
      "  app.setLoading(false);",
      "}",
    ],
    steps: [
      {
        label: "Two idle loops",
        caption: "Two threads, both idle in their loops.",
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [],
      },
      {
        line: 2,
        label: "Click → loadPreset(), like before",
        caption:
          "The click starts it inline: until the first co_await, the stack is the same as the synchronous version.",
        threads: {
          Main: [
            "body|loadPreset()",
            "call|onLoadClicked()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [
          {
            name: "loadPreset",
            state: "running",
            note: "on Main",
            locals: ["preset"],
          },
        ],
      },
      {
        line: 3,
        label: "The awaitable picks the queue",
        caption:
          "The awaitable decides where to continue: await_suspend() hands the handle to the worker queue…",
        threads: {
          Main: [
            "call|ResumeOn::await_suspend()",
            "body|loadPreset()",
            "call|onLoadClicked()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [
          {
            name: "loadPreset",
            state: "suspended",
            note: "at line 3",
            locals: ["preset"],
          },
        ],
      },
      {
        line: 3,
        label: "Main is back in its loop",
        caption: "…and returns. loadPreset() returns to onLoadClicked(). Main is back in its loop.",
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [
          {
            name: "loadPreset",
            state: "suspended",
            note: "in worker queue",
            locals: ["preset"],
          },
        ],
      },
      {
        line: 4,
        label: "Same frame, different stack",
        caption:
          "The worker picks it up. Same frame, different stack. Main is free to paint.",
        threads: {
          Main: ["call|Editor::paint()", ...mainLoop],
          Worker: [
            "call|buildInstrument()",
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Main: "free · painting" },
        heap: [
          {
            name: "loadPreset",
            state: "running",
            note: "on Worker",
            locals: ["preset"],
          },
        ],
      },
      {
        line: 5,
        label: "Posted back to Main",
        caption:
          "co_await again: the handle is posted to Main, and the worker goes back to waiting.",
        threads: {
          Main: mainIdle,
          Worker: workerIdle,
        },
        heap: [
          {
            name: "loadPreset",
            state: "suspended",
            note: "in Main queue",
            locals: ["preset", "instrument"],
          },
        ],
      },
      {
        line: 6,
        label: "Main resumes it",
        caption: "Main’s loop drains its queue and resumes the frame.",
        threads: {
          Main: [
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            "executor|MainExecutor::drain()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [
          {
            name: "loadPreset",
            state: "running",
            note: "on Main",
            locals: ["preset", "instrument"],
          },
        ],
      },
      {
        label: "Nobody waited",
        caption:
          "Done. The frame is destroyed. Neither thread ever waited for the other.",
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [{ name: "loadPreset", state: "done", note: "destroyed" }],
      },
    ],
  },

  callbacks: {
    threads: ["Main"],
    hideHeap: true,
    code: [
      "void enableInstrument() {",
      "  if (!_license || !_samples) return;",
      "  instrument.enable(*_license, *_samples);",
      "}",
      "void onLicenseActivated(License l) override {",
      "  _license = l; enableInstrument();",
      "}",
      "void onDownloadFinished(Samples s) override {",
      "  _samples = s; enableInstrument();",
      "}",
    ],
    steps: [
      {
        label: "Both arrive later, in any order",
        caption: "Async doesn’t mean “run on another thread”: the license and the sample download just arrive later, in any order.",
        threads: { Main: mainIdle },
        heap: [],
      },
      {
        line: 2,
        label: "License first → return",
        caption: "The license arrives first. enableInstrument() checks: no samples yet, return.",
        threads: {
          Main: [
            "call|enableInstrument()",
            "call|Plugin::onLicenseActivated()",
            "loop|LicenseClient::onReply()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
        },
        heap: [],
      },
      {
        line: 3,
        label: "Download finishes → enable",
        caption: "The download finishes. Both are there, so the instrument is enabled on Main, inside the callback.",
        threads: {
          Main: [
            "call|Instrument::enable()",
            "call|enableInstrument()",
            "call|Plugin::onDownloadFinished()",
            "loop|postedCallback()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
        },
        heap: [],
      },
      {
        label: "Spread over three functions",
        caption: "The decision is spread over three functions and two members. Nothing in the code says “wait for both, then enable”.",
        threads: { Main: mainIdle },
        heap: [],
      },
    ],
  },

  event: {
    threads: ["Main"],
    code: [
      "task<void> startInstrument() {",
      "  auto [license, samples] = co_await when_all(",
      "      _license.value(), _samples.value());",
      "  instrument.enable(license, samples);",
      "}",
      "void onLicenseActivated(License l) override {",
      "  _license.setValue(l);",
      "}",
      "void onDownloadFinished(Samples s) override {",
      "  _samples.setValue(s);",
      "}",
    ],
    steps: [
      {
        line: 2,
        label: "Started, suspended at once",
        caption: "Started inline on Main, like a plain call. Neither is there yet, so it suspends right away.",
        threads: {
          Main: [
            "body|startInstrument()",
            "call|onInstrumentSelected()",
            ...mainLoop,
          ],
        },
        heap: [{ name: "startInstrument", state: "suspended", note: "waiting for both" }],
      },
      {
        label: "Main keeps painting",
        caption: "Back to the host. No executor, no queue: just a frame waiting for two values. Main keeps painting.",
        threads: { Main: ["call|Editor::paint()", ...mainLoop] },
        status: { Main: "free · painting" },
        heap: [{ name: "startInstrument", state: "suspended", note: "waiting for both" }],
      },
      {
        line: 7,
        label: "License arrives → still waiting",
        caption: "The license arrives. when_all still needs the samples, so setValue() just returns.",
        threads: {
          Main: [
            "call|AwaitableValue::setValue()",
            "call|Plugin::onLicenseActivated()",
            "loop|LicenseClient::onReply()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
        },
        heap: [{ name: "startInstrument", state: "suspended", note: "waiting for the samples", locals: ["license"] }],
      },
      {
        line: [4, 10],
        label: "Download finishes → resumed inline",
        caption: "The download completes when_all. setValue() resumes the frame inline, on Main, inside the callback.",
        threads: {
          Main: [
            "body|startInstrument() (resume)",
            "resume|handle.resume()",
            "call|AwaitableValue::setValue()",
            "call|Plugin::onDownloadFinished()",
            "loop|postedCallback()",
            "loop|NativeEventLoop::run()",
          ],
        },
        heap: [{ name: "startInstrument", state: "running", note: "inside onDownloadFinished()", locals: ["license", "samples"] }],
      },
      {
        label: "One function, top to bottom",
        caption: "Enabled, done. The whole decision reads top to bottom, in one function.",
        threads: { Main: mainIdle },
        heap: [{ name: "startInstrument", state: "done", note: "finished" }],
      },
    ],
  },

  polled: {
    threads: ["Main", "Audio thread"],
    code: [
      "task<void> onKeyboardNote(int note) {",
      "  auto* audioBlock = co_await resumeOn(audioThread);",
      "  synth.noteOn(audioBlock, note);",
      "}",
    ],
    steps: [
      {
        line: 2,
        label: "Key click → co_await",
        caption:
          "A key on the on-screen keyboard is clicked. The coroutine starts inside mouseDown() and hits co_await.",
        threads: {
          Main: [
            "call|ResumeOn::await_suspend()",
            "body|onKeyboardNote()",
            "call|Keyboard::mouseDown()",
            ...mainLoop,
          ],
          "Audio thread": [
            "call|Synth::render()",
            "call|Plugin::processBlock()",
            "loop|Host::audioCallback()",
            "loop|AudioDriver::run()",
          ],
        },
        status: { "Audio thread": "rendering" },
        heap: [
          {
            name: "onKeyboardNote",
            state: "suspended",
            note: "in audio queue",
            locals: ["note"],
          },
        ],
      },
      {
        line: 2,
        label: "Waiting for the next block",
        caption:
          "mouseDown() returns right away. The handle waits in the audio queue, and nobody wakes the audio thread.",
        threads: {
          Main: ["call|Keyboard::paint()", ...mainLoop],
          "Audio thread": [
            "wait|waitForNextBlock()",
            "loop|AudioDriver::run()",
          ],
        },
        status: {
          Main: "free \u00b7 painting",
          "Audio thread": "between blocks",
        },
        heap: [
          {
            name: "onKeyboardNote",
            state: "suspended",
            note: "in audio queue",
            locals: ["note"],
          },
        ],
      },
      {
        line: 3,
        label: "The next block resumes it",
        caption:
          "The next block polls the queue first: processBlock() resumes the frame and co_await hands it that block.",
        threads: {
          Main: mainIdle,
          "Audio thread": [
            "body|onKeyboardNote() (resume)",
            "resume|handle.resume()",
            "executor|AudioExecutor::runPending()",
            "call|Plugin::processBlock()",
            "loop|Host::audioCallback()",
            "loop|AudioDriver::run()",
          ],
        },
        heap: [
          {
            name: "onKeyboardNote",
            state: "running",
            note: "on Audio thread",
            locals: ["note", "audioBlock"],
          },
        ],
      },
      {
        label: "Note plays in this block",
        caption: "The note plays in this very block. Conceptual: not real-time safe as written.",
        threads: {
          Main: mainIdle,
          "Audio thread": [
            "call|Synth::render()",
            "call|Plugin::processBlock()",
            "loop|Host::audioCallback()",
            "loop|AudioDriver::run()",
          ],
        },
        status: { "Audio thread": "rendering" },
        heap: [{ name: "onKeyboardNote", state: "done", note: "destroyed" }],
      },
    ],
  },

  forgotHop: {
    threads: ["Main", "Worker"],
    code: [
      "task<void> loadPreset(Preset preset) {",
      "  app.setLoading(true);",
      "  ScopeExit finish([&] { app.setLoading(false); });",
      "  co_await resumeOn(workers);",
      "  auto instrument = buildInstrument(preset);",
      "  sampler.install(instrument);",
      "}",
    ],
    steps: [
      {
        line: [2, 3],
        label: "Starts on Main",
        caption: "Main’s executor resumes it, like before. The cleanup is armed on Main.",
        threads: {
          Main: [
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            "executor|MainExecutor::drain()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [{ name: "loadPreset", state: "running", note: "on Main", locals: ["preset", "finish"] }],
      },
      {
        line: 5,
        label: "Worker builds the instrument",
        caption: "The hop to the worker works. Main is free.",
        threads: {
          Main: ["call|Editor::paint()", ...mainLoop],
          Worker: [
            "call|buildInstrument()",
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Main: "free · painting" },
        heap: [{ name: "loadPreset", state: "running", note: "on Worker", locals: ["preset", "finish"] }],
      },
      {
        line: 6,
        label: "Still on the worker",
        caption: "Nobody hops back. install() runs on the worker while Main paints the sampler.",
        threads: {
          Main: ["call|SamplerView::paint()", ...mainLoop],
          Worker: [
            "call|Sampler::install()",
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Main: "painting · reads sampler" },
        heap: [{ name: "loadPreset", state: "running", note: "on Worker", locals: ["preset", "finish", "instrument"] }],
      },
      {
        line: [3, 7],
        label: "Cleanup runs on the worker",
        caption: "The scope ends on the worker, so finish runs there: setLoading(false) off the main thread.",
        threads: {
          Main: ["call|Spinner::paint()", ...mainLoop],
          Worker: [
            "call|App::setLoading()",
            "call|ScopeExit::~ScopeExit()",
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Main: "painting · reads app" },
        heap: [{ name: "loadPreset", state: "running", note: "unwinding on Worker", locals: ["preset", "finish", "instrument"] }],
      },
      {
        label: "Finished on the worker",
        caption: "The frame is destroyed on the worker. It never came back.",
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [{ name: "loadPreset", state: "done", note: "destroyed on Worker" }],
      },
    ],
  },

  teardown: {
    threads: ["Main", "Worker"],
    code: [
      "void root_scope::close_and_wait() {",
      "  requestStop();",
      "  while (!joined) {",
      "    loop.drain();",
      "    loop.sleepUntilPosted();",
      "  }",
      "}",
      "",
      "MainActorTask<void> loadPreset(Preset preset) {",
      "  ScopeExit finish([&] { app.setLoading(false); });",
      "  auto samples = co_await starts_on(workers, loadSamples(preset));",
      "  sampler.installSamples(samples);",
      "}",
    ],
    steps: [
      {
        line: 1,
        label: "Host destroys the plugin",
        caption: "The host destroys the plugin while a preset is still loading on the worker.",
        threads: {
          Main: [
            "call|root.close_and_wait()",
            "call|Plugin::~Plugin()",
            "call|Host::destroyPlugin()",
            ...mainLoop,
          ],
          Worker: [
            "call|readSampleFiles()",
            "body|loadSamples() (resume)",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Worker: "loading samples" },
        heap: [
          { name: "loadPreset", state: "suspended", note: "awaits child", locals: ["preset", "finish"] },
          { name: "loadSamples", state: "running", note: "on Worker" },
        ],
      },
      {
        line: [2, 5],
        label: "Stop, then drain or sleep",
        caption: "close_and_wait() requests stop, then runs its own little loop: drain Main's queue, sleep until something is posted.",
        threads: {
          Main: [
            "wait|loop.sleepUntilPosted()",
            "call|root.close_and_wait()",
            "call|Plugin::~Plugin()",
            "call|Host::destroyPlugin()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
          Worker: [
            "call|readSampleFiles()",
            "body|loadSamples() (resume)",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Main: "in ~Plugin()", Worker: "loading samples" },
        heap: [
          { name: "loadPreset", state: "suspended", note: "stop requested", locals: ["preset", "finish"] },
          { name: "loadSamples", state: "running", note: "on Worker" },
        ],
      },
      {
        line: 11,
        label: "Child stops, posts \"stopped\" home",
        caption: "loadSamples sees the stop, ends with just_stopped(), and the stopped signal is posted onto Main's queue. That wakes Main.",
        threads: {
          Main: [
            "wait|loop.sleepUntilPosted()",
            "call|root.close_and_wait()",
            "call|Plugin::~Plugin()",
            "call|Host::destroyPlugin()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
          Worker: [
            "executor|MainThreadLoop::post()",
            "call|loadSamples(): just_stopped()",
            ...workerLoop,
          ],
        },
        status: { Main: "in ~Plugin()" },
        heap: [
          { name: "loadPreset", state: "suspended", note: "stopped · in Main queue", locals: ["preset", "finish"] },
          { name: "loadSamples", state: "done", note: "destroyed" },
        ],
      },
      {
        line: [4, 10],
        label: "drain() unwinds it on top of ~Plugin()",
        caption: "drain() delivers the stopped signal: loadPreset is never resumed, its frame is destroyed and ScopeExit turns the spinner off, all on top of the destructor.",
        threads: {
          Main: [
            "call|~ScopeExit() → setLoading(false)",
            "call|frame.destroy()",
            "body|loadPreset: set_stopped()",
            "executor|loop.drain()",
            "call|root.close_and_wait()",
            "call|Plugin::~Plugin()",
            "loop|Host::destroyPlugin()",
          ],
          Worker: workerIdle,
        },
        heap: [{ name: "loadPreset", state: "suspended", note: "never resumed → destroyed", locals: ["preset", "finish"] }],
      },
      {
        line: 3,
        label: "Joined, destructor returns",
        caption: "Every frame is gone, the loop ends, and the destructor returns to the host.",
        threads: {
          Main: [
            "call|Plugin::~Plugin()",
            "call|Host::destroyPlugin()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [{ name: "loadPreset", state: "done", note: "freed" }],
      },
    ],
  },

  affine: {
    threads: ["Main", "Worker"],
    code: [
      "MainActorTask<void> loadPreset(Preset preset) {",
      "  app.setLoading(true);",
      "  auto instrument = co_await starts_on(workers,",
      "      prepareInstrument(preset));",
      "  sampler.install(instrument);",
      "  app.setLoading(false);",
      "}",
    ],
    steps: [
      {
        line: 2,
        label: "Starts on Main",
        caption: "Same start as before.",
        threads: {
          Main: [
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            "executor|MainExecutor::drain()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [{ name: "loadPreset", state: "running", note: "on Main", locals: ["preset"] }],
      },
      {
        line: [3, 4],
        label: "starts_on: child → worker queue",
        caption: "starts_on puts the child, not started yet, into the worker's queue. The parent waits for it.",
        threads: {
          Main: [
            "call|workers.schedule()",
            "call|starts_on: start()",
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            "executor|MainExecutor::drain()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
          Worker: workerIdle,
        },
        heap: [
          { name: "loadPreset", state: "suspended", note: "awaits child", locals: ["preset"] },
          { name: "prepareInstrument", state: "suspended", note: "not started · in worker queue" },
        ],
      },
      {
        line: [3, 4],
        label: "Child runs on the worker",
        caption: "The child does the heavy work. Main is free.",
        threads: {
          Main: ["call|Editor::paint()", ...mainLoop],
          Worker: [
            "call|buildInstrument()",
            "body|prepareInstrument()",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Main: "free · painting" },
        heap: [
          { name: "loadPreset", state: "suspended", note: "awaits child", locals: ["preset"] },
          { name: "prepareInstrument", state: "running", note: "on Worker" },
        ],
      },
      {
        label: "The task posts itself home",
        caption: "The child is done. MainActorTask schedules the parent's continuation back onto Main.",
        threads: {
          Main: mainIdle,
          Worker: [
            "executor|MainExecutor::post()",
            "call|ResumeOnMain::await_suspend()",
            "call|prepareInstrument() done",
            ...workerLoop,
          ],
        },
        heap: [
          { name: "loadPreset", state: "suspended", note: "in Main queue", locals: ["preset", "instrument"] },
          { name: "prepareInstrument", state: "done", note: "destroyed" },
        ],
      },
      {
        line: 5,
        label: "Back on Main, by itself",
        caption: "Main drains its queue and resumes the parent. No resumeOn(mainThread) anywhere.",
        threads: {
          Main: [
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            "executor|MainExecutor::drain()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [{ name: "loadPreset", state: "running", note: "on Main", locals: ["preset", "instrument"] }],
      },
    ],
  },
};
