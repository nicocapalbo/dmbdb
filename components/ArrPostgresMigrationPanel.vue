<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import useService from '~/services/useService.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  processName: { type: String, required: true },
  serviceKey: { type: String, required: true }
})
const emit = defineEmits(['close', 'completed'])

const { processService } = useService()
const preflight = ref(null)
const job = ref(null)
const loading = ref(false)
const starting = ref(false)
const error = ref('')
const mode = ref('rehearsal')
const includeLogs = ref(false)
const acknowledgeUnsupported = ref(false)
const acknowledgeBackup = ref(false)
const acknowledgeTargetReset = ref(false)
const confirmation = ref('')
const rollbackConfirmation = ref('')
const rollbackLoading = ref(false)
let pollTimer = null

const activeStatuses = new Set(['queued', 'running', 'rolling_back'])
const isActive = computed(() => activeStatuses.has(String(job.value?.status || '')))
const hasSuccessfulRehearsal = computed(() =>
  job.value?.status === 'completed' && job.value?.mode === 'rehearsal' && job.value?.result?.validated === true
)
const canStart = computed(() =>
  preflight.value?.ready === true &&
  !isActive.value &&
  acknowledgeUnsupported.value &&
  acknowledgeBackup.value &&
  acknowledgeTargetReset.value &&
  confirmation.value === preflight.value?.confirmation_text &&
  (mode.value !== 'cutover' || hasSuccessfulRehearsal.value)
)
const progressPercent = computed(() => Number(job.value?.progress?.percent || 0))
const checks = computed(() => Array.isArray(preflight.value?.checks) ? preflight.value.checks : [])
const events = computed(() => Array.isArray(job.value?.events) ? [...job.value.events].reverse() : [])
const rollbackText = computed(() => `ROLLBACK ${props.processName}`)

const errorText = (value) => value?.response?.data?.detail || value?.data?.detail || value?.message || 'Request failed.'
const formatTime = (value) => {
  if (!value) return ''
  return new Date(Number(value) * 1000).toLocaleString()
}
const statusClass = (status) => {
  if (status === 'pass' || status === 'completed') return 'border-emerald-600/40 bg-emerald-900/25 text-emerald-200'
  if (status === 'warn' || status === 'failed_rolled_back' || status === 'rolled_back') return 'border-amber-600/40 bg-amber-900/25 text-amber-200'
  if (status === 'fail' || status === 'failed' || status === 'interrupted') return 'border-rose-600/40 bg-rose-900/25 text-rose-200'
  return 'border-sky-600/40 bg-sky-900/25 text-sky-200'
}

const stopPolling = () => {
  if (pollTimer) window.clearTimeout(pollTimer)
  pollTimer = null
}

const pollJob = async () => {
  if (!job.value?.job_id) return
  try {
    job.value = await processService.getArrPostgresMigrationStatus(job.value.job_id)
    if (isActive.value && props.open) {
      pollTimer = window.setTimeout(pollJob, 2000)
    } else {
      stopPolling()
      if (job.value?.status === 'completed') emit('completed', job.value)
      await refreshPreflight(false)
    }
  } catch (value) {
    error.value = errorText(value)
    stopPolling()
  }
}

const loadLatestJob = async () => {
  try {
    const response = await processService.getLatestArrPostgresMigration(props.processName)
    job.value = response?.job || null
    if (isActive.value) {
      stopPolling()
      pollTimer = window.setTimeout(pollJob, 300)
    }
  } catch (value) {
    error.value = errorText(value)
  }
}

const refreshPreflight = async (showLoading = true) => {
  if (!props.processName) return
  if (showLoading) loading.value = true
  error.value = ''
  try {
    preflight.value = await processService.getArrPostgresMigrationPreflight(props.processName)
  } catch (value) {
    error.value = errorText(value)
  } finally {
    loading.value = false
  }
}

const openPanel = async () => {
  stopPolling()
  loading.value = true
  error.value = ''
  try {
    await Promise.all([refreshPreflight(false), loadLatestJob()])
    if (hasSuccessfulRehearsal.value) mode.value = 'cutover'
  } finally {
    loading.value = false
  }
}

const startMigration = async () => {
  if (!canStart.value) return
  starting.value = true
  error.value = ''
  try {
    const queued = await processService.startArrPostgresMigration({
      process_name: props.processName,
      mode: mode.value,
      include_logs: includeLogs.value,
      confirmation: confirmation.value,
      acknowledge_unsupported: acknowledgeUnsupported.value,
      acknowledge_backup: acknowledgeBackup.value,
      acknowledge_target_reset: acknowledgeTargetReset.value
    })
    job.value = { ...queued, status: 'queued', progress: { stage: 'queued', percent: 0, message: 'Migration queued.' } }
    confirmation.value = ''
    stopPolling()
    pollTimer = window.setTimeout(pollJob, 300)
  } catch (value) {
    error.value = errorText(value)
  } finally {
    starting.value = false
  }
}

