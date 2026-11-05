<template>
  <div v-if="$page !== 1" class="muse-chrome">
    <img class="muse-logo" src="/muse-logo-light.png" alt="Muse" />
    <div class="muse-page">{{ $page }}</div>
    <div class="muse-rule top" />
    <div class="muse-rule bottom" />
  </div>
</template>
