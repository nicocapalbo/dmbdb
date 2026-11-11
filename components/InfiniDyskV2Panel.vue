<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import BackupStorageSelector from '~/components/BackupStorageSelector.vue'
import InfiniDyskV2Cleanup from '~/components/InfiniDyskV2Cleanup.vue'
import { backupDestinationFields, backupStorageSupported } from '~/helper/backupStorage.js'
import {
  INFINIDYSK_V2_ACKNOWLEDGEMENTS, infinidyskV2AcknowledgementKeys, infinidyskV2AcknowledgementsReady,
  infinidyskCompatibilityAuthRequired,
  infinidyskV2ErrorText, infinidyskV2MajorReady, infinidyskV2NeedsAttention,
  infinidyskV2PreviewFresh, infinidyskV2Selection, infinidyskV2Support,
  isInfiniDyskV2CleanupActive,
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
const confirmation = ref('')
const rollbackConfirmation = ref('')
const error = ref('')
const acknowledgements = reactive(Object.fromEntries(INFINIDYSK_V2_ACKNOWLEDGEMENTS.map(key => [key, false])))
const now = ref(Date.now())
let clockTimer = null
const status = computed(() => state.value.major)
const job = computed(() => state.value.majorJob)
const support = computed(() => infinidyskV2Support(state.value.capabilities))
const backupStorageAllowed = computed(() => state.value.capabilities?.infinidysk_v2_migration_backup_storage === true && backupStorageSupported(state.value.capabilities, 'infinidysk_v2_archive'))
const selection = computed(() => ({ ...infinidyskV2Selection(status.value, mountBackend.value), ...(backupStorageAllowed.value ? backupDestinationFields(state.value.capabilities, backupDestination.value, 'infinidysk_v2_archive') : {}) }))
const mountChoices = computed(() => (status.value?.supported_mount_backends || []).filter(value => ['rclone', 'fuse'].includes(value)))
const canPreview = computed(() => support.value.migration && state.value.majorStatusConfirmed && status.value?.protocol === 1
  && (!backupDestination.value || backupStorageAllowed.value)
  && status.value?.runtime_generation !== '2' && mountChoices.value.includes(mountBackend.value)
  && !state.value.busy && !infinidyskV2NeedsAttention(job.value))
const requiredAcknowledgements = computed(() => infinidyskV2AcknowledgementKeys(preview.value))
const fresh = computed(() => infinidyskV2PreviewFresh(preview.value, now.value))
const reviewed = computed(() => fresh.value && confirmation.value === preview.value.confirmation_text
  && infinidyskV2AcknowledgementsReady(preview.value, acknowledgements))
const rehearsal = computed(() => job.value?.mode === 'rehearsal'
  && job.value?.plan_fingerprint === preview.value?.plan_fingerprint ? job.value : null)
const canRehearse = computed(() => canPreview.value && reviewed.value && preview.value.rehearsal_required === true)
const canStart = computed(() => canPreview.value && infinidyskV2MajorReady({
  preview: preview.value, confirmation: confirmation.value, acknowledgements,
  job: job.value, rehearsalJob: rehearsal.value, now: now.value,
}))
const rollbackText = computed(() => job.value?.rollback_confirmation_text || status.value?.rollback_confirmation_text || '')
const canRollback = computed(() => support.value.migration && state.value.majorStatusConfirmed && !state.value.busy && rollbackText.value
  && !isInfiniDyskV2CleanupActive(job.value)
  && (job.value?.can_rollback === true || job.value?.actions?.rollback === true)
  && rollbackConfirmation.value === rollbackText.value)
const ackLabels = {
  backup: 'I have an independent, verified backup of the original database, settings, identity keys and library links.',
  downtime: 'I accept downtime and will keep affected imports, playback and scans stopped until validation finishes.',
  beta: 'I accept the selected InfiniDysk 2 beta and its migration and rollback limits.',
  oidc_policy: 'I reviewed login and OIDC policy changes and have a recovery login. An unsupported OIDC source remains blocked.',
  downstream: 'I verified existing Arr/media mount paths, remote path mappings, symlinks and STRM playback origins, and stopped external writers and scanners for the upgrade.',
}
const invalidate = () => {
  preview.value = null
  confirmation.value = ''
  for (const key of INFINIDYSK_V2_ACKNOWLEDGEMENTS) acknowledgements[key] = false
}
watch(mountBackend, invalidate)
watch(backupDestination, invalidate)
watch(backupStorageAllowed, invalidate)
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
      acknowledgements: { ...acknowledgements },
      ...(action === 'start' && rehearsal.value ? { rehearsal_job_id: rehearsal.value.job_id } : {}),
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
    await mutate('major', 'rollback', { job_id: job.value.job_id, confirmation: rollbackConfirmation.value })
    rollbackConfirmation.value = ''
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
      <p v-if="status?.runtime_generation === '2'" class="text-emerald-200">InfiniDysk 2 is already selected. Use its separate database tool for a provider conversion.</p>
      <p v-if="status?.mode === 'fresh'" class="text-blue-200">Fresh installation: the backend must verify that no existing library data will be replaced.</p>
      <p v-for="(blocker, index) in status?.eligibility?.blockers || []" :key="index" class="text-rose-200">{{ text(typeof blocker === 'string' ? blocker : blocker.message) }}</p>
      <p v-if="error || state.error" role="alert" class="text-rose-200">{{ error || state.error }}</p>
      <InfiniDyskV2Job :job="job" />
      <p v-if="infinidyskCompatibilityAuthRequired(status?.current)" class="rounded border border-amber-500 p-3 text-sm text-amber-200" data-testid="v2-compatibility-auth-current">DUMB locks native Required authentication for compatibility launches and leaves your stored policy unchanged. The native interface cannot relax this launch requirement.</p>
      <fieldset :disabled="!canPreview" class="space-y-2 rounded border border-slate-600 p-3">
        <legend class="px-1 font-semibold">Mount after migration</legend>
        <label class="block"><input v-model="mountBackend" type="radio" value="rclone" :disabled="!mountChoices.includes('rclone')"> Keep historical rclone over WebDAV (default)</label>
        <label class="block"><input v-model="mountBackend" type="radio" value="fuse" :disabled="!mountChoices.includes('fuse')"> Use InfiniDysk native FUSE</label>
        <p class="text-sm text-slate-300">Existing path: <span class="break-all">{{ text(status?.current?.mount_path) || 'Backend preview required' }}</span>. Native FUSE needs verified device access, permissions, mount ownership and visibility to every consumer.</p>
      </fieldset>
      <p class="text-sm text-slate-300">Import strategy is preserved. This migration does not regenerate symlinks or STRM files. Existing signed stream links require preserved identity keys and reachable original URL routes. Music and book jobs still require symlinks when STRM is selected upstream.</p>
      <p class="text-sm text-slate-300">The major importer stages InfiniDysk 2 SQLite first. Native SQLite-to-PostgreSQL conversion is a separate operation after validation.</p>
      <BackupStorageSelector v-if="backupStorageAllowed && status?.runtime_generation !== '2'" v-model="backupDestination" :capabilities="state.capabilities" kind="infinidysk_v2_archive" legacy-label="Keep legacy local backup tree (default)" :disabled="!canPreview" @catalog-changed="invalidate" />
      <p v-if="backupDestination && !backupStorageAllowed" class="text-amber-200">The selected backup destination cannot be confirmed by this backend. Refresh capabilities before making another preview.</p>
      <button class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canPreview" data-testid="v2-preview" @click="makePreview">Preview {{ status?.mode === 'fresh' ? 'fresh installation' : 'migration' }}</button>
      <InfiniDyskV2Review :preview="preview" />
      <InfiniDyskV2Cleanup v-if="status?.runtime_generation === '2'" />
      <div v-if="preview" class="space-y-3">
        <p v-if="!fresh" class="text-amber-200">This preview is blocked or expired. Generate and review a fresh preview.</p>
        <label v-for="key in requiredAcknowledgements" :key="key" class="flex items-start gap-2 text-sm"><input v-model="acknowledgements[key]" type="checkbox" :data-testid="`v2-ack-${key}`">{{ ackLabels[key] }}</label>
        <label class="block text-sm">Type <strong>{{ preview.confirmation_text }}</strong><input v-model="confirmation" class="mt-1 block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-confirmation"></label>
        <div class="flex flex-wrap gap-3">
          <button v-if="preview.rehearsal_required" class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canRehearse" data-testid="v2-rehearse" @click="run('rehearse')">Run isolated rehearsal</button>
          <button class="button-small border border-amber-500 disabled:opacity-40" :disabled="!canStart" data-testid="v2-start" @click="run('start')">{{ status?.mode === 'fresh' ? 'Install InfiniDysk 2' : 'Start migration' }}</button>
        </div>
        <p v-if="preview.rehearsal_required" class="text-xs text-slate-400">Cutover requires the successful validated rehearsal for this reviewed preview. Changed choices or an expired token require another review.</p>
      </div>
      <div v-if="job?.can_rollback === true || job?.actions?.rollback === true" class="space-y-2 rounded border border-amber-600 p-3">
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
