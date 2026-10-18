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
  threads: [string, string]
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
}
