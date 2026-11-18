<script setup>
import { computed, ref, watch } from 'vue'
import InfiniDyskV2QueueSummary from '~/components/InfiniDyskV2QueueSummary.vue'
import { infinidyskV2ScanProgress, infinidyskV2ScanEstimateText, infinidyskV2SnapshotProgress, infinidyskV2SnapshotStage, infinidyskV2StatusDuration as duration } from '~/helper/infinidyskV2Status.js'
import { infinidyskV2AffectedServices } from '~/helper/infinidyskV2Services.js'
import { infinidyskV2ProviderDiagnostics } from '~/helper/infinidyskV2Providers.js'
import { infinidyskV2IOProgress, infinidyskV2IOEstimateText, infinidyskV2InputIntegrity, formatInfiniDyskV2IORate } from '~/helper/infinidyskV2IO.js'
import { infinidyskV2ActivationExposed, infinidyskV2ConsumerRecovery, infinidyskV2ErrorText, infinidyskV2ImportProgress, infinidyskV2ImportReport, infinidyskV2JobExplanation, infinidyskV2JobPercent, formatInfiniDyskV2Bytes as bytes, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
import { infinidyskV2Repository } from '~/services/infinidyskV2.js'
import { infinidyskV2JobLabel, infinidyskV2JobPresentation } from '~/helper/infinidyskV2Presentation.js'
const props = defineProps({ job: { type: Object, default: null }, kind: { type: String, default: 'migration' }, runtimeGeneration: { type: String, default: null }, currentMode: { type: String, default: null }, observedAt: { type: Number, default: null }, confirmed: { type: Boolean, default: false }, now: { type: Number, default: () => Date.now() } })
const presentation = computed(() => infinidyskV2JobPresentation(props.job, { kind: props.kind, runtimeGeneration: props.runtimeGeneration, currentMode: props.currentMode }))
const borderTone = computed(() => ({ info: 'border-blue-400', warning: 'border-amber-500', success: 'border-emerald-500', neutral: 'border-slate-500' })[presentation.value?.tone] || 'border-slate-500')
const percent = computed(() => infinidyskV2JobPercent(props.job))
const rollbackActive = computed(() => props.job?.status === 'rolling_back')
const snapshot = computed(() => infinidyskV2SnapshotProgress(props.job?.snapshot_progress))
const snapshotActive = computed(() => presentation.value?.active && infinidyskV2SnapshotStage(props.job?.stage))
const scanActive = computed(() => presentation.value?.active && props.job?.stage === 'revalidating')
const scan = computed(() => infinidyskV2ScanProgress(props.job?.scan_progress, {
  active: presentation.value?.active === true, confirmed: props.confirmed, stage: props.job?.stage, now: props.now,
}))
const scanRate = computed(() => scan.value?.rate?.toLocaleString('en-US', { maximumSignificantDigits: 2 }))
const io = computed(() => infinidyskV2IOProgress(props.job?.io_progress, {
  active: presentation.value?.active === true, confirmed: props.confirmed, stage: props.job?.stage, now: props.now,
}))
const ioActive = computed(() => presentation.value?.active && Boolean(io.value && io.value.stage === props.job?.stage))
const ioAmount = value => io.value?.unit === 'bytes' ? bytes(value) : value.toLocaleString('en-US')
const ioRate = computed(() => formatInfiniDyskV2IORate(io.value?.rate, io.value?.unit))
const ioObservedAgo = computed(() => io.value?.updatedAt === undefined ? ''
  : duration(Math.max(0, props.now / 1000 - io.value.updatedAt)))

const affectedServices = computed(() => infinidyskV2AffectedServices(props.job))
const hasProgress = computed(() => !rollbackActive.value && !snapshotActive.value && !ioActive.value
  && typeof props.job?.progress?.percent === 'number'
  && (props.job.progress.phase === props.job.stage || props.job.progress.stage === props.job.stage))
const observedAgo = computed(() => Number.isFinite(props.observedAt) ? duration(Math.max(0, (props.now - props.observedAt) / 1000)) : '')
const elapsed = computed(() => {
  const start = props.job?.created_at
  const end = presentation.value?.active ? props.now / 1000 : props.job?.updated_at
  return typeof start === 'number' && typeof end === 'number' ? duration(end - start) : ''
})
const events = computed(() => Array.isArray(props.job?.events) ? props.job.events.slice(-5) : [])
const report = computed(() => infinidyskV2ImportReport(props.job?.import_report))
const explanation = computed(() => infinidyskV2JobExplanation(props.job))
const consumerRecovery = computed(() => infinidyskV2ConsumerRecovery(props.job))
const importProgress = computed(() => infinidyskV2ImportProgress(props.job?.import_progress))
const providers = computed(() => infinidyskV2ProviderDiagnostics(props.job?.provider_diagnostics))
const inputIntegrity = computed(() => infinidyskV2InputIntegrity(props.job?.input_integrity))
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
  <div v-if="job && presentation" class="space-y-3 rounded border bg-slate-950 p-3" :class="borderTone" role="status" data-testid="v2-job">
    <h3 tabindex="-1" class="font-semibold focus:outline-none" data-testid="v2-job-heading">{{ presentation.title }}</h3>
    <p class="text-sm" data-testid="v2-job-summary">{{ presentation.message }}</p>
    <p v-if="presentation.next" class="text-sm" data-testid="v2-job-next">{{ presentation.next }}</p>
    <p v-if="observedAgo" class="text-xs text-slate-300" data-testid="v2-status-freshness">{{ confirmed ? 'Status checked ' + observedAgo + ' ago.' : 'The latest status could not be confirmed. Last successful check: ' + observedAgo + ' ago.' }} Automatic checks continue while this page is visible.</p>
    <p v-if="elapsed" class="text-xs text-slate-300" data-testid="v2-job-elapsed">{{ presentation.state === 'prepared' ? 'Session elapsed' : presentation.active ? 'Operation elapsed' : 'Recorded duration' }}: {{ elapsed }}<span v-if="presentation.state === 'restored'"> · Includes the attempt and restoration.</span></p>
    <p v-if="presentation.active && presentation.state !== 'prepared' && job.stage" class="text-sm font-medium" data-testid="v2-current-phase">Current phase: {{ infinidyskV2JobLabel(job.stage, job.mode) }}</p>
    <section v-if="scanActive && scan" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="v2-scan-progress">
      <p class="font-semibold">{{ scan.label }}</p>
      <p data-testid="v2-scan-count">Entries inspected: {{ scan.entries.toLocaleString('en-US') }}<span v-if="scan.totalEntries !== undefined"> of {{ scan.totalIsEstimate ? 'about ' : '' }}{{ scan.totalEntries.toLocaleString('en-US') }}</span></p>
      <p v-if="scan.logicalBytes !== undefined">Logical size inspected: {{ bytes(scan.logicalBytes) }}</p>
      <p>Scan elapsed: {{ duration(scan.elapsedSeconds) }}</p>
      <p v-if="scanRate" data-testid="v2-scan-rate">Current measured pace: about {{ scanRate }} entries/s.</p>
      <p v-if="scan.remainingSeconds !== undefined" class="font-medium" data-testid="v2-scan-eta">About {{ duration(scan.remainingSeconds) }} remaining in this scan.</p>
      <p v-else class="text-slate-300" data-testid="v2-scan-estimate-note">{{ infinidyskV2ScanEstimateText(scan.estimateState) }}</p>
      <p class="text-xs text-slate-300">This covers only the current scan. Later test or migration steps are not included; a full-operation finish estimate is not available.</p>
    </section>
    <section v-if="ioActive && io" :key="io.phaseId" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="v2-io-progress">
      <p class="font-semibold">{{ io.label }}</p>
      <p data-testid="v2-io-count">{{ io.countLabel }}: {{ ioAmount(io.processed) }}<span v-if="io.total !== undefined"> of {{ io.totalIsEstimate ? 'about ' : '' }}{{ ioAmount(io.total) }}</span></p>
      <p data-testid="v2-io-elapsed">Phase elapsed: {{ duration(io.elapsedSeconds) }}</p>
      <p v-if="ioObservedAgo" class="text-xs text-slate-300">Last I/O measurement: {{ ioObservedAgo }} ago.</p>
      <p v-if="ioRate" data-testid="v2-io-rate">Current measured pace: about {{ ioRate }}.</p>
      <p v-if="io.remainingSeconds !== undefined" class="font-medium" data-testid="v2-io-eta">About {{ duration(io.remainingSeconds) }} remaining in this phase.</p>
      <p v-else class="text-slate-300" data-testid="v2-io-estimate-note">{{ infinidyskV2IOEstimateText(io.estimateState) }}</p>
      <p class="text-xs text-slate-300">These counters and estimates cover this phase only. Copying, readback, verification and restoration are separate passes; a full-operation finish estimate is not available.</p>
    </section>
    <section v-if="snapshotActive && snapshot" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="v2-snapshot-progress">
      <p class="font-semibold">{{ snapshot.label }}</p>
      <p v-if="snapshot.restoreLabel">{{ snapshot.restoreLabel }}</p>
      <p v-if="snapshot.table_count > 0 && snapshot.table_index > 0 && snapshot.table_index <= snapshot.table_count">Table {{ snapshot.table_index }} of {{ snapshot.table_count }}<span v-if="snapshot.table"> · {{ snapshot.table }}</span></p>
      <p v-if="snapshot.rows !== undefined">Reported rows processed: {{ snapshot.rows.toLocaleString('en-US') }}</p>
      <p v-if="snapshot.elapsed_seconds !== undefined && !elapsed">Reported elapsed: {{ duration(snapshot.elapsed_seconds) }}</p>
      <p v-if="snapshot.idle_seconds > 0">No new phase counters for {{ duration(snapshot.idle_seconds) }}; status checks continue.</p>
      <p v-if="snapshot.stall_warning" class="text-amber-200">DUMB has reported no recent progress. Keep the services and recovery storage available; review the backend status before taking action.</p>
      <p class="text-xs text-slate-300">These are phase counters, not an overall completion percentage.</p>
    </section>
    <InfiniDyskV2QueueSummary :value="job.source_queue" />
    <details v-if="affectedServices.length" class="rounded border border-slate-600 p-3 text-sm" data-testid="v2-affected-services"><summary class="cursor-pointer">Affected managed services ({{ affectedServices.length }})</summary><p class="mt-2">These are the services recorded for this operation. Other services may remain running.</p><ul class="mt-2 list-inside list-disc"><li v-for="name in affectedServices" :key="name">{{ text(name) }}</li></ul></details>

    <p v-if="presentation.active && presentation.state !== 'prepared' && !rollbackActive && job.message" class="text-sm">{{ text(job.message) }}</p>
    <p v-if="presentation.state !== 'prepared' && !(rollbackActive && (infinidyskV2ActivationExposed(job) || consumerRecovery)) && explanation && (presentation.active || presentation.state === 'recovery' || consumerRecovery)" class="text-sm text-amber-200" data-testid="v2-job-explanation">{{ explanation }}</p>
    <section v-if="importProgress && presentation.active && job.stage === 'importing'" class="space-y-1 rounded border border-slate-600 p-3 text-sm" aria-label="Observed import progress" data-testid="v2-import-progress">
      <p class="font-semibold">Observed import progress</p>
      <p v-if="importProgress.stage">Native stage: {{ importProgress.stage.replaceAll('_', ' ') }}</p>
      <dl class="grid grid-cols-2 gap-2"><template v-for="row in importProgress.rows" :key="row.key"><dt>{{ row.label }}</dt><dd>{{ row.value.toLocaleString('en-US') }}</dd></template></dl>
    </section>
    <section v-if="providers && (providers.providers.length || providers.unbound.length)" class="space-y-2 rounded border border-slate-600 p-3 text-sm" aria-label="Provider read observations" data-testid="v2-provider-diagnostics">
      <h4 class="font-semibold">{{ providers.final ? 'Retained provider observations' : 'Provider activity' }}</h4>
      <div v-for="provider in providers.providers" :key="provider.ordinal" class="space-y-1" data-testid="v2-provider-row">
        <p><strong>Provider {{ provider.ordinal }}</strong> · {{ provider.requests.toLocaleString('en-US') }} requests · {{ provider.retries.toLocaleString('en-US') }} retries · {{ bytes(provider.bytesReceived) }} read</p>
        <p v-if="provider.missing">Article not found replies: {{ provider.missing.toLocaleString('en-US') }}.</p>
        <details v-if="provider.errors.length"><summary class="cursor-pointer">Connection and protocol errors</summary><ul class="mt-1 list-inside list-disc"><li v-for="error in provider.errors" :key="error.key">{{ error.label }}: {{ error.count.toLocaleString('en-US') }}</li></ul></details>
      </div>
      <div v-if="providers.unbound.length"><p class="font-medium">Bridge errors before provider selection</p><ul class="list-inside list-disc"><li v-for="error in providers.unbound" :key="error.key">{{ error.label }}: {{ error.count.toLocaleString('en-US') }}</li></ul></div>
      <p class="text-xs text-slate-300">Counts include attempts recovered by a retry or another provider. The native import report determines whether any files remain blocked.</p>
    </section>
    <section v-if="typeof job.error === 'string' && job.error" class="space-y-2 rounded border border-rose-500 p-3 text-sm" data-testid="v2-job-failure">
      <h4 class="font-semibold">{{ rollbackActive ? 'Earlier error' : 'Why it stopped' }}</h4>
      <p class="break-words text-rose-200" role="alert">{{ text(job.error) }}</p>
      <dl v-if="inputIntegrity" class="space-y-1" data-testid="v2-input-integrity">
        <div><dt class="font-medium">Input check</dt><dd>{{ inputIntegrity.label }}</dd></div>
        <div><dt class="font-medium">Affected input</dt><dd data-testid="v2-input-integrity-side">{{ inputIntegrity.sideLabel }} · {{ inputIntegrity.entryType }}</dd></div>
        <div><dt class="font-medium">Changed checks</dt><dd data-testid="v2-input-integrity-changes">{{ inputIntegrity.changes.join(', ') }}</dd></div>
        <div><dt class="font-medium">Diagnostic reference</dt><dd class="break-all font-mono text-xs" data-testid="v2-input-integrity-reference">{{ inputIntegrity.reference }}</dd></div>
      </dl>
    </section>
    <section v-if="consumerRecovery && !rollbackActive" class="space-y-2 rounded border border-amber-500 p-3 text-sm" aria-label="Managed service recovery results" data-testid="v2-consumer-results">
      <p v-if="!consumerRecovery.valid" class="text-amber-200">The service recovery details could not be confirmed. Refresh status and retain both v2 data and v1 recovery evidence.</p>
      <template v-else>
        <p>{{ consumerRecovery.ready ? 'The backend verified the v2 runtime and delivery mount.' : 'The v2 runtime and delivery mount need verification before services can resume.' }}</p>
        <ul v-if="consumerRecovery.failed.length" class="space-y-1" data-testid="v2-consumer-failures"><li v-for="(failure, index) in consumerRecovery.failed" :key="index"><strong>{{ text(failure.process_name) }}</strong> · {{ text(failure.reason_code) }} · {{ text(failure.message) }}</li></ul>
        <div v-if="consumerRecovery.pending.length" data-testid="v2-consumer-pending"><p class="font-semibold">{{ job.status === 'completed' ? 'Left stopped by review' : 'Pending services' }} ({{ consumerRecovery.pending.length }})</p><ul class="list-inside list-disc"><li v-for="name in consumerRecovery.pending" :key="name">{{ text(name) }}</li></ul></div>
        <details v-if="consumerRecovery.resumed.length"><summary class="cursor-pointer">Resumed services ({{ consumerRecovery.resumed.length }})</summary><ul class="list-inside list-disc"><li v-for="name in consumerRecovery.resumed" :key="name">{{ text(name) }}</li></ul></details>
      </template>
    </section>
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
    <p v-if="presentation.active && presentation.state !== 'prepared'" class="text-xs text-slate-400">Closing this panel does not stop the current operation.</p>
    <p v-if="presentation.showProgress && hasProgress" class="text-xs text-slate-300">Current phase: {{ percent }}%. The operation finishes only after its final checks.</p>
    <progress v-if="presentation.showProgress" class="w-full" :value="hasProgress ? percent : undefined" max="100" :aria-label="hasProgress ? `Current phase progress ${percent}%` : 'Current phase in progress'" />
    <p v-if="presentation.state === 'recovery' && job.recovery_required && !infinidyskV2ActivationExposed(job)" class="text-amber-200">Recovery is required. Keep the original data and backups; review the available backend recovery action.</p>
    <section v-if="(presentation.active || presentation.state === 'recovery') && (!infinidyskV2ActivationExposed(job) || rollbackActive) && job.source_storage?.mode === 'archive_recovery' && job.source_storage.rollback_requires_archive === true" class="space-y-2 rounded border border-slate-600 p-3 text-sm" data-testid="v2-archive-recovery-state">
      <p>{{ presentation.state === 'recovery' ? 'Recovery requires the selected archive mount to remain available while DUMB restores v1. Allow additional downtime; later v2 changes are discarded.' : 'Keep the selected migration backup location connected until this operation finishes. DUMB needs its verified archive if v1 has to be restored.' }}</p>
      <p v-if="presentation.state === 'recovery' && job.source_storage.offload_legacy_blobs === true" data-testid="v2-external-input-recovery">This operation uses external storage for the v1 import files. Keep the same migration backup location connected. If its mount or temporary input is unavailable, reconnect it and refresh status. Do not delete or re-register it. DUMB must use the verified recovery archive to restore v1 if the staged input is missing.</p>
      <p class="text-slate-300">{{ presentation.state === 'recovery' ? 'After repairing a storage connection, use Refresh status to recheck the available recovery actions.' : 'Status updates automatically while this page is visible. Use Refresh status if the connection needs to be rechecked.' }}</p>
    </section>
    <p v-if="job.cleanup_required" class="text-amber-200">Native cleanup needs review; SQLite remains active. Review the retained private warnings before reusing the destination or performing any source cleanup.</p>
    <div v-if="job.cleanup" class="space-y-1" data-testid="v2-cleanup-progress">
      <p>Old-installation cleanup: {{ text(job.cleanup.state) }} · {{ text(job.cleanup.message) }}</p>
      <p v-if="Number.isSafeInteger(job.cleanup.deleted_entries) && Number.isSafeInteger(job.cleanup.total_entries)">Reviewed entries removed: {{ job.cleanup.deleted_entries.toLocaleString('en-US') }} / {{ job.cleanup.total_entries.toLocaleString('en-US') }}</p>
      <p v-if="job.cleanup.error" class="text-rose-200" role="alert">{{ text(job.cleanup.error) }}</p>
      <p v-if="job.rollback_retired" class="text-amber-200">Automatic v1 rollback is retired; retained archives and receipts remain protected.</p>
    </div>
    <details class="rounded border border-slate-600 p-3 text-xs" data-testid="v2-job-details">
      <summary class="cursor-pointer font-medium">Retained operation details</summary>
      <p v-if="snapshot && !snapshotActive" class="mt-2" data-testid="v2-retained-snapshot-progress">Last recorded database phase: {{ snapshot.label }}<span v-if="snapshot.restoreLabel"> · {{ snapshot.restoreLabel }}</span></p>

      <div v-if="importProgress && (!presentation.active || job.stage !== 'importing')" class="mt-2 space-y-1" data-testid="v2-retained-native-progress">
        <p class="font-semibold">Last reported native import progress</p>
        <p v-if="importProgress.stage">Native stage: {{ importProgress.stage.replaceAll('_', ' ') }}</p>
        <dl class="grid grid-cols-2 gap-2"><template v-for="row in importProgress.rows" :key="row.key"><dt>{{ row.label }}</dt><dd>{{ row.value.toLocaleString('en-US') }}</dd></template></dl>
      </div>
      <dl class="mt-2 grid grid-cols-2 gap-2"><dt>Job</dt><dd class="break-all">{{ text(job.job_id) }}</dd><dt>Backend state</dt><dd>{{ text(job.status) }}</dd><dt v-if="job.stage">Last stage</dt><dd v-if="job.stage">{{ infinidyskV2JobLabel(job.stage, job.mode) }}</dd></dl>
      <p v-if="(!presentation.active || rollbackActive) && job.message" class="mt-2">{{ text(job.message) }}</p>
      <p v-for="(event, index) in events" :key="index" class="mt-2">{{ text(event?.message || event) }}</p>
    </details>
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
