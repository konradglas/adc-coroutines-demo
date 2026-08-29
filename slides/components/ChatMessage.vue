<script setup lang="ts">
const props = defineProps<{
  from: 'QA' | 'Developer'
}>()
</script>

<template>
  <div class="chat-message" :class="props.from === 'Developer' ? 'from-developer' : 'from-qa'">
    <div class="chat-author">{{ props.from }}</div>
    <div class="chat-bubble"><slot /></div>
  </div>
</template>
