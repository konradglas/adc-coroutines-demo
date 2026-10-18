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

const width = (p: TimelinePanel) => side * 2 + (p.lanes.length - 1) * laneGap
const height = (p: TimelinePanel) => top + p.length * unit + 18
const laneX = (p: TimelinePanel, lane: string) => side + p.lanes.indexOf(lane) * laneGap
const y = (t: number) => top + t * unit
const shown = (at?: number) => (at ?? 0) <= props.step
const vertical = (b: { from: number, to: number, label?: string }) => b.to - b.from >= 2 && (b.label?.length ?? 0) > 3

function hopPath(p: TimelinePanel, from: [string, number], to: [string, number]) {
  const x1 = laneX(p, from[0])
  const x2 = laneX(p, to[0])
  const y1 = y(from[1])
  const y2 = y(to[1])
  const mid = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${mid + 14}, ${x2} ${mid - 14}, ${x2} ${y2 - 3}`
}

const colors: Record<BlockKind, string> = {
  a: '#d8976b',
  b: '#69b4a5',
  other: '#3a3a3a',
  blocked: '#e07a6f',
}
</script>

<template>
  <div class="thread-timeline">
    <div class="tt-panels">
      <div v-for="(p, pi) in timeline.panels" :key="p.title" class="tt-panel" :style="{ flex: p.lanes.length }">
        <div class="tt-title">{{ p.title }}</div>
        <svg :viewBox="`0 0 ${width(p)} ${height(p)}`" preserveAspectRatio="xMidYMin meet">
          <defs>
            <pattern :id="`tt-hatch-${pi}`" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="rgba(224, 122, 111, 0.16)" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(224, 122, 111, 0.55)" stroke-width="2.5" />
            </pattern>
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
            class="tt-item tt-hop" :class="{ hidden: !shown(h.at) }"
            :d="hopPath(p, h.from, h.to)" :stroke="colors[h.kind]" :marker-end="`url(#tt-arrow-${pi}-${h.kind})`"
          />

          <g v-for="(b, i) in p.blocks" :key="i" class="tt-item" :class="{ hidden: !shown(b.at) }">
            <rect
              :x="laneX(p, b.lane) - blockWidth / 2" :y="y(b.from)" :width="blockWidth" :height="(b.to - b.from) * unit"
              :rx="Math.min(9, (b.to - b.from) * unit / 2)"
              :fill="b.kind === 'blocked' ? `url(#tt-hatch-${pi})` : colors[b.kind]"
              :stroke="b.kind === 'blocked' ? colors.blocked : 'none'" stroke-width="1.2"
            />
            <text
              v-if="b.label && (b.to - b.from) * unit >= 12"
              class="tt-label" :class="[b.kind, { vertical: vertical(b) }]"
              :x="laneX(p, b.lane)" :y="y((b.from + b.to) / 2)"
              :transform="vertical(b) ? `rotate(-90 ${laneX(p, b.lane)} ${y((b.from + b.to) / 2)})` : undefined"
            >{{ b.label }}</text>
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
  fill: #101010;
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
  fill: #f0b3ab;
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

.tt-legend i.a { background: #d8976b; }
.tt-legend i.b { background: #69b4a5; }
.tt-legend i.other { background: #3a3a3a; }
.tt-legend i.blocked {
  background: repeating-linear-gradient(45deg, rgba(224, 122, 111, 0.55) 0 2px, rgba(224, 122, 111, 0.16) 2px 5px);
  border: 1px solid #e07a6f;
}
</style>