const rollback = async () => {
  if (!job.value?.job_id || rollbackConfirmation.value !== rollbackText.value) return
  rollbackLoading.value = true
  error.value = ''
  try {
    job.value = await processService.rollbackArrPostgresMigration(job.value.job_id, rollbackConfirmation.value)
    rollbackConfirmation.value = ''
    emit('completed', job.value)
    await refreshPreflight(false)
  } catch (value) {
    error.value = errorText(value)
  } finally {
    rollbackLoading.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) openPanel()
  else stopPolling()
}, { immediate: true })
watch(() => props.processName, () => {
  preflight.value = null
  job.value = null
  if (props.open) openPanel()
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3"
    @click.self="emit('close')"
  >
    <section class="relative flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
      <header class="flex items-start justify-between gap-3 border-b border-slate-700 p-4">
        <div>
          <h2 class="text-lg font-semibold text-slate-100">SQLite → PostgreSQL migration</h2>
          <p class="text-sm text-slate-400">{{ processName }} · guided rehearsal, cutover, validation, and rollback</p>
        </div>
        <button class="material-symbols-rounded text-slate-300 hover:text-white" title="Close migration panel" @click="emit('close')">close</button>
      </header>

      <div class="space-y-4 overflow-y-auto p-4 text-sm text-slate-300">
        <div class="rounded border border-amber-600/40 bg-amber-900/20 p-3 text-amber-100">
          Servarr classifies migration of an existing SQLite database as unsupported. This workflow keeps the original SQLite files, creates a cold cutover backup, validates table counts, and automatically restores SQLite configuration when cutover fails.
        </div>

        <div v-if="error" class="rounded border border-rose-600/40 bg-rose-900/25 p-3 text-rose-200">{{ error }}</div>
        <div v-if="loading" class="flex items-center gap-2 text-slate-400">
          <span class="material-symbols-rounded animate-spin">progress_activity</span>
          Running preflight checks…
        </div>

        <template v-else-if="preflight">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="font-semibold text-slate-100">1. Preflight</div>
              <div class="text-xs text-slate-400">No configuration is changed during preflight.</div>
            </div>
            <button class="button-small border border-slate-50/20 hover:apply !px-2 !py-1" :disabled="isActive" @click="refreshPreflight()">
              <span class="material-symbols-rounded !text-[16px]">refresh</span>
              Refresh
            </button>
          </div>

          <div class="grid gap-2 md:grid-cols-2">
            <div v-for="check in checks" :key="check.id" class="rounded border p-2" :class="statusClass(check.status)">
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium">{{ check.id.replaceAll('_', ' ') }}</span>
                <span class="text-[10px] uppercase tracking-wide">{{ check.status }}</span>
              </div>
              <div class="mt-1 text-xs opacity-90">{{ check.message }}</div>
            </div>
          </div>

          <div class="grid gap-2 rounded border border-slate-700/70 bg-slate-950/30 p-3 md:grid-cols-2">
            <div>
              <div class="text-xs uppercase tracking-wide text-slate-500">SQLite source</div>
              <div>Main: {{ preflight.sqlite?.main?.display_size || 'unknown' }}</div>
              <div>Logs: {{ preflight.sqlite?.log?.display_size || 'not present' }}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-slate-500">PostgreSQL targets</div>
              <div class="font-mono text-xs">{{ preflight.postgres?.main_database }}</div>
              <div class="font-mono text-xs">{{ preflight.postgres?.log_database }}</div>
            </div>
          </div>

          <div v-if="job" class="space-y-3 rounded border border-slate-700 bg-slate-950/25 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="font-semibold text-slate-100">Current migration job</div>
                <div class="font-mono text-[11px] text-slate-500">{{ job.job_id }}</div>
              </div>
              <span class="rounded border px-2 py-1 text-xs" :class="statusClass(job.status)">{{ job.status }}</span>
            </div>
            <div class="h-2 overflow-hidden rounded bg-slate-700">
              <div class="h-full bg-sky-500 transition-all" :style="{ width: `${progressPercent}%` }" />
            </div>
            <div v-if="job.progress" class="text-sm">
              <span class="font-medium text-slate-200">{{ job.progress.stage }}:</span> {{ job.progress.message }}
            </div>
            <div v-if="job.error?.message" class="rounded border border-rose-600/40 bg-rose-900/20 p-2 text-rose-200">{{ job.error.message }}</div>
            <div v-if="job.result?.key_row_counts" class="flex flex-wrap gap-2 text-xs">
              <span v-for="(count, table) in job.result.key_row_counts" :key="table" class="rounded border border-slate-600 px-2 py-1">
                {{ table }}: {{ Number(count).toLocaleString() }}
              </span>
            </div>
            <details v-if="events.length" class="rounded border border-slate-700/70 p-2">
              <summary class="cursor-pointer text-xs text-slate-300">Detailed progress ({{ events.length }} events)</summary>
              <div class="mt-2 max-h-52 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-400">
                <div v-for="(event, index) in events" :key="`${event.at}-${index}`">
                  {{ formatTime(event.at) }} · {{ event.percent }}% · {{ event.message }}
                </div>
              </div>
            </details>
          </div>

          <div class="space-y-3 rounded border border-slate-700 p-3">
            <div>
              <div class="font-semibold text-slate-100">2. Choose the operation</div>
              <p class="text-xs text-slate-400">Run a rehearsal first. It imports a consistent snapshot into temporary PostgreSQL databases and returns the service to SQLite.</p>
            </div>
            <label class="flex items-start gap-2 rounded border border-slate-700 p-2" :class="mode === 'rehearsal' ? 'bg-sky-900/20' : ''">
              <input v-model="mode" type="radio" value="rehearsal" class="mt-1 accent-sky-400" :disabled="isActive" />
              <span><strong class="text-slate-100">Rehearsal</strong><span class="block text-xs text-slate-400">Snapshot, schema bootstrap, temporary import, full count validation, cleanup. No cutover.</span></span>
            </label>
            <label class="flex items-start gap-2 rounded border border-slate-700 p-2" :class="mode === 'cutover' ? 'bg-amber-900/20' : ''">
              <input v-model="mode" type="radio" value="cutover" class="mt-1 accent-amber-400" :disabled="isActive || !hasSuccessfulRehearsal" />
              <span><strong class="text-slate-100">Cut over to PostgreSQL</strong><span class="block text-xs text-slate-400">Stops the service, takes a cold backup, imports and validates, then switches the backend. Available after a successful rehearsal.</span></span>
            </label>
            <label class="flex items-start gap-2">
              <input v-model="includeLogs" type="checkbox" class="mt-1 accent-sky-400" :disabled="isActive" />
              <span>Migrate the Arr log database too <span class="block text-xs text-slate-500">Usually unnecessary; leaving this off starts fresh PostgreSQL application logs and shortens downtime.</span></span>
            </label>
          </div>

          <div class="space-y-2 rounded border border-amber-600/30 bg-amber-950/15 p-3">
            <div class="font-semibold text-slate-100">3. Confirm safeguards</div>
            <label class="flex items-start gap-2"><input v-model="acknowledgeUnsupported" type="checkbox" class="mt-1 accent-amber-400" :disabled="isActive" /><span>I understand Servarr does not support assistance for this migration.</span></label>
            <label class="flex items-start gap-2"><input v-model="acknowledgeBackup" type="checkbox" class="mt-1 accent-amber-400" :disabled="isActive" /><span>I understand DUMB will preserve SQLite and config backups under <code>/config/arr-postgres-migration</code>.</span></label>
            <label class="flex items-start gap-2"><input v-model="acknowledgeTargetReset" type="checkbox" class="mt-1 accent-amber-400" :disabled="isActive" /><span>I authorize DUMB to reset the named PostgreSQL target databases during import.</span></label>
            <label class="block text-xs text-slate-400">
              Type <code class="text-amber-200">{{ preflight.confirmation_text }}</code>
              <input v-model="confirmation" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-slate-100" :disabled="isActive" autocomplete="off" />
            </label>
            <button class="button-small border border-amber-500/50 hover:restart !px-3 !py-2" :disabled="!canStart || starting" @click="startMigration">
              <span class="material-symbols-rounded !text-[18px]">database</span>
              <span>{{ starting ? 'Starting…' : mode === 'rehearsal' ? 'Run rehearsal' : 'Start guarded cutover' }}</span>
            </button>
            <div v-if="mode === 'cutover' && !hasSuccessfulRehearsal" class="text-xs text-amber-300">Complete a rehearsal in this panel before cutover is enabled.</div>
          </div>

          <div v-if="job?.rollback_available && job?.mode === 'cutover' && !isActive" class="space-y-2 rounded border border-rose-600/40 bg-rose-950/20 p-3">
            <div class="font-semibold text-rose-100">Rollback to preserved SQLite</div>
            <p class="text-xs text-rose-200">Rollback restores the pre-cutover SQLite configuration. Changes made after cutover are not copied back into SQLite.</p>
            <label class="block text-xs text-slate-400">
              Type <code class="text-rose-200">{{ rollbackText }}</code>
              <input v-model="rollbackConfirmation" class="mt-1 w-full rounded border border-rose-700/60 bg-slate-950 px-3 py-2 font-mono text-slate-100" autocomplete="off" />
            </label>
            <button class="button-small border border-rose-500/50 hover:stop !px-3 !py-2" :disabled="rollbackConfirmation !== rollbackText || rollbackLoading" @click="rollback">
              Restore SQLite
            </button>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
