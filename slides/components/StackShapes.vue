<script setup lang="ts">
// Four ways a coroutine gets resumed: same top of stack, different bottom.
const shapes = [
  {
    name: 'Worker',
    how: 'own thread · woken by enqueue',
    frames: ['ThreadPool::run()', 'thread_start()'],
  },
  {
    name: 'Main',
    how: 'host’s loop · woken by posting',
    frames: ['MainExecutor::drain()', 'postedCallback()', 'Host::runLoop()'],
  },
  {
    name: 'Audio',
    how: 'host’s callback · polled every block',
    frames: ['AudioExecutor::runPending()', 'Plugin::processBlock()', 'Host::audioCallback()'],
  },
  {
    name: 'Event',
    how: 'no loop · resumed inline',
    frames: ['AwaitableValue::setValue()', 'Plugin::onLibraryIndexed()', 'postedCallback()'],
  },
]
const depth = Math.max(...shapes.map(s => s.frames.length))
</script>

<template>
  <div class="stack-shapes">
    <div v-for="s in shapes" :key="s.name" class="ss-col">
      <div class="ss-name">{{ s.name }}</div>
      <div class="ss-frame body">body() (resume)</div>
      <div class="ss-frame resume">handle.resume()</div>
      <div v-for="(f, i) in s.frames" :key="i" class="ss-frame bottom">{{ f }}</div>
      <div v-for="n in depth - s.frames.length" :key="'pad' + n" class="ss-frame pad" />
      <div class="ss-how">{{ s.how }}</div>
    </div>
  </div>
</template>

<style scoped>
.stack-shapes {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 1.4rem;
}

.ss-col {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
}

.ss-name {
  color: var(--slide-muted);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  margin-bottom: 0.3rem;
  text-transform: uppercase;
}

.ss-frame {
  background: #1b1b1b;
  border: 1px solid #2c2c2c;
  border-radius: 0.3rem;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.66rem;
  height: 1.55rem;
  line-height: 1.55rem;
  overflow: hidden;
  padding: 0 0.55rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ss-frame.body { background: rgba(216, 151, 107, 0.16); border-color: #d8976b; color: #f2c1ae; font-weight: 600; }
.ss-frame.resume { background: rgba(105, 180, 165, 0.14); border-color: #69b4a5; color: #bdd4ce; }
.ss-frame.bottom { color: #a5a5a5; }
.ss-frame.pad { background: transparent; border-color: transparent; }

.ss-how {
  color: var(--slide-fg);
  font-size: 0.78rem;
  line-height: 1.35;
  margin-top: 0.6rem;
}
</style>
