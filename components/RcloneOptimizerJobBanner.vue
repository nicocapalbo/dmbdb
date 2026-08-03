<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import useService from '~/services/useService.js'
import { RCLONE_OPTIMIZER_ACTIVE_STATUSES } from '~/helper/rcloneOptimizer.js'

const props = defineProps({
  processName: { type: String, default: '' },
  sourcePage: { type: Boolean, default: false }
})
const emit = defineEmits(['open'])
const { processService } = useService()
const job = ref(null)
let timer = null

const targetUrl = computed(() => job.value?.process_name
  ? `/services/${encodeURIComponent(job.value.process_name)}?tab=rclone-optimizer`
  : '')

const refresh = async () => {
  try {
    if (!props.sourcePage) {
      const response = await processService.getLatestRcloneOptimizerJob(props.processName, true)
      job.value = response?.job || null
      return
    }
    const instances = (await processService.getRcloneOptimizerInstances())?.instances || []
    for (const instance of instances) {
      const response = await processService.getLatestRcloneOptimizerJob(instance.process_name, true)
      if (response?.job && RCLONE_OPTIMIZER_ACTIVE_STATUSES.has(response.job.status)) {
        job.value = response.job
        return
      }
    }
    job.value = null
  } catch {
    job.value = null
  }
}

onMounted(async () => {
  await refresh()
  timer = window.setInterval(refresh, 4000)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div v-if="job && RCLONE_OPTIMIZER_ACTIVE_STATUSES.has(job.status)" class="px-4 pb-2">
    <NuxtLink
      v-if="sourcePage"
      :to="targetUrl"
      class="flex w-full items-center justify-between gap-3 rounded border border-sky-500/50 bg-sky-950/35 px-3 py-2 text-left text-sky-100 hover:bg-sky-900/45"
    >
      <span class="flex min-w-0 items-center gap-2">
        <span class="material-symbols-rounded animate-spin text-sky-300">progress_activity</span>
        <span class="min-w-0"><span class="block font-semibold">Associated rclone optimization is running · {{ job.progress || 0 }}%</span><span class="block truncate text-xs text-sky-200/80">{{ job.process_name }} · {{ job.stage }}</span></span>
      </span>
      <span class="shrink-0 text-xs font-medium">Open on rclone page</span>
    </NuxtLink>
    <button
      v-else
      type="button"
      class="flex w-full items-center justify-between gap-3 rounded border border-sky-500/50 bg-sky-950/35 px-3 py-2 text-left text-sky-100 hover:bg-sky-900/45"
      @click="emit('open')"
    >
      <span class="flex min-w-0 items-center gap-2">
        <span class="material-symbols-rounded animate-spin text-sky-300">progress_activity</span>
        <span class="min-w-0"><span class="block font-semibold">Rclone optimization running in the background · {{ job.progress || 0 }}%</span><span class="block truncate text-xs text-sky-200/80">{{ job.stage }}</span></span>
      </span>
      <span class="shrink-0 text-xs font-medium">Open progress</span>
    </button>
  </div>
</template>
