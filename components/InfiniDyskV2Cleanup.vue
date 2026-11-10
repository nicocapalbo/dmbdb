<script setup>
import { computed, onBeforeUnmount, onMounted, ref, reactive, watch } from 'vue'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import { formatInfiniDyskV2Bytes as bytes, infinidyskV2CleanupReady, infinidyskV2CleanupSupported, infinidyskV2ErrorText, infinidyskV2PreviewFresh, isInfiniDyskV2CleanupActive, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'

const { state, mutate } = useInfiniDyskV2State()
const job = computed(() => state.value.majorJob)
const supported = computed(() => infinidyskV2CleanupSupported(state.value.capabilities))
const eligible = computed(() => supported.value && state.value.majorStatusConfirmed && !state.value.busy
  && state.value.major?.runtime_generation === '2' && job.value?.status === 'completed'
  && !isInfiniDyskV2CleanupActive(job.value) && (job.value.can_cleanup === true || job.value.actions?.cleanup === true))
const preview = ref(null), confirmation = ref(''), error = ref(''), now = ref(Date.now())
const acknowledgements = reactive({ playback: false, test_import: false, rollback_retirement: false })
const labels = {
  playback: 'I verified playback, seeking and existing library paths from the actual media server or player.',
  test_import: 'I completed and checked a real new import through the generation 2 workflow.',
  rollback_retirement: 'I accept permanent retirement of automatic v1 rollback. Retained archives are for separate manual recovery.',
}
const reset = () => { preview.value = null; confirmation.value = ''; for (const key of Object.keys(acknowledgements)) acknowledgements[key] = false }
watch([() => job.value?.job_id, () => job.value?.can_cleanup, () => job.value?.actions?.cleanup, () => job.value?.cleanup?.state, () => state.value.major?.runtime_generation], reset)
let timer
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const ready = computed(() => eligible.value && infinidyskV2CleanupReady({ capabilities: state.value.capabilities, status: state.value.major, job: job.value, preview: preview.value, confirmation: confirmation.value, acknowledgements, now: now.value }))
const fresh = computed(() => infinidyskV2PreviewFresh(preview.value, now.value))
const review = async () => {
  if (!eligible.value) return
  reset(); error.value = ''
  try {
    const result = await mutate('major', 'cleanupPreview', { job_id: job.value.job_id })
    if (result?.protocol !== 1 || result?.job_id !== job.value?.job_id) throw new Error('Cleanup preview could not be confirmed')
    preview.value = result
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
}
const cleanup = async () => {
  if (!ready.value) return
  error.value = ''
  try {
    await mutate('major', 'cleanup', { job_id: job.value.job_id, preview_token: preview.value.preview_token, confirmation: confirmation.value, acknowledgements: { ...acknowledgements } })
    reset()
  } catch (value) { reset(); error.value = infinidyskV2ErrorText(value) }
}
</script>

<template>
  <section v-if="supported && job?.status === 'completed'" class="space-y-3 rounded border border-amber-600 p-3 text-sm" data-testid="v2-cleanup">
    <h3 class="font-semibold">Retire the old v1 installation</h3>
    <p>This optional cleanup removes only backend-verified old installation paths after you validate generation 2. A healthy service does not establish playback or import success.</p>
    <p>Verified migration backups and audit receipts are always kept. PostgreSQL databases and shared dependencies are not deleted. Retiring rollback disables DUMB's automatic v1 recovery even while archives remain.</p>
    <p v-if="job.rollback_retired" class="text-amber-200">Automatic v1 rollback has been retired. Retained archives require a separate manual recovery procedure.</p>
    <p v-if="job.cleanup?.state">Cleanup: {{ text(job.cleanup.state) }} · {{ text(job.cleanup.message) }}</p>
    <p v-if="error" class="text-rose-200" role="alert">{{ error }}</p>
    <button class="button-small" :disabled="!eligible" data-testid="v2-cleanup-preview" @click="review">Review old-installation cleanup</button>
    <div v-if="preview" class="space-y-3" data-testid="v2-cleanup-review">
      <p v-for="(item, index) in preview.blockers || []" :key="`block-${index}`" class="text-rose-200">{{ text(typeof item === 'string' ? item : item.message) }}</p>
      <p v-for="(item, index) in preview.warnings || []" :key="`warn-${index}`" class="text-amber-200">{{ text(typeof item === 'string' ? item : item.message) }}</p>
      <h4 class="font-semibold">Selected old installation paths</h4>
      <div v-for="(target, index) in preview.targets || []" :key="index" class="rounded border border-slate-600 p-2">
        <p class="break-all">{{ text(target.path) }}</p>
        <p v-for="path in target.published_paths || []" :key="path" class="break-all">Published path: {{ text(path) }}</p>
        <p>{{ text(Array.isArray(target.roles) ? target.roles.map(role => ({ v1_data: 'v1 data', v1_runtime: 'v1 runtime' })[role] || role).join(', ') : '') }} · {{ Number.isSafeInteger(target.entries) && target.entries >= 0 ? target.entries.toLocaleString('en-US') : 'Unknown' }} entries · {{ bytes(target.logical_bytes) }} logical size · {{ bytes(target.reclaim_estimate_bytes) }} estimated reclaim</p>
      </div>
      <p>Actual free-space recovery can differ because of hard links, compression or filesystem snapshots. Full source and backup verification runs before retirement and deletion.</p>
      <h4 class="font-semibold">Retained backups and receipts</h4>
      <ul class="space-y-1 break-all"><li v-for="(backup, index) in preview.kept_backups || []" :key="index">{{ text(backup.role) || 'Retained backup' }} · {{ text(backup.reference || backup.path) }} · {{ backup.kept === true ? 'kept' : 'backend review required' }}</li></ul>
      <label v-for="(label, key) in labels" :key="key" class="flex items-start gap-2"><input v-model="acknowledgements[key]" type="checkbox" :disabled="!eligible" :data-testid="`v2-cleanup-ack-${key}`">{{ label }}</label>
      <label class="block">Type <strong>{{ text(preview.confirmation_text) }}</strong><input v-model="confirmation" class="mt-1 block w-full rounded bg-slate-800 p-2" :disabled="!eligible" autocomplete="off" data-testid="v2-cleanup-confirmation"></label>
      <button class="button-small border border-rose-400" :disabled="!ready" data-testid="v2-cleanup-start" @click="cleanup">Retire rollback and remove reviewed v1 files</button>
      <p v-if="preview.ready !== true" class="text-amber-200">Cleanup is blocked. Resolve the backend's checks and generate a fresh review.</p>
      <p v-else-if="!fresh" class="text-amber-200">This cleanup review has expired. Generate and review a fresh preview before proceeding.</p>
    </div>
  </section>
</template>

<style scoped>
[data-appearance-mode='light'] .text-amber-200 { @apply text-amber-800; }
[data-appearance-mode='light'] .text-rose-200 { @apply text-rose-800; }
</style>
