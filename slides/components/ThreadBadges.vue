<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { badgeScenarios, type BadgeLine } from './threadBadges'
import { highlightLines, type Token } from './callStackHighlight'

const props = withDefaults(defineProps<{
  name: string
  step?: number
}>(), {
  step: 0,
})

const lines = computed(() => badgeScenarios[props.name].lines)

// Same Shiki theme as the rest of the deck; plain text until it loads.
const tokens = ref<Token[][]>([])
watchEffect(async () => {
  const code = lines.value.map(l => l.code)
  tokens.value = code.map(c => [{ content: c }])
  tokens.value = await highlightLines(code)
})

function badgeOf(line: BadgeLine) {
  if (line.then && props.step >= line.then.at)
    return line.then.badge
  if (line.badge && (line.at ?? 0) <= props.step)
    return line.badge
  return undefined
}

const flipped = (line: BadgeLine) => !!line.then && props.step >= line.then.at
const current = (line: BadgeLine) => props.step > 0 && line.at === props.step

function kind(badge: string) {
  if (badge === '?')
    return 'unknown'
  return badge.includes('Worker') ? 'worker' : 'main'
}
</script>

<template>
  <div class="thread-badges">
    <div v-for="(line, i) in lines" :key="i" class="tb-row" :class="{ current: current(line) }">
      <code class="tb-code"><span v-for="(t, j) in tokens[i] ?? []" :key="j" :style="{ color: t.color }">{{ t.content }}</span></code>
      <span v-if="badgeOf(line)" class="tb-badge" :class="[kind(badgeOf(line)!), { flipped: flipped(line) }]">{{ badgeOf(line) }}</span>
    </div>
  </div>
</template>

<style scoped>
.thread-badges {
  background: #22272e;
  border: 1px solid #444c56;
  border-radius: 0.6rem;
  margin-top: 0.8rem;
  column-gap: 2.5rem;
  display: grid;
  grid-template-columns: max-content 6.5rem;
  padding: 0.7rem 0.9rem;
  width: fit-content;
}

.tb-row {
  align-items: center;
  border-radius: 0.2rem;
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  margin: 0 -0.4rem;
  min-height: 1.75rem;
  padding: 0 0.4rem;
}

.tb-row.current {
  background: rgba(216, 151, 107, 0.14);
  box-shadow: inset 2px 0 0 #d8976b;
}

.tb-code {
  background: none !important;
  font-family: "Fira Code", "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
  font-size: 0.83rem;
  padding: 0 !important;
  white-space: pre;
}

.tb-badge {
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 600;
  justify-self: start;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.6rem;
  transition: background 0.3s, color 0.3s, box-shadow 0.3s;
}

.tb-badge.main {
  background: rgba(105, 180, 165, 0.16);
  color: #69b4a5;
}

.tb-badge.worker {
  background: rgba(216, 151, 107, 0.16);
  color: #d8976b;
}

.tb-badge.unknown {
  background: rgba(224, 122, 111, 0.12);
  border: 1px dashed #e07a6f;
  color: #e07a6f;
}

.tb-badge.flipped {
  box-shadow: 0 0 0 3px rgba(105, 180, 165, 0.25);
}
</style>
