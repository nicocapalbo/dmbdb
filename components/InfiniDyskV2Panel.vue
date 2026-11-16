<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import BackupStorageSelector from '~/components/BackupStorageSelector.vue'
import InfiniDyskV2Cleanup from '~/components/InfiniDyskV2Cleanup.vue'
import { backupDestinationFields, backupStorageSupported } from '~/helper/backupStorage.js'
import {
  INFINIDYSK_V2_ACKNOWLEDGEMENTS, infinidyskV2AcknowledgementKeys, infinidyskV2AcknowledgementsReady,
  infinidyskCompatibilityAuthRequired,
  infinidyskV2ActivationExposed, infinidyskV2ConsumerRecovery, infinidyskV2ConsumerRecoverySupported, infinidyskV2ConsumerActionReady, infinidyskV2RollbackReady,
  infinidyskV2ErrorText, infinidyskV2MajorReady, infinidyskV2NeedsAttention,
  infinidyskV2PreviewFresh, infinidyskV2RenewedPreview, infinidyskV2Selection, infinidyskV2Support, infinidyskV2LowSpaceSupported, infinidyskV2ExternalBlobStagingSupported, infinidyskV2SourceStorageMatches, infinidyskV2ImportReport, infinidyskV2SkipReviewReady, infinidyskV2CancelReady, infinidyskV2CancelSupported,
  normalizeInfiniDyskV2Job, safeInfiniDyskV2Text as text,
} from '~/helper/infinidyskV2.js'
import InfiniDyskV2Review from '~/components/InfiniDyskV2Review.vue'
import InfiniDyskV2Job from '~/components/InfiniDyskV2Job.vue'
import InfiniDyskV2PreviewTask from '~/components/InfiniDyskV2PreviewTask.vue'
import { infinidyskV2AsyncPreviewSupported, infinidyskV2ClientError, infinidyskV2PreviewBlocked, infinidyskV2PreviewOptionsMatch, infinidyskV2PreviewTaskActive } from '~/helper/infinidyskV2Preview.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const { state, refresh, mutate, update, prepareMajorPreview, pollMajorPreview, cancelMajorPreview } = useInfiniDyskV2State()
const preview = ref(null)
const mountBackend = ref('rclone')
const backupDestination = ref('')
const sourceStorageChoice = ref('retain_local')
const reclaimSourceSpace = computed(() => sourceStorageChoice.value !== 'retain_local')
const offloadLegacyBlobs = computed(() => sourceStorageChoice.value === 'offload_blobs')
const confirmation = ref('')
const rollbackConfirmation = ref('')
const cancelConfirmation = ref('')
const retryConfirmation = ref('')
const finishConfirmation = ref('')
const acknowledgePendingConsumers = ref(false)
const acknowledgeDiscardV2Writes = ref(false)
const error = ref('')
const refreshPending = ref(false)
const refreshFeedback = ref('')
const legacyPreviewPending = ref(false)
const previewStartedAt = ref(null)
const ignoredPreviewTaskId = ref(null)
let applyingTask = false
let adoptedTaskId = null
let adoptionGeneration = 0
let catalogLoaded = false
const acknowledgements = reactive(Object.fromEntries(INFINIDYSK_V2_ACKNOWLEDGEMENTS.map(key => [key, false])))
const now = ref(Date.now())
let clockTimer = null
const status = computed(() => state.value.major)
const job = computed(() => state.value.majorJob)
const support = computed(() => infinidyskV2Support(state.value.capabilities))
const asyncPreviewSupported = computed(() => infinidyskV2AsyncPreviewSupported(state.value.capabilities))
const previewTask = computed(() => state.value.majorPreviewTask)
const previewBlocked = computed(() => infinidyskV2PreviewBlocked(state.value))
const canRetryPreview = computed(() => asyncPreviewSupported.value && state.value.majorPreviewUncertain
  && !state.value.majorPreviewPending && !state.value.busy && !previewTask.value
  && Boolean(state.value.majorPreviewRequest))
