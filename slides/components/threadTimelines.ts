// Thread timelines for <ThreadTimeline>. Time runs downwards in abstract units.
// `at` is the click on which an item appears (default 0); `until` the click on which it
// disappears again.

// 'stopping' is an overlay: stop was requested, the work below still runs.
export type BlockKind = 'a' | 'b' | 'other' | 'blocked' | 'ok' | 'stopping'

export interface TimelineBlock {
  lane: string
  from: number
  to: number
  kind: BlockKind
  label?: string
  at?: number
  until?: number
}

export interface TimelineHop {
  from: [string, number]
  to: [string, number]
  kind: 'a' | 'b'
  at?: number
  until?: number
}

// A request from one block to another (e.g. close()), drawn straight and on top.
export interface TimelineSignal {
  from: [string, number]
  to: [string, number]
  label?: string
  at?: number
  until?: number
}

export interface TimelinePanel {
  title: string
  at?: number
  // Distance between lanes in SVG units (default 92).
  gap?: number
  lanes: string[]
  length: number
  blocks: TimelineBlock[]
  hops?: TimelineHop[]
  signals?: TimelineSignal[]
}

export interface Timeline {
  legend: Partial<Record<BlockKind, string>>
  captions: string[]
  // Short on-screen text per step; the captions then live in the slide notes.
  labels?: string[]
  panels: TimelinePanel[]
}

const audioBlocks = (at = 0) => [0.2, 1.2, 2.2, 3.2, 4.2, 5.2].map(from => ({
  lane: 'Audio', from, to: from + 0.4, kind: 'other' as const, label: 'render', at,
}))

