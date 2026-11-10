<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { startupReadiness } from '~/helper/startupStatus.js'
const props = defineProps({ status: { type: Object, default: null }, error: { type: String, default: '' }, loading: Boolean })
defineEmits(['refresh'])
const now = ref(Date.now())
const view = computed(() => startupReadiness(props.status, now.value))
let clock
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(clock))
</script>
<template>
  <section class="startup-status-banner mx-auto mt-3 w-[calc(100%-1.5rem)] max-w-7xl rounded-lg border border-sky-700 bg-sky-950 px-4 py-3 text-sm text-sky-100"
    :class="{ 'startup-status-error': ['degraded', 'recovery_required'].includes(status?.phase) || !!error }" data-startup-status aria-live="polite">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">{{ status ? view.label : 'Startup readiness is unavailable' }}</h2>
      <span v-if="view.elapsed">{{ status?.phase === 'recovery_required' ? 'Recovery boot elapsed' : 'Startup elapsed' }}: {{ view.elapsed }}</span>
    </div>
    <p v-if="error" role="alert" class="mt-1">{{ error }}</p>
    <p v-if="status" class="mt-1">{{ view.message }}</p>
    <p v-if="status && error" class="mt-1">Showing the last received startup result.</p>
    <ul v-if="view.pending.length" class="mt-2 space-y-1">
      <li v-for="service in view.pending" :key="service.name"><strong>{{ service.name }}</strong>: {{ service.reason }}</li>
    </ul>
    <template v-if="view.failures.length">
      <p class="mt-2 font-semibold">{{ status?.phase === 'recovery_required' ? 'Recovery details:' : 'Services that missed the startup readiness deadline:' }}</p>
      <ul class="space-y-1"><li v-for="service in view.failures" :key="service.name"><strong>{{ service.name }}</strong>: {{ service.reason }}</li></ul>
    </template>
    <p v-if="status && !status.terminal" class="mt-2 text-xs">Health alerts and automatic restarts remain paused until the controller finishes startup.</p>
    <button v-if="error" type="button" class="mt-2 rounded border border-current px-3 py-1 disabled:opacity-50" :disabled="loading" @click="$emit('refresh')">Retry startup status</button>
  </section>
</template>
<style scoped>
.startup-status-error { background-color: #4c0519; border-color: #be123c; color: #ffe4e6; }
:global(html:not(.dark)) .startup-status-banner { background-color: #eff6ff; border-color: #1d4ed8; color: #172554; }
:global(html:not(.dark)) .startup-status-error { background-color: #fff1f2; border-color: #be123c; color: #4c0519; }
</style>
