<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import useService from '~/services/useService.js'
import {
  RCLONE_OPTIMIZER_ACTIVE_STATUSES,
  retainedTraceSummary,
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

const limitFields = [
  { key: 'max_vfs_cache_gib', label: 'Max VFS cache (GiB)', min: 1, max: 2048, step: 1, help: 'Starting ceiling for each isolated candidate cache. Choose a value your cache disk can accommodate with free-space headroom; rclone may temporarily overshoot while evicting.' },
  { key: 'min_free_disk_gib', label: 'Minimum free disk (GiB)', min: 1, max: 65536, step: 1, help: 'Testing stops if free space falls below this reserve. Increase it on shared or capacity-constrained cache storage.' },
  { key: 'max_memory_mib', label: 'Max optimizer memory (MiB)', min: 256, max: 262144, step: 1, help: 'Testing stops when the isolated rclone candidate exceeds this memory guard. Set it below the RAM you can safely spare.' },
  { key: 'max_test_download_gib', label: 'Max test/provider budget (GiB)', min: 0.25, max: 100, step: 0.25, help: 'Shared real-data budget for the complete test. Lower it for provider limits or metered connections; allow for a small read-ahead overshoot.' },
  { key: 'max_duration_minutes', label: 'Maximum duration (minutes)', min: 2, max: 180, step: 1, help: 'Wall-clock deadline shared by all candidate profiles. Slower providers or larger matrices may require more time.' },
  { key: 'concurrent_streams', label: 'Concurrent streams', min: 1, max: 3, step: 1, help: 'Number of selected files read at the same time. Keep this at 1 unless you deliberately need concurrency testing and your provider permits it.' },
  { key: 'startup_buffer_mib', label: 'Startup buffer target (MiB)', min: 1, max: 256, step: 1, help: 'Bytes that must be read before startup time is considered satisfied. Match this to the startup buffering behavior you want to evaluate.' },
  { key: 'bandwidth_limit_mbps', label: 'Bandwidth limit Mbps (0 = none)', min: 0, max: 100000, step: 1, help: 'Optional optimizer-only bandwidth ceiling. Use 0 for no ceiling, or set a value appropriate for your ISP and desired streaming reserve.' },
]

const fallbackSelectionDetails = {
  recent_likely_warm: { label: 'Recent / likely warm', reason: 'Most recently modified file discovered; more likely to have warm metadata or cached provider data.' },
  older_likely_cold: { label: 'Older / likely cold', reason: 'Oldest modified file discovered; more likely to exercise a cold or less recently used path.' },
  large_high_bitrate: { label: 'Largest / high-bandwidth candidate', reason: 'Largest file discovered; used as a practical high-bandwidth and sustained-throughput candidate.' },
  typical: { label: 'Typical / median-age candidate', reason: 'File near the middle of the discovered modification-age range; used as a representative everyday sample.' },
}

const settingRoleMeta = {
  actually_varied: {
    label: 'Actually varied',
    classes: 'border-sky-500/50 bg-sky-950/40 text-sky-200',
    help: 'This streaming-oriented value changes across the predefined candidate profiles and contributes to the bundle comparison.',
  },
  fixed_constraint: {
    label: 'Fixed test constraint',
    classes: 'border-amber-500/50 bg-amber-950/35 text-amber-200',
    help: 'This value is held constant across candidates as a safety or resource boundary. The optimizer does not tune it.',
  },
  bundled_assumption: {
    label: 'Bundled assumption',
    classes: 'border-violet-500/50 bg-violet-950/35 text-violet-200',
    help: 'This value is part of a predefined profile bundle. It may change from the current command, but it is not varied independently, so the result does not prove this individual value is optimal.',
  },
  nzbdav_recommended: {
    label: 'NzbDAV recommendation',
    classes: 'border-teal-500/50 bg-teal-950/35 text-teal-200',
    help: 'This operational value is held constant across candidates and is recommended from NzbDAV’s RC-aware architecture, not selected by the benchmark score. DUMB recommends at least one week and preserves longer existing values.',
  },
  preserved: {
    label: 'Preserved',
    classes: 'border-slate-600 bg-slate-900 text-slate-300',
    help: 'This existing user value is carried into every candidate unchanged and is not evaluated by the optimizer.',
  },
  legacy: {
    label: 'Legacy result',
    classes: 'border-slate-600 bg-slate-900 text-slate-300',
    help: 'This older job recorded the tested value but did not record its optimizer role or previous value.',
  },
}

const settingImpactNotes = {
  '--buffer-size': 'Per-open-file memory buffer; directly relevant to startup, memory use, and short reads.',
  '--vfs-read-chunk-size': 'Initial remote read chunk; directly relevant to request shape, startup, and sequential throughput.',
  '--vfs-read-chunk-size-limit': 'Upper bound for growing read chunks; directly relevant to sustained reads and provider traffic shape.',
  '--vfs-read-ahead': 'Additional prefetched data beyond the active read; directly relevant to startup/seek tradeoffs and provider bytes.',
  '--vfs-cache-max-size': 'Shared eviction target and disk-safety constraint, not a value selected by candidate scoring.',
  '--vfs-cache-mode': 'Controls VFS caching behavior. It is a profile prerequisite/assumption, not independently evaluated.',
  '--vfs-cache-max-age': 'One week or the longer existing value retains warm file data and can reduce repeat provider downloads; the VFS cache maximum remains the disk-usage constraint.',
  '--dir-cache-time': 'One week or the longer existing value avoids frequent WebDAV metadata refreshes because healthy NzbDAV RC notifications invalidate directories when content changes.',
  '--transfers': 'Preserved from the current command. It primarily controls transfer operations and is not an optimizer streaming dimension.',
}

const localSettingRole = (flag) => {
  if (['--buffer-size', '--vfs-read-chunk-size', '--vfs-read-chunk-size-limit', '--vfs-read-ahead'].includes(flag)) return 'actually_varied'
  if (flag === '--vfs-cache-max-size') return 'fixed_constraint'
  if (['--vfs-cache-max-age', '--dir-cache-time'].includes(flag)) return 'nzbdav_recommended'
  if (flag === '--vfs-cache-mode') return 'bundled_assumption'
  return 'preserved'
}

const settingComparison = (record) => {
  if (record?.setting_comparison?.length) return record.setting_comparison
  return Object.entries(record?.settings || {}).map(([flag, testedValue]) => ({
    flag,
    current_value: null,
    tested_value: testedValue,
    changed_from_current: null,
    role: 'legacy',
  }))
}

const settingRole = (entry) => settingRoleMeta[entry?.role] || settingRoleMeta[localSettingRole(entry?.flag)] || settingRoleMeta.legacy
const settingImpact = (entry) => settingImpactNotes[entry?.flag] || settingRole(entry).help
const settingHelp = (entry) => settingImpactNotes[entry?.flag] ? `${settingRole(entry).help} ${settingImpact(entry)}` : settingRole(entry).help
const settingValue = (value) => value == null ? 'not set' : String(value)
const settingTransition = (entry) => {
  if (entry?.current_value == null || entry?.current_value === entry?.tested_value) return settingValue(entry?.tested_value)
  return `${settingValue(entry.current_value)} → ${settingValue(entry.tested_value)}`
}

const fixedConstraintSummary = computed(() => {
  const values = job.value?.limits || {}
  return [
    { label: 'VFS cache maximum', value: values.max_vfs_cache_gib != null ? `${values.max_vfs_cache_gib} GiB` : '—', help: 'The same rclone VFS cache eviction target is used for every candidate.' },
    { label: 'Bandwidth ceiling', value: Number(values.bandwidth_limit_mbps || 0) > 0 ? `${values.bandwidth_limit_mbps} Mbps` : 'none', help: 'The same optimizer-only bandwidth ceiling is used for every candidate.' },
    { label: 'Memory guard', value: values.max_memory_mib != null ? `${values.max_memory_mib} MiB` : '—', help: 'Testing stops if an isolated candidate exceeds this resident-memory guard.' },
    { label: 'Free-disk reserve', value: values.min_free_disk_gib != null ? `${values.min_free_disk_gib} GiB` : '—', help: 'Testing stops if the cache filesystem falls below this free-space reserve.' },
    { label: 'Job duration', value: values.max_duration_minutes != null ? `${values.max_duration_minutes} min` : '—', help: 'This wall-clock limit is shared by the complete candidate matrix.' },
    { label: 'Concurrent streams', value: values.concurrent_streams ?? '—', help: 'Every candidate uses the same requested stream concurrency.' },
  ]
})

const isActive = computed(() => RCLONE_OPTIMIZER_ACTIVE_STATUSES.has(job.value?.status))
const canApply = computed(() => job.value?.status === 'completed' || job.value?.status === 'rolled_back')
const canRollback = computed(() => job.value?.status === 'applied')
const progress = computed(() => Number(job.value?.progress || 0))
const fileDisplayPath = (file) => file?.display_path || file?.path || ''
const automaticSelectionByPath = computed(() => new Map(
  (content.value?.automatic_selection || []).map((item, index) => [item.path, { ...item, index }])
))
const automaticSelectionPaths = computed(() => (content.value?.automatic_selection || []).map((item) => item.path).filter(Boolean))
const automaticSelectionDetails = (file) => {
  const selected = automaticSelectionByPath.value.get(file?.path)
  if (!selected) return null
  const fallback = fallbackSelectionDetails[selected.selection_key || selected.category] || {}
  return {
    label: selected.selection_label || fallback.label || 'Automatically selected',
    reason: selected.selection_reason || fallback.reason || 'Selected automatically as a representative test file.',
    index: selected.index,
  }
}
const filteredFiles = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const files = content.value?.files || []
  return files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => !needle || fileDisplayPath(file).toLowerCase().includes(needle))
    .sort((left, right) => {
      const leftAuto = automaticSelectionByPath.value.get(left.file.path)?.index
      const rightAuto = automaticSelectionByPath.value.get(right.file.path)?.index
      if (leftAuto != null || rightAuto != null) return (leftAuto ?? Number.MAX_SAFE_INTEGER) - (rightAuto ?? Number.MAX_SAFE_INTEGER)
      return left.index - right.index
    })
    .map(({ file }) => file)
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
    toast.warning({ title: 'Selection limit', message: 'Choose no more than eight files.', timeout: 4000 })
    return
  }
  selectedPaths.value = [...selectedPaths.value, path]
}

