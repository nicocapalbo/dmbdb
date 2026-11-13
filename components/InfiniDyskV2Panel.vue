<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import BackupStorageSelector from '~/components/BackupStorageSelector.vue'
import InfiniDyskV2Cleanup from '~/components/InfiniDyskV2Cleanup.vue'
import { backupDestinationFields, backupStorageSupported } from '~/helper/backupStorage.js'
import {
  INFINIDYSK_V2_ACKNOWLEDGEMENTS, infinidyskV2AcknowledgementKeys, infinidyskV2AcknowledgementsReady,
  infinidyskCompatibilityAuthRequired,
  infinidyskV2ActivationExposed, infinidyskV2ConsumerRecovery, infinidyskV2ConsumerRecoverySupported, infinidyskV2ConsumerActionReady, infinidyskV2RollbackReady,
  infinidyskV2ErrorText, infinidyskV2MajorReady, infinidyskV2NeedsAttention,
  infinidyskV2PreviewFresh, infinidyskV2RenewedPreview, infinidyskV2Selection, infinidyskV2Support, infinidyskV2LowSpaceSupported, infinidyskV2SourceStorageMatches, infinidyskV2ImportReport, infinidyskV2SkipReviewReady, infinidyskV2CancelReady, infinidyskV2CancelSupported,
  normalizeInfiniDyskV2Job, safeInfiniDyskV2Text as text,
} from '~/helper/infinidyskV2.js'
import InfiniDyskV2Review from '~/components/InfiniDyskV2Review.vue'
import InfiniDyskV2Job from '~/components/InfiniDyskV2Job.vue'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const { state, refresh, mutate, update } = useInfiniDyskV2State()
const preview = ref(null)
const mountBackend = ref('rclone')
const backupDestination = ref('')
const reclaimSourceSpace = ref(false)
const confirmation = ref('')
const rollbackConfirmation = ref('')
const cancelConfirmation = ref('')
const retryConfirmation = ref('')
const finishConfirmation = ref('')
const acknowledgePendingConsumers = ref(false)
const acknowledgeDiscardV2Writes = ref(false)
const error = ref('')
const acknowledgements = reactive(Object.fromEntries(INFINIDYSK_V2_ACKNOWLEDGEMENTS.map(key => [key, false])))
const now = ref(Date.now())
let clockTimer = null
const status = computed(() => state.value.major)
const job = computed(() => state.value.majorJob)
const support = computed(() => infinidyskV2Support(state.value.capabilities))
const backupStorageAllowed = computed(() => state.value.capabilities?.infinidysk_v2_migration_backup_storage === true && backupStorageSupported(state.value.capabilities, 'infinidysk_v2_archive'))
const lowSpaceAllowed = computed(() => infinidyskV2LowSpaceSupported(state.value.capabilities, status.value))
const selection = computed(() => ({ ...infinidyskV2Selection(status.value, mountBackend.value), ...(backupStorageAllowed.value ? backupDestinationFields(state.value.capabilities, backupDestination.value, 'infinidysk_v2_archive') : {}), ...(reclaimSourceSpace.value ? { reclaim_source_space: true } : {}) }))
const mountChoices = computed(() => (status.value?.supported_mount_backends || []).filter(value => ['rclone', 'fuse'].includes(value)))
const canChoose = computed(() => support.value.migration && state.value.majorStatusConfirmed && status.value?.protocol === 1
  && status.value?.runtime_generation !== '2' && mountChoices.value.includes(mountBackend.value)
  && !state.value.busy && !infinidyskV2NeedsAttention(job.value))
const canPreview = computed(() => canChoose.value && (!backupDestination.value || backupStorageAllowed.value)
  && (!reclaimSourceSpace.value || (lowSpaceAllowed.value && Boolean(backupDestination.value))))
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
  backup: 'I have an independent, verified backup of the original database, settings, identity keys and library links.',
  downtime: 'I accept downtime and will keep affected imports, playback and scans stopped until validation finishes.',
  beta: 'I accept the selected InfiniDysk 2 beta and its migration and rollback limits.',
  oidc_policy: 'I reviewed login and OIDC policy changes and have a recovery login. An unsupported OIDC source remains blocked.',
  downstream: 'I verified existing Arr/media mount paths, remote path mappings, symlinks and STRM playback origins, and stopped external writers and scanners for the upgrade.',
  archive_recovery: 'I authorize reusing the local v1 data after archive verification. I accept that rollback requires the selected archive to remain available, restores v1 with additional downtime and discards later v2 writes.',
  skipped_media: 'I reviewed the native import report and accept exactly these skipped items. They will be absent from v2; this does not guarantee automatic repair or replacement.',
}
const invalidate = () => {
  preview.value = null
  confirmation.value = ''
  for (const key of INFINIDYSK_V2_ACKNOWLEDGEMENTS) acknowledgements[key] = false
}
watch(mountBackend, invalidate)
watch(backupDestination, invalidate)
watch(backupStorageAllowed, invalidate)
watch(lowSpaceAllowed, invalidate)
watch(reclaimSourceSpace, invalidate)
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
  clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
  await refresh()
  const requestedMount = state.value.majorRequestedMountBackend
  update({ majorRequestedMountBackend: null })
  mountBackend.value = !infinidyskV2NeedsAttention(job.value) && mountChoices.value.includes(requestedMount)
    ? requestedMount : infinidyskV2Selection(status.value).mount_backend
}, { immediate: true })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })

const makePreview = async () => {
  if (!canPreview.value) return
  invalidate()
  error.value = ''
  try {
    const result = await mutate('major', 'preview', selection.value)
    if (result?.protocol !== 1) throw new Error('Unsupported preview protocol.')
    if (result?.target?.mount_backend !== mountBackend.value
      || (selection.value.mode === 'migrate' && result?.current?.mount_path !== result?.target?.mount_path)) {
      throw { data: { detail: 'The preview does not preserve the selected mount and exact existing path. Refresh status.' } }
    }
    if (!infinidyskV2SourceStorageMatches(result, reclaimSourceSpace.value)) {
      throw { data: { detail: 'The preview did not confirm the selected local-space and archive-recovery policy. Refresh status and review again.' } }
    }
    preview.value = result
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
      <p>Generation, mount transport, database provider and import strategy are separate choices. The original mount path and virtual library namespace must remain usable.</p>
      <p v-if="!support.migration" class="text-amber-200">Starting or changing a migration requires DUMB API 2.24.0 or newer and the explicit protocol 1 capabilities. Retained recovery information stays visible.</p>
      <p v-if="status?.runtime_generation === '2'" class="text-emerald-200">InfiniDysk 2 is already selected. {{ consumerRecovery && job?.status !== 'completed' ? 'Resolve the current service recovery before changing its database provider.' : 'Use its separate database tool for a provider conversion.' }}</p>
      <p v-if="status?.mode === 'fresh'" class="text-blue-200">Fresh installation: the backend must verify that no existing library data will be replaced.</p>
      <p v-for="(blocker, index) in status?.eligibility?.blockers || []" :key="index" class="text-rose-200">{{ text(typeof blocker === 'string' ? blocker : blocker.message) }}</p>
      <p v-if="error || state.error" role="alert" class="text-rose-200">{{ error || state.error }}</p>
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
        <p>Request a cooperative stop and restore v1 with its affected consumers. The job keeps its recovery evidence and remains active until DUMB verifies restoration. Keep the selected archive mount available when local v1 storage was reused.</p>
        <label class="block">Type <strong>{{ cancelText || 'Awaiting backend cancellation authorization' }}</strong><input v-model="cancelConfirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-cancel-confirmation"></label>
        <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canCancel" data-testid="v2-cancel" @click="cancel">Stop migration and restore v1</button>
      </div>
      <p v-else-if="job && !consumerRecovery && job.cancel_requested !== true && !rollbackOffered && infinidyskV2NeedsAttention(job)" class="text-sm text-amber-200" data-testid="v2-recovery-unavailable">{{ activationExposed ? 'The v2 target may contain new writes. Refresh its current recovery authorization and keep both v2 data and retained v1 evidence.' : cancelSupported ? 'DUMB has not authorized cancellation or rollback at this stage. Refresh status to reconcile the worker and recovery state; keep the retained job files and archives.' : 'This backend has not authorized a recovery action for the current job and does not advertise cooperative migration cancellation. Refresh status to reconcile its worker state; keep the retained job files and archives.' }}</p>
      <p v-if="infinidyskCompatibilityAuthRequired(status?.current)" class="rounded border border-amber-500 p-3 text-sm text-amber-200" data-testid="v2-compatibility-auth-current">DUMB locks native Required authentication for compatibility launches and leaves your stored policy unchanged. The native interface cannot relax this launch requirement.</p>
      <fieldset :disabled="!canChoose" class="space-y-2 rounded border border-slate-600 p-3">
        <legend class="px-1 font-semibold">Mount after migration</legend>
        <label class="block"><input v-model="mountBackend" type="radio" value="rclone" :disabled="!mountChoices.includes('rclone')"> Keep historical rclone over WebDAV (default)</label>
        <label class="block"><input v-model="mountBackend" type="radio" value="fuse" :disabled="!mountChoices.includes('fuse')"> Use InfiniDysk native FUSE</label>
        <p class="text-sm text-slate-300">Existing path: <span class="break-all">{{ text(status?.current?.mount_path) || 'Backend preview required' }}</span>. Native FUSE needs verified device access, permissions, mount ownership and visibility to every consumer.</p>
      </fieldset>
      <p class="text-sm text-slate-300">Import strategy is preserved. This migration does not regenerate symlinks or STRM files. Existing signed stream links require preserved identity keys and reachable original URL routes. Music and book jobs still require symlinks when STRM is selected upstream.</p>
      <p class="text-sm text-slate-300">The major importer stages InfiniDysk 2 SQLite first. Native SQLite-to-PostgreSQL conversion is a separate operation after validation.</p>
      <BackupStorageSelector v-if="backupStorageAllowed && status?.runtime_generation !== '2'" v-model="backupDestination" :capabilities="state.capabilities" kind="infinidysk_v2_archive" legacy-label="Keep legacy local backup tree (default)" :disabled="!canChoose" @catalog-changed="invalidate" />
      <p v-if="backupDestination && !backupStorageAllowed" class="text-amber-200">The selected backup destination cannot be confirmed by this backend. Refresh capabilities before making another preview.</p>
      <section v-if="lowSpaceAllowed || reclaimSourceSpace" class="space-y-2 rounded border border-amber-600 p-3 text-sm" data-testid="v2-low-space">
        <label class="flex items-start gap-2"><input v-model="reclaimSourceSpace" type="checkbox" :disabled="!canChoose" data-testid="v2-reclaim-source-space"> Reuse local v1 storage after verifying an external archive</label>
        <p>The normal migration keeps the original v1 data locally. This option reuses that local space for v2 after verifying the selected archive. The working database stays local.</p>
        <p v-if="reclaimSourceSpace" class="text-amber-200">Rollback and rehearsal recovery require the archive mount to remain available and take longer while v1 is restored. Later v2 writes are not merged back into v1.</p>
        <p v-if="reclaimSourceSpace && !backupDestination" class="text-amber-200">Choose a registered backup destination above before generating a preview.</p>
        <p v-if="reclaimSourceSpace && !lowSpaceAllowed" class="text-amber-200" role="alert">This backend cannot confirm the selected storage-reuse option. Refresh status or uncheck it before generating another preview.</p>
      </section>
      <button class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canPreview" data-testid="v2-preview" @click="makePreview">Preview {{ status?.mode === 'fresh' ? 'fresh installation' : 'migration' }}</button>
      <InfiniDyskV2Review :preview="preview" />
      <InfiniDyskV2Cleanup v-if="status?.runtime_generation === '2' && !(consumerRecovery && job?.status !== 'completed')" />
      <div v-if="preview" class="space-y-3">
        <p v-if="!fresh" class="text-amber-200">This preview is blocked or expired. Generate and review a fresh preview.</p>
        <label v-for="key in requiredAcknowledgements" :key="key" class="flex items-start gap-2 text-sm"><input v-model="acknowledgements[key]" type="checkbox" :data-testid="`v2-ack-${key}`">{{ ackLabels[key] }}</label>
        <label v-if="rehearsalReport?.review_required" class="flex items-start gap-2 text-sm text-amber-200"><input v-model="acknowledgements.skipped_media" type="checkbox" :disabled="!rehearsalReport.valid || state.capabilities?.infinidysk_v2_reviewed_skips !== true" data-testid="v2-ack-skipped_media">{{ ackLabels.skipped_media }}</label>
        <label class="block text-sm">Type <strong>{{ preview.confirmation_text }}</strong><input v-model="confirmation" class="mt-1 block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-confirmation"></label>
        <div class="flex flex-wrap gap-3">
          <button v-if="preview.rehearsal_required" class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canRehearse" data-testid="v2-rehearse" @click="run('rehearse')">Run isolated rehearsal</button>
          <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canStart" data-testid="v2-start" @click="run('start')">{{ status?.mode === 'fresh' ? 'Install InfiniDysk 2' : 'Start migration' }}</button>
        </div>
        <p v-if="preview.rehearsal_required" class="text-xs text-slate-400">Cutover requires the successful validated rehearsal for this reviewed preview. Changed choices or an expired token require another review.</p>
      </div>
      <div v-if="rollbackOffered" class="space-y-2 rounded border border-amber-600 p-3">
        <template v-if="job?.rollback_requires_discard_ack === true">
          <p class="text-amber-200">Returning to retained v1 discards writes accepted by v2. Preserve any v2 data you need before requesting this rollback.</p>
          <label class="flex items-start gap-2 text-sm"><input v-model="acknowledgeDiscardV2Writes" type="checkbox" data-testid="v2-rollback-discard-ack">I accept discarding v2 writes when returning to the retained v1 state.</label>
        </template>
        <p>Rollback restores retained original state; later writes may be lost. Follow the backend recovery checks before resuming imports or scans.</p>
        <label class="block">Type <strong>{{ rollbackText || 'Awaiting backend recovery authorization' }}</strong><input v-model="rollbackConfirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-rollback-confirmation"></label>
        <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canRollback" data-testid="v2-rollback" @click="rollback">Run guarded rollback</button>
      </div>
      <button class="button-small" :disabled="state.busy" @click="refresh">Refresh status</button>
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
