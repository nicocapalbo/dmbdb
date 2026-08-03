<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import useService from '~/services/useService.js'
import {
  RCLONE_OPTIMIZER_ACTIVE_STATUSES,
  warmColdStartupAverages,
} from '~/helper/rcloneOptimizer.js'

const props = defineProps({
  processName: { type: String, required: true }
})

const { processService } = useService()
const toast = useToast()
const loadingContent = ref(false)
const actionPending = ref(false)
const error = ref('')
const content = ref(null)
const selectedPaths = ref([])
const search = ref('')
const job = ref(null)
const depth = ref('standard')
let pollTimer = null

const limits = reactive({
  max_vfs_cache_gib: 5,
  min_free_disk_gib: 10,
  max_memory_mib: 2048,
  max_test_download_gib: 4,
  max_duration_minutes: 20,
  concurrent_streams: 1,
  startup_buffer_mib: 32,
  bandwidth_limit_mbps: 0
})

const isActive = computed(() => RCLONE_OPTIMIZER_ACTIVE_STATUSES.has(job.value?.status))
const canApply = computed(() => job.value?.status === 'completed' || job.value?.status === 'rolled_back')
const canRollback = computed(() => job.value?.status === 'applied')
const progress = computed(() => Number(job.value?.progress || 0))
const filteredFiles = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const files = content.value?.files || []
  return needle ? files.filter((file) => file.path.toLowerCase().includes(needle)) : files
})
const selectedSet = computed(() => new Set(selectedPaths.value))
const recommendationResult = computed(() => {
  const candidateId = job.value?.recommendation?.candidate_id
  return (job.value?.results || []).find((result) => result.id === candidateId) || null
})
const warmColdSummary = computed(() => {
  const samples = recommendationResult.value?.samples || []
  return warmColdStartupAverages(samples)
})

