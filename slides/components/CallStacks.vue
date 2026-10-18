<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { scenarios, type CallStackScenario, type FrameKind } from './callStackScenarios'
import { highlightLines, type Token } from './callStackHighlight'

const props = withDefaults(defineProps<{
  scenario?: string
  data?: CallStackScenario
  step?: number
  slots?: number
}>(), {
  scenario: 'coroutine',
  step: 0,
  slots: 7,
})

const current = computed(() => props.data ?? scenarios[props.scenario])
const steps = computed(() => current.value.steps)
const index = computed(() => Math.min(Math.max(props.step, 0), steps.value.length - 1))
const active = computed(() => steps.value[index.value])

const kinds: FrameKind[] = ['wait', 'block', 'loop', 'executor', 'resume', 'body', 'call']

function parse(frame: string) {
  const bar = frame.indexOf('|')
  const kind = frame.slice(0, bar) as FrameKind
  return kinds.includes(kind) ? { kind, fn: frame.slice(bar + 1) } : { kind: 'call' as FrameKind, fn: frame }
}

function stackOf(thread: string) {
  // Bottom-anchored like a real stack: pad above the innermost frame.
  const frames = (active.value.threads[thread] ?? []).map(parse)
  const padding = Math.max(props.slots - frames.length, 0)
  return { frames, padding }
}

function statusOf(thread: string) {
  const frames = stackOf(thread).frames
  const override = active.value.status?.[thread]
  if (override)
    return { label: override, cls: 'busy' }
  if (frames.some(f => f.kind === 'block'))
    return { label: 'blocked', cls: 'blocked' }
  if (frames.some(f => f.kind === 'body'))
    return active.value.heap.some(c => c.state === 'suspended')
      ? { label: 'suspending', cls: 'running' }
      : { label: 'running coroutine', cls: 'running' }
  if (frames[0]?.kind === 'wait')
    return { label: 'idle', cls: 'idle' }
  return { label: 'busy', cls: 'busy' }
}

const [left, right] = current.value.threads

// Same Shiki theme as setup/shiki.ts; plain text until the highlighter loads.
const lines = ref<Token[][]>([])
watchEffect(async () => {
  const code = current.value.code
  lines.value = code.map(line => [{ content: line }])
  lines.value = await highlightLines(code)
})
</script>

