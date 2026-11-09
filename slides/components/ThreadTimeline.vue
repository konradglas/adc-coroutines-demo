<script setup lang="ts">
import { computed } from 'vue'
import { timelines, type TimelinePanel, type BlockKind } from './threadTimelines'

const props = withDefaults(defineProps<{
  name?: string
  step?: number
}>(), {
  name: 'loadPreset',
  step: 0,
})

const timeline = computed(() => timelines[props.name])
const caption = computed(() => {
  const captions = timeline.value.labels ?? timeline.value.captions
  return captions[Math.min(Math.max(props.step, 0), captions.length - 1)]
})

// Layout in SVG units; each panel scales with its own viewBox.
const laneGap = 92
const side = 46
const top = 44
const unit = 48
const blockWidth = 46

const queueWidth = 30
const gap = (p: TimelinePanel) => p.gap ?? laneGap

const width = (p: TimelinePanel) => side * 2 + (p.lanes.length - 1) * gap(p)
const height = (p: TimelinePanel) => top + p.length * unit + 18
// "Main:queue" is not a lane: it is Main's queue, a narrow box right next to Main's lane.
const isQueue = (lane: string) => lane.endsWith(':queue')
const laneX = (p: TimelinePanel, lane: string): number => isQueue(lane)
  ? laneX(p, lane.slice(0, -':queue'.length)) + blockWidth / 2 + 22 + queueWidth / 2
  : side + p.lanes.indexOf(lane) * gap(p)
const halfWidth = (lane: string) => (isQueue(lane) ? queueWidth : blockWidth) / 2
const y = (t: number) => top + t * unit
const shown = (at?: number, until?: number) => (at ?? 0) <= props.step && (until === undefined || props.step < until)
const vertical = (b: { from: number, to: number, label?: string }) => b.to - b.from >= 2 && (b.label?.length ?? 0) > 3

// Signals run left to right or right to left; they start and end at block edges.
const dir = (p: TimelinePanel, sg: { from: [string, number], to: [string, number] }): number =>
  laneX(p, sg.to[0]) >= laneX(p, sg.from[0]) ? 1 : -1

