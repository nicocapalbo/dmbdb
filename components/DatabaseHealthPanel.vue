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

const formatBytes = (value) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** unit)).toFixed(unit ? 1 : 0)} ${units[unit]}`
}

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

const saveMonitoring = async (enabled, mode = null) => {
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
      mode: mode || existing.mode || serviceEntry.value.mode || 'standard',
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

const setMode = (event) => saveMonitoring(true, event.target.value)

onMounted(() => load(false))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-3" @click.self="emit('close')">
    <div class="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
      <button class="absolute right-3 top-3 material-symbols-rounded text-slate-300 hover:text-white" title="Close" @click="emit('close')">
        close
      </button>
      <div class="pr-8">
        <h2 class="text-lg font-semibold">Database Health · {{ processName }}</h2>
        <p class="mt-1 text-xs text-slate-400">
          External, read-only pressure indicators. This does not profile application SQL or predict an exact PostgreSQL performance gain.
        </p>
      </div>

      <div v-if="loading" class="mt-5 text-sm text-slate-400">Loading database health…</div>
      <div v-else-if="error && !serviceEntry" class="mt-5 text-sm text-rose-300">{{ error }}</div>
      <div v-else-if="serviceEntry" class="mt-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700/70 bg-slate-800/30 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full border px-2 py-0.5 text-[10px] uppercase" :class="pressureClass">
              {{ serviceEntry.pressure }}<span v-if="serviceEntry.monitoring_enabled"> · {{ serviceEntry.score }}</span>
            </span>
            <span class="text-xs uppercase text-slate-400">{{ serviceEntry.provider }}</span>
            <span v-if="serviceEntry.monitoring_enabled" class="text-xs text-slate-400">{{ serviceEntry.mode }} mode</span>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-if="serviceEntry.monitoring_enabled"
              :value="serviceEntry.mode"
              :disabled="saving"
              class="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs"
              @change="setMode"
            >
              <option value="standard">Standard / passive</option>
              <option value="enhanced">Enhanced / read-only probes</option>
            </select>
            <button
              class="rounded px-3 py-1.5 text-xs text-white disabled:opacity-50"
              :class="serviceEntry.monitoring_enabled ? 'bg-slate-700 hover:bg-slate-600' : 'bg-emerald-600 hover:bg-emerald-500'"
              :disabled="saving"
              @click="saveMonitoring(!serviceEntry.monitoring_enabled)"
            >
              {{ saving ? 'Saving…' : serviceEntry.monitoring_enabled ? 'Disable' : 'Enable monitoring' }}
            </button>
            <button class="rounded bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700" :disabled="loading" @click="load(true)">Refresh</button>
          </div>
        </div>

        <div v-if="error" class="rounded border border-rose-700/40 bg-rose-900/20 p-2 text-xs text-rose-300">{{ error }}</div>
        <div class="rounded border border-slate-700/70 bg-slate-800/20 p-3 text-sm text-slate-200">
          {{ serviceEntry.recommendation }}
        </div>
        <div v-if="serviceEntry.reasons?.length" class="space-y-1 text-xs text-amber-200">
          <div v-for="reason in serviceEntry.reasons" :key="reason">• {{ reason }}</div>
        </div>

        <div v-if="serviceEntry.databases?.length" class="overflow-x-auto rounded border border-slate-700/70">
          <table class="min-w-full text-xs">
            <thead class="bg-slate-800/60 text-left text-slate-400">
              <tr>
                <th class="p-2">Database</th>
                <th class="p-2">Size</th>
                <th class="p-2">WAL</th>
                <th class="p-2">Storage</th>
                <th class="p-2">Probe</th>
                <th class="p-2">Pressure details</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="database in serviceEntry.databases" :key="database.role" class="border-t border-slate-700/60 align-top">
                <td class="p-2 font-medium">
                  {{ database.role }}
                  <div class="mt-1 max-w-[320px] break-all font-mono text-[10px] text-slate-500">{{ database.path || database.name }}</div>
                </td>
                <td class="p-2 whitespace-nowrap">{{ database.exists === false ? 'Missing' : formatBytes(database.size_bytes) }}</td>
                <td class="p-2 whitespace-nowrap">{{ formatBytes(database.wal_size_bytes) }}</td>
                <td class="p-2">
                  <span>{{ database.storage?.fs_type || '-' }}</span>
                  <span v-if="database.storage?.network" class="ml-1 text-amber-300">network</span>
                </td>
                <td class="p-2 whitespace-nowrap">{{ database.probe_ms == null ? '-' : `${Number(database.probe_ms).toFixed(1)} ms` }}</td>
                <td class="p-2 text-slate-300">
                  <div v-if="database.probe_error" class="text-rose-300">{{ database.probe_error }}</div>
                  <div v-if="database.lock_waiters">Lock waiters: {{ database.lock_waiters }}</div>
                  <div v-if="database.deadlocks_delta">New deadlocks: {{ database.deadlocks_delta }}</div>
                  <div v-if="database.cache_hit_percent != null">Cache hit: {{ database.cache_hit_percent }}%</div>
                  <div v-if="database.oldest_transaction_seconds">Oldest transaction: {{ database.oldest_transaction_seconds }}s</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="serviceEntry.log_signals" class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div v-for="key in ['locked', 'busy', 'timeout', 'io_error', 'deadlock']" :key="key" class="rounded border border-slate-700/60 bg-slate-800/30 p-2">
            <div class="uppercase text-[10px] text-slate-500">{{ key.replace('_', ' ') }}</div>
            <div class="mt-1 font-semibold">{{ serviceEntry.log_signals[key] || 0 }}</div>
          </div>
        </div>

        <p v-if="serviceEntry.probe_notice" class="text-xs text-slate-400">{{ serviceEntry.probe_notice }}</p>
        <div class="flex justify-end">
          <NuxtLink to="/metrics" class="text-xs text-sky-300 hover:text-sky-200">Open stack-wide Metrics →</NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