const restoreAutomaticSelection = () => {
  selectedPaths.value = automaticSelectionPaths.value.slice(0, 8)
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
    toast.info({ title: 'Rclone test started', message: 'The job will continue in the background if you leave this page.', timeout: 5000 })
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
    toast.success({ title: 'Rclone settings applied', message: 'The service restarted and its mount was verified.', timeout: 6000 })
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
    toast.success({ title: 'Rclone settings rolled back', message: 'The previous command was restored and its mount was verified.', timeout: 6000 })
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
          <a href="https://dumbarr.com/features/rclone-optimizer/" target="_blank" rel="noopener noreferrer" class="button-small border border-slate-50/20 hover:apply" title="Open the rclone streaming optimizer documentation in a new tab.">
            <span class="material-symbols-rounded !text-[18px]">help</span>
            Docs
          </a>
        </div>
        <div class="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2" title="Candidate reads travel through NzbDAV to the configured Usenet providers and can consume real provider traffic."><strong>Real provider reads</strong><br>Data and rate limits apply.</div>
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2" title="The optimizer does not clear the production or provider cache. Recent and older selections are only cache-likelihood heuristics."><strong>No cache purge</strong><br>Warm/cold likelihood stays separate.</div>
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2" title="Testing stops early when NzbDAV reports strong error, retry, failover, throttle, authentication, or open-circuit signals."><strong>Provider guard</strong><br>Errors, throttling, and open circuits stop testing.</div>
          <div class="rounded border border-slate-700 bg-slate-950/40 p-2" title="A recommendation is reported for review. DUMB changes rclone only after you explicitly choose Apply recommendation."><strong>Review first</strong><br>Settings are never auto-applied.</div>
        </div>
      </div>

      <div class="rounded-lg border border-amber-500/50 bg-amber-950/25 p-4 text-amber-100" role="alert">
        <div class="flex items-start gap-3">
          <span class="material-symbols-rounded mt-0.5 text-amber-300">warning</span>
          <div>
            <h3 class="font-semibold">Run the optimizer only while the media stack is idle</h3>
            <p class="mt-1 text-sm text-amber-100/90">
              Stop Plex, Jellyfin, Emby, or any other media server before testing, and wait until NzbDAV has no active imports, library ingestion, or unrelated reads. Playback, scans, and large imports—such as ingesting an entire library—compete for the same network, provider, CPU, memory, and storage resources, which can skew the recommendation and increase provider load.
            </p>
          </div>
        </div>
      </div>

      <div v-if="job" class="rounded-lg border border-slate-700 bg-slate-900/60 p-4" aria-live="polite">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-100">Latest job · {{ job.status }}</p>
            <p class="text-sm text-slate-400">{{ job.stage }}<span v-if="job.updated_at"> · {{ new Date(job.updated_at).toLocaleString() }}</span></p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-if="isActive" :disabled="actionPending" class="rounded bg-rose-800 px-3 py-1.5 text-sm hover:bg-rose-700 disabled:opacity-50" title="Stop the background benchmark and clean up its isolated mount and cache." @click="cancelJob">Cancel test</button>
            <button v-if="canApply" :disabled="actionPending" class="rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50" title="Write the recommended managed rclone flags, stop rclone, detach and verify removal of its production FUSE mount, restart the service, and retain the previous command for rollback." @click="applyRecommendation">Apply recommendation</button>
            <button v-if="canRollback" :disabled="actionPending" class="rounded bg-amber-700 px-3 py-1.5 text-sm hover:bg-amber-600 disabled:opacity-50" title="Restore the previously saved rclone command using the same stop, verified-unmount, restart, and mount-readiness checks." @click="rollbackRecommendation">Roll back</button>
          </div>
        </div>
        <div v-if="isActive" class="mt-3">
          <div class="h-2 overflow-hidden rounded bg-slate-800"><div class="h-full bg-sky-500 transition-all" :style="{ width: `${progress}%` }" /></div>
          <div class="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <div title="The rclone settings profile currently being benchmarked.">Candidate: {{ job.live?.candidate || 'preparing' }}</div>
            <div title="Bytes consumed by completed optimizer sample reads in the current candidate.">Read: {{ formatBytes(job.live?.bytes_read) }}</div>
            <div title="NzbDAV's current active-read count, which can include activity not created by the optimizer.">NzbDAV reads: {{ job.live?.nzbdav?.active_reads ?? '—' }}</div>
            <div title="The 95th-percentile provider segment latency reported by NzbDAV's live metrics window.">Provider p95: {{ job.live?.nzbdav?.provider_latency_p95_ms != null ? `${job.live.nzbdav.provider_latency_p95_ms} ms` : '—' }}</div>
          </div>
        </div>
        <p v-if="job.error" class="mt-3 rounded border border-rose-500/40 bg-rose-950/30 p-2 text-sm text-rose-200">{{ job.error }}</p>
        <div v-if="job.warnings?.length" class="mt-3 rounded border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-100">
          <p class="font-medium">Optimizer notices</p>
          <ul class="mt-1 list-inside list-disc space-y-1 text-xs text-amber-100/90">
            <li v-for="warning in job.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>
        <div v-if="job.cleanup" class="mt-3 grid gap-2 text-xs sm:grid-cols-3" title="A completed job is reported only after DUMB verifies that its isolated shadow mounts, runtime directory, and candidate cache directory are gone.">
          <div class="rounded border p-2" :class="job.cleanup.shadow_mounts_verified ? 'border-emerald-500/35 text-emerald-200' : 'border-rose-500/40 text-rose-200'">Shadow mounts: <strong>{{ job.cleanup.shadow_mounts_verified ? 'removal verified' : 'not verified' }}</strong></div>
          <div class="rounded border p-2" :class="job.cleanup.runtime_removed ? 'border-emerald-500/35 text-emerald-200' : 'border-rose-500/40 text-rose-200'">Runtime files: <strong>{{ job.cleanup.runtime_removed ? 'removed' : 'not removed' }}</strong></div>
          <div class="rounded border p-2" :class="job.cleanup.cache_removed ? 'border-emerald-500/35 text-emerald-200' : 'border-rose-500/40 text-rose-200'">Test cache: <strong>{{ job.cleanup.cache_removed ? 'removed' : 'not removed' }}</strong></div>
        </div>
      </div>

      <div v-if="job?.recommendation" class="rounded-lg border border-emerald-500/35 bg-emerald-950/15 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-emerald-100">Recommendation: {{ job.recommendation.label }}</h3>
            <p class="mt-1 text-sm text-slate-300">{{ job.recommendation.reason }}</p>
            <p class="mt-2 rounded border border-amber-500/40 bg-amber-950/25 px-3 py-2 text-sm text-amber-100" title="Profiles are compared as complete bundles; the optimizer does not run an independent controlled experiment for every individual flag.">
              <strong>Bundle recommendation, not per-setting proof.</strong>
              {{ job.recommendation.confidence_note || 'The winning profile performed best as a complete predefined bundle. Individual bundled values were not independently optimized.' }}
            </p>
          </div>
          <span class="rounded-full border px-2 py-1 text-xs" :class="job.recommendation.applied ? 'border-emerald-500 text-emerald-200' : 'border-amber-500 text-amber-200'">
            {{ job.recommendation.applied ? 'Applied' : 'Not applied' }}
          </span>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="entry in settingComparison(job.recommendation)" :key="entry.flag" class="rounded border border-slate-700 bg-slate-950/45 p-2 text-xs" :title="settingHelp(entry)">
            <div class="flex flex-wrap items-start justify-between gap-1">
              <span class="font-mono text-slate-300">{{ entry.flag }}</span>
              <span class="rounded border px-1.5 py-0.5 text-[10px]" :class="settingRole(entry).classes">{{ settingRole(entry).label }}</span>
            </div>
            <div class="mt-1 font-mono font-semibold text-slate-100">{{ settingTransition(entry) }}</div>
            <div class="mt-1 text-[11px] text-slate-500">{{ settingImpact(entry) }}</div>
          </div>
        </div>
        <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded bg-slate-950/35 p-2" title="Average time for scored samples to read the configured startup-buffer target.">Startup buffer<br><strong>{{ job.recommendation.summary?.startup_ms?.toFixed?.(0) ?? '—' }} ms</strong></div>
          <div class="rounded bg-slate-950/35 p-2" title="Average delay from opening a selected file until the first response byte was received.">First byte<br><strong>{{ job.recommendation.summary?.ttfb_ms?.toFixed?.(0) ?? '—' }} ms</strong></div>
          <div class="rounded bg-slate-950/35 p-2" title="Average early sequential read throughput across scored samples.">Throughput<br><strong>{{ job.recommendation.summary?.throughput_mib_s?.toFixed?.(1) ?? '—' }} MiB/s</strong></div>
          <div class="rounded bg-slate-950/35 p-2" title="Average delay for the optimizer's bounded read near the end of each selected file.">Seek<br><strong>{{ job.recommendation.summary?.seek_ms?.toFixed?.(0) ?? '—' }} ms</strong></div>
        </div>
        <div class="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
          <div class="rounded border border-slate-700 p-2" title="Average startup-buffer time for selected files modified within the last seven days. Recent age suggests—but does not prove—a warmer cache path.">Recent / likely warm startup: <strong>{{ warmColdSummary.recent != null ? `${warmColdSummary.recent.toFixed(0)} ms` : 'not sampled' }}</strong></div>
          <div class="rounded border border-slate-700 p-2" title="Average startup-buffer time for selected files older than seven days. Older age suggests—but does not prove—a colder cache path.">Older / likely cold startup: <strong>{{ warmColdSummary.older != null ? `${warmColdSummary.older.toFixed(0)} ms` : 'not sampled' }}</strong></div>
        </div>
      </div>

      <details v-if="job?.results?.length" class="rounded-lg border border-slate-700 bg-slate-900/45" open>
        <summary class="cursor-pointer px-4 py-3 font-semibold">Candidate report</summary>
        <div class="border-t border-slate-700 p-4">
          <h4 class="font-semibold text-slate-100">What this test did—and did not—optimize</h4>
          <div class="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div v-for="(meta, role) in settingRoleMeta" v-show="role !== 'legacy'" :key="role" class="rounded border p-3" :class="meta.classes" :title="meta.help"><strong>{{ meta.label }}</strong><p class="mt-1 opacity-90">{{ meta.help }}</p></div>
          </div>
          <p class="mt-3 rounded border border-slate-700 bg-slate-950/35 p-3 text-xs text-slate-300">
            <strong>Preserved settings are outside this optimizer's intended streaming dimensions.</strong>
            Apart from the temporary mount path, cache directory, loopback RC, read-only, log-level, and optional bandwidth plumbing required to isolate the test, DUMB carries all other existing rclone flags into every candidate unchanged. Their values are not exposed here because a command can contain credentials. They are expected not to determine this comparison, but an unusual custom rclone flag can still affect behavior and should be reviewed manually.
          </p>
          <div class="mt-3">
            <h5 class="text-sm font-medium text-slate-200">Fixed across every candidate</h5>
            <div class="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <div v-for="constraint in fixedConstraintSummary" :key="constraint.label" class="rounded border border-amber-500/30 bg-amber-950/15 p-2" :title="constraint.help"><span class="text-slate-400">{{ constraint.label }}</span><br><strong class="text-amber-100">{{ constraint.value }}</strong></div>
            </div>
            <p class="mt-2 text-xs text-slate-400" title="The startup buffer is part of how startup time is measured; it is not an rclone value being optimized.">Measurement target: {{ job.limits?.startup_buffer_mib ?? '—' }} MiB must be read before the startup-buffer timer is satisfied. The provider-byte budget is {{ job.limits?.max_test_download_gib ?? '—' }} GiB for the complete test, not a candidate setting.</p>
          </div>
        </div>
        <div class="overflow-x-auto border-t border-slate-700">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="bg-slate-800 text-xs uppercase text-slate-300"><tr><th class="p-2" title="Bounded rclone settings profile tested through an isolated shadow mount.">Profile</th><th class="p-2" title="Average time to fill the configured startup-buffer target.">Startup</th><th class="p-2" title="Average time to receive the first byte after opening a file.">First byte</th><th class="p-2" title="Average early sequential read rate.">Throughput</th><th class="p-2" title="Average bounded seek-read latency near the end of a file.">Seek</th><th class="p-2" title="Peak resident memory observed for the candidate rclone process tree.">Memory</th><th class="p-2" title="Samples used for scoring versus samples excluded because they failed or were incomplete.">Samples</th><th class="p-2" title="NzbDAV trace availability, retained matches, observed provider bytes, and provider-guard state.">NzbDAV</th></tr></thead>
            <tbody>
              <tr v-for="result in job.results" :key="result.id" class="border-t border-slate-800">
                <td class="p-2 font-medium">{{ result.label }}</td>
                <td class="p-2">{{ result.summary?.startup_ms != null ? `${result.summary.startup_ms.toFixed(0)} ms` : '—' }}</td>
                <td class="p-2">{{ result.summary?.ttfb_ms != null ? `${result.summary.ttfb_ms.toFixed(0)} ms` : '—' }}</td>
                <td class="p-2">{{ result.summary?.throughput_mib_s != null ? `${result.summary.throughput_mib_s.toFixed(1)} MiB/s` : '—' }}</td>
                <td class="p-2">{{ result.summary?.seek_ms != null ? `${result.summary.seek_ms.toFixed(0)} ms` : '—' }}</td>
                <td class="p-2">{{ result.resources?.rss_mib != null ? `${result.resources.rss_mib.toFixed(0)} MiB` : '—' }}</td>
                <td class="p-2">{{ result.summary?.scored_samples || 0 }} scored / {{ result.summary?.excluded_samples || 0 }} excluded</td>
                <td class="p-2"><span v-if="result.trace_capture?.available === false" class="text-amber-300" title="NzbDAV stream tracing could not be enabled or queried for this candidate.">trace capture unavailable</span><span v-else-if="result.trace_capture?.available === true" title="Number of retained NzbDAV stream sessions matched to this candidate's selected paths and time window.">{{ result.trace_count || 0 }} traces</span><span v-else class="text-slate-400" title="This older result did not record whether NzbDAV trace capture was available.">trace status unknown</span> · <span title="Increase in NzbDAV's total provider-fetched bytes across this candidate. Unrelated NzbDAV activity can affect this delta.">{{ formatBytes(result.provider_bytes_delta) }} fetched</span><span v-if="result.provider_guard_stop" class="ml-1 text-amber-300" title="The remaining candidate matrix stopped because NzbDAV reported strong provider error, retry, failover, throttle, authentication, or open-circuit signals.">guard stop</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="space-y-2 border-t border-slate-700 p-3">
          <details v-for="result in job.results" :key="`${result.id}-settings`" class="rounded border border-slate-700 bg-slate-950/35 p-2 text-xs text-slate-300" open>
            <summary class="cursor-pointer font-medium text-slate-200" title="Show every optimizer-relevant effective rclone value used for this candidate, including current-to-tested changes and its evaluation role.">{{ result.label }} · complete settings compared</summary>
            <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div v-for="entry in settingComparison(result)" :key="`${result.id}-${entry.flag}`" class="rounded border border-slate-800 bg-slate-950/45 p-2" :title="settingHelp(entry)">
                <div class="flex flex-wrap items-start justify-between gap-1">
                  <span class="font-mono text-slate-300">{{ entry.flag }}</span>
                  <span class="rounded border px-1.5 py-0.5 text-[10px]" :class="settingRole(entry).classes">{{ settingRole(entry).label }}</span>
                </div>
                <div class="mt-1 font-mono font-semibold text-slate-100">{{ settingTransition(entry) }}</div>
                <div v-if="entry.changed_from_current === true" class="mt-1 text-slate-500">current → tested</div>
                <div v-else-if="entry.changed_from_current === false" class="mt-1 text-slate-500">unchanged from current</div>
                <div class="mt-1 text-[11px] text-slate-500">{{ settingImpact(entry) }}</div>
              </div>
            </div>
            <p class="mt-2 text-slate-500">Apart from isolation/safety plumbing, every other existing user flag was preserved unchanged and was not evaluated. Values are intentionally omitted because commands can contain credentials.</p>
            <p class="mt-1" :class="result.shadow_mount_cleanup_verified ? 'text-emerald-300' : 'text-slate-500'">Isolated candidate shadow mount: {{ result.shadow_mount_cleanup_verified ? 'removal verified' : 'cleanup status unavailable for this older result' }}</p>
          </details>
          <details v-for="result in job.results" :key="`${result.id}-nzbdav`" class="rounded border border-slate-700 bg-slate-950/35 p-2 text-xs text-slate-300">
            <summary class="cursor-pointer font-medium text-slate-200" title="Expand NzbDAV overview-window metrics and candidate-matched retained stream traces for this rclone profile.">{{ result.label }} · NzbDAV provider evidence</summary>
            <p class="mt-2 text-slate-500" title="These four values come from NzbDAV's overview metrics after the candidate. They can include unrelated NzbDAV activity, which is why the media stack should be idle during testing.">Overview-window snapshot—not candidate-only. Matched retained traces below are the candidate-specific evidence.</p>
            <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div title="Median provider-fetch latency in NzbDAV's current overview window: 50% of observed provider fetches completed at or below this time."><span class="underline decoration-dotted underline-offset-2">Provider p50</span>: {{ result.nzbdav?.after?.provider_latency_p50_ms ?? '—' }} ms</div>
              <div title="95th-percentile provider-fetch latency in NzbDAV's current overview window: 95% completed at or below this time, while the slowest 5% took longer."><span class="underline decoration-dotted underline-offset-2">Provider p95</span>: {{ result.nzbdav?.after?.provider_latency_p95_ms ?? '—' }} ms</div>
              <div title="NzbDAV's recent error rate per minute in the overview window. It is not limited to this candidate and can include unrelated reads."><span class="underline decoration-dotted underline-offset-2">Errors/min</span>: {{ result.nzbdav?.after?.errors_per_minute ?? '—' }}</div>
              <div title="NzbDAV in-flight article throttle events reported by the overview snapshot. A nonzero or increasing value indicates provider/read concurrency was constrained."><span class="underline decoration-dotted underline-offset-2">Throttle events</span>: {{ result.nzbdav?.after?.throttle_events ?? '—' }}</div>
            </div>
            <p v-if="result.trace_capture?.available === false" class="mt-2 text-amber-300">NzbDAV stream tracing was unavailable for this candidate. The performance measurements remain available, but no provider trace correlation was possible.</p>
            <p v-else-if="result.trace_capture == null" class="mt-2 text-slate-500">This older job did not record trace-capture availability. Its performance measurements remain available, but the absence of matching traces cannot be classified.</p>
            <p v-else-if="!result.stream_traces?.length" class="mt-2 text-slate-500">Trace capture was available, but no retained stream trace matched this candidate's selected paths.</p>
            <div class="mt-3 rounded border border-slate-800 bg-slate-950/40 p-2">
              <div class="flex flex-wrap items-center justify-between gap-1">
                <h6 class="font-medium text-slate-200" title="These values aggregate all retained NzbDAV stream sessions matched to this candidate's selected paths and test time window.">Candidate-matched retained trace summary</h6>
                <span class="text-slate-500">{{ retainedTraceSummary(result).matched }} matched</span>
              </div>
              <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div title="Unique provider nicknames recorded across every candidate-matched retained stream trace."><span class="underline decoration-dotted underline-offset-2">Providers</span><br><strong :class="retainedTraceSummary(result).available ? 'text-slate-100' : 'text-slate-500'">{{ retainedTraceSummary(result).providers }}</strong></div>
                <div title="Sum of retry counts recorded across all candidate-matched retained stream traces."><span class="underline decoration-dotted underline-offset-2">Retries</span><br><strong :class="retainedTraceSummary(result).available ? 'text-slate-100' : 'text-slate-500'">{{ retainedTraceSummary(result).available ? retainedTraceSummary(result).retries : 'not available' }}</strong></div>
                <div title="Sum of bytes served recorded across all candidate-matched retained stream traces."><span class="underline decoration-dotted underline-offset-2">Bytes</span><br><strong :class="retainedTraceSummary(result).available ? 'text-slate-100' : 'text-slate-500'">{{ retainedTraceSummary(result).available ? formatBytes(retainedTraceSummary(result).bytesServed) : 'not available' }}</strong></div>
                <div title="Cumulative retained-event time spent waiting on provider work across all candidate-matched traces."><span class="underline decoration-dotted underline-offset-2">Provider wait</span><br><strong :class="retainedTraceSummary(result).available ? 'text-slate-100' : 'text-slate-500'">{{ retainedTraceSummary(result).available ? `${retainedTraceSummary(result).providerWaitMs} ms` : 'not available' }}</strong></div>
                <div title="Cumulative retained-event time spent acquiring provider connections across all candidate-matched traces."><span class="underline decoration-dotted underline-offset-2">Connection wait</span><br><strong :class="retainedTraceSummary(result).available ? 'text-slate-100' : 'text-slate-500'">{{ retainedTraceSummary(result).available ? `${retainedTraceSummary(result).connectionWaitMs} ms` : 'not available' }}</strong></div>
              </div>
              <p v-if="!retainedTraceSummary(result).available" class="mt-2 text-slate-500">These fields remain visible so the report is explicit: no candidate-matched retained trace was available from which to calculate them.</p>
            </div>
            <div v-if="result.stream_traces?.length" class="mt-2 space-y-1">
              <p class="font-medium text-slate-400">Individual matched traces</p>
              <div v-for="trace in result.stream_traces" :key="trace.session_id" class="rounded border border-slate-800 p-2" title="A retained NzbDAV stream session matched to one of this candidate's selected mount-relative paths and test time window.">
                <span class="font-mono" title="The NzbDAV request path recorded for this matched stream session.">{{ trace.path }}</span><br>
                <span title="Provider nicknames recorded in the matched session's retained events.">Providers: {{ trace.providers?.join(', ') || 'none recorded' }}</span>
                · <span title="Sum of retry counts recorded by retained events for this matched session.">retries: {{ trace.retries || 0 }}</span>
                · <span title="Bytes served recorded by the retained events included in this matched trace.">bytes: {{ formatBytes(trace.bytes_served) }}</span>
                · <span title="Cumulative time retained events spent waiting on provider work for this matched session.">provider wait: {{ trace.provider_wait_ms || 0 }} ms</span>
                · <span title="Cumulative time retained events spent waiting to acquire a provider connection for this matched session.">connection wait: {{ trace.connection_wait_ms || 0 }} ms</span>
              </div>
            </div>
          </details>
        </div>
      </details>

      <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><h3 class="font-semibold">1. Select test content</h3><p class="text-xs text-slate-400" title="Recent and older labels estimate cache likelihood only. NzbDAV's provider metrics and traces show what actually happened.">DUMB suggests a representative starting set from active NzbDAV Arr categories. Keep those files, replace them, or combine them with your own choices—up to eight total. Age is only a cache-likelihood heuristic.</p></div>
          <button :disabled="loadingContent || isActive" class="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50" title="Scan active NzbDAV content categories again and generate a fresh representative automatic selection." @click="loadContent">{{ loadingContent ? 'Scanning…' : 'Rescan content' }}</button>
        </div>
        <div v-if="content" class="mt-3">
          <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span title="Directory entries inspected during the bounded metadata scan.">{{ content.scanned }} entries scanned</span><span>·</span><span title="Choose between one and eight files. Automatic suggestions are optional.">{{ selectedPaths.length }}/8 selected</span><span v-if="content.truncated" title="Discovery stopped at its time or entry bound instead of enumerating the complete remote library.">· bounded scan stopped early</span></div>
          <div v-if="automaticSelectionPaths.length" class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded border border-sky-500/35 bg-sky-950/20 px-3 py-2 text-xs text-slate-300">
            <span><strong class="text-sky-200">Automatic starting set:</strong> {{ automaticSelectionPaths.length }} representative files are pinned to the top and labeled with why they were chosen. You may keep, replace, or mix these selections.</span>
            <button :disabled="isActive" class="rounded border border-sky-500/40 px-2 py-1 text-sky-200 hover:bg-sky-900/40 disabled:opacity-50" title="Discard your current choices and restore DUMB's representative automatic selection." @click="restoreAutomaticSelection">Restore automatic selection</button>
          </div>
          <div v-if="content.active_categories?.length" class="mb-2 rounded border border-slate-700 bg-slate-950/35 px-3 py-2 text-xs text-slate-400" title="DUMB derives these categories from enabled Arr instances linked to NzbDAV and scans them through the configured production mount for metadata only.">
            <strong class="text-slate-300">Content source:</strong>
            {{ content.content_base }}
            <span> · active categories:</span>
            <span v-for="(category, index) in content.active_categories" :key="category.category" :class="category.available ? 'text-slate-300' : 'text-amber-300'">
              {{ index ? ', ' : ' ' }}{{ category.category }} ({{ category.available ? `${category.found} found` : 'missing' }})
            </span>
          </div>
          <input v-model="search" class="w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm" placeholder="Filter available media paths" title="Filter the displayed media list by its friendly NzbDAV content path. Automatic suggestions remain pinned when they match the filter." />
          <div class="mt-2 max-h-64 overflow-auto rounded border border-slate-700">
            <label v-for="file in filteredFiles" :key="file.path" class="flex cursor-pointer items-start gap-2 border-b border-slate-800 px-3 py-2 text-sm last:border-0 hover:bg-slate-800/50" :class="automaticSelectionDetails(file) ? 'bg-sky-950/15' : ''" :title="automaticSelectionDetails(file)?.reason || `Use ${fileDisplayPath(file)} as one of the optimizer's test files.`">
              <input type="checkbox" class="mt-1" :checked="selectedSet.has(file.path)" :disabled="isActive" :aria-label="`${selectedSet.has(file.path) ? 'Remove' : 'Add'} ${fileDisplayPath(file)}`" @change="togglePath(file.path)" />
              <span class="min-w-0 flex-1">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="block min-w-0 flex-1 truncate">{{ fileDisplayPath(file) }}</span>
                  <span v-if="automaticSelectionDetails(file)" class="shrink-0 rounded border border-sky-500/40 bg-sky-950/40 px-1.5 py-0.5 text-[10px] font-medium text-sky-200" :title="automaticSelectionDetails(file).reason">{{ automaticSelectionDetails(file).label }}</span>
                </span>
                <span class="text-xs text-slate-500">{{ file.size_label }} · {{ file.age_bucket }}</span>
                <span v-if="automaticSelectionDetails(file)" class="block truncate text-xs text-sky-300/75" :title="automaticSelectionDetails(file).reason">{{ automaticSelectionDetails(file).reason }}</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        <h3 class="font-semibold">2. Set safety limits</h3>
        <div class="mt-3 rounded border border-amber-500/45 bg-amber-950/25 px-3 py-2 text-sm text-amber-100" role="note">
          <strong>Default starting placeholders only—not recommendations.</strong>
          DUMB does not calculate these values from your CPU, RAM, cache disk, ISP bandwidth, NzbDAV workload, or provider limits. Review and change every value for this deployment before testing; the values below become the real limits used by the job.
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="text-xs text-slate-400" title="Controls how many bounded rclone profiles are tested. More profiles consume more time and provider traffic."><span class="flex items-center gap-1">Test depth <span class="material-symbols-rounded !text-[15px] text-slate-500" aria-hidden="true">help</span></span><select v-model="depth" :disabled="isActive" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-100" title="Quick tests 2 profiles, Standard tests 4, and Thorough tests 6. Choose based on your available time and provider budget."><option value="quick">Quick · 2 profiles</option><option value="standard">Standard · 4 profiles</option><option value="thorough">Thorough · 6 profiles</option></select></label>
          <label v-for="field in limitFields" :key="field.key" class="text-xs text-slate-400" :title="field.help">
            <span class="flex items-center gap-1">{{ field.label }} <span class="material-symbols-rounded !text-[15px] text-slate-500" aria-hidden="true">help</span></span>
            <input v-model.number="limits[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step" :disabled="isActive" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-100" :title="field.help" />
          </label>
        </div>
        <p class="mt-3 text-xs text-amber-200/85" title="These controls reduce risk but cannot guarantee an exact provider-byte total or prevent every temporary rclone cache overshoot.">Rclone's maximum VFS cache size is an eviction target, not an absolute byte-perfect ceiling. The test/provider budget bounds requested reads and also reconciles NzbDAV's observed provider-byte delta after each profile; rclone read-ahead can cause a small final overshoot. The optimizer enforces the free-disk and memory checks during reads.</p>
      </div>

      <div v-if="error" class="rounded border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">{{ error }}</div>
      <div class="flex justify-end">
        <button :disabled="actionPending || isActive || !selectedPaths.length || loadingContent" class="rounded bg-sky-700 px-5 py-2 font-medium hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50" title="Start the background benchmark with the files, profile depth, and deployment-specific limits currently shown. Nothing is applied automatically." @click="startJob">
          {{ actionPending ? 'Working…' : 'Start background optimization' }}
        </button>
      </div>
    </div>
  </div>
</template>
