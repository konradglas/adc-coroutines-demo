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
    heapEmpty: "none: _license and _library are members",
    code: [
      "void enableInstrument() {",
      "  if (!_license || !_library) return;",
      "  instrument.enable(*_license, *_library);",
      "}",
      "void onLicenseActivated(License l) override {",
      "  _license = l; enableInstrument();",
      "}",
      "void onLibraryIndexed(Library lib) override {",
      "  _library = lib; enableInstrument();",
      "}",
    ],
    steps: [
      {
        label: "Both arrive later, in any order",
        caption: "Async doesn’t mean “run on another thread”: the license and the indexed library just arrive later, in any order.",
        threads: { Main: mainIdle },
        heap: [],
      },
      {
        line: 2,
        label: "License first → return",
        caption: "The license arrives first. enableInstrument() checks: no library yet, return.",
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
        label: "Library arrives → enable",
        caption: "The indexed library arrives. Both are there, so the instrument is enabled on Main, inside the callback.",
        threads: {
          Main: [
            "call|Instrument::enable()",
            "call|enableInstrument()",
            "call|Plugin::onLibraryIndexed()",
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
      "  auto [license, library] = co_await when_all(",
      "      _license.value(), _library.value());",
      "  instrument.enable(license, library);",
      "}",
      "void onLicenseActivated(License l) override {",
      "  _license.setValue(l);",
      "}",
      "void onLibraryIndexed(Library lib) override {",
      "  _library.setValue(lib);",
      "}",
    ],
    steps: [
      {
        line: 2,
        label: "Started, suspended at once",
        caption: "Started on Main. Neither is there yet, so it suspends right away.",
        threads: {
          Main: [
            "body|startInstrument() (resume)",
            "resume|handle.resume()",
            "executor|MainExecutor::drain()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
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
        caption: "The license arrives. when_all still needs the library, so setValue() just returns.",
        threads: {
          Main: [
            "call|AwaitableValue::setValue()",
            "call|Plugin::onLicenseActivated()",
            "loop|LicenseClient::onReply()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
        },
        heap: [{ name: "startInstrument", state: "suspended", note: "waiting for the library", locals: ["license"] }],
      },
      {
        line: [4, 10],
        label: "Library arrives → resumed inline",
        caption: "The library completes when_all. setValue() resumes the frame inline, on Main, inside the callback.",
        threads: {
          Main: [
            "body|startInstrument() (resume)",
            "resume|handle.resume()",
            "call|AwaitableValue::setValue()",
            "call|Plugin::onLibraryIndexed()",
            "loop|postedCallback()",
            "loop|NativeEventLoop::run()",
          ],
        },
        heap: [{ name: "startInstrument", state: "running", note: "inside onLibraryIndexed()", locals: ["license", "library"] }],
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

  forgotHop: {
    threads: ["Main", "Worker"],
    code: [
      "task<void> loadPreset(Preset preset) {",
      "  app.setLoading(true);",
      "  ScopeExit finish([&] { app.setLoading(false); });",
      "  co_await resumeOn(workers);",
      "  auto tree = buildSamplerTree(preset);",
      "  sampler.install(tree);",
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
        label: "Worker builds the tree",
        caption: "The hop to the worker works. Main is free.",
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
        heap: [{ name: "loadPreset", state: "running", note: "on Worker", locals: ["preset", "finish", "tree"] }],
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
        heap: [{ name: "loadPreset", state: "running", note: "unwinding on Worker", locals: ["preset", "finish", "tree"] }],
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
      "Plugin::~Plugin() {",
      "  root.close_and_wait();",
      "}",
      "",
      "MainActorTask<void> loadPreset(Preset preset) {",
      "  ScopeExit finish([&] { app.setLoading(false); });",
      "  auto stop = co_await stdexec::read_env(stdexec::get_stop_token);",
      "  auto samples = co_await loadSamples(preset);",
      "  if (stop.stop_requested()) co_return;",
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
        line: 2,
        label: "Stop requested, Main waits",
        caption: "close_and_wait() requests stop and waits for the join, inside the destructor.",
        threads: {
          Main: [
            "wait|condition.wait()",
            "call|loop.sync_wait(root.join())",
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
        line: 8,
        label: "Child done, posts parent home",
        caption: "The child finishes and posts the parent's continuation onto Main's queue.",
        threads: {
          Main: [
            "wait|condition.wait()",
            "call|loop.sync_wait(root.join())",
            "call|root.close_and_wait()",
            "call|Plugin::~Plugin()",
            "call|Host::destroyPlugin()",
            "loop|NativeEventLoop::run()",
            "loop|main()",
          ],
          Worker: [
            "executor|MainThreadLoop::post()",
            "call|loadSamples() done",
            ...workerLoop,
          ],
        },
        status: { Main: "in ~Plugin()" },
        heap: [
          { name: "loadPreset", state: "suspended", note: "in Main queue", locals: ["preset", "finish", "samples"] },
          { name: "loadSamples", state: "done", note: "destroyed" },
        ],
      },
      {
        line: [9, 6],
        label: "Unwinds on top of ~Plugin()",
        caption: "The join runs the posted continuation: stop seen, co_return, ScopeExit turns the spinner off, all on top of the destructor.",
        threads: {
          Main: [
            "call|app.setLoading(false)",
            "body|loadPreset() (resume)",
            "resume|handle.resume()",
            "executor|MainThreadLoop::executeReady()",
            "call|loop.sync_wait(root.join())",
            "call|root.close_and_wait()",
            "call|Plugin::~Plugin()",
            "loop|Host::destroyPlugin()",
          ],
          Worker: workerIdle,
        },
        heap: [{ name: "loadPreset", state: "running", note: "co_return → ScopeExit", locals: ["preset", "finish", "samples"] }],
      },
      {
        line: 3,
        label: "Joined, destructor returns",
        caption: "Every frame is gone, the join completes, and the destructor returns to the host.",
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
      "  auto tree = co_await prepareSamplerTree(preset);",
      "  sampler.install(tree);",
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
        line: 3,
        label: "The child hops to the worker",
        caption: "prepareSamplerTree() runs its ScheduleOn{workers}. The parent waits for it.",
        threads: {
          Main: [
            "call|ScheduleOn::await_suspend()",
            "body|prepareSamplerTree()",
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
          { name: "prepareSamplerTree", state: "suspended", note: "in worker queue" },
        ],
      },
      {
        line: 3,
        label: "Child runs on the worker",
        caption: "The child does the heavy work. Main is free.",
        threads: {
          Main: ["call|Editor::paint()", ...mainLoop],
          Worker: [
            "call|buildSamplerTree()",
            "body|prepareSamplerTree() (resume)",
            "resume|handle.resume()",
            ...workerLoop,
          ],
        },
        status: { Main: "free · painting" },
        heap: [
          { name: "loadPreset", state: "suspended", note: "awaits child", locals: ["preset"] },
          { name: "prepareSamplerTree", state: "running", note: "on Worker" },
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
            "call|prepareSamplerTree() done",
            ...workerLoop,
          ],
        },
        heap: [
          { name: "loadPreset", state: "suspended", note: "in Main queue", locals: ["preset", "tree"] },
          { name: "prepareSamplerTree", state: "done", note: "destroyed" },
        ],
      },
      {
        line: 4,
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
        heap: [{ name: "loadPreset", state: "running", note: "on Main", locals: ["preset", "tree"] }],
      },
    ],
  },
};
