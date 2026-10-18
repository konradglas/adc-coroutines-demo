// Call stack walkthroughs for <CallStacks>.
// Frames are listed innermost first, like a debugger. Prefix a frame with
// "kind|" to style it: wait, block, loop, executor, resume, body, call.

export type FrameKind = 'wait' | 'block' | 'loop' | 'executor' | 'resume' | 'body' | 'call'

export interface CoroutineFrame {
  name: string
  state: 'created' | 'running' | 'suspended' | 'done'
  note?: string
  locals?: string[]
}

export interface CallStackStep {
  line?: number
  caption: string
  threads: Record<string, string[]>
  status?: Record<string, string>
  heap: CoroutineFrame[]
}

export interface CallStackScenario {
  code: string[]
  threads: [string] | [string, string]
  heapEmpty?: string
  steps: CallStackStep[]
}

const mainIdle = ['wait|waitForEvents()', 'loop|NativeEventLoop::run()', 'loop|main()']
const mainLoop = ['loop|NativeEventLoop::dispatch()', 'loop|NativeEventLoop::run()', 'loop|main()']
const workerIdle = ['wait|queue.waitForWork()', 'executor|ThreadPool::run()', 'loop|thread_start()']
const workerLoop = ['executor|ThreadPool::run()', 'loop|thread_start()']