<template>
  <div class="callstacks">
    <div class="cs-top">
      <pre class="cs-code"><code><span
        v-for="(line, i) in lines" :key="i"
        class="cs-line" :class="{ on: active.line === i + 1, dim: active.line && active.line !== i + 1 }"
        ><span v-for="(t, j) in line" :key="j" :style="{ color: t.color }">{{ t.content }}</span>{{ '\n' }}</span></code></pre>
      <div class="cs-caption">
        <span class="cs-step">{{ index + 1 }} / {{ steps.length }}</span>
        <p>{{ active.caption }}</p>
      </div>
    </div>

    <div class="cs-columns" :class="{ single: !right }">
      <div v-for="thread in [left]" :key="thread" class="cs-thread">
        <div class="cs-head">
          <span>{{ thread }} stack</span>
          <span class="cs-status" :class="statusOf(thread).cls">{{ statusOf(thread).label }}</span>
        </div>
        <div class="cs-stack">
          <div v-for="n in stackOf(thread).padding" :key="'pad' + n" class="cs-frame pad" />
          <div v-for="(f, i) in stackOf(thread).frames" :key="i" class="cs-frame" :class="f.kind">{{ f.fn }}</div>
        </div>
      </div>

      <div class="cs-heap">
        <div class="cs-head"><span>Coroutine frame (heap)</span></div>
        <div class="cs-heap-body">
          <p v-if="!active.heap.length" class="cs-empty">{{ current.heapEmpty ?? 'none yet' }}</p>
          <div v-for="c in active.heap" :key="c.name" class="cs-coro" :class="c.state">
            <div class="cs-coro-name">{{ c.name }}</div>
            <div class="cs-coro-state">
              <span class="cs-dot" />{{ c.state }}<template v-if="c.note"> &middot; {{ c.note }}</template>
            </div>
            <div v-if="c.locals?.length" class="cs-locals">
              <span v-for="l in c.locals" :key="l">{{ l }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-for="thread in (right ? [right] : [])" :key="thread" class="cs-thread">
        <div class="cs-head">
          <span>{{ thread }} stack</span>
          <span class="cs-status" :class="statusOf(thread).cls">{{ statusOf(thread).label }}</span>
        </div>
        <div class="cs-stack">
          <div v-for="n in stackOf(thread).padding" :key="'pad' + n" class="cs-frame pad" />
          <div v-for="(f, i) in stackOf(thread).frames" :key="i" class="cs-frame" :class="f.kind">{{ f.fn }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.callstacks {
  --cs-orange: #d8976b;
  --cs-orange-soft: rgba(216, 151, 107, 0.16);
  --cs-teal: #69b4a5;
  --cs-teal-soft: rgba(105, 180, 165, 0.14);
  --cs-red: #e07a6f;
  --cs-mono: "SF Mono", Menlo, Consolas, monospace;
  display: grid;
  gap: 0.9rem;
  margin-top: 0.6rem;
}

.cs-top {
  display: grid;
  gap: 1.2rem;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  align-items: stretch;
}

.cs-code {
  background: #191919;
  border: 1px solid var(--slide-line);
  border-radius: 0.6rem;
  font-family: var(--cs-mono);
  font-size: 0.72rem;
  line-height: 1.45;
  margin: 0;
  padding: 0.55rem 0.8rem;
}

.cs-line {
  display: block;
  margin: 0 -0.4rem;
  padding: 0 0.4rem;
  white-space: pre;
}

.cs-line.on {
  background: var(--cs-orange-soft);
  box-shadow: inset 2px 0 0 var(--cs-orange);
}

.cs-line.dim {
  opacity: 0.45;
}

.cs-caption {
  align-self: center;
}

.cs-caption p {
  font-size: 1.05rem;
  line-height: 1.4;
  margin: 0.3rem 0 0;
}

.cs-step {
  color: var(--slide-muted);
  font-family: var(--cs-mono);
  font-size: 0.68rem;
}

.cs-columns {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1fr);
}

.cs-columns.single {
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
}

.cs-head {
  align-items: baseline;
  color: var(--slide-muted);
  display: flex;
  font-size: 0.68rem;
  justify-content: space-between;
  letter-spacing: 0.06em;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
}

.cs-status {
  border-radius: 999px;
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.5rem;
}

.cs-status.idle { background: #222; color: var(--slide-muted); }
.cs-status.busy { background: #222; color: var(--slide-fg); }
.cs-status.running { background: var(--cs-orange-soft); color: var(--cs-orange); }
.cs-status.blocked { background: rgba(224, 122, 111, 0.18); color: var(--cs-red); }

.cs-stack {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.cs-frame {
  background: #1b1b1b;
  border: 1px solid #2c2c2c;
  border-radius: 0.3rem;
  font-family: var(--cs-mono);
  font-size: 0.62rem;
  height: 1.35rem;
  line-height: 1.35rem;
  overflow: hidden;
  padding: 0 0.5rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cs-frame.pad { background: transparent; border-color: transparent; }
.cs-frame.loop { color: #8a8a8a; }
.cs-frame.wait { border-style: dashed; color: #8a8a8a; font-style: italic; }
.cs-frame.executor { border-color: rgba(105, 180, 165, 0.45); color: var(--cs-teal); }
.cs-frame.resume { background: var(--cs-teal-soft); border-color: var(--cs-teal); color: #bdd4ce; }
.cs-frame.body { background: var(--cs-orange-soft); border-color: var(--cs-orange); color: #f2c1ae; font-weight: 600; }
.cs-frame.call { color: var(--slide-fg); }
.cs-frame.block { background: rgba(224, 122, 111, 0.16); border-color: var(--cs-red); color: #f0b3ab; font-weight: 600; }

.cs-heap {
  display: flex;
  flex-direction: column;
}

.cs-heap-body {
  background: repeating-linear-gradient(135deg, #151515 0 8px, #181818 8px 16px);
  border: 1px dashed var(--slide-line);
  border-radius: 0.6rem;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  padding: 0.6rem;
}

.cs-empty {
  color: var(--slide-muted);
  font-size: 0.72rem;
  margin: 0;
  text-align: center;
}

.cs-coro {
  background: #191919;
  border: 1px solid var(--slide-line);
  border-radius: 0.5rem;
  padding: 0.5rem 0.65rem;
}

.cs-coro.running { border-color: var(--cs-orange); box-shadow: 0 0 0 3px var(--cs-orange-soft); }
.cs-coro.suspended { border-color: var(--cs-teal); }
.cs-coro.done { opacity: 0.4; }

.cs-coro-name {
  font-family: var(--cs-mono);
  font-size: 0.75rem;
  font-weight: 600;
}

.cs-coro-state {
  align-items: center;
  color: var(--slide-muted);
  display: flex;
  font-size: 0.66rem;
  gap: 0.35rem;
  margin-top: 0.2rem;
}

.cs-dot {
  background: var(--slide-muted);
  border-radius: 50%;
  display: inline-block;
  height: 0.45rem;
  width: 0.45rem;
}

.running .cs-dot { background: var(--cs-orange); }
.suspended .cs-dot { background: var(--cs-teal); }

.cs-locals {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.4rem;
}

.cs-locals span {
  background: #222;
  border-radius: 0.25rem;
  font-family: var(--cs-mono);
  font-size: 0.6rem;
  padding: 0.05rem 0.35rem;
}
</style>
