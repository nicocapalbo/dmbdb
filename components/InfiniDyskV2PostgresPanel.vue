<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import {
  infinidyskV2ActionAllowed, infinidyskV2ErrorText, infinidyskV2NeedsAttention,
  infinidyskV2PreviewFresh, infinidyskV2Support, isInfiniDyskV2CleanupActive, safeInfiniDyskV2Text as text,
} from '~/helper/infinidyskV2.js'
import InfiniDyskV2Review from '~/components/InfiniDyskV2Review.vue'
import InfiniDyskV2Job from '~/components/InfiniDyskV2Job.vue'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const { state, refresh, mutate } = useInfiniDyskV2State()
const managed = ref(true)
const host = ref('')
const port = ref(5432)
const database = ref('infinidysk_v2')
const user = ref('')
const password = ref('')
const sslmode = ref('verify-full')
const preview = ref(null)
const confirmation = ref('')
const actionConfirmation = ref('')
const acknowledgeBackup = ref(false)
const acknowledgeTarget = ref(false)
const error = ref('')
const now = ref(Date.now())
let clockTimer = null
const status = computed(() => state.value.postgres)
const job = computed(() => state.value.postgresJob)
const supported = computed(() => infinidyskV2Support(state.value.capabilities).postgres)
const cleanupBusy = computed(() => isInfiniDyskV2CleanupActive(state.value.majorJob))
const canPreview = computed(() => supported.value && state.value.major?.runtime_generation === '2'
  && state.value.postgresStatusConfirmed && status.value?.protocol === 1 && infinidyskV2ActionAllowed(status.value, 'start')
  && !state.value.busy && !cleanupBusy.value && !infinidyskV2NeedsAttention(job.value)
  && database.value.trim() && (managed.value || (host.value.trim() && user.value.trim() && password.value
    && Number.isInteger(Number(port.value)) && Number(port.value) > 0 && Number(port.value) <= 65535)))
const canStart = computed(() => supported.value && state.value.postgresStatusConfirmed && !state.value.busy && !cleanupBusy.value
  && !infinidyskV2NeedsAttention(job.value) && infinidyskV2PreviewFresh(preview.value, now.value)
  && (infinidyskV2ActionAllowed(preview.value, 'start') || infinidyskV2ActionAllowed(status.value, 'start'))
  && confirmation.value === preview.value.confirmation_text
  && acknowledgeBackup.value && acknowledgeTarget.value)
const actionText = action => status.value?.confirmation_texts?.[action]
  || job.value?.confirmation_texts?.[action] || status.value?.[`${action}_confirmation_text`] || ''
const actionAvailable = action => supported.value && state.value.postgresStatusConfirmed && !state.value.busy && !cleanupBusy.value && job.value?.job_id
  && status.value?.job?.job_id === job.value.job_id
  && (infinidyskV2ActionAllowed(status.value, action) || infinidyskV2ActionAllowed(job.value, action))
const canAct = action => actionAvailable(action) && Boolean(actionText(action))
  && actionConfirmation.value === actionText(action) && acknowledgeBackup.value && acknowledgeTarget.value