const backupStorageAllowed = computed(() => state.value.capabilities?.infinidysk_v2_migration_backup_storage === true && backupStorageSupported(state.value.capabilities, 'infinidysk_v2_archive'))
const lowSpaceAllowed = computed(() => infinidyskV2LowSpaceSupported(state.value.capabilities, status.value))
const externalBlobStagingAllowed = computed(() => infinidyskV2ExternalBlobStagingSupported(state.value.capabilities, status.value))
const selection = computed(() => ({ ...infinidyskV2Selection(status.value, mountBackend.value), ...(backupStorageAllowed.value ? backupDestinationFields(state.value.capabilities, backupDestination.value, 'infinidysk_v2_archive') : {}), ...(reclaimSourceSpace.value ? { reclaim_source_space: true } : {}), ...(offloadLegacyBlobs.value ? { offload_legacy_blobs: true } : {}) }))
const mountChoices = computed(() => (status.value?.supported_mount_backends || []).filter(value => ['rclone', 'fuse'].includes(value)))
const canChoose = computed(() => support.value.migration && state.value.majorStatusConfirmed && status.value?.protocol === 1
  && status.value?.runtime_generation !== '2' && mountChoices.value.includes(mountBackend.value)
  && !state.value.busy && !previewBlocked.value && !infinidyskV2NeedsAttention(job.value))
const canPreview = computed(() => canChoose.value && (!backupDestination.value || backupStorageAllowed.value)
  && (!reclaimSourceSpace.value || (lowSpaceAllowed.value && Boolean(backupDestination.value)))
  && (!offloadLegacyBlobs.value || externalBlobStagingAllowed.value))
const requiredAcknowledgements = computed(() => infinidyskV2AcknowledgementKeys(preview.value))
const fresh = computed(() => infinidyskV2PreviewFresh(preview.value, now.value))
const reviewed = computed(() => fresh.value && confirmation.value === preview.value.confirmation_text
  && infinidyskV2AcknowledgementsReady(preview.value, acknowledgements))
const rehearsal = computed(() => job.value?.mode === 'rehearsal'
  && job.value?.plan_fingerprint === preview.value?.plan_fingerprint ? job.value : null)
const rehearsalReport = computed(() => infinidyskV2ImportReport(rehearsal.value?.import_report))
const canRehearse = computed(() => canPreview.value && reviewed.value && preview.value.rehearsal_required === true)
const canStart = computed(() => canPreview.value && (preview.value?.rehearsal_required !== true || infinidyskV2SkipReviewReady(state.value.capabilities, rehearsalReport.value, acknowledgements.skipped_media))
  && infinidyskV2MajorReady({
  preview: preview.value, confirmation: confirmation.value, acknowledgements,
  job: job.value, rehearsalJob: rehearsal.value, now: now.value,
}))
const rollbackText = computed(() => job.value?.rollback_confirmation_text || status.value?.rollback_confirmation_text || '')
const activationExposed = computed(() => infinidyskV2ActivationExposed(job.value))
const consumerRecovery = computed(() => infinidyskV2ConsumerRecovery(job.value))
const consumerRecoverySupported = computed(() => infinidyskV2ConsumerRecoverySupported(state.value.capabilities))
const retryText = computed(() => job.value?.confirmation_texts?.retry_consumers || '')
const finishText = computed(() => job.value?.confirmation_texts?.finish_consumer_recovery || '')
const retryOffered = computed(() => consumerRecoverySupported.value && job.value?.can_retry_consumers === true)
const finishOffered = computed(() => consumerRecoverySupported.value && job.value?.can_finish_consumer_recovery === true)
const canRetryConsumers = computed(() => infinidyskV2ConsumerActionReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: job.value, action: 'retry_consumers', confirmation: retryConfirmation.value }))
const canFinishConsumerRecovery = computed(() => infinidyskV2ConsumerActionReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: job.value, action: 'finish_consumer_recovery', confirmation: finishConfirmation.value, acknowledgePendingConsumers: acknowledgePendingConsumers.value }))
const cancelSupported = computed(() => infinidyskV2CancelSupported(state.value.capabilities))
const cancelText = computed(() => job.value?.cancel_confirmation_text || '')
const cancelOffered = computed(() => !activationExposed.value && cancelSupported.value && (job.value?.can_cancel === true || job.value?.actions?.cancel === true))
const canCancel = computed(() => infinidyskV2CancelReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: job.value, confirmation: cancelConfirmation.value }))
const rollbackOffered = computed(() => (job.value?.can_rollback === true || job.value?.actions?.rollback === true)
  && (!activationExposed.value || (job.value?.status === 'completed' && job.value?.rollback_requires_discard_ack === true)))