const formatBytes = (value) => {
  let number = Number(value || 0)
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let unit = 0
  while (number >= 1024 && unit < units.length - 1) {
    number /= 1024
    unit += 1
  }
  return `${number.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

const errorText = (caught, fallback) => caught?.response?.data?.detail || caught?.message || fallback

const loadContent = async () => {
  loadingContent.value = true
  error.value = ''
  try {
    content.value = await processService.discoverRcloneOptimizerContent(props.processName)
    if (!selectedPaths.value.length) {
      selectedPaths.value = (content.value?.automatic_selection || []).map((item) => item.path)
    }
  } catch (caught) {
    error.value = errorText(caught, 'Content discovery failed.')
  } finally {
    loadingContent.value = false
  }
}

const refreshJob = async () => {
  if (!job.value?.job_id) return
  try {
    const response = await processService.getRcloneOptimizerJob(job.value.job_id)
    job.value = response?.job || null
    if (isActive.value) startPolling()
    else stopPolling()
  } catch (caught) {
    error.value = errorText(caught, 'Could not refresh the optimizer job.')
  }
}

const loadLatestJob = async () => {
  try {
    const response = await processService.getLatestRcloneOptimizerJob(props.processName, false)
    job.value = response?.job || null
    if (isActive.value) startPolling()
  } catch (caught) {
    error.value = errorText(caught, 'Could not load the latest optimizer job.')
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = window.setInterval(refreshJob, 2000)
}

function stopPolling() {
  if (!pollTimer) return
  window.clearInterval(pollTimer)
  pollTimer = null
}

const togglePath = (path) => {
  if (selectedSet.value.has(path)) {
    selectedPaths.value = selectedPaths.value.filter((item) => item !== path)
    return
  }
  if (selectedPaths.value.length >= 8) {
    toast.add({ severity: 'warn', summary: 'Selection limit', detail: 'Choose no more than eight files.', life: 4000 })
    return
  }
  selectedPaths.value = [...selectedPaths.value, path]
}

const startJob = async () => {
  if (!selectedPaths.value.length) return
  actionPending.value = true
  error.value = ''
  try {
    const response = await processService.startRcloneOptimizer({
      process_name: props.processName,
      selected_paths: selectedPaths.value,
      depth: depth.value,
      limits: { ...limits }
    })
    job.value = response?.job || null
    startPolling()
    toast.add({ severity: 'info', summary: 'Rclone test started', detail: 'The job will continue in the background if you leave this page.', life: 5000 })
  } catch (caught) {
    error.value = errorText(caught, 'Could not start the optimizer.')
  } finally {
    actionPending.value = false
  }
}

const cancelJob = async () => {
  if (!job.value?.job_id || !window.confirm('Cancel this optimizer job? The shadow mount and test cache will be cleaned up.')) return
  actionPending.value = true
  try {
    await processService.cancelRcloneOptimizer(job.value.job_id)
    await refreshJob()
  } catch (caught) {
    error.value = errorText(caught, 'Could not cancel the optimizer.')
  } finally {
    actionPending.value = false
  }
}

const applyRecommendation = async () => {
  if (!job.value?.job_id || !window.confirm('Apply the recommended rclone flags and restart this rclone service? The previous command will be retained for rollback.')) return
  actionPending.value = true
  error.value = ''
  try {
    const response = await processService.applyRcloneOptimizer(job.value.job_id)
    job.value = response?.job || job.value
    toast.add({ severity: 'success', summary: 'Rclone settings applied', detail: 'The service restarted and its mount was verified.', life: 6000 })
  } catch (caught) {
    error.value = errorText(caught, 'The recommendation could not be applied.')
    await refreshJob()
  } finally {
    actionPending.value = false
  }
}

const rollbackRecommendation = async () => {
  if (!job.value?.job_id || !window.confirm('Restore the rclone command that was active before this recommendation?')) return
  actionPending.value = true
  error.value = ''
  try {
    const response = await processService.rollbackRcloneOptimizer(job.value.job_id)
    job.value = response?.job || job.value
    toast.add({ severity: 'success', summary: 'Rclone settings rolled back', detail: 'The previous command was restored and the mount was verified.', life: 6000 })
  } catch (caught) {
    error.value = errorText(caught, 'The previous settings could not be restored.')
    await refreshJob()
  } finally {
    actionPending.value = false
  }
}

onMounted(async () => {
  await loadLatestJob()
  await loadContent()
})
onUnmounted(stopPolling)
</script>

<template>
  <div class="grow overflow-y-auto px-4 pb-6">
    <div class="mx-auto max-w-7xl space-y-4">
      <div class="rounded-lg border border-sky-500/35 bg-sky-950/20 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-lg font-semibold text-slate-100">
              <span class="material-symbols-rounded text-sky-300">speed</span>
              NzbDAV rclone streaming optimizer
            </h2>
            <p class="mt-1 max-w-4xl text-sm text-slate-300">
              Tests bounded rclone profiles through a separate read-only mount, NzbDAV's real WebDAV server, and your configured Usenet providers. The live mount and its cache are left alone.
            </p>
          </div>
          <a href="https://dumbarr.com/features/rclone-optimizer/" target="_blank" rel="noopener noreferrer" class="button-small border border-slate-50/20 hover:apply">
            <span class="material-symbols-rounded !text-[18px]">help</span>
            Docs
          </a>
        </div>
        <div class="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2"><strong>Real provider reads</strong><br>Data and rate limits apply.</div>
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2"><strong>No cache purge</strong><br>Warm/cold likelihood stays separate.</div>
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2"><strong>Provider guard</strong><br>Errors, throttling, and open circuits stop testing.</div>
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2"><strong>Review first</strong><br>Settings are never auto-applied.</div>
        </div>
      </div>

      <div v-if="job" class="rounded-lg border border-slate-700 bg-slate-900/60 p-4" aria-live="polite">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-100">Latest job · {{ job.status }}</p>
            <p class="text-sm text-slate-400">{{ job.stage }}<span v-if="job.updated_at"> · {{ new Date(job.updated_at).toLocaleString() }}</span></p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-if="isActive" :disabled="actionPending" class="rounded bg-rose-800 px-3 py-1.5 text-sm hover:bg-rose-700 disabled:opacity-50" @click="cancelJob">Cancel test</button>
            <button v-if="canApply" :disabled="actionPending" class="rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50" @click="applyRecommendation">Apply recommendation</button>
            <button v-if="canRollback" :disabled="actionPending" class="rounded bg-amber-700 px-3 py-1.5 text-sm hover:bg-amber-600 disabled:opacity-50" @click="rollbackRecommendation">Roll back</button>
          </div>
        </div>
        <div v-if="isActive" class="mt-3">
          <div class="h-2 overflow-hidden rounded bg-slate-800"><div class="h-full bg-sky-500 transition-all" :style="{ width: `${progress}%` }" /></div>
          <div class="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <div>Candidate: {{ job.live?.candidate || 'preparing' }}</div>
            <div>Read: {{ formatBytes(job.live?.bytes_read) }}</div>
            <div>NzbDAV reads: {{ job.live?.nzbdav?.active_reads ?? '—' }}</div>
            <div>Provider p95: {{ job.live?.nzbdav?.provider_latency_p95_ms != null ? `${job.live.nzbdav.provider_latency_p95_ms} ms` : '—' }}</div>
          </div>
        </div>
        <p v-if="job.error" class="mt-3 rounded border border-rose-500/40 bg-rose-950/30 p-2 text-sm text-rose-200">{{ job.error }}</p>
      </div>

      <div v-if="job?.recommendation" class="rounded-lg border border-emerald-500/35 bg-emerald-950/15 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-emerald-100">Recommendation: {{ job.recommendation.label }}</h3>
            <p class="mt-1 text-sm text-slate-300">{{ job.recommendation.reason }}</p>
          </div>
          <span class="rounded-full border px-2 py-1 text-xs" :class="job.recommendation.applied ? 'border-emerald-500 text-emerald-200' : 'border-amber-500 text-amber-200'">
            {{ job.recommendation.applied ? 'Applied' : 'Not applied' }}
          </span>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="(value, flag) in job.recommendation.settings" :key="flag" class="rounded border border-slate-700 bg-slate-950/45 p-2 font-mono text-xs"><span class="text-slate-400">{{ flag }}</span><br>{{ value }}</div>
        </div>
        <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded bg-slate-950/35 p-2">Startup buffer<br><strong>{{ job.recommendation.summary?.startup_ms?.toFixed?.(0) ?? '—' }} ms</strong></div>
          <div class="rounded bg-slate-950/35 p-2">First byte<br><strong>{{ job.recommendation.summary?.ttfb_ms?.toFixed?.(0) ?? '—' }} ms</strong></div>
          <div class="rounded bg-slate-950/35 p-2">Throughput<br><strong>{{ job.recommendation.summary?.throughput_mib_s?.toFixed?.(1) ?? '—' }} MiB/s</strong></div>
          <div class="rounded bg-slate-950/35 p-2">Seek<br><strong>{{ job.recommendation.summary?.seek_ms?.toFixed?.(0) ?? '—' }} ms</strong></div>
        </div>
        <div class="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
          <div class="rounded border border-slate-700 p-2">Recent / likely warm startup: <strong>{{ warmColdSummary.recent != null ? `${warmColdSummary.recent.toFixed(0)} ms` : 'not sampled' }}</strong></div>
          <div class="rounded border border-slate-700 p-2">Older / likely cold startup: <strong>{{ warmColdSummary.older != null ? `${warmColdSummary.older.toFixed(0)} ms` : 'not sampled' }}</strong></div>
        </div>
      </div>

      <details v-if="job?.results?.length" class="rounded-lg border border-slate-700 bg-slate-900/45" open>
        <summary class="cursor-pointer px-4 py-3 font-semibold">Candidate report</summary>
        <div class="overflow-x-auto border-t border-slate-700">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="bg-slate-800 text-xs uppercase text-slate-300"><tr><th class="p-2">Profile</th><th class="p-2">Startup</th><th class="p-2">First byte</th><th class="p-2">Throughput</th><th class="p-2">Seek</th><th class="p-2">Memory</th><th class="p-2">Samples</th><th class="p-2">NzbDAV</th></tr></thead>
            <tbody>
              <tr v-for="result in job.results" :key="result.id" class="border-t border-slate-800">
                <td class="p-2 font-medium">{{ result.label }}</td>
                <td class="p-2">{{ result.summary?.startup_ms != null ? `${result.summary.startup_ms.toFixed(0)} ms` : '—' }}</td>
                <td class="p-2">{{ result.summary?.ttfb_ms != null ? `${result.summary.ttfb_ms.toFixed(0)} ms` : '—' }}</td>
                <td class="p-2">{{ result.summary?.throughput_mib_s != null ? `${result.summary.throughput_mib_s.toFixed(1)} MiB/s` : '—' }}</td>
                <td class="p-2">{{ result.summary?.seek_ms != null ? `${result.summary.seek_ms.toFixed(0)} ms` : '—' }}</td>
                <td class="p-2">{{ result.resources?.rss_mib != null ? `${result.resources.rss_mib.toFixed(0)} MiB` : '—' }}</td>
                <td class="p-2">{{ result.summary?.scored_samples || 0 }} scored / {{ result.summary?.excluded_samples || 0 }} excluded</td>
                <td class="p-2">{{ result.trace_count || 0 }} traces · {{ formatBytes(result.provider_bytes_delta) }} fetched<span v-if="result.provider_guard_stop" class="ml-1 text-amber-300">guard stop</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="space-y-2 border-t border-slate-700 p-3">
          <details v-for="result in job.results" :key="`${result.id}-nzbdav`" class="rounded border border-slate-700 bg-slate-950/35 p-2 text-xs text-slate-300">
            <summary class="cursor-pointer font-medium text-slate-200">{{ result.label }} · NzbDAV provider evidence</summary>
            <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div>Provider p50: {{ result.nzbdav?.after?.provider_latency_p50_ms ?? '—' }} ms</div>
              <div>Provider p95: {{ result.nzbdav?.after?.provider_latency_p95_ms ?? '—' }} ms</div>
              <div>Errors/min: {{ result.nzbdav?.after?.errors_per_minute ?? '—' }}</div>
              <div>Throttle events: {{ result.nzbdav?.after?.throttle_events ?? '—' }}</div>
            </div>
            <div v-if="result.stream_traces?.length" class="mt-2 space-y-1">
              <div v-for="trace in result.stream_traces" :key="trace.session_id" class="rounded border border-slate-800 p-2">
                <span class="font-mono">{{ trace.path }}</span><br>
                Providers: {{ trace.providers?.join(', ') || 'none recorded' }} · retries: {{ trace.retries || 0 }} · bytes: {{ formatBytes(trace.bytes_served) }} · provider wait: {{ trace.provider_wait_ms || 0 }} ms · connection wait: {{ trace.connection_wait_ms || 0 }} ms
              </div>
            </div>
            <p v-else class="mt-2 text-slate-500">No matching retained stream trace was available for this candidate.</p>
          </details>
        </div>
      </details>

      <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><h3 class="font-semibold">1. Select test content</h3><p class="text-xs text-slate-400">Automatic selection mixes recent, older, large, and typical files. Age is only a cache-likelihood heuristic.</p></div>
          <button :disabled="loadingContent || isActive" class="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50" @click="loadContent">{{ loadingContent ? 'Scanning…' : 'Rescan mount' }}</button>
        </div>
        <div v-if="content" class="mt-3">
          <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{{ content.scanned }} entries scanned</span><span>·</span><span>{{ selectedPaths.length }}/8 selected</span><span v-if="content.truncated">· bounded scan stopped early</span></div>
          <input v-model="search" class="w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm" placeholder="Filter available media paths" />
          <div class="mt-2 max-h-64 overflow-auto rounded border border-slate-700">
            <label v-for="file in filteredFiles" :key="file.path" class="flex cursor-pointer items-start gap-2 border-b border-slate-800 px-3 py-2 text-sm last:border-0 hover:bg-slate-800/50">
              <input type="checkbox" class="mt-1" :checked="selectedSet.has(file.path)" :disabled="isActive" @change="togglePath(file.path)" />
              <span class="min-w-0 flex-1"><span class="block truncate">{{ file.path }}</span><span class="text-xs text-slate-500">{{ file.size_label }} · {{ file.age_bucket }}</span></span>
            </label>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        <h3 class="font-semibold">2. Set safety limits</h3>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="text-xs text-slate-400">Test depth<select v-model="depth" :disabled="isActive" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-100"><option value="quick">Quick · 2 profiles</option><option value="standard">Standard · 4 profiles</option><option value="thorough">Thorough · 6 profiles</option></select></label>
          <label v-for="field in [
            ['max_vfs_cache_gib', 'Max VFS cache (GiB)', 1, 2048],
            ['min_free_disk_gib', 'Minimum free disk (GiB)', 1, 65536],
            ['max_memory_mib', 'Max optimizer memory (MiB)', 256, 262144],
            ['max_test_download_gib', 'Max test/provider budget (GiB)', 0.25, 100],
            ['max_duration_minutes', 'Maximum duration (minutes)', 2, 180],
            ['concurrent_streams', 'Concurrent streams', 1, 3],
            ['startup_buffer_mib', 'Startup buffer target (MiB)', 1, 256],
            ['bandwidth_limit_mbps', 'Bandwidth limit Mbps (0 = none)', 0, 100000]
          ]" :key="field[0]" class="text-xs text-slate-400">
            {{ field[1] }}
            <input v-model.number="limits[field[0]]" type="number" :min="field[2]" :max="field[3]" :step="field[0] === 'max_test_download_gib' ? 0.25 : 1" :disabled="isActive" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-100" />
          </label>
        </div>
        <p class="mt-3 text-xs text-amber-200/85">Rclone's maximum VFS cache size is an eviction target, not an absolute byte-perfect ceiling. The test/provider budget bounds requested reads and also reconciles NzbDAV's observed provider-byte delta after each profile; rclone read-ahead can cause a small final overshoot. The optimizer enforces the free-disk and memory checks during reads.</p>
      </div>

      <div v-if="error" class="rounded border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">{{ error }}</div>
      <div class="flex justify-end">
        <button :disabled="actionPending || isActive || !selectedPaths.length || loadingContent" class="rounded bg-sky-700 px-5 py-2 font-medium hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50" @click="startJob">
          {{ actionPending ? 'Working…' : 'Start background optimization' }}
        </button>
      </div>
    </div>
  </div>
</template>