export const timelines: Record<string, Timeline> = {
  loadPreset: {
    legend: { a: 'loadPreset', b: 'onKeyboardNote', other: 'other work', blocked: 'Main busy, nothing else runs' },
    labels: [
      'Blocking: Main is stuck',
      'Chunk 1 → hop to the worker',
      'Main is free',
      'A second coroutine → audio',
      'Back on Main · nobody waited',
    ],
    captions: [
      'Blocking: Main builds the instrument itself. Nothing else runs on it.',
      'Suspending: chunk 1 runs on Main, then the continuation hops to a worker…',
      '…and Main is free: it paints and handles the mouse while chunk 2 runs.',
      'A second coroutine starts on Main and hops to the audio thread, which picks it up at the next block.',
      'Chunk 3 of loadPreset comes back to Main. Two coroutines, three threads, nobody waited.',
    ],
    panels: [
      {
        title: 'Blocking',
        lanes: ['Main'],
        length: 6,
        blocks: [
          { lane: 'Main', from: 0, to: 1, kind: 'a', label: '1' },
          { lane: 'Main', from: 1, to: 4, kind: 'blocked', label: 'buildInstrument' },
          { lane: 'Main', from: 4, to: 5, kind: 'a', label: '3' },
          { lane: 'Main', from: 5.3, to: 5.8, kind: 'other', label: 'paint' },
        ],
      },
      {
        title: 'Suspending',
        lanes: ['Main', 'Worker', 'Audio'],
        length: 6,
        blocks: [
          ...audioBlocks(1).filter(b => b.from !== 3.2),
          { lane: 'Main', from: 0, to: 1, kind: 'a', label: '1', at: 1 },
          { lane: 'Worker', from: 1.1, to: 4, kind: 'a', label: '2', at: 2 },
          { lane: 'Main', from: 1.3, to: 1.8, kind: 'other', label: 'paint', at: 2 },
          { lane: 'Main', from: 2.0, to: 2.3, kind: 'other', label: 'mouse', at: 2 },
          { lane: 'Main', from: 2.5, to: 2.9, kind: 'b', label: '1', at: 3 },
          { lane: 'Audio', from: 3.2, to: 3.45, kind: 'b', label: '2', at: 3 },
          { lane: 'Audio', from: 3.45, to: 3.7, kind: 'other', at: 1 },
          { lane: 'Main', from: 3.2, to: 3.7, kind: 'other', label: 'paint', at: 3 },
          { lane: 'Main', from: 4.2, to: 5, kind: 'a', label: '3', at: 4 },
          { lane: 'Main', from: 5.3, to: 5.8, kind: 'other', label: 'paint', at: 4 },
        ],
        hops: [
          { from: ['Main', 1], to: ['Worker', 1.1], kind: 'a', at: 2 },
          { from: ['Main', 2.9], to: ['Audio', 3.2], kind: 'b', at: 3 },
          { from: ['Worker', 4], to: ['Main', 4.2], kind: 'a', at: 4 },
        ],
      },
    ],
  },
  reentrancy: {
    legend: { a: 'load A', b: 'load B', other: 'spinner on', blocked: 'spinner off' },
    labels: [
      'A loads',
      'B cancels A',
      'A unwinds · spinner off',
      'Each task: its own share',
      'Spinner stays on',
    ],
    captions: [],
    panels: [
      {
        title: 'Main is one actor',
        lanes: ['Main', 'Worker', 'Worker ', 'Spinner'],
        length: 6,
        blocks: [
          { lane: 'Main', from: 0, to: 0.6, kind: 'a', label: 'A' },
          { lane: 'Worker', from: 0.7, to: 2.6, kind: 'a', label: 'load' },
          { lane: 'Worker', from: 1.85, to: 2.6, kind: 'stopping', at: 1 },
          { lane: 'Main', from: 1.4, to: 2.0, kind: 'b', label: 'B', at: 1 },
          { lane: 'Worker ', from: 2.1, to: 5.2, kind: 'b', label: 'load', at: 1 },
          { lane: 'Main', from: 2.8, to: 3.3, kind: 'a', label: '~A', at: 2 },
          { lane: 'Main', from: 2.8, to: 3.3, kind: 'stopping', at: 2 },
          { lane: 'Main', from: 5.4, to: 5.9, kind: 'b', label: 'B', at: 1 },
          // setLoading(true/false): one flag
          { lane: 'Spinner', from: 0, to: 5.9, kind: 'other', label: 'on', until: 2 },
          { lane: 'Spinner', from: 0, to: 3.3, kind: 'other', label: 'on', at: 2, until: 4 },
          { lane: 'Spinner', from: 3.3, to: 5.9, kind: 'blocked', label: 'off', at: 2, until: 4 },
          // beginLoading(): a count
          { lane: 'Spinner', from: 0, to: 1.4, kind: 'ok', label: '1', at: 4 },
          { lane: 'Spinner', from: 1.4, to: 3.3, kind: 'ok', label: '2', at: 4 },
          { lane: 'Spinner', from: 3.3, to: 5.9, kind: 'ok', label: '1', at: 4 },
        ],
        hops: [
          { from: ['Main', 0.6], to: ['Worker', 0.7], kind: 'a' },
          { from: ['Main', 2.0], to: ['Worker ', 2.1], kind: 'b', at: 1 },
          { from: ['Worker', 2.6], to: ['Main', 2.8], kind: 'a', at: 2 },
          { from: ['Worker ', 5.2], to: ['Main', 5.4], kind: 'b', at: 1 },
        ],
        signals: [
          { from: ['Main', 1.85], to: ['Worker', 1.85], label: 'close()', at: 1 },
        ],
      },
    ],
  },
  teardown: {
    legend: { a: 'loadPreset', stopping: 'stopped · unwinding', other: '~Plugin()', blocked: 'Main blocked' },
    labels: [
      'Host destroys the plugin',
      'close(), then wait',
      'Deadlock',
      'Wait and drain the queue',
      'Unwound on Main · done',
    ],
    captions: [],
    panels: [
      {
        title: 'Just wait',
        lanes: ['Main', 'Worker'],
        gap: 150,
        length: 6,
        blocks: [
          { lane: 'Worker', from: 0, to: 2.6, kind: 'a', label: 'load' },
          { lane: 'Worker', from: 1.3, to: 2.6, kind: 'stopping', at: 1 },
          { lane: 'Main', from: 0.6, to: 1.3, kind: 'other', label: '~Plugin' },
          { lane: 'Main', from: 1.3, to: 6, kind: 'blocked', label: 'wait', at: 1 },
          { lane: 'Main:queue', from: 2.8, to: 3.3, kind: 'a', label: '~A', at: 2 },
          { lane: 'Main:queue', from: 2.8, to: 3.3, kind: 'stopping', at: 2 },
        ],
        hops: [
          { from: ['Worker', 2.6], to: ['Main:queue', 2.8], kind: 'a', at: 2 },
        ],
        signals: [
          { from: ['Main', 1.3], to: ['Worker', 1.3], label: 'close()', at: 1 },
          { from: ['Main:queue', 3.05], to: ['Main', 3.05], at: 2 },
        ],
      },
      {
        title: 'Wait and drain',
        at: 3,
        lanes: ['Main', 'Worker'],
        gap: 150,
        length: 6,
        blocks: [
          { lane: 'Worker', from: 0, to: 2.6, kind: 'a', label: 'load' },
          { lane: 'Worker', from: 1.3, to: 2.6, kind: 'stopping' },
          { lane: 'Main', from: 0.6, to: 1.3, kind: 'other', label: '~Plugin' },
          { lane: 'Main', from: 1.3, to: 3.0, kind: 'other', label: 'drain' },
          { lane: 'Main:queue', from: 2.8, to: 3.2, kind: 'a', label: '~A' },
          { lane: 'Main:queue', from: 2.8, to: 3.2, kind: 'stopping' },
          { lane: 'Main', from: 3.4, to: 4.2, kind: 'a', label: '~A', at: 4 },
          { lane: 'Main', from: 3.4, to: 4.2, kind: 'stopping', at: 4 },
          { lane: 'Main', from: 4.4, to: 4.9, kind: 'other', label: 'return', at: 4 },
        ],
        hops: [
          { from: ['Worker', 2.6], to: ['Main:queue', 2.8], kind: 'a' },
          { from: ['Main:queue', 3.2], to: ['Main', 3.4], kind: 'a', at: 4 },
        ],
        signals: [
          { from: ['Main', 1.3], to: ['Worker', 1.3], label: 'close()' },
        ],
      },
    ],
  },
}
