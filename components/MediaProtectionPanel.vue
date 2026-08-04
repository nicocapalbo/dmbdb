<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import useService from '~/services/useService.js'

const props = defineProps({
  processName: { type: String, required: true },
  serviceKey: { type: String, required: true },
  plexSettingsSupported: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])
const { processService } = useService()

const loading = ref(true)
const saving = ref(false)
const plexSaving = ref(false)
const error = ref('')
const saved = ref(false)
const policy = reactive({
  enabled: true,
  api_key_configured: false,
  api_key: '',
  stop_when_idle_on_outage: true,
  protected_mounts: [],
})
const globalSettings = reactive({
  enabled: true,
  recovery_stabilization_seconds: 30,
  recovery_timeout_seconds: 180,
  monitor_interval_seconds: 5,
})
const apiKeyDraft = ref('')
const clearApiKey = ref(false)
const protectedMountsText = ref('')
const incidents = ref([])
const plexPayload = ref(null)
const plexDraft = reactive({
  autoEmptyTrash: false,
  fSEventLibraryUpdatesEnabled: false,
  fSEventLibraryPartialScanEnabled: true,
  scheduledLibraryUpdatesEnabled: false,
  scheduledLibraryUpdateInterval: 12,
})

const normalizedKey = computed(() => String(props.serviceKey || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
const needsDedicatedApiKey = computed(() => ['jellyfin', 'emby'].includes(normalizedKey.value))
const setupRequired = computed(() => needsDedicatedApiKey.value && !policy.api_key_configured)
const docsUrl = 'https://dumbarr.com/features/media-library-protection/'

const applyPlexSettings = (payload) => {
  plexPayload.value = payload || null
  const settings = payload?.settings || {}
  for (const key of Object.keys(plexDraft)) {
    if (settings[key]?.value == null) continue
    plexDraft[key] = key === 'scheduledLibraryUpdateInterval'
      ? Number(settings[key].value)
      : settings[key].value === true || String(settings[key].value).toLowerCase() === 'true'
  }
}

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const [savedPolicy, status] = await Promise.all([
      processService.getMediaProtectionPolicy(props.processName),
      processService.getMediaProtectionStatus(props.processName),
    ])
    Object.assign(policy, savedPolicy || {})
    Object.assign(globalSettings, {
      enabled: status?.enabled !== false,
      recovery_stabilization_seconds: Number(status?.recovery_stabilization_seconds || 30),
      recovery_timeout_seconds: Number(status?.recovery_timeout_seconds || 180),
      monitor_interval_seconds: Number(status?.monitor_interval_seconds || 5),
    })
    protectedMountsText.value = (savedPolicy?.protected_mounts || []).join('\n')
    incidents.value = status?.active || []
    if (normalizedKey.value === 'plex' && props.plexSettingsSupported) {
      try {
        applyPlexSettings(await processService.getPlexLibrarySettings())
      } catch (plexError) {
        error.value = plexError?.response?.data?.detail || 'Protection loaded, but Plex library settings could not be read.'
      }
    }
  } catch (err) {
    error.value = err?.response?.data?.detail || err?.message || 'Failed to load media protection settings.'
  } finally {
    loading.value = false
  }
}

const save = async () => {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    const policyPayload = {
      process_name: props.processName,
      enabled: policy.enabled,
      stop_when_idle_on_outage: policy.stop_when_idle_on_outage,
      protected_mounts: protectedMountsText.value
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      clear_api_key: clearApiKey.value,
    }
    if (apiKeyDraft.value.trim()) policyPayload.api_key = apiKeyDraft.value.trim()
    const savedPolicy = await processService.updateMediaProtectionPolicy(policyPayload)
    await processService.updateMediaProtectionSettings({
        enabled: globalSettings.enabled,
        recovery_stabilization_seconds: Number(globalSettings.recovery_stabilization_seconds),
        recovery_timeout_seconds: Number(globalSettings.recovery_timeout_seconds),
        monitor_interval_seconds: Number(globalSettings.monitor_interval_seconds),
    })
    Object.assign(policy, savedPolicy || {})
    apiKeyDraft.value = ''
    clearApiKey.value = false
    saved.value = true
  } catch (err) {
    error.value = err?.response?.data?.detail || err?.message || 'Failed to save media protection settings.'
  } finally {
    saving.value = false
  }
}