function hopPath(p: TimelinePanel, from: [string, number], to: [string, number]) {
  const x1 = laneX(p, from[0])
  const x2 = laneX(p, to[0])
  const y1 = y(from[1])
  const y2 = y(to[1])
  const mid = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${mid + 14}, ${x2} ${mid - 14}, ${x2} ${y2 - 3}`
}

const colors: Record<BlockKind, string> = {
  a: '#fe4f00',
  b: '#9b6bff',
  other: '#3a3a3a',
  blocked: '#ff4fa8',
  ok: '#5fe08f',
  stopping: 'none',
}
</script>

<template>
  <div class="thread-timeline">
    <div class="tt-panels">
      <div v-for="(p, pi) in timeline.panels" :key="p.title" class="tt-panel tt-item" :style="{ flex: p.lanes.length, opacity: shown(p.at) ? 1 : 0 }">
        <div class="tt-title">{{ p.title }}</div>
        <svg :viewBox="`0 0 ${width(p)} ${height(p)}`" preserveAspectRatio="xMidYMin meet">
          <defs>
            <pattern :id="`tt-hatch-${pi}`" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="rgba(255, 79, 168, 0.16)" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255, 79, 168, 0.55)" stroke-width="2.5" />
            </pattern>
            <pattern :id="`tt-stopping-${pi}`" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(0, 0, 0, 0.5)" stroke-width="3" />
            </pattern>
            <marker :id="`tt-signal-${pi}`" viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" :fill="colors.blocked" />
            </marker>
            <marker v-for="k in ['a', 'b']" :id="`tt-arrow-${pi}-${k}`" :key="k" viewBox="0 0 8 8" refX="4" refY="4"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" :fill="colors[k as BlockKind]" />
            </marker>
          </defs>

          <g v-for="lane in p.lanes" :key="lane">
            <text :x="laneX(p, lane)" :y="top - 20" class="tt-lane">{{ lane }}</text>
            <line :x1="laneX(p, lane)" :x2="laneX(p, lane)" :y1="top - 8" :y2="y(p.length) + 6" class="tt-axis" />
            <path :d="`M ${laneX(p, lane) - 3} ${y(p.length) + 2} L ${laneX(p, lane)} ${y(p.length) + 7} L ${laneX(p, lane) + 3} ${y(p.length) + 2}`" class="tt-axis-head" />
          </g>

          <!-- Hops sit below the blocks, so a hop crossing another lane passes behind its work. -->
          <path
            v-for="(h, i) in p.hops ?? []" :key="'hop' + i"
            class="tt-item tt-hop" :class="{ hidden: !shown(h.at, h.until) }"
            :d="hopPath(p, h.from, h.to)" :stroke="colors[h.kind]" :marker-end="`url(#tt-arrow-${pi}-${h.kind})`"
          />

          <!-- A queued item gets a dashed inbox around it, labelled "queue". -->
          <g v-for="(b, i) in p.blocks.filter(b => isQueue(b.lane) && b.kind !== 'stopping')" :key="'q' + i"
            class="tt-item" :class="{ hidden: !shown(b.at, b.until) }">
            <rect class="tt-queue" :x="laneX(p, b.lane) - queueWidth / 2 - 4" :y="y(b.from) - 4"
              :width="queueWidth + 8" :height="(b.to - b.from) * unit + 8" rx="6" />
            <text class="tt-queue-label" :x="laneX(p, b.lane)" :y="y(b.to) + 13">queue</text>
          </g>

          <rect
            v-for="(b, i) in p.blocks" :key="i" class="tt-item" :class="{ hidden: !shown(b.at, b.until) }"
            :x="laneX(p, b.lane) - halfWidth(b.lane)" :y="y(b.from)" :width="halfWidth(b.lane) * 2" :height="(b.to - b.from) * unit"
            :rx="Math.min(9, (b.to - b.from) * unit / 2)"
            :fill="b.kind === 'blocked' ? `url(#tt-hatch-${pi})` : b.kind === 'stopping' ? `url(#tt-stopping-${pi})` : colors[b.kind]"
            :stroke="b.kind === 'blocked' ? colors.blocked : 'none'" stroke-width="1.2"
          />

          <!-- Labels after all blocks, so overlays never cover them. -->
          <template v-for="(b, i) in p.blocks" :key="'label' + i">
            <text
              v-if="b.label && (b.to - b.from) * unit >= 12"
              class="tt-item tt-label" :class="[b.kind, { vertical: vertical(b), hidden: !shown(b.at, b.until) }]"
              :x="laneX(p, b.lane)" :y="y((b.from + b.to) / 2)"
              :transform="vertical(b) ? `rotate(-90 ${laneX(p, b.lane)} ${y((b.from + b.to) / 2)})` : undefined"
            >{{ b.label }}</text>
          </template>

          <!-- Signals sit on top: they point from one block's edge to another's. -->
          <g v-for="(sg, i) in p.signals ?? []" :key="'sig' + i" class="tt-item" :class="{ hidden: !shown(sg.at, sg.until) }">
            <line
              class="tt-signal"
              :x1="laneX(p, sg.from[0]) + dir(p, sg) * (halfWidth(sg.from[0]) + 2)" :y1="y(sg.from[1])"
              :x2="laneX(p, sg.to[0]) - dir(p, sg) * (halfWidth(sg.to[0]) + 3)" :y2="y(sg.to[1])"
              :stroke="colors.blocked" :marker-end="`url(#tt-signal-${pi})`"
            />
            <text
              v-if="sg.label" class="tt-signal-label"
              :x="(laneX(p, sg.from[0]) + laneX(p, sg.to[0])) / 2" :y="y((sg.from[1] + sg.to[1]) / 2) - 6"
            >{{ sg.label }}</text>
          </g>
        </svg>
      </div>
    </div>

    <div class="tt-footer">
      <p class="tt-caption" :class="{ label: timeline.labels }">{{ caption }}</p>
      <div class="tt-legend">
        <span v-for="(label, kind) in timeline.legend" :key="kind">
          <i :class="kind" />{{ label }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thread-timeline {
  display: grid;
  gap: 0.7rem;
  margin-top: 0.4rem;
}

.tt-panels {
  display: flex;
  gap: 1rem;
}

.tt-panel {
  background: #191919;
  border: 1px solid var(--slide-line);
  border-radius: 0.7rem;
  padding: 0.6rem 0.4rem 0.2rem;
}

.tt-panel svg {
  display: block;
  height: 19rem;
  width: 100%;
}

.tt-title {
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
}

.tt-lane {
  fill: var(--slide-muted);
  font-size: 11px;
  text-anchor: middle;
}

.tt-axis {
  stroke: #4a4a4a;
  stroke-width: 1;
}

.tt-axis-head {
  fill: none;
  stroke: #4a4a4a;
  stroke-width: 1;
}

.tt-item {
  transition: opacity 0.25s ease;
}

.tt-item.hidden {
  opacity: 0;
}

.tt-label {
  dominant-baseline: central;
  fill: #000000;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  text-anchor: middle;
}

.tt-label.other {
  fill: #b5b5b5;
  font-size: 8.5px;
  font-weight: 500;
}

.tt-label.blocked {
  fill: #ffb3d9;
  font-size: 9.5px;
}

.tt-label.vertical {
  font-size: 9.5px;
}

.tt-hop {
  fill: none;
  stroke-dasharray: 4 3;
  stroke-width: 1.4;
}

.tt-queue {
  fill: none;
  stroke: #6a6a6a;
  stroke-dasharray: 3 2;
  stroke-width: 1;
}

.tt-queue-label {
  fill: var(--slide-muted);
  font-size: 7.5px;
  text-anchor: middle;
}

.tt-signal {
  stroke-width: 2;
}

.tt-signal-label {
  fill: #ffb3d9;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 8.5px;
  font-weight: 600;
  text-anchor: middle;
}

.tt-footer {
  align-items: baseline;
  display: flex;
  gap: 1.5rem;
  justify-content: space-between;
}

.tt-caption {
  font-size: 1rem;
  line-height: 1.4;
  margin: 0;
  min-height: 2.8em;
}

.tt-caption.label {
  font-size: 1.45rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  min-height: 0;
}

.tt-legend {
  color: var(--slide-muted);
  display: flex;
  flex-shrink: 0;
  font-size: 0.68rem;
  gap: 0.9rem;
}

.tt-legend i {
  border-radius: 0.2rem;
  display: inline-block;
  height: 0.6rem;
  margin-right: 0.3rem;
  vertical-align: -0.05rem;
  width: 0.6rem;
}

.tt-legend i.a { background: #fe4f00; }
.tt-legend i.b { background: #9b6bff; }
.tt-legend i.other { background: #3a3a3a; }
.tt-legend i.ok { background: #5fe08f; }
.tt-legend i.stopping {
  background: repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.5) 0 2px, #fe4f00 2px 5px);
}
.tt-legend i.blocked {
  background: repeating-linear-gradient(45deg, rgba(255, 79, 168, 0.55) 0 2px, rgba(255, 79, 168, 0.16) 2px 5px);
  border: 1px solid #ff4fa8;
}
</style>