export const scenarios: Record<string, CallStackScenario> = {
  blocking: {
    threads: ['Main', 'Worker'],
    heapEmpty: 'none: every local lives on Main’s stack',
    code: [
      'void loadPreset(Preset preset) {',
      '  app.setLoading(true);',
      '  auto tree = workers.submit([&] {',
      '    return buildSamplerTree(preset);',
      '  }).get();',
      '  sampler.install(tree);',
      '  app.setLoading(false);',
      '}',
    ],
    steps: [
      {
        caption: 'Two threads, both idle in their loops.',
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [],
      },
      {
        line: 2,
        caption: 'A click calls loadPreset() on Main.',
        threads: {
          Main: ['call|loadPreset()', 'call|onLoadClicked()', ...mainLoop],
          Worker: workerIdle,
        },
        heap: [],
      },
      {
        line: 5,
        caption: 'The worker builds the tree. Main is parked in get(): no events, no painting.',
        threads: {
          Main: ['block|future::wait()', 'call|loadPreset()', 'call|onLoadClicked()', ...mainLoop],
          Worker: ['call|buildSamplerTree()', 'call|lambda()', ...workerLoop],
        },
        heap: [],
      },
      {
        line: 6,
        caption: 'Only when the worker is done does Main get its stack back.',
        threads: {
          Main: ['call|loadPreset()', 'call|onLoadClicked()', ...mainLoop],
          Worker: workerIdle,
        },
        heap: [],
      },
    ],
  },

  coroutine: {
    threads: ['Main', 'Worker'],
    code: [
      'task<void> loadPreset(Preset preset) {',
      '  app.setLoading(true);',
      '  co_await resumeOn(workers);',
      '  auto tree = buildSamplerTree(preset);',
      '  co_await resumeOn(mainThread);',
      '  sampler.install(tree);',
      '  app.setLoading(false);',
      '}',
    ],
    steps: [
      {
        caption: 'Two threads, both idle in their loops.',
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [],
      },
      {
        caption: 'A click spawns loadPreset(). The frame is created, nothing runs yet.',
        threads: {
          Main: ['call|scope.spawn(loadPreset(preset))', 'call|onLoadClicked()', ...mainLoop],
          Worker: workerIdle,
        },
        heap: [{ name: 'loadPreset', state: 'created', note: 'queued on Main', locals: ['preset'] }],
      },
      {
        line: 2,
        caption: 'Main’s executor resumes it. The body is just a call under resume().',
        threads: {
          Main: ['body|loadPreset() (resume)', 'resume|handle.resume()', 'executor|MainExecutor::drain()', ...mainLoop],
          Worker: workerIdle,
        },
        heap: [{ name: 'loadPreset', state: 'running', note: 'on Main', locals: ['preset'] }],
      },
      {
        line: 3,
        caption: 'co_await: await_suspend() hands the handle to the worker queue…',
        threads: {
          Main: [
            'call|ResumeOn::await_suspend()',
            'body|loadPreset() (resume)',
            'resume|handle.resume()',
            'executor|MainExecutor::drain()',
            ...mainLoop,
          ],
          Worker: workerIdle,
        },
        heap: [{ name: 'loadPreset', state: 'suspended', note: 'at line 3', locals: ['preset'] }],
      },
      {
        line: 3,
        caption: '…and returns. So does resume(). Main is back in its loop.',
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [{ name: 'loadPreset', state: 'suspended', note: 'in worker queue', locals: ['preset'] }],
      },
      {
        line: 4,
        caption: 'The worker picks it up. Same frame, different stack. Main is free to paint.',
        threads: {
          Main: ['call|Editor::paint()', ...mainLoop],
          Worker: ['call|buildSamplerTree()', 'body|loadPreset() (resume)', 'resume|handle.resume()', ...workerLoop],
        },
        status: { Main: 'free · painting' },
        heap: [{ name: 'loadPreset', state: 'running', note: 'on Worker', locals: ['preset'] }],
      },
      {
        line: 5,
        caption: 'co_await again: the handle is posted to Main, and the worker goes back to waiting.',
        threads: {
          Main: mainIdle,
          Worker: workerIdle,
        },
        heap: [{ name: 'loadPreset', state: 'suspended', note: 'in Main queue', locals: ['preset', 'tree'] }],
      },
      {
        line: 6,
        caption: 'Main’s loop drains its queue and resumes the frame.',
        threads: {
          Main: ['body|loadPreset() (resume)', 'resume|handle.resume()', 'executor|MainExecutor::drain()', ...mainLoop],
          Worker: workerIdle,
        },
        heap: [{ name: 'loadPreset', state: 'running', note: 'on Main', locals: ['preset', 'tree'] }],
      },
      {
        caption: 'Done. The frame is destroyed. Neither thread ever waited for the other.',
        threads: { Main: mainIdle, Worker: workerIdle },
        heap: [{ name: 'loadPreset', state: 'done', note: 'destroyed' }],
      },
    ],
  },

  event: {
    threads: ['Host thread'],
    code: [
      'task<void> createSomeProcessor() {',
      '  for (;;) {',
      '    auto [rate, layout] = co_await when_all(',
      '        _sampleRate.value(), _channelLayout.value());',
      '    createProcessor(rate, layout);',
      '    co_await when_any(_sampleRate.changed(),',
      '                      _channelLayout.changed());',
      '  }',
      '}',
    ],
    steps: [
      {
        line: 3,
        caption: 'Started while the plugin initialises. Neither value is known yet, so it suspends right away.',
        threads: {
          'Host thread': [
            'body|createSomeProcessor() (resume)',
            'resume|handle.resume()',
            'call|scope.spawn(createSomeProcessor())',
            'call|Plugin::initialise()',
            'loop|Host::loadPlugin()',
            'loop|Host::run()',
          ],
        },
        heap: [{ name: 'createSomeProcessor', state: 'suspended', note: 'waiting for both values' }],
      },
      {
        caption: 'Back to the host. No executor, no queue: just a frame waiting for a value.',
        threads: { 'Host thread': ['wait|Host::waitForEvents()', 'loop|Host::run()'] },
        heap: [{ name: 'createSomeProcessor', state: 'suspended', note: 'waiting for both values' }],
      },
      {
        caption: 'The host sets the channel layout. when_all still needs the sample rate, so setValue() just returns.',
        threads: {
          'Host thread': [
            'call|AwaitableValue::setValue()',
            'call|Plugin::setChannelLayout()',
            'loop|Host::configureBuses()',
            'loop|Host::run()',
          ],
        },
        heap: [{ name: 'createSomeProcessor', state: 'suspended', note: 'waiting for sample rate', locals: ['layout'] }],
      },
      {
        line: 5,
        caption: 'The sample rate completes when_all. setValue() resumes the frame inline, on the host’s thread, inside its callback.',
        threads: {
          'Host thread': [
            'call|createProcessor()',
            'body|createSomeProcessor() (resume)',
            'resume|handle.resume()',
            'call|AwaitableValue::setValue()',
            'call|Plugin::setSampleRate()',
            'loop|Host::prepareToPlay()',
            'loop|Host::run()',
          ],
        },
        heap: [{ name: 'createSomeProcessor', state: 'running', note: 'inside setSampleRate()', locals: ['rate', 'layout'] }],
      },
      {
        line: 6,
        caption: 'Next co_await: the frame parks, setValue() returns, and the host’s callback finishes.',
        threads: { 'Host thread': ['wait|Host::waitForEvents()', 'loop|Host::run()'] },
        heap: [{ name: 'createSomeProcessor', state: 'suspended', note: 'waiting for a change' }],
      },
    ],
  },

  polled: {
    threads: ['Audio thread', 'Worker'],
    code: [
      'task<void> swapImpulseResponse(File file) {',
      '  co_await resumeOn(workers);',
      '  auto ir = loadAndResample(file);',
      '  co_await resumeOn(audioThread);',
      '  convolver.swap(ir);',
      '}',
    ],
    steps: [
      {
        line: 3,
        caption: 'The heavy part runs on a worker. The audio thread keeps rendering blocks.',
        threads: {
          'Audio thread': ['call|Convolver::process()', 'call|Plugin::processBlock()', 'loop|Host::audioCallback()', 'loop|AudioDriver::run()'],
          Worker: ['call|loadAndResample()', 'body|swapImpulseResponse() (resume)', 'resume|handle.resume()', ...workerLoop],
        },
        status: { 'Audio thread': 'rendering' },
        heap: [{ name: 'swapImpulseResponse', state: 'running', note: 'on Worker', locals: ['file'] }],
      },
      {
        line: 4,
        caption: 'co_await pushes the handle into the audio executor’s queue. Nobody gets woken up.',
        threads: {
          'Audio thread': ['wait|waitForNextBlock()', 'loop|AudioDriver::run()'],
          Worker: workerIdle,
        },
        status: { 'Audio thread': 'between blocks' },
        heap: [{ name: 'swapImpulseResponse', state: 'suspended', note: 'in audio queue', locals: ['ir'] }],
      },
      {
        line: 5,
        caption: 'The next block arrives. processBlock() polls the queue first and resumes the frame.',
        threads: {
          'Audio thread': [
            'body|swapImpulseResponse() (resume)',
            'resume|handle.resume()',
            'executor|AudioExecutor::runPending()',
            'call|Plugin::processBlock()',
            'loop|Host::audioCallback()',
            'loop|AudioDriver::run()',
          ],
          Worker: workerIdle,
        },
        heap: [{ name: 'swapImpulseResponse', state: 'running', note: 'on Audio thread', locals: ['ir'] }],
      },
      {
        caption: 'Then it renders with the new IR. The catch: everything resumed here must be real-time safe.',
        threads: {
          'Audio thread': ['call|Convolver::process()', 'call|Plugin::processBlock()', 'loop|Host::audioCallback()', 'loop|AudioDriver::run()'],
          Worker: workerIdle,
        },
        status: { 'Audio thread': 'rendering' },
        heap: [{ name: 'swapImpulseResponse', state: 'done', note: 'destroyed' }],
      },
    ],
  },
}