const canRollback = computed(() => infinidyskV2RollbackReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: job.value, confirmation: rollbackConfirmation.value, confirmationText: rollbackText.value, acknowledgeDiscardV2Writes: acknowledgeDiscardV2Writes.value }))
const ackLabels = {
  backup: 'I have a separate, verified backup of v1’s database, settings, keys and library links.',
  downtime: 'I will keep imports, playback and scans stopped until testing, migration and service checks finish.',
  beta: 'I accept this InfiniDysk 2 beta and the upgrade and recovery limits shown here.',
  oidc_policy: 'I checked my sign-in settings, including OIDC if used, and have a working recovery login.',
  downstream: 'I checked media and Arr paths, remote mappings, symlinks and STRM origins, and paused external writers and scanners.',
  archive_recovery: 'I allow DUMB to reuse the v1 directory after the recovery archive is verified. I will keep that archive available; restoring v1 takes extra downtime and discards later v2 changes.',
  external_blob_staging: 'I allow DUMB to remove local v1 blobs after verifying the external copy and recovery archive. I will keep this storage connected until testing, migration and any recovery finish.',
  skipped_media: 'I reviewed and accept these exact skipped items. They will not be in v2; automatic repair or replacement is not guaranteed.',
}
const invalidate = () => {
  preview.value = null
  confirmation.value = ''
  for (const key of INFINIDYSK_V2_ACKNOWLEDGEMENTS) acknowledgements[key] = false
}
const invalidateSelection = () => {
  if (!applyingTask && previewTask.value && !infinidyskV2PreviewTaskActive(previewTask.value)) ignoredPreviewTaskId.value = previewTask.value.task_id
  invalidate()
}
const storageCatalogChanged = () => {
  if (catalogLoaded) invalidateSelection()
  else { catalogLoaded = true; invalidate() }
}
watch(mountBackend, invalidateSelection, { flush: 'sync' })
watch(backupDestination, invalidateSelection, { flush: 'sync' })
watch(backupStorageAllowed, invalidateSelection, { flush: 'sync' })
watch(lowSpaceAllowed, invalidateSelection, { flush: 'sync' })
watch(sourceStorageChoice, invalidateSelection, { flush: 'sync' })
watch(externalBlobStagingAllowed, invalidateSelection, { flush: 'sync' })
watch(asyncPreviewSupported, invalidateSelection, { flush: 'sync' })
watch(previewTask, task => { applyPreviewTask(task) })
watch(() => rehearsalReport.value?.review_digest, () => { acknowledgements.skipped_media = false })
watch(() => state.value.capabilities?.infinidysk_v2_reviewed_skips, () => { acknowledgements.skipped_media = false })
watch(() => job.value?.job_id, () => { cancelConfirmation.value = ''; rollbackConfirmation.value = '' })
watch(() => JSON.stringify([job.value?.job_id, job.value?.status, job.value?.recovery_kind, job.value?.activation_exposed, job.value?.activation_committed, job.value?.consumer_recovery, job.value?.confirmation_texts, job.value?.can_retry_consumers, job.value?.can_finish_consumer_recovery, job.value?.rollback_requires_discard_ack, state.value.capabilities?.infinidysk_v2_consumer_recovery, state.value.capabilities?.infinidysk_v2_consumer_recovery_protocol]), () => {
  retryConfirmation.value = ''; finishConfirmation.value = ''; acknowledgePendingConsumers.value = false; acknowledgeDiscardV2Writes.value = false
})
watch(job, current => { preview.value = infinidyskV2RenewedPreview(preview.value, current) })
watch(() => props.open, async open => {
  if (clockTimer) clearInterval(clockTimer)
  if (!open) return
  now.value = Date.now()
  clockTimer = setInterval(() => {
    now.value = Date.now()
    if (asyncPreviewSupported.value && previewBlocked.value) pollMajorPreview()
  }, 2000)
  await refresh()
  const requestedMount = state.value.majorRequestedMountBackend
  update({ majorRequestedMountBackend: null })
  if (previewTask.value && asyncPreviewSupported.value && !infinidyskV2NeedsAttention(job.value)) await applyPreviewTask(previewTask.value)
  else mountBackend.value = !infinidyskV2NeedsAttention(job.value) && mountChoices.value.includes(requestedMount)
    ? requestedMount : infinidyskV2Selection(status.value).mount_backend
}, { immediate: true })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })

function validatedPreview(result) {
  if (result?.protocol !== 1) throw infinidyskV2ClientError('Unsupported preview protocol. Refresh backend capabilities before retrying.')
  if (result?.target?.mount_backend !== mountBackend.value
    || (selection.value.mode === 'migrate' && result?.current?.mount_path !== result?.target?.mount_path)) {
    throw infinidyskV2ClientError('The preview does not preserve the selected mount and exact existing path. Refresh status.')
  }
  if (!infinidyskV2SourceStorageMatches(result, reclaimSourceSpace.value, offloadLegacyBlobs.value)) {
    throw infinidyskV2ClientError('The preview did not confirm the selected local-space and archive-recovery policy. Refresh status and review again.')
  }
  return result
}
async function applyPreviewTask(task) {
  if (!props.open || !asyncPreviewSupported.value || !task || task.task_id === ignoredPreviewTaskId.value
    || infinidyskV2NeedsAttention(job.value)) return
  const current = ++adoptionGeneration
  if (adoptedTaskId !== task.task_id) { invalidate(); adoptedTaskId = task.task_id }
  applyingTask = true
  mountBackend.value = task.options.mount_backend
  backupDestination.value = task.options.backup_destination_id
  sourceStorageChoice.value = task.options.offload_legacy_blobs ? 'offload_blobs' : task.options.reclaim_source_space ? 'reuse_local' : 'retain_local'
  applyingTask = false
  await nextTick()
  if (current !== adoptionGeneration || task.task_id !== previewTask.value?.task_id || task.task_id === ignoredPreviewTaskId.value) return
  if (task.status !== 'completed' || !task.preview_available) { preview.value = null; return }
  try {
    if (!infinidyskV2PreviewOptionsMatch(task.options, selection.value)) throw infinidyskV2ClientError('The retained preview does not match the current selection. Generate a fresh preview.')
    preview.value = infinidyskV2RenewedPreview(validatedPreview(task.preview), job.value)
    error.value = ''
  } catch (value) { invalidate(); error.value = infinidyskV2ErrorText(value) }
}
const makePreview = async () => {
  if (!canPreview.value) return
  invalidate()
  error.value = ''
  refreshFeedback.value = ''
  previewStartedAt.value = Date.now()
  try {
    if (asyncPreviewSupported.value) {
      const task = await prepareMajorPreview(selection.value)
      await applyPreviewTask(task)
    } else {
      legacyPreviewPending.value = true
      preview.value = validatedPreview(await mutate('major', 'preview', selection.value))
    }
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
  finally { legacyPreviewPending.value = false }
}
const refreshPanel = async () => {
  if (refreshPending.value) return
  refreshPending.value = true
  refreshFeedback.value = 'Refreshing migration status…'
  try {
    await refresh({ force: true })
    if (asyncPreviewSupported.value) {
      await pollMajorPreview()
      await applyPreviewTask(previewTask.value)
    }
    if (state.value.majorStatusConfirmed && !state.value.majorPreviewUncertain) {
      error.value = ''
      refreshFeedback.value = 'Status refreshed at ' + new Date().toLocaleTimeString() + '. '
        + (preview.value ? 'Preview ready for review.' : infinidyskV2PreviewTaskActive(previewTask.value) ? 'The read-only preview is still running.' : 'Current migration status is confirmed.')
    } else refreshFeedback.value = 'Status is still unconfirmed. Keep the current request and check again before starting another scan.'
  } catch (value) { error.value = infinidyskV2ErrorText(value); refreshFeedback.value = 'Could not confirm the latest migration status.' }
  finally { refreshPending.value = false }
}
const retryPreview = async () => {
  if (!canRetryPreview.value) return
  try {
    error.value = ''
    const task = await prepareMajorPreview(state.value.majorPreviewRequest.options, { retry: true })
    await applyPreviewTask(task)
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
}
const run = async action => {
  if (action === 'rehearse' ? !canRehearse.value : !canStart.value) return
  error.value = ''
  const token = preview.value.preview_token
  try {
    const response = await mutate('major', action, {
      preview_token: token, confirmation: confirmation.value,
      acknowledgements: Object.fromEntries([...requiredAcknowledgements.value, ...(action === 'start' && rehearsalReport.value?.review_required ? ['skipped_media'] : [])].map(key => [key, acknowledgements[key] === true])),
      ...(action === 'start' && rehearsal.value ? { rehearsal_job_id: rehearsal.value.job_id } : {}),
      ...(action === 'start' && rehearsalReport.value?.status === 'review_required' ? { skip_review_digest: rehearsalReport.value.review_digest } : {}),
    })
    const started = normalizeInfiniDyskV2Job(response)
    if (!started) throw { data: { detail: 'The backend did not confirm a migration job. Refresh status before retrying.' } }
    if (action === 'start') invalidate()
  } catch (value) {
    invalidate()
    error.value = infinidyskV2ErrorText(value)
  }
}
const rollback = async () => {
  if (!canRollback.value) return
  error.value = ''
  try {
    await mutate('major', 'rollback', { job_id: job.value.job_id, confirmation: rollbackConfirmation.value, ...(job.value.rollback_requires_discard_ack === true ? { acknowledge_discard_v2_writes: acknowledgeDiscardV2Writes.value } : {}) })
    rollbackConfirmation.value = ''
    invalidate()
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
}
const cancel = async () => {
  if (!canCancel.value) return
  error.value = ''
  try {
    await mutate('major', 'cancel', { job_id: job.value.job_id, confirmation: cancelConfirmation.value })
    cancelConfirmation.value = ''
    invalidate()
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
}
const recoverConsumers = async action => {
  const retry = action === 'retryConsumers'
  if (retry ? !canRetryConsumers.value : !canFinishConsumerRecovery.value) return
  error.value = ''
  try {
    await mutate('major', action, { job_id: job.value.job_id, confirmation: retry ? retryConfirmation.value : finishConfirmation.value, ...(!retry ? { acknowledge_pending_consumers: acknowledgePendingConsumers.value } : {}) })
    retryConfirmation.value = ''; finishConfirmation.value = ''; acknowledgePendingConsumers.value = false
    invalidate()
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-[1100] overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="infinidysk-v2-title" data-testid="v2-panel">
    <div class="mx-auto max-w-4xl space-y-4 rounded-lg border border-slate-600 bg-slate-900 p-5 text-slate-100">
      <div class="flex items-center justify-between gap-3"><h2 id="infinidysk-v2-title" class="text-xl font-semibold">InfiniDysk 2 migration</h2><button class="button-small" aria-label="Close InfiniDysk 2 migration" @click="emit('close')">Close</button></div>
      <p>Choose where to keep the v1 recovery copy and how v2 will mount your library. Test the migration before upgrading; your existing library paths are preserved.</p>
      <p v-if="!support.migration" class="text-amber-200">Starting or changing a migration requires DUMB API 2.24.0 or newer and the explicit protocol 1 capabilities. Retained recovery information stays visible.</p>
      <p v-if="status?.runtime_generation === '2'" class="text-emerald-200">InfiniDysk 2 is already selected. {{ consumerRecovery && job?.status !== 'completed' ? 'Resolve the current service recovery before changing its database provider.' : 'Use its separate database tool for a provider conversion.' }}</p>
      <p v-if="status?.mode === 'fresh'" class="text-blue-200">Fresh installation: the backend must verify that no existing library data will be replaced.</p>
      <p v-for="(blocker, index) in status?.eligibility?.blockers || []" :key="index" class="text-rose-200">{{ text(typeof blocker === 'string' ? blocker : blocker.message) }}</p>
      <p v-if="error || state.error" role="alert" class="text-rose-200">{{ error || state.error }}</p>
      <InfiniDyskV2PreviewTask v-if="status?.runtime_generation !== '2' && !infinidyskV2NeedsAttention(job)" :task="previewTask" :pending="state.majorPreviewPending" :uncertain="state.majorPreviewUncertain"
        :confirmed="state.majorPreviewConfirmed" :cancel-pending="state.majorPreviewCancelPending" :can-retry="canRetryPreview"
        :legacy-busy="legacyPreviewPending" :started-at="previewStartedAt" :now="now"
        @refresh="refreshPanel" @cancel="cancelMajorPreview" @retry="retryPreview" />
      <p v-if="state.majorPreviewError && status?.runtime_generation !== '2' && !infinidyskV2NeedsAttention(job)" role="alert" class="text-rose-200" data-testid="v2-preview-error">{{ state.majorPreviewError }}</p>
      <InfiniDyskV2Job :job="job" />
      <section v-if="consumerRecovery" class="space-y-3 rounded border border-amber-500 p-3" aria-label="InfiniDysk 2 service recovery" data-testid="v2-consumer-recovery">
        <h3 class="font-semibold">{{ job?.status === 'completed' ? (consumerRecovery.pending.length ? 'Services left stopped' : 'Service recovery results') : 'Continue InfiniDysk 2 service recovery' }}</h3>
        <p>Keep the v2 data and retained v1 evidence. Retry verifies the owned v2 runtime and mount before resuming only the retained pending services. It does not repeat the import or restore v1.</p>
        <p v-if="!consumerRecoverySupported" class="text-amber-200" data-testid="v2-consumer-recovery-unsupported">This backend has not advertised the supported service recovery controls. Refresh status and keep the retained data; no recovery request will be sent.</p>
        <div v-if="retryOffered" class="space-y-2">
          <label class="block">Type <strong>{{ text(retryText) || 'Awaiting backend retry authorization' }}</strong><input v-model="retryConfirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-retry-consumers-confirmation"></label>
          <button class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canRetryConsumers" data-testid="v2-retry-consumers" @click="recoverConsumers('retryConsumers')">{{ job?.activation_committed === true ? 'Retry pending consumers' : 'Verify/restart v2 and retry consumers' }}</button>
        </div>
        <div v-if="finishOffered" class="space-y-2 border-t border-slate-600 pt-3">
          <p>Finish only after reviewing every pending service above. Those services remain stopped, and their warnings remain available after completion.</p>
          <label class="flex items-start gap-2 text-sm"><input v-model="acknowledgePendingConsumers" type="checkbox" data-testid="v2-finish-consumers-ack">I accept that the listed pending services remain stopped and will review their errors before starting them later.</label>
          <label class="block">Type <strong>{{ text(finishText) || 'Awaiting backend finish authorization' }}</strong><input v-model="finishConfirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-finish-consumers-confirmation"></label>
          <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canFinishConsumerRecovery" data-testid="v2-finish-consumers" @click="recoverConsumers('finishConsumerRecovery')">Finish with pending services stopped</button>
        </div>
      </section>
      <div v-if="cancelOffered && job?.cancel_requested !== true" class="space-y-2 rounded border border-amber-600 p-3" data-testid="v2-cancel-review">
        <p>Stop the migration safely and restore v1 and its affected apps. Keep DUMB and the selected recovery storage running until restoration is verified.</p>
        <label class="block">Type <strong>{{ cancelText || 'Awaiting backend cancellation authorization' }}</strong><input v-model="cancelConfirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-cancel-confirmation"></label>
        <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canCancel" data-testid="v2-cancel" @click="cancel">Stop migration and restore v1</button>
      </div>
      <p v-else-if="job && !consumerRecovery && job.cancel_requested !== true && !rollbackOffered && infinidyskV2NeedsAttention(job)" class="text-sm text-amber-200" data-testid="v2-recovery-unavailable">{{ activationExposed ? 'The v2 target may contain new writes. Refresh its current recovery authorization and keep both v2 data and retained v1 evidence.' : cancelSupported ? 'DUMB has not authorized cancellation or rollback at this stage. Refresh status to reconcile the worker and recovery state; keep the retained job files and archives.' : 'This backend has not authorized a recovery action for the current job and does not advertise cooperative migration cancellation. Refresh status to reconcile its worker state; keep the retained job files and archives.' }}</p>
      <section v-if="infinidyskCompatibilityAuthRequired(status?.current) && !infinidyskCompatibilityAuthRequired(preview?.target)" class="rounded border border-slate-600 p-3 text-sm" data-testid="v2-compatibility-auth-current">
        <p>InfiniDysk requires a sign-in for the retained backend address.</p>
        <details class="mt-2 text-sm"><summary class="cursor-pointer text-slate-300">Why sign-in is required</summary><p class="mt-2 text-slate-300">DUMB requires native authentication for the compatibility listener. Your stored policy is unchanged, and the native interface cannot relax this launch requirement. Using the same backend and frontend port disables that compatibility listener.</p></details>
      </section>
      <section v-if="status?.runtime_generation !== '2'" class="space-y-3 rounded border border-slate-600 p-3" data-testid="v2-migration-backup">
        <h3 class="font-semibold">Migration backup location</h3>
        <p class="text-sm">{{ status?.mode === 'fresh' ? 'Choose where to keep this installation’s recovery files. The active v2 database stays local.' : 'DUMB saves a v1 recovery copy here before testing or upgrading. If migration fails, this copy is used to restore v1.' }}</p>
        <BackupStorageSelector v-if="backupStorageAllowed" v-model="backupDestination" :capabilities="state.capabilities" kind="infinidysk_v2_archive" label="Migration backup location" legacy-label="Use the local migration recovery folder (default)" :compact-management="true" :disabled="!canChoose" @catalog-changed="storageCatalogChanged" />
        <p v-else class="text-sm text-slate-300">This backend uses its existing local recovery folder. A newer backend can also use registered mounted backup storage.</p>
        <p v-if="backupDestination && !backupStorageAllowed" role="alert" class="text-rose-200">The selected backup location cannot be confirmed by this backend. Refresh capabilities before making another preview.</p>
      </section>
      <fieldset v-if="lowSpaceAllowed || reclaimSourceSpace" :disabled="!canChoose" class="space-y-3 rounded border border-slate-600 p-3 text-sm" data-testid="v2-low-space">
        <legend class="px-1 font-semibold">Local disk space</legend>
        <label class="flex items-start gap-2"><input v-model="sourceStorageChoice" type="radio" value="retain_local" data-testid="v2-retain-source-space"><span><strong>Keep v1 data locally (default)</strong><span class="block mt-1 text-slate-300">Keep the original v1 files while DUMB creates a separate v2 working copy. This uses the most local disk space.</span></span></label>
        <label class="flex items-start gap-2"><input v-model="sourceStorageChoice" type="radio" value="reuse_local" :disabled="!lowSpaceAllowed" data-testid="v2-reclaim-source-space"><span><strong>Reuse the v1 directory</strong><span class="block mt-1 text-slate-300">Avoid a second full copy by reusing the local v1 files after the recovery archive is verified. The legacy blobs still occupy local space during import.</span></span></label>
        <label v-if="externalBlobStagingAllowed || offloadLegacyBlobs" class="flex items-start gap-2"><input v-model="sourceStorageChoice" type="radio" value="offload_blobs" :disabled="!externalBlobStagingAllowed" data-testid="v2-offload-legacy-blobs"><span><strong>Move v1 blobs to external storage</strong><span class="block mt-1 text-slate-300">Copy and verify the legacy import files on the selected migration storage, then remove their local copies to free space for v2. The v2 working database stays local.</span></span></label>
        <p v-if="offloadLegacyBlobs" class="text-slate-300" data-testid="v2-offload-storage-explanation">The migration location needs room for both the v1 recovery archive and a temporary expanded copy of the v1 blob files. Keep it connected throughout testing, migration and recovery.</p>
        <p v-if="reclaimSourceSpace" class="rounded border border-amber-600 p-3 text-amber-200">Restoring v1 requires the selected recovery archive and additional downtime. Later v2 changes are discarded.</p>
        <p v-if="reclaimSourceSpace && !backupDestination" class="text-rose-200" role="alert">Choose a registered external migration backup location above before generating a preview.</p>
        <p v-if="reclaimSourceSpace && !lowSpaceAllowed" class="text-rose-200" role="alert">This backend cannot confirm the selected storage-reuse option. Refresh status or choose “Keep v1 data locally” before generating another preview.</p>
        <p v-else-if="offloadLegacyBlobs && !externalBlobStagingAllowed" class="text-rose-200" role="alert">This backend cannot confirm moving the legacy blobs to external storage. Refresh status or select another storage choice.</p>
      </fieldset>
      <fieldset :disabled="!canChoose" class="space-y-2 rounded border border-slate-600 p-3">
        <legend class="px-1 font-semibold">Mount after migration</legend>
        <label class="block"><input v-model="mountBackend" type="radio" value="rclone" :disabled="!mountChoices.includes('rclone')"> Keep rclone over WebDAV (default)</label>
        <label class="block"><input v-model="mountBackend" type="radio" value="fuse" :disabled="!mountChoices.includes('fuse')"> Use InfiniDysk native FUSE</label>
        <p class="text-sm text-slate-300">Existing library path: <span class="break-all">{{ text(status?.current?.mount_path) || 'Backend preview required' }}</span></p>
        <details class="text-sm text-slate-300"><summary class="cursor-pointer">FUSE requirements</summary><p class="mt-2">DUMB must verify device access, permissions, mount ownership and visibility to every app that uses the library.</p></details>
      </fieldset>
      <details class="rounded border border-slate-600 p-3 text-sm text-slate-300"><summary class="cursor-pointer font-semibold">What stays the same</summary><p class="mt-2">Existing library paths, symlinks and STRM files are preserved. Signed stream links still need the original identity keys and reachable URLs. Check external apps and playback before resuming their imports and scans.</p><p class="mt-2">Migration first creates the InfiniDysk 2 SQLite database locally. A later switch to PostgreSQL uses the separate database tool.</p></details>
      <button class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canPreview" data-testid="v2-preview" @click="makePreview">Preview {{ status?.mode === 'fresh' ? 'fresh installation' : 'migration' }}</button>
      <InfiniDyskV2Review :preview="preview" />
      <InfiniDyskV2Cleanup v-if="status?.runtime_generation === '2' && !(consumerRecovery && job?.status !== 'completed')" />
      <div v-if="preview" class="space-y-3">
        <p v-if="!fresh" class="text-amber-200">{{ preview.ready === false ? 'Resolve the blockers above, then generate a new preview.' : 'This preview has expired. Generate and review a fresh preview.' }}</p>
        <label v-for="key in requiredAcknowledgements" :key="key" class="flex items-start gap-2 text-sm"><input v-model="acknowledgements[key]" type="checkbox" :data-testid="`v2-ack-${key}`">{{ ackLabels[key] }}</label>
        <label v-if="rehearsalReport?.review_required" class="flex items-start gap-2 text-sm text-amber-200"><input v-model="acknowledgements.skipped_media" type="checkbox" :disabled="!rehearsalReport.valid || state.capabilities?.infinidysk_v2_reviewed_skips !== true" data-testid="v2-ack-skipped_media">{{ ackLabels.skipped_media }}</label>
        <label class="block text-sm">Type <strong>{{ preview.confirmation_text }}</strong><input v-model="confirmation" class="mt-1 block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-confirmation"></label>
        <div class="flex flex-wrap gap-3">
          <button v-if="preview.rehearsal_required" class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canRehearse" data-testid="v2-rehearse" @click="run('rehearse')">Test migration</button>
          <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canStart" data-testid="v2-start" @click="run('start')">{{ status?.mode === 'fresh' ? 'Install InfiniDysk 2' : 'Start migration' }}</button>
        </div>
        <p v-if="preview.rehearsal_required" class="text-xs text-slate-400">A successful test migration is required for this exact preview. Changing a choice or letting the preview expire requires another review and test.</p>
      </div>
      <div v-if="rollbackOffered" class="space-y-2 rounded border border-amber-600 p-3">
        <template v-if="job?.rollback_requires_discard_ack === true">
          <p class="text-amber-200">Returning to retained v1 discards writes accepted by v2. Preserve any v2 data you need before requesting this rollback.</p>
          <label class="flex items-start gap-2 text-sm"><input v-model="acknowledgeDiscardV2Writes" type="checkbox" data-testid="v2-rollback-discard-ack">I accept discarding v2 writes when returning to the retained v1 state.</label>
        </template>
        <p>Rollback restores retained original state; later writes may be lost. Follow the backend recovery checks before resuming imports or scans.</p>
        <label class="block">Type <strong>{{ rollbackText || 'Awaiting backend recovery authorization' }}</strong><input v-model="rollbackConfirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-rollback-confirmation"></label>
        <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canRollback" data-testid="v2-rollback" @click="rollback">Restore v1</button>
      </div>
      <button class="button-small disabled:opacity-40" :disabled="refreshPending" data-testid="v2-refresh-status" @click="refreshPanel">{{ refreshPending ? 'Refreshing status…' : 'Refresh status' }}</button>
      <p v-if="refreshFeedback" class="text-sm" role="status" data-testid="v2-refresh-feedback">{{ refreshFeedback }}</p>
    </div>
  </div>
</template>

<style scoped>
[data-appearance-mode='light'] .text-amber-200 {
  @apply text-amber-800;
}

[data-appearance-mode='light'] .text-rose-200 {
  @apply text-rose-800;
}

[data-appearance-mode='light'] .text-emerald-200 {
  @apply text-emerald-800;
}

[data-appearance-mode='light'] .text-blue-200 {
  @apply text-blue-800;
}
</style>
