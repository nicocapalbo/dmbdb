<script setup>
import { computed, ref, watch } from 'vue'
import { infinidyskV2ErrorText, infinidyskV2ImportReport, infinidyskV2JobPercent, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
import { infinidyskV2Repository } from '~/services/infinidyskV2.js'
const props = defineProps({ job: { type: Object, default: null } })
const percent = computed(() => infinidyskV2JobPercent(props.job))
const hasProgress = computed(() => typeof props.job?.progress === 'number' || typeof props.job?.progress?.percent === 'number')
const events = computed(() => Array.isArray(props.job?.events) ? props.job.events.slice(-5) : [])
const report = computed(() => infinidyskV2ImportReport(props.job?.import_report))
const fullReport = ref('')
const reportError = ref('')
const loadingReport = ref(false)
let reportGeneration = 0
watch([() => props.job?.job_id, () => props.job?.import_report?.review_digest], () => {
  reportGeneration++
  fullReport.value = ''; reportError.value = ''; loadingReport.value = false
})
const loadReport = async () => {
  if (loadingReport.value || !props.job?.job_id) return
  const generation = ++reportGeneration
  loadingReport.value = true; reportError.value = ''
  try {
    const value = await infinidyskV2Repository().report(props.job.job_id)
    if (generation !== reportGeneration) return
    if (typeof value !== 'string' || !value || value.length > 8_000_000) throw { data: { detail: 'The native report response is unavailable or exceeds the supported display size.' } }
    fullReport.value = value
  } catch (error) { if (generation === reportGeneration) reportError.value = infinidyskV2ErrorText(error) }
  finally { if (generation === reportGeneration) loadingReport.value = false }
}
const downloadReport = () => {
  if (!fullReport.value) return
  const url = URL.createObjectURL(new Blob([fullReport.value], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = `infinidysk-import-${props.job.job_id}.txt`; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
</script>

<template>
  <div v-if="job" class="space-y-2 rounded border border-blue-400 bg-slate-950 p-3" role="status" data-testid="v2-job">
    <p class="font-semibold">{{ text(job.status) }} <span v-if="job.stage">· {{ text(job.stage) }}</span></p>
    <p class="text-sm">{{ text(job.message) }}</p>
    <p v-if="typeof job.error === 'string' && job.error" class="text-sm text-rose-200" role="alert">{{ text(job.error) }}</p>
    <section v-if="report" class="space-y-2 rounded border border-slate-600 p-3 text-sm" aria-label="Native import report" data-testid="v2-import-report">
      <p class="font-semibold">Native import report</p>
      <p>Imported files: {{ report.imported_files ?? 'Unknown' }} · Skipped items: {{ report.skipped_files ?? 'Unknown' }}</p>
      <p v-if="!report.valid" class="text-rose-200" role="alert">The report summary could not be fully verified. Cutover remains blocked; review the full report.</p>
      <p v-else-if="report.status === 'review_required'" class="text-amber-200">The native importer excluded these items. Review the omissions before accepting them for cutover. Skipped items are absent from v2 and automatic repair is not guaranteed.</p>
      <p v-else-if="report.status === 'blocked'" class="text-rose-200">This import has blocking omissions or validation problems. Accepting skipped items cannot bypass these checks.</p>
      <p v-for="(reason, index) in report.blocking_reasons" :key="`block-${index}`" class="text-rose-200">{{ text(reason) }}</p>
      <ul class="space-y-1"><li v-for="(reason, index) in report.reasons" :key="index">{{ reason.count }} · {{ text(reason.reason) }}</li></ul>
      <details v-if="report.skipped.length"><summary class="cursor-pointer">Skipped paths and reasons</summary><ul class="mt-2 max-h-72 space-y-1 overflow-y-auto break-all"><li v-for="(item, index) in report.skipped" :key="index">{{ text(item.path) }} · {{ text(item.reason) }}</li></ul></details>
      <p v-if="report.truncated" class="text-amber-200">This summary shows a limited set of details. Open the full native report to review every skipped item.</p>
      <button class="button-small" :disabled="loadingReport" data-testid="v2-load-native-report" @click="loadReport">{{ loadingReport ? 'Loading native report…' : 'Show full native report' }}</button>
      <p v-if="reportError" class="text-rose-200" role="alert">{{ reportError }}</p>
      <div v-if="fullReport" class="space-y-2"><pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-600 p-2" data-testid="v2-full-native-report">{{ fullReport }}</pre><button class="button-small" data-testid="v2-download-native-report" @click="downloadReport">Download report</button></div>
    </section>
    <p class="text-xs text-slate-400">Job {{ job.job_id }} · Closing this panel does not stop the backend job.</p>
    <progress class="w-full" :value="hasProgress ? percent : undefined" max="100" :aria-label="hasProgress ? `Migration progress ${percent}%` : 'Migration in progress'" />
    <p v-if="job.recovery_required" class="text-amber-200">Recovery is required. Keep the original data and backups; review the available backend recovery action.</p>
    <p v-if="job.source_storage?.mode === 'archive_recovery' && job.source_storage.rollback_requires_archive === true" class="text-amber-200" data-testid="v2-archive-recovery-state">This job reuses local v1 storage. Recovery requires the selected archive mount to remain available while DUMB restores v1. Allow additional downtime; later v2 writes are discarded during rollback.</p>
    <p v-if="job.cleanup_required" class="text-amber-200">Native cleanup needs review; SQLite remains active. Review the retained private warnings before reusing the destination or performing any source cleanup.</p>
    <div v-if="job.cleanup" class="space-y-1" data-testid="v2-cleanup-progress">
      <p>Old-installation cleanup: {{ text(job.cleanup.state) }} · {{ text(job.cleanup.message) }}</p>
      <p v-if="Number.isSafeInteger(job.cleanup.deleted_entries) && Number.isSafeInteger(job.cleanup.total_entries)">Reviewed entries removed: {{ job.cleanup.deleted_entries.toLocaleString('en-US') }} / {{ job.cleanup.total_entries.toLocaleString('en-US') }}</p>
      <p v-if="job.cleanup.error" class="text-rose-200" role="alert">{{ text(job.cleanup.error) }}</p>
      <p v-if="job.rollback_retired" class="text-amber-200">Automatic v1 rollback is retired; retained archives and receipts remain protected.</p>
    </div>
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
