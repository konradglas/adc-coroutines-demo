// Thread timelines for <ThreadTimeline>. Time runs downwards in abstract units.
// `at` is the click on which an item appears (default 0).

export type BlockKind = 'a' | 'b' | 'other' | 'blocked'

export interface TimelineBlock {
  lane: string
  from: number
  to: number
  kind: BlockKind
  label?: string
  at?: number
}

export interface TimelineHop {
  from: [string, number]
  to: [string, number]
  kind: 'a' | 'b'
  at?: number
}

export interface TimelinePanel {
  title: string
  lanes: string[]
  length: number
  blocks: TimelineBlock[]
  hops?: TimelineHop[]
}

export interface Timeline {
  legend: Partial<Record<BlockKind, string>>
  captions: string[]
  panels: TimelinePanel[]
}

const audioBlocks = (at = 0) => [0.2, 1.2, 2.2, 3.2, 4.2, 5.2].map(from => ({
  lane: 'Audio', from, to: from + 0.4, kind: 'other' as const, label: 'render', at,
}))

export const timelines: Record<string, Timeline> = {
  loadPreset: {
    legend: { a: 'loadPreset', b: 'onKeyboardNote', other: 'other work', blocked: 'blocked' },
    captions: [
      'Blocking: Main sits in get() until the worker is done. Nothing else runs on it.',
      'Suspending: chunk 1 runs on Main, then the continuation hops to a worker…',
      '…and Main is free: it paints and handles the mouse while chunk 2 runs.',
      'A second coroutine starts on Main and hops to the audio thread, which picks it up at the next block.',
      'Chunk 3 of loadPreset comes back to Main. Two coroutines, three threads, nobody waited.',
    ],
    panels: [
      {
        title: 'Blocking',
        lanes: ['Main', 'Worker'],
        length: 6,
        blocks: [
          { lane: 'Main', from: 0, to: 1, kind: 'a', label: '1' },
          { lane: 'Main', from: 1, to: 4, kind: 'blocked', label: 'blocked in get()' },
          { lane: 'Worker', from: 1, to: 4, kind: 'a', label: 'buildSamplerTree' },
          { lane: 'Main', from: 4, to: 5, kind: 'a', label: '3' },
          { lane: 'Main', from: 5.3, to: 5.8, kind: 'other', label: 'paint' },
        ],
        hops: [
          { from: ['Main', 1], to: ['Worker', 1], kind: 'a' },
          { from: ['Worker', 4], to: ['Main', 4], kind: 'a' },
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
}
