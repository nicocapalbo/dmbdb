<script setup>
import { computed } from 'vue'
import { infinidyskV2JobPercent, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
const props = defineProps({ job: { type: Object, default: null } })
const percent = computed(() => infinidyskV2JobPercent(props.job))
const hasProgress = computed(() => typeof props.job?.progress === 'number' || typeof props.job?.progress?.percent === 'number')
const events = computed(() => Array.isArray(props.job?.events) ? props.job.events.slice(-5) : [])
</script>

<template>
  <div v-if="job" class="space-y-2 rounded border border-blue-400 bg-slate-950 p-3" role="status" data-testid="v2-job">
    <p class="font-semibold">{{ text(job.status) }} <span v-if="job.stage">· {{ text(job.stage) }}</span></p>
    <p class="text-sm">{{ text(job.message) }}</p>
    <p v-if="typeof job.error === 'string' && job.error" class="text-sm text-rose-200" role="alert">{{ text(job.error) }}</p>
    <p class="text-xs text-slate-400">Job {{ job.job_id }} · Closing this panel does not stop the backend job.</p>
    <progress class="w-full" :value="hasProgress ? percent : undefined" max="100" :aria-label="hasProgress ? `Migration progress ${percent}%` : 'Migration in progress'" />
    <p v-if="job.recovery_required" class="text-amber-200">Recovery is required. Keep the original data and backups; review the available backend recovery action.</p>
    <p v-if="job.cleanup_required" class="text-amber-200">Native cleanup needs review; SQLite remains active. Review the retained private warnings before reusing the destination or performing any source cleanup.</p>
    <p v-for="(event, index) in events" :key="index" class="text-xs text-slate-300">{{ text(event?.message || event) }}</p>
  </div>
</template>

<style scoped>
[data-appearance-mode='light'] .text-amber-200 {
  @apply text-amber-800;
}

[data-appearance-mode='light'] .text-rose-200 {
  @apply text-rose-800;
}
</style>