const invalidate = () => {
  preview.value = null
  confirmation.value = ''
  acknowledgeBackup.value = false
  acknowledgeTarget.value = false
}
watch(managed, invalidate)
watch(() => job.value?.job_id, () => { actionConfirmation.value = ''; invalidate() })
watch(() => props.open, async open => {
  if (clockTimer) clearInterval(clockTimer)
  if (!open) { password.value = ''; invalidate(); return }
  now.value = Date.now()
  clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
  await refresh()
}, { immediate: true })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer); password.value = '' })
const makePreview = async () => {
  if (!canPreview.value) return
  invalidate()
  error.value = ''
  const target = managed.value ? { use_managed_postgres: true, database: database.value.trim() } : {
    host: host.value.trim(), port: Number(port.value), database: database.value.trim(), user: user.value.trim(),
    password: password.value, sslmode: sslmode.value,
  }
  password.value = ''
  try {
    const response = await mutate('postgres', 'postgresPreview', { target })
    if (response?.protocol !== 1) throw { data: { detail: 'Unsupported database preview protocol.' } }
    preview.value = response
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
  finally { delete target.password }
}
const run = async action => {
  if (action === 'start' ? !canStart.value : !canAct(action)) return
  error.value = ''
  try {
    const method = { start: 'postgresStart', cutover: 'postgresCutover', cancel: 'postgresCancel', rollback: 'postgresRollback' }[action]
    await mutate('postgres', method, {
      ...(action === 'start' ? { preview_token: preview.value.preview_token } : { job_id: job.value.job_id }),
      confirmation: action === 'start' ? confirmation.value : actionConfirmation.value,
      acknowledge_backup: acknowledgeBackup.value,
      acknowledge_destructive_target: acknowledgeTarget.value,
    })
    actionConfirmation.value = ''
  } catch (value) { error.value = infinidyskV2ErrorText(value) }
  finally { invalidate() }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-[1100] overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="infinidysk-v2-pg-title" data-testid="v2-postgres-panel">
    <div class="mx-auto max-w-4xl space-y-4 rounded-lg border border-slate-600 bg-slate-900 p-5 text-slate-100">
      <div class="flex items-center justify-between gap-3"><h2 id="infinidysk-v2-pg-title" class="text-xl font-semibold">InfiniDysk 2 database conversion</h2><button class="button-small" aria-label="Close InfiniDysk 2 database conversion" @click="emit('close')">Close</button></div>
      <p>This tool uses InfiniDysk 2's native SQLite-to-PostgreSQL engine. It is separate from the v1 database migration and the major generation upgrade.</p>
      <p v-if="!supported" class="text-amber-200">This backend does not advertise the required InfiniDysk 2 database protocol. Existing recovery information remains visible; mutations are disabled.</p>
      <p v-if="cleanupBusy" class="text-amber-200">Wait for old-installation cleanup to finish before changing the database provider.</p>
      <p class="text-sm text-slate-300">Copy and synchronization precede cutover. A restart can keep the same process ID; wait for confirmed migration and service health. Cancel or rollback can truncate destination tables, so a verified independent target and backups are required.</p>
      <p v-if="error || state.error" class="text-rose-200" role="alert">{{ error || state.error }}</p>
      <p v-for="(blocker, index) in status?.blockers || []" :key="index" class="text-rose-200">{{ text(typeof blocker === 'string' ? blocker : blocker.message) }}</p>
      <InfiniDyskV2Job :job="job" />
      <fieldset :disabled="!supported || state.busy || infinidyskV2NeedsAttention(job)" class="space-y-3 rounded border border-slate-600 p-3">
        <legend class="px-1 font-semibold">Destination PostgreSQL</legend>
        <label class="block"><input v-model="managed" type="checkbox" data-testid="v2-pg-managed"> Use DUMB-managed PostgreSQL</label>
        <label class="block text-sm">Database<input v-model="database" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-pg-database" @input="invalidate"></label>
        <div v-if="!managed" class="grid gap-3 md:grid-cols-2">
          <label class="block text-sm">Host<input v-model="host" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-pg-host" @input="invalidate"></label>
          <label class="block text-sm">Port<input v-model="port" type="number" min="1" max="65535" class="block w-full rounded bg-slate-800 p-2" data-testid="v2-pg-port" @input="invalidate"></label>
          <label class="block text-sm">User<input v-model="user" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-pg-user" @input="invalidate"></label>
          <label class="block text-sm">Password<input v-model="password" type="password" class="block w-full rounded bg-slate-800 p-2" autocomplete="new-password" data-testid="v2-pg-password" @input="invalidate"></label>
          <label class="block text-sm">TLS<select v-model="sslmode" class="block w-full rounded bg-slate-800 p-2" @change="invalidate"><option value="verify-full">Verify certificate and hostname</option><option value="require">Require encryption</option></select></label>
          <p class="text-xs text-slate-400">Credentials are sent only to the backend preview and cleared from the form. They are never saved in browser recovery storage.</p>
        </div>
      </fieldset>
      <button class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canPreview" data-testid="v2-pg-preview" @click="makePreview">Preview destination and identity checks</button>
      <InfiniDyskV2Review :preview="preview" />
      <div v-if="preview || job" class="space-y-3">
        <label class="flex gap-2 text-sm"><input v-model="acknowledgeBackup" type="checkbox" data-testid="v2-pg-backup">I have verified independent backups and understand that rollback does not merge later writes.</label>
        <label class="flex gap-2 text-sm"><input v-model="acknowledgeTarget" type="checkbox" data-testid="v2-pg-target-ack">I reviewed the physical destination identity and accept destination-table reset during the advertised native recovery actions.</label>
      </div>
      <div v-if="preview" class="space-y-2">
        <p v-if="!infinidyskV2PreviewFresh(preview, now)" class="text-amber-200">This preview is blocked or expired. Review a fresh destination preview.</p>
        <label class="block text-sm">Type <strong>{{ preview.confirmation_text }}</strong><input v-model="confirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-pg-confirmation"></label>
        <button class="button-small border border-blue-500 disabled:opacity-40" :disabled="!canStart" data-testid="v2-pg-start" @click="run('start')">Start native copy and synchronization</button>
      </div>
      <div v-if="['cutover', 'cancel', 'rollback'].some(actionAvailable)" class="space-y-3 rounded border border-amber-600 p-3">
        <label class="block text-sm">Type the exact action confirmation below<input v-model="actionConfirmation" class="block w-full rounded bg-slate-800 p-2" autocomplete="off" data-testid="v2-pg-action-confirmation"></label>
        <div v-for="action in ['cutover', 'cancel', 'rollback']" :key="action">
          <template v-if="actionAvailable(action)"><p class="mb-1 text-sm">{{ action }}: <strong>{{ actionText(action) || 'Awaiting backend authorization' }}</strong></p><button class="button-small border border-amber-500 disabled:opacity-40 capitalize" :disabled="!canAct(action)" :data-testid="`v2-pg-${action}`" @click="run(action)">{{ action }}</button></template>
        </div>
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
</style>
