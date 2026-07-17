<script setup>
import axios from 'axios'
import { configRepository } from '~/services/config.js'

const props = defineProps({
  processName: { type: String, required: true },
})
const emit = defineEmits(['close'])

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const serviceEntry = ref(null)

const pressureClass = computed(() => ({
  healthy: 'border-emerald-600/40 bg-emerald-900/30 text-emerald-200',
  observing: 'border-sky-600/40 bg-sky-900/30 text-sky-200',
  collecting: 'border-sky-600/40 bg-sky-900/30 text-sky-200',
  moderate: 'border-amber-600/40 bg-amber-900/30 text-amber-200',
  high: 'border-orange-600/40 bg-orange-900/30 text-orange-200',
  critical: 'border-rose-600/40 bg-rose-900/30 text-rose-200',
  unavailable: 'border-slate-600/50 bg-slate-800 text-slate-300',
  disabled: 'border-slate-700 bg-slate-900/40 text-slate-400',
}[serviceEntry.value?.pressure] || 'border-slate-700 bg-slate-900/40 text-slate-300'))

const load = async (refresh = false) => {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ process_name: props.processName })
    if (refresh) params.set('refresh', 'true')
    const { data } = await axios.get(`/api/metrics/database-health?${params.toString()}`)
    serviceEntry.value = (data?.services || [])
      .find((entry) => entry?.process_name === props.processName) || null
    if (!serviceEntry.value) error.value = 'This service is not exposed by the database health collector.'
  } catch (err) {
    error.value = err?.response?.data?.detail || err?.message || 'Failed to load database health.'
  } finally {
    loading.value = false
  }
}

const saveMonitoring = async (enabled, changes = {}) => {
  if (!serviceEntry.value?.id) return
  saving.value = true
  error.value = ''
  try {
    const repository = configRepository()
    const config = await repository.getConfig()
    const current = config?.dumb?.metrics?.database_health || {}
    const services = structuredClone(current.services || {})
    const existing = services[serviceEntry.value.id] || {}
    services[serviceEntry.value.id] = {
      enabled,
      mode: changes.mode || existing.mode || serviceEntry.value.mode || 'standard',
      ignore_network_storage: changes.ignore_network_storage
        ?? existing.ignore_network_storage
        ?? serviceEntry.value.ignore_network_storage
        ?? false,
    }
    await repository.updateGlobalConfig({
      dumb: {
        metrics: {
          database_health: {
            enabled: enabled ? true : current.enabled === true,
            interval_sec: Number(current.interval_sec || 60),
            log_tail_bytes: Number(current.log_tail_bytes || 262144),
            services,
          },
        },
      },
    })
    await load(true)
  } catch (err) {
    error.value = err?.response?.data?.detail || err?.message || 'Failed to save database monitoring settings.'
  } finally {
    saving.value = false
  }
}

const setMode = (event) => saveMonitoring(true, { mode: event.target.value })
const setIgnoreNetworkStorage = (event) => saveMonitoring(true, {
  ignore_network_storage: event.target.checked,
})

onMounted(() => load(false))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-3" @click.self="emit('close')">
    <div class="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
      <button class="absolute right-3 top-3 material-symbols-rounded text-slate-300 hover:text-white" title="Close" @click="emit('close')">
        close
      </button>
      <div class="pr-8">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-lg font-semibold">Database Health · {{ processName }}</h2>
          <a
            href="https://dumbarr.com/features/metrics/#database-health-monitoring"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-sky-300 hover:text-sky-200"
            title="Open the Database Health documentation in a new tab."
          >
            Docs ↗
          </a>
        </div>
        <p class="mt-1 text-xs text-slate-400">
          External, read-only pressure indicators for SQL databases and application-owned persistent stores. This does not profile application SQL or predict an exact PostgreSQL performance gain.
        </p>
      </div>

      <div v-if="loading" class="mt-5 text-sm text-slate-400">Loading database health…</div>
      <div v-else-if="error && !serviceEntry" class="mt-5 text-sm text-rose-300">{{ error }}</div>
      <div v-else-if="serviceEntry" class="mt-5 space-y-4">
        <DatabaseHealthGuide />

        <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700/70 bg-slate-800/30 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] uppercase"
              :class="pressureClass"
              title="Current evidence-based pressure classification and 0–100 score."
            >
              {{ serviceEntry.pressure }}<span v-if="serviceEntry.monitoring_enabled"> · {{ serviceEntry.score }}</span>
            </span>
            <span class="text-xs uppercase text-slate-400" title="Database provider detected for this service.">{{ serviceEntry.provider }}</span>
            <span
              v-if="serviceEntry.monitoring_enabled"
              class="text-xs text-slate-400"
              title="Standard is passive. Enhanced adds bounded read-only SQL metadata probes when this provider supports them; custom stores remain passive-only."
            >
              {{ serviceEntry.mode }} mode
            </span>
            <span
              v-if="serviceEntry.ignore_network_storage"
              class="text-xs text-sky-300"
              title="Network placement remains visible but does not contribute to this service's score or recommendation."
            >
              network storage excluded from score
            </span>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-if="serviceEntry.monitoring_enabled"
              :value="serviceEntry.mode"
              :disabled="saving"
              class="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs"
              title="Standard is passive. Enhanced adds bounded, read-only SQL metadata probes when available; custom stores remain passive-only."
              @change="setMode"
            >
              <option value="standard">Standard / passive</option>
              <option value="enhanced">Enhanced / read-only probes</option>
            </select>
            <label
              v-if="serviceEntry.monitoring_enabled"
              class="flex items-center gap-1 text-[11px] text-slate-400"
              title="Keep reporting the filesystem but exclude network storage from the pressure score and recommendation."
            >
              <input
                type="checkbox"
                :checked="serviceEntry.ignore_network_storage"
                :disabled="saving"
                @change="setIgnoreNetworkStorage"
              />
              <span>Ignore network storage score</span>
            </label>
            <button
              class="rounded px-3 py-1.5 text-xs text-white disabled:opacity-50"
              :class="serviceEntry.monitoring_enabled ? 'bg-slate-700 hover:bg-slate-600' : 'bg-emerald-600 hover:bg-emerald-500'"
              :title="serviceEntry.monitoring_enabled ? 'Stop collecting Database Health for this service.' : 'Enable read-only Database Health collection for this service.'"
              :disabled="saving"
              @click="saveMonitoring(!serviceEntry.monitoring_enabled)"
            >
              {{ saving ? 'Saving…' : serviceEntry.monitoring_enabled ? 'Disable' : 'Enable monitoring' }}
            </button>
            <button
              class="rounded bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700"
              title="Discard the cached result for this service and collect a fresh sample."
              :disabled="loading"
              @click="load(true)"
            >
              Refresh
            </button>
          </div>
        </div>

        <div v-if="error" class="rounded border border-rose-700/40 bg-rose-900/20 p-2 text-xs text-rose-300">{{ error }}</div>
        <DatabaseHealthDetails :service-entry="serviceEntry" />
        <div class="flex justify-end">
          <NuxtLink
            to="/metrics"
            class="text-xs text-sky-300 hover:text-sky-200"
            title="Open the Metrics page to compare Database Health across services."
          >
            Open stack-wide Metrics →
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
