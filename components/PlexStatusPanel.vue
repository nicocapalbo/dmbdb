<script setup>
import axios from 'axios'
import { configRepository } from '~/services/config.js'

const emit = defineEmits(['close'])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const status = ref(null)
const enabled = ref(false)
const intervalSec = ref(300)

const load = async (refresh = false) => {
  loading.value = true
  error.value = ''
  try {
    const repo = configRepository()
    const [config, response] = await Promise.all([
      repo.getConfig(),
      axios.get('/api/metrics/plex-status', { params: { refresh } }),
    ])
    const current = config?.dumb?.metrics?.plex_status || {}
    enabled.value = current.enabled === true
    intervalSec.value = Number(current.interval_sec || 300)
    status.value = response.data || null
  } catch (err) {
    error.value = err?.response?.data?.detail || err?.message || 'Failed to load Plex cloud status.'
  } finally {
    loading.value = false
  }
}

const save = async () => {
  saving.value = true
  error.value = ''
  try {
    const normalizedInterval = Math.max(60, Math.min(3600, Number(intervalSec.value) || 300))
    intervalSec.value = normalizedInterval
    const repo = configRepository()
    await repo.updateGlobalConfig({
      dumb: {
        metrics: {
          plex_status: {
            enabled: enabled.value,
            interval_sec: normalizedInterval,
          },
        },
      },
    })
    await load(enabled.value)
  } catch (err) {
    error.value = err?.response?.data?.detail || err?.message || 'Failed to save Plex status settings.'
  } finally {
    saving.value = false
  }
}

onMounted(() => load(false))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-3" @click.self="emit('close')">
    <div class="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
      <button class="absolute right-3 top-3 material-symbols-rounded text-slate-300 hover:text-white" title="Close" @click="emit('close')">
        close
      </button>
      <div class="pr-8">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-lg font-semibold">Plex Cloud Status</h2>
          <a
            href="https://status.plex.tv/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-sky-300 hover:text-sky-200"
          >Official status ↗</a>
          <a
            href="https://dumbarr.com/features/metrics/#plex-cloud-status"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-sky-300 hover:text-sky-200"
          >Docs ↗</a>
        </div>
        <p class="mt-1 text-xs text-slate-400">
          Optional server-side polling of Plex's public status feed. This reports Plex-operated cloud services; it does not test your local Plex process, network, or remote-access configuration.
        </p>
      </div>

      <div class="mt-5 rounded border border-slate-700/70 bg-slate-800/30 p-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="flex items-center gap-2">
            <input v-model="enabled" type="checkbox" :disabled="saving" />
            <span>Enable Plex cloud status metric</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-slate-400">
            <span>Poll interval (seconds)</span>
            <input
              v-model.number="intervalSec"
              type="number"
              min="60"
              max="3600"
              step="60"
              :disabled="saving"
              class="w-24 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
            />
          </label>
        </div>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <button
            class="rounded bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600 disabled:opacity-50"
            :disabled="loading || saving || !enabled"
            @click="load(true)"
          >Refresh now</button>
          <button
            class="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
            :disabled="saving"
            @click="save"
          >{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>

      <p v-if="error" class="mt-4 rounded border border-rose-700/40 bg-rose-900/20 p-2 text-xs text-rose-300">{{ error }}</p>
      <div v-if="loading" class="mt-5 text-sm text-slate-400">Loading Plex cloud status…</div>
      <PlexStatusDetails v-else-if="status" class="mt-5" :status="status" />
    </div>
  </div>
</template>
