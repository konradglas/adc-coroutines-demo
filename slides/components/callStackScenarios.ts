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
    threads: ["Main", "Worker"],
    heapEmpty: "none: every local lives on Main’s stack",
    code: [
      "void loadPreset(Preset preset) {",
      "  app.setLoading(true);",
      "  auto tree = workers.submit([&] {",
      "    return buildSamplerTree(preset);",
      "  }).get();",
      "  sampler.install(tree);",
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
        label: "Click → loadPreset()",
        caption: "A click calls loadPreset() on Main.",
        threads: {
          Main: ["call|loadPreset()", "call|onLoadClicked()", ...mainLoop],
          Worker: workerIdle,
        },
        heap: [],
      },
      {
        line: 5,
        label: "Main is stuck in get()",
        caption:
          "The worker builds the tree. Main is parked in get(): no events, no painting.",
        threads: {
          Main: [
            "block|future::wait()",
            "call|loadPreset()",
            "call|onLoadClicked()",
            ...mainLoop,
          ],
          Worker: ["call|buildSamplerTree()", "call|lambda()", ...workerLoop],
        },
        heap: [],
      },
      {
        line: 6,
        label: "Main gets its stack back",
        caption: "Only when the worker is done does Main get its stack back.",
        threads: {
          Main: ["call|loadPreset()", "call|onLoadClicked()", ...mainLoop],
          Worker: workerIdle,
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
      "  auto tree = buildSamplerTree(preset);",
      "  co_await resumeOn(mainThread);",
      "  sampler.install(tree);",
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
        label: "Spawned, not started",
        caption:
          "A click spawns loadPreset(). The frame is created, nothing runs yet.",
        threads: {
          Main: [
            "call|scope.spawn(loadPreset(preset))",
            "call|onLoadClicked()",
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [
          {
            name: "loadPreset",
            state: "created",
            note: "queued on Main",
            locals: ["preset"],
          },
        ],
      },
      {
        line: 2,
        label: "Resumed by Main’s executor",
        caption:
          "Main’s executor resumes it. The body is just a call under resume().",
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
            state: "suspended",
            note: "at line 3",
            locals: ["preset"],
          },
        ],
      },
      {
        line: 3,
        label: "Main is back in its loop",
        caption: "…and returns. So does resume(). Main is back in its loop.",
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
            "call|buildSamplerTree()",
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
            locals: ["preset", "tree"],
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
            locals: ["preset", "tree"],
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
    heapEmpty: "none: _sampleRate and _channelLayout are members",
    code: [
      "void createSomeProcessor() {",
      "  if (!_sampleRate || !_channelLayout) return;",
      "  createProcessor(*_sampleRate, *_channelLayout);",
      "}",
      "void setChannelLayout(auto layout) override {",
      "  _channelLayout = layout; createSomeProcessor();",
      "}",
      "void setSampleRate(int rate) override {",
      "  _sampleRate = rate; createSomeProcessor();",
      "}",
    ],
    steps: [
      {
        label: "Values arrive later, in any order",
        caption: "Async doesn’t mean “run on another thread”: these two values just arrive later, in any order.",
        threads: { Main: mainIdle },
        heap: [],
      },
      {
        line: 2,
        label: "Layout first → return",
        caption:
          "The layout arrives first. createSomeProcessor() checks: no sample rate yet, return.",
        threads: {
          Main: [
            "call|createSomeProcessor()",
            "call|Plugin::setChannelLayout()",
            "loop|Host::configureBuses()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
        },
        heap: [],
      },
      {
        line: 3,
        label: "Rate arrives → create",
        caption:
          "The sample rate arrives. Both are there, so the processor is created on Main, inside the host’s callback.",
        threads: {
          Main: [
            "call|createProcessor()",
            "call|createSomeProcessor()",
            "call|Plugin::setSampleRate()",
            "loop|Host::prepareToPlay()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
        },
        heap: [],
      },
      {
        label: "Spread over three functions",
        caption:
          "The decision is spread over three functions and two members. Nothing in the code says “wait for both, then create”.",
        threads: { Main: mainIdle },
        heap: [],
      },
    ],
  },

  event: {
    threads: ["Main"],
    code: [
      "task<void> createSomeProcessor() {",
      "  for (;;) {",
      "    auto [rate, layout] = co_await when_all(",
      "        _sampleRate.value(), _channelLayout.value());",
      "    createProcessor(rate, layout);",
      "    co_await when_any(_sampleRate.changed(),",
      "                      _channelLayout.changed());",
      "  }",
      "}",
      "void setChannelLayout(auto layout) override {",
      "  _channelLayout.setValue(layout);",
      "}",
      "void setSampleRate(int rate) override {",
      "  _sampleRate.setValue(rate);",
      "}",
    ],
    steps: [
      {
        line: 3,
        label: "Started, suspended at once",
        caption:
          "Started while the plugin initialises. Neither value is known yet, so it suspends right away.",
        threads: {
          Main: [
            "body|createSomeProcessor() (resume)",
            "resume|handle.resume()",
            "call|scope.spawn(createSomeProcessor())",
            "loop|Host::loadPlugin()",
            "loop|NativeEventLoop::run()",
          ],
        },
        heap: [
          {
            name: "createSomeProcessor",
            state: "suspended",
            note: "waiting for both values",
          },
        ],
      },
      {
        label: "Main keeps painting",
        caption:
          "Back to the host. No executor, no queue: just a frame waiting for a value. Main keeps painting.",
        threads: { Main: ["call|Editor::paint()", ...mainLoop.slice(0, 2)] },
        status: { Main: "free · painting" },
        heap: [
          {
            name: "createSomeProcessor",
            state: "suspended",
            note: "waiting for both values",
          },
        ],
      },
      {
        label: "Layout set → still waiting",
        caption:
          "The host sets the channel layout. when_all still needs the sample rate, so setValue() just returns.",
        line: 11,
        threads: {
          Main: [
            "call|AwaitableValue::setValue()",
            "call|Plugin::setChannelLayout()",
            "loop|Host::configureBuses()",
            "loop|NativeEventLoop::run()",
          ],
        },
        heap: [
          {
            name: "createSomeProcessor",
            state: "suspended",
            note: "waiting for sample rate",
            locals: ["layout"],
          },
        ],
      },
      {
        line: [5, 14],
        label: "Rate set → resumed inline",
        caption:
          "The sample rate completes when_all. setValue() resumes the frame inline, on Main, inside the host’s callback.",
        threads: {
          Main: [
            "body|createSomeProcessor() (resume)",
            "resume|handle.resume()",
            "call|AwaitableValue::setValue()",
            "call|Plugin::setSampleRate()",
            "loop|Host::prepareToPlay()",
            "loop|NativeEventLoop::run()",
          ],
        },
        heap: [
          {
            name: "createSomeProcessor",
            state: "running",
            note: "inside setSampleRate()",
            locals: ["rate", "layout"],
          },
        ],
      },
      {
        line: 6,
        label: "One function, top to bottom",
        caption:
          "Next co_await: the frame parks and the callback returns. The whole decision reads top to bottom, in one function.",
        threads: { Main: mainIdle.slice(0, 2) },
        heap: [
          {
            name: "createSomeProcessor",
            state: "suspended",
            note: "waiting for a change",
          },
        ],
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
        label: "Note plays · stay real-time safe",
        caption:
          "The note plays in this very block. The catch: whatever resumes here must be real-time safe.",
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
};