const savePlex = async () => {
  plexSaving.value = true
  error.value = ''
  try {
    const payload = await processService.updatePlexLibrarySettings({
      ...plexDraft,
      scheduledLibraryUpdateInterval: Number(plexDraft.scheduledLibraryUpdateInterval),
    })
    applyPlexSettings(payload)
  } catch (err) {
    error.value = err?.response?.data?.detail || err?.message || 'Failed to update Plex library settings.'
  } finally {
    plexSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-3" @click.self="emit('close')">
    <div class="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
      <button class="absolute right-3 top-3 material-symbols-rounded text-slate-300 hover:text-white" title="Close" @click="emit('close')">close</button>
      <div class="border-b border-slate-700 px-5 py-4 pr-12">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-lg font-semibold">Media Library Protection · {{ processName }}</h2>
          <a :href="docsUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-sky-300 hover:text-sky-200">Docs ↗</a>
        </div>
        <p class="mt-1 text-xs text-slate-400">
          Enabled by default. DUMB pauses scans before storage maintenance, preserves active playback during an outage, and restores only the settings and processes it changed.
        </p>
      </div>

      <div v-if="loading" class="p-5 text-sm text-slate-400">Loading protection settings…</div>
      <div v-else class="space-y-5 p-5">
        <div v-if="setupRequired" class="rounded border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
          <strong>Setup required:</strong> supply a dedicated {{ normalizedKey === 'emby' ? 'Emby' : 'Jellyfin' }} API key so DUMB can inspect sessions, pause scans, and restore library monitoring. Until then, activity is treated as unknown and safe unattended maintenance is deferred.
        </div>

        <section class="space-y-3 rounded border border-slate-700 bg-slate-800/30 p-4">
          <h3 class="font-medium">Protection policy</h3>
          <label class="flex items-start gap-2">
            <input v-model="globalSettings.enabled" type="checkbox" class="mt-0.5" />
            <span><strong>Enable protection globally</strong><span class="block text-xs text-slate-400">Opt out here only if you intentionally want normal service lifecycle behavior without downstream safeguards.</span></span>
          </label>
          <label class="flex items-start gap-2">
            <input v-model="policy.enabled" type="checkbox" class="mt-0.5" :disabled="!globalSettings.enabled" />
            <span><strong>Protect this media server</strong><span class="block text-xs text-slate-400">Per-server opt-out. Existing streams are never stopped automatically while activity is busy or unknown.</span></span>
          </label>
          <label class="flex items-start gap-2">
            <input v-model="policy.stop_when_idle_on_outage" type="checkbox" class="mt-0.5" :disabled="!policy.enabled" />
            <span><strong>Stop after users become idle during an outage</strong><span class="block text-xs text-slate-400">Scanning is guarded immediately; a busy server stays up until its streams end.</span></span>
          </label>

          <div v-if="needsDedicatedApiKey" class="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label class="space-y-1">
              <span class="text-xs text-slate-400">Dedicated {{ normalizedKey === 'emby' ? 'Emby' : 'Jellyfin' }} API key</span>
              <input v-model="apiKeyDraft" type="password" autocomplete="new-password" class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" :placeholder="policy.api_key_configured ? 'Configured — leave blank to keep' : 'Paste API key'" />
            </label>
            <label v-if="policy.api_key_configured" class="flex items-center gap-2 pb-2 text-xs text-rose-200">
              <input v-model="clearApiKey" type="checkbox" /> Clear saved key
            </label>
          </div>

          <label class="block space-y-1">
            <span class="text-xs text-slate-400">Protected library mount roots (optional)</span>
            <textarea v-model="protectedMountsText" rows="3" class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs" placeholder="One absolute path per line; blank uses DUMB's dependency mapping." />
          </label>

          <details>
            <summary class="cursor-pointer text-xs text-slate-400">Recovery timing</summary>
            <div class="mt-3 grid gap-3 sm:grid-cols-3">
              <label class="space-y-1 text-xs text-slate-400">Stable before restore (sec)<input v-model.number="globalSettings.recovery_stabilization_seconds" type="number" min="5" max="600" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100" /></label>
              <label class="space-y-1 text-xs text-slate-400">Delayed recovery alert (sec)<input v-model.number="globalSettings.recovery_timeout_seconds" type="number" min="30" max="3600" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100" /></label>
              <label class="space-y-1 text-xs text-slate-400">Monitor interval (sec)<input v-model.number="globalSettings.monitor_interval_seconds" type="number" min="2" max="60" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100" /></label>
            </div>
          </details>
        </section>

        <section v-if="normalizedKey === 'plex' && plexSettingsSupported" class="space-y-3 rounded border border-sky-700/50 bg-sky-950/20 p-4">
          <div>
            <h3 class="font-medium text-sky-100">Plex library settings</h3>
            <p class="mt-1 text-xs text-slate-400">These are live Plex settings. Recommended values reduce the chance that a temporary remote-mount outage becomes a destructive library cleanup.</p>
          </div>
          <div v-if="plexPayload" class="space-y-3">
            <label class="flex items-start gap-2"><input v-model="plexDraft.autoEmptyTrash" type="checkbox" class="mt-0.5" /><span><strong>Empty trash automatically after every scan</strong><span class="block text-xs text-rose-200">Recommended: Off. This is the highest-risk setting during mount outages.</span></span></label>
            <label class="flex items-start gap-2"><input v-model="plexDraft.fSEventLibraryUpdatesEnabled" type="checkbox" class="mt-0.5" /><span><strong>Scan my library automatically</strong><span class="block text-xs text-amber-200">Recommended: Off for remote/virtual mounts; reconnect events can be misleading.</span></span></label>
            <label class="flex items-start gap-2"><input v-model="plexDraft.fSEventLibraryPartialScanEnabled" type="checkbox" class="mt-0.5" /><span><strong>Run a partial scan when changes are detected</strong><span class="block text-xs text-emerald-200">Recommended: On if automatic detection remains enabled.</span></span></label>
            <label class="flex items-start gap-2"><input v-model="plexDraft.scheduledLibraryUpdatesEnabled" type="checkbox" class="mt-0.5" /><span><strong>Update libraries periodically</strong><span class="block text-xs text-amber-200">Recommended: Off unless the schedule is actively supervised.</span></span></label>
            <label class="block max-w-xs space-y-1 text-xs text-slate-400">Scan interval value<input v-model.number="plexDraft.scheduledLibraryUpdateInterval" type="number" min="0" max="23" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100" /></label>
            <div class="flex justify-end"><button class="button-small border border-sky-500/50 !px-3 !py-2" :disabled="plexSaving" @click="savePlex">{{ plexSaving ? 'Saving Plex settings…' : 'Save Plex settings' }}</button></div>
          </div>
          <p v-else class="text-xs text-slate-400">Plex settings could not be loaded.</p>
        </section>

        <section v-if="incidents.length" class="space-y-2 rounded border border-amber-700/40 bg-amber-950/20 p-4">
          <h3 class="font-medium text-amber-100">Active protection</h3>
          <div v-for="incident in incidents" :key="incident.id" class="text-xs text-slate-300">
            {{ incident.target_process }} · {{ incident.action }} · {{ incident.status }}
          </div>
        </section>

        <p v-if="error" class="rounded border border-rose-700/40 bg-rose-950/30 p-3 text-xs text-rose-200">{{ error }}</p>
        <div class="flex items-center justify-end gap-3 border-t border-slate-700 pt-4">
          <span v-if="saved" class="text-xs text-emerald-300">Saved</span>
          <button class="button-small border border-slate-600 !px-3 !py-2" @click="emit('close')">Close</button>
          <button class="button-small border border-emerald-500/50 !px-3 !py-2" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save protection' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
