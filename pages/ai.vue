<script setup>
import SelectComponent from '~/components/SelectComponent.vue'
import useService from '~/services/useService.js'
import { useAiProviderProfiles } from '~/composables/useAiProviderProfiles.js'
import {
  AI_PROVIDER_OPTIONS,
  aiModelCompatibilityOptionPrefix,
  aiModelLifecycleOptionPrefix,
  aiProviderHasManagedEndpoint,
  aiProviderManagedEndpointLabel,
  aiProviderNeedsKey,
  aiProviderSupportsModelDiscovery,
  applyAiProviderDefaults,
  isGeminiProvider,
  resolveAiModelCompatibility,
  resolveAiModelLifecycle,
} from '~/constants/aiProviders.js'

const { aiService, processService } = useService()
const toast = useToast()

const aiSettings = reactive({
  enabled: false,
  provider: 'ollama',
  base_url: 'http://127.0.0.1:11434',
  model: '',
  model_lifecycle: null,
  model_compatibility: null,
  api_key: '',
  api_key_configured: false,
  active_profile_id: '',
  profiles: [],
  timeout_sec: 60,
  temperature: 0.2,
  max_log_chars: 20000,
  include_logs: true,
  include_service_config: false,
  include_dependency_graph: true,
  include_docs_context: true,
  include_process_list: true,
  max_docs_chars: 12000,
  diagnostic_window_hours: 24,
  comparison_mode: 'previous_period',
  deep_log_scan: true,
  max_log_scan_mb: 128,
  include_metrics: true,
  include_change_history: true,
  include_native_diagnostics: true,
})
const {
  selectedProfileId,
  profileName,
  profileBusy,
  profileHydrating,
  profileOptions,
  selectedProfile,
  editingProfile,
  syncProfileSettings,
  startNewProfile,
  markProfileDirty,
  saveProfile,
  activateProfile,
  deleteProfile,
} = useAiProviderProfiles(aiSettings, aiService)

const aiProviderOptions = AI_PROVIDER_OPTIONS
const windowOptions = [
  { value: 1, label: 'Last hour' },
  { value: 6, label: 'Last 6 hours' },
  { value: 24, label: 'Last 24 hours' },
  { value: 72, label: 'Last 3 days' },
  { value: 168, label: 'Last 7 days' },
  { value: 720, label: 'Last 30 days' },
]
const comparisonOptions = [
  { value: 'previous_period', label: 'Previous matching period' },
  { value: 'since_change', label: 'Before latest saved change' },
  { value: 'none', label: 'No comparison' },
]
const fallbackPresets = [
  { id: 'stack_health', label: 'Stack health', question: 'How has the stack been running? Find unhealthy services, restart loops, dependency problems, and the highest-value next actions.' },
  { id: 'stack_performance', label: 'Performance', question: 'Which services changed most in CPU, memory, disk activity, errors, or throughput versus the baseline, and what should be optimized first?' },
  { id: 'stack_changes', label: 'Recent changes', question: 'Correlate recent recorded configuration changes with service health and performance. State where evidence is insufficient.' },
  { id: 'stack_dependencies', label: 'Dependencies', question: 'Review startup order and dependency health. Identify broken or risky chains and provide safe remediation steps.' },
]

const supported = ref(null)
const providerProfilesSupported = ref(false)
const question = ref('')
const selectedPreset = ref('')
const presets = ref(fallbackPresets)
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const modelsLoading = ref(false)
const followUpLoading = ref(false)
const error = ref('')
const analysis = ref('')
const bundle = ref(null)
const dryRun = ref(true)
const lastProvider = ref('')
const usage = ref(null)
const sessionId = ref('')
const testResult = ref(null)
const modelOptions = ref([])
const modelsStatus = ref('')
const apiKeyVisible = ref(false)

const providerNeedsKey = computed(() => aiProviderNeedsKey(aiSettings.provider))
const modelDiscoverySupported = computed(() => aiProviderSupportsModelDiscovery(aiSettings.provider))
const geminiProviderSelected = computed(() => isGeminiProvider(aiSettings.provider))
const providerEndpointManaged = computed(() => aiProviderHasManagedEndpoint(aiSettings.provider))
const managedProviderEndpointLabel = computed(() => aiProviderManagedEndpointLabel(aiSettings.provider))
const selectedModelLifecycle = computed(() =>
  resolveAiModelLifecycle(
    aiSettings.model,
    modelOptions.value,
    aiSettings.model_lifecycle
  )
)
const selectedModelCompatibility = computed(() =>
  resolveAiModelCompatibility(
    aiSettings.model,
    modelOptions.value,
    aiSettings.model_compatibility
  )
)
const retiredModelSelected = computed(() =>
  selectedModelLifecycle.value?.status === 'retired'
)
const unsupportedModelSelected = computed(() =>
  selectedModelCompatibility.value?.status === 'unsupported'
)
const unavailableModelSelected = computed(() =>
  retiredModelSelected.value || unsupportedModelSelected.value
)
const bundlePreview = computed(() => {
  if (!bundle.value) return ''
  try { return JSON.stringify(bundle.value, null, 2) } catch { return String(bundle.value) }
})

const modelSourceLabel = source => ['local', 'external'].includes(String(source || '').toLowerCase()) ? String(source).toLowerCase() : 'unknown'
const formatModelOption = (model) => {
  const name = String(model?.name || '').trim()
  if (!name) return null
  const source = modelSourceLabel(model?.source)
  const detail = String(model?.source_detail || model?.owned_by || '').trim()
  const lifecycle = model?.lifecycle || null
  const compatibility = model?.compatibility || null
  const lifecyclePrefix = aiModelLifecycleOptionPrefix(lifecycle)
  const compatibilityPrefix = lifecyclePrefix
    ? ''
    : aiModelCompatibilityOptionPrefix(compatibility)
  return {
    value: name,
    label: `${lifecyclePrefix}${compatibilityPrefix}${source === 'unknown' ? name : `[${source}] ${name}${detail && !name.toLowerCase().includes(detail.toLowerCase()) ? ` (${detail})` : ''}`}`,
    lifecycle,
    compatibility,
  }
}

const buildProviderPayload = () => {
  const payload = {
    provider: aiSettings.provider,
    base_url: aiSettings.base_url || '',
    model: aiSettings.model || '',
    timeout_sec: Number(aiSettings.timeout_sec) || 60,
    temperature: Number(aiSettings.temperature) || 0.2,
  }
  if (String(aiSettings.api_key || '').trim()) payload.api_key = String(aiSettings.api_key).trim()
  return payload
}

const settingsPayload = () => {
  const updates = {
    enabled: aiSettings.enabled === true,
    provider: aiSettings.provider,
    base_url: aiSettings.base_url || '',
    model: aiSettings.model || '',
    timeout_sec: Number(aiSettings.timeout_sec) || 60,
    temperature: Number(aiSettings.temperature) || 0.2,
    max_log_chars: Number(aiSettings.max_log_chars) || 20000,
    include_logs: aiSettings.include_logs === true,
    include_service_config: aiSettings.include_service_config === true,
    include_dependency_graph: aiSettings.include_dependency_graph === true,
    include_docs_context: aiSettings.include_docs_context === true,
    include_process_list: aiSettings.include_process_list === true,
    max_docs_chars: Number(aiSettings.max_docs_chars) || 12000,
    diagnostic_window_hours: Number(aiSettings.diagnostic_window_hours) || 24,
    comparison_mode: aiSettings.comparison_mode || 'previous_period',
    deep_log_scan: aiSettings.deep_log_scan === true,
    max_log_scan_mb: Number(aiSettings.max_log_scan_mb) || 128,
    include_metrics: aiSettings.include_metrics === true,
    include_change_history: aiSettings.include_change_history === true,
    include_native_diagnostics: aiSettings.include_native_diagnostics === true,
  }
  if (providerProfilesSupported.value) updates.active_profile_id = aiSettings.active_profile_id || ''
  if (String(aiSettings.api_key || '').trim()) updates.api_key = String(aiSettings.api_key).trim()
  return updates
}

const loadSettings = async () => {
  try {
    const caps = await processService.getCapabilities()
    supported.value = !!caps?.ai_diagnostics
    providerProfilesSupported.value = !!caps?.ai_provider_profiles
    if (!supported.value) return
    const [settings, presetResult] = await Promise.all([
      aiService.getSettings(),
      aiService.getPresets().catch(() => null),
    ])
    syncProfileSettings(settings)
    if (Array.isArray(presetResult?.stack)) presets.value = presetResult.stack
  } catch (err) {
    supported.value = false
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to load AI settings.')
  }
}

const saveSettings = async () => {
  saving.value = true
  error.value = ''
  try {
    const saved = await aiService.updateSettings(settingsPayload())
    syncProfileSettings(saved)
    toast.success({ title: 'AI settings saved', message: 'Provider and diagnostic defaults updated.' })
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to save AI settings.')
  } finally {
    saving.value = false
  }
}

const saveProviderProfile = async () => {
  error.value = ''
  try {
    await saveProfile(buildProviderPayload())
    toast.success({
      title: 'Provider profile saved',
      message: `${profileName.value} is now the active AI provider.`,
    })
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to save provider profile.')
  }
}

const switchProviderProfile = async (profileId) => {
  if (!profileId) {
    startNewProfile()
    return
  }
  error.value = ''
  try {
    await activateProfile(profileId)
    toast.success({
      title: 'Provider profile activated',
      message: `${profileName.value} is now active.`,
    })
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to activate provider profile.')
  }
}

const removeProviderProfile = async () => {
  if (!selectedProfile.value) return
  if (!window.confirm(`Delete the saved provider profile "${selectedProfile.value.name}"?`)) return
  error.value = ''
  try {
    await deleteProfile()
    toast.success({ title: 'Provider profile deleted', message: 'The saved provider was removed.' })
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to delete provider profile.')
  }
}

const loadModels = async () => {
  modelsLoading.value = true
  error.value = ''
  try {
    const result = await aiService.listModels(buildProviderPayload())
    const models = Array.isArray(result?.models) ? result.models : []
    modelOptions.value = models.map(formatModelOption).filter(Boolean)
    const flagged = modelOptions.value.filter(model =>
      model.lifecycle?.status === 'retired'
      || model.compatibility?.status === 'unsupported'
    ).length
    modelsStatus.value = modelOptions.value.length
      ? `${modelOptions.value.length} models found.${flagged ? ` ${flagged} unavailable or non-diagnostic models marked.` : ''}`
      : 'No models returned by provider.'
  } catch (err) {
    modelOptions.value = []
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to load AI models.')
  } finally {
    modelsLoading.value = false
  }
}

const testProvider = async () => {
  testing.value = true
  error.value = ''
  testResult.value = null
  try {
    testResult.value = await aiService.testProvider(buildProviderPayload())
    toast.success({ title: 'AI provider test passed', message: testResult.value?.response || 'Provider responded.' })
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'AI provider test failed.')
  } finally {
    testing.value = false
  }
}

const applyPreset = (preset) => {
  selectedPreset.value = preset.id
  question.value = preset.question
  if (preset.id.includes('change')) aiSettings.comparison_mode = 'since_change'
}

const runStackDiagnosis = async (preview = true) => {
  loading.value = true
  error.value = ''
  analysis.value = ''
  usage.value = null
  sessionId.value = ''
  try {
    const result = await aiService.diagnoseStack({
      question: question.value || '',
      preset: selectedPreset.value || null,
      dry_run: preview,
      include_logs: aiSettings.include_logs === true,
      include_service_config: aiSettings.include_service_config === true,
      include_dependency_graph: aiSettings.include_dependency_graph === true,
      include_docs_context: aiSettings.include_docs_context === true,
      include_process_list: aiSettings.include_process_list === true,
      max_log_chars: Number(aiSettings.max_log_chars) || 20000,
      max_docs_chars: Number(aiSettings.max_docs_chars) || 12000,
      window_hours: Number(aiSettings.diagnostic_window_hours) || 24,
      comparison: aiSettings.comparison_mode,
      deep_log_scan: aiSettings.deep_log_scan === true,
      max_log_scan_mb: Number(aiSettings.max_log_scan_mb) || 128,
      include_metrics: aiSettings.include_metrics === true,
      include_change_history: aiSettings.include_change_history === true,
      include_native_diagnostics: aiSettings.include_native_diagnostics === true,
    })
    bundle.value = result?.bundle || null
    analysis.value = result?.analysis || ''
    usage.value = result?.usage || null
    sessionId.value = result?.session_id || ''
    dryRun.value = result?.dry_run !== false
    lastProvider.value = [result?.provider, result?.model].filter(Boolean).join(' / ')
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Stack AI diagnosis failed.')
  } finally {
    loading.value = false
  }
}

const askFollowUp = async (followUpQuestion) => {
  followUpLoading.value = true
  error.value = ''
  try {
    const result = await aiService.followUp({ session_id: sessionId.value, question: followUpQuestion })
    analysis.value = `${analysis.value}\n\n---\n\n## Follow-up\n\n**Question:** ${followUpQuestion}\n\n${result?.analysis || ''}`
    usage.value = result?.usage || usage.value
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Follow-up failed.')
  } finally {
    followUpLoading.value = false
  }
}

const copyBundle = async () => {
  await navigator.clipboard.writeText(bundlePreview.value)
  toast.success({ title: 'Bundle copied', message: 'Redacted diagnostic JSON copied.' })
}
const downloadBundle = () => {
  const blob = new Blob([bundlePreview.value], { type: 'application/json;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `dumb-stack-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

watch(() => [aiSettings.provider, aiSettings.base_url, aiSettings.active_profile_id], () => {
  modelOptions.value = []
  modelsStatus.value = ''
  testResult.value = null
})
watch(
  () => aiSettings.provider,
  (provider, previousProvider) => {
    if (profileHydrating.value) return
    applyAiProviderDefaults(aiSettings, provider, previousProvider)
    markProfileDirty({ newProvider: true })
  }
)
watch(
  () => [
    aiSettings.base_url,
    aiSettings.model,
    aiSettings.api_key,
    aiSettings.timeout_sec,
    aiSettings.temperature,
    profileName.value,
  ],
  () => markProfileDirty(),
  { flush: 'post' }
)
onMounted(loadSettings)
</script>

<template>
  <div class="min-h-full space-y-4 bg-gray-900 px-4 py-4 text-white md:px-8">
    <InfoBar />

    <header class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-3xl font-bold">Stack AI Assist</h1>
        <p class="mt-1 text-xs text-slate-400">Compare real service evidence over time, inspect what was included, and continue the investigation without rebuilding context.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="button-small border border-slate-50/20 !px-3 !py-2" :disabled="loading || supported === false" title="Build evidence without contacting the provider" @click="runStackDiagnosis(true)">
          <span class="material-symbols-rounded !text-[18px]">visibility</span><span>Preview evidence</span>
        </button>
        <button class="button-small border border-slate-50/20 !px-3 !py-2" :disabled="loading || !aiSettings.enabled || unavailableModelSelected || supported === false" :title="unavailableModelSelected ? 'Choose a supported text model before analyzing.' : 'Analyze with the configured provider'" @click="runStackDiagnosis(false)">
          <span v-if="loading" class="animate-spin material-symbols-rounded !text-[18px]">progress_activity</span>
          <span v-else class="material-symbols-rounded !text-[18px]">psychology</span><span>Analyze stack</span>
        </button>
      </div>
    </header>

    <div v-if="supported === false" class="border border-amber-500/30 bg-amber-950/30 p-3 text-sm text-amber-100">This backend does not expose AI diagnostics.</div>
    <div v-if="error" class="border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">{{ error }}</div>

    <section class="border border-slate-700/70 bg-slate-900/30">
      <div class="border-b border-slate-700/60 px-3 py-3">
        <div class="text-sm font-semibold text-slate-100">Choose a focus</div>
        <div class="mt-2 flex flex-wrap gap-1" role="group" aria-label="Diagnostic presets">
          <button
            v-for="preset in presets"
            :key="preset.id"
            type="button"
            class="border px-3 py-1.5 text-xs"
            :class="selectedPreset === preset.id ? 'border-sky-400 bg-sky-950/60 text-sky-100' : 'border-slate-700 bg-slate-950/50 text-slate-300 hover:border-slate-500'"
            @click="applyPreset(preset)"
          >{{ preset.label }}</button>
        </div>
      </div>
      <div class="grid gap-3 px-3 py-3 lg:grid-cols-[180px_250px_minmax(300px,1fr)]">
        <label class="space-y-1">
          <span class="text-xs text-slate-400">Current window</span>
          <SelectComponent v-model="aiSettings.diagnostic_window_hours" :items="windowOptions" class="w-full" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-slate-400">Compare with</span>
          <SelectComponent v-model="aiSettings.comparison_mode" :items="comparisonOptions" class="w-full" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-slate-400">Question or focus</span>
          <textarea v-model="question" rows="2" class="w-full border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-sky-500" placeholder="How has the stack been running? Any changes or useful optimizations?"></textarea>
        </label>
      </div>
    </section>

    <AiEvidenceSummary :bundle="bundle" />
    <AiAnalysisResult
      :analysis="analysis"
      :provider="lastProvider"
      :usage="usage || {}"
      :session-id="sessionId"
      :follow-up-loading="followUpLoading"
      title="Stack analysis"
      @follow-up="askFollowUp"
    />

    <details class="border border-slate-700/70 bg-slate-900/30">
      <summary class="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-100">Provider settings</summary>
      <div class="space-y-4 border-t border-slate-700/60 p-3">
        <div v-if="providerProfilesSupported" class="grid gap-3 border-b border-slate-700/60 pb-4 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
          <label class="block space-y-1">
            <span class="block text-xs text-slate-400">Saved provider</span>
            <SelectComponent
              v-model="selectedProfileId"
              :items="profileOptions"
              class="w-full"
              :disabled="profileBusy"
              @update:model-value="switchProviderProfile"
            />
            <span v-if="!selectedProfile && editingProfile" class="block text-[11px] text-amber-300">
              Unsaved changes to {{ editingProfile.name }}
            </span>
          </label>
          <label class="block space-y-1">
            <span class="block text-xs text-slate-400">Profile name</span>
            <Input v-model="profileName" class="w-full" maxlength="80" placeholder="Home Gemini, Local Ollama…" />
          </label>
          <div class="flex flex-wrap items-end gap-2">
            <button class="button-small border border-slate-50/20 !px-3 !py-2" :disabled="profileBusy" title="Start a new provider profile using the current form values." @click="startNewProfile">
              <span class="material-symbols-rounded !text-[18px]">add</span><span>New</span>
            </button>
            <button class="button-small border border-slate-50/20 !px-3 !py-2" :disabled="profileBusy || !profileName.trim()" title="Save the provider, endpoint settings, model, key, timeout, and temperature under this profile name." @click="saveProviderProfile">
              <span class="material-symbols-rounded !text-[18px]">bookmark_add</span><span>{{ editingProfile ? 'Update profile' : 'Save profile' }}</span>
            </button>
            <button class="button-small border border-red-500/40 !px-3 !py-2 text-red-200" :disabled="profileBusy || !selectedProfile" title="Delete the selected saved provider profile." @click="removeProviderProfile">
              <span class="material-symbols-rounded !text-[18px]">delete</span><span>Delete</span>
            </button>
          </div>
        </div>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="block space-y-1"><span class="block text-xs text-slate-400">Provider</span><SelectComponent v-model="aiSettings.provider" :items="aiProviderOptions" class="w-full" /></label>
          <label v-if="!providerEndpointManaged" class="block space-y-1"><span class="block text-xs text-slate-400">Base URL</span><Input v-model="aiSettings.base_url" class="w-full" /></label>
          <div v-else class="block space-y-1">
            <span class="block text-xs text-slate-400">Endpoint</span>
            <div class="flex min-h-9 items-center border border-slate-700/70 bg-slate-950/40 px-3 text-xs text-slate-300">
              {{ managedProviderEndpointLabel }} · managed automatically
            </div>
          </div>
          <div class="space-y-1">
            <span class="block text-xs text-slate-400">Model</span>
            <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input v-if="!modelOptions.length" v-model="aiSettings.model" class="w-full" placeholder="Model name" />
              <SelectComponent v-else v-model="aiSettings.model" :items="modelOptions" class="w-full" />
              <button class="button-small self-stretch border border-slate-50/20 !px-2 !py-0" :disabled="modelsLoading || !modelDiscoverySupported" title="Load models" @click="loadModels"><span class="material-symbols-rounded !text-[17px]" :class="{ 'animate-spin': modelsLoading }">{{ modelsLoading ? 'progress_activity' : 'refresh' }}</span></button>
            </div>
            <div v-if="modelsStatus" class="text-[11px] text-slate-500">{{ modelsStatus }}</div>
            <div
              v-if="selectedModelLifecycle"
              class="mt-2 border p-2 text-xs leading-5"
              :class="retiredModelSelected ? 'border-red-500/50 bg-red-950/40 text-red-100' : 'border-amber-500/40 bg-amber-950/30 text-amber-100'"
            >
              <strong>{{ retiredModelSelected ? 'Retired model.' : 'Model retirement scheduled.' }}</strong>
              {{ selectedModelLifecycle.provider === 'openai' ? 'OpenAI' : 'Google' }}
              {{ retiredModelSelected ? 'shut this model down' : 'lists this model for shutdown' }} on
              {{ selectedModelLifecycle.shutdown_date }}.
              <span v-if="selectedModelLifecycle.replacement">Use <code>{{ selectedModelLifecycle.replacement }}</code> instead.</span>
              Retired IDs can still appear in a provider's model response.
              <a
                :href="selectedModelLifecycle.source_url"
                target="_blank"
                rel="noreferrer"
                class="underline hover:text-white"
              >Provider lifecycle details</a>.
            </div>
            <div
              v-if="unsupportedModelSelected"
              class="mt-2 border border-red-500/50 bg-red-950/40 p-2 text-xs leading-5 text-red-100"
            >
              <strong>Not usable for AI diagnostics.</strong>
              {{ selectedModelCompatibility.reason }}
            </div>
          </div>
          <label class="block space-y-1"><span class="block text-xs text-slate-400">API key</span><div class="relative"><Input v-model="aiSettings.api_key" :type="apiKeyVisible ? 'text' : 'password'" class="w-full pr-10" :placeholder="aiSettings.api_key_configured ? 'Stored key configured' : (providerNeedsKey ? 'Required' : 'Optional')" /><button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" :title="apiKeyVisible ? 'Hide API key' : 'Show API key'" @click="apiKeyVisible = !apiKeyVisible"><span class="material-symbols-rounded !text-[18px]">{{ apiKeyVisible ? 'visibility_off' : 'visibility' }}</span></button></div></label>
        </div>
        <div v-if="geminiProviderSelected" class="border border-sky-500/30 bg-sky-950/30 p-3 text-xs leading-5 text-sky-100">
          DUMB manages the official Gemini API endpoint automatically. Gemini API has a limited free tier for eligible regions and models. Create a restricted key in
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" class="underline hover:text-white">Google AI Studio</a>,
          then use <strong>Load models</strong> to see what that project can access. Free-tier prompts may be used by Google to improve its products; review the redacted bundle before sending it.
        </div>
        <div v-if="aiSettings.provider === 'openai'" class="border border-sky-500/30 bg-sky-950/30 p-3 text-xs leading-5 text-sky-100">
          DUMB manages the official OpenAI endpoint and sends native OpenAI text models through the Responses API. Models intended only for embeddings, moderation, media, realtime, or specialized tool workflows are marked unsupported for diagnostic prompts.
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2 text-xs text-slate-300"><input v-model="aiSettings.enabled" type="checkbox" class="accent-sky-400" /> Enable provider calls</label>
          <button class="button-small border border-slate-50/20 !px-3 !py-2" :disabled="testing || !aiSettings.model || unavailableModelSelected" :title="unavailableModelSelected ? 'Choose a supported text model before testing.' : 'Test the configured provider and model.'" @click="testProvider"><span class="material-symbols-rounded !text-[18px]" :class="{ 'animate-spin': testing }">{{ testing ? 'progress_activity' : 'network_check' }}</span><span>Test</span></button>
          <button class="button-small border border-slate-50/20 !px-3 !py-2" :disabled="saving" @click="saveSettings"><span class="material-symbols-rounded !text-[18px]" :class="{ 'animate-spin': saving }">{{ saving ? 'progress_activity' : 'save' }}</span><span>Save</span></button>
          <span v-if="testResult" class="text-xs text-emerald-300">Provider test passed</span>
        </div>
      </div>
    </details>

    <details class="border border-slate-700/70 bg-slate-900/30">
      <summary class="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-100">Evidence settings</summary>
      <div class="space-y-3 border-t border-slate-700/60 p-3">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label class="space-y-1"><span class="text-xs text-slate-400">Recent log characters</span><Input v-model="aiSettings.max_log_chars" type="number" min="1000" max="200000" /></label>
          <label class="space-y-1"><span class="text-xs text-slate-400">Deep-scan budget (MiB)</span><Input v-model="aiSettings.max_log_scan_mb" type="number" min="1" max="1024" /></label>
          <label class="space-y-1"><span class="text-xs text-slate-400">Docs characters</span><Input v-model="aiSettings.max_docs_chars" type="number" min="1000" max="60000" /></label>
          <label class="space-y-1"><span class="text-xs text-slate-400">Provider timeout seconds</span><Input v-model="aiSettings.timeout_sec" type="number" min="5" max="300" /></label>
        </div>
        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label v-for="option in [
            ['deep_log_scan', 'Scan retained log files'],
            ['include_metrics', 'Metrics history'],
            ['include_change_history', 'Saved change history'],
            ['include_native_diagnostics', 'Native service telemetry'],
            ['include_logs', 'Recent log excerpts'],
            ['include_service_config', 'Redacted service configs'],
            ['include_dependency_graph', 'Dependency graph'],
            ['include_docs_context', 'DUMB docs context'],
            ['include_process_list', 'Process list'],
          ]" :key="option[0]" class="flex min-h-[34px] items-center gap-2 border border-slate-700/50 bg-slate-950/30 px-2 text-xs text-slate-300">
            <input v-model="aiSettings[option[0]]" type="checkbox" class="accent-sky-400" />{{ option[1] }}
          </label>
        </div>
        <div class="text-xs text-slate-500">Deep scanning reads retained files within the byte budget and sends summaries plus selected excerpts, not an unrestricted filesystem view.</div>
      </div>
    </details>

    <details v-if="bundlePreview" class="border border-slate-700/70 bg-slate-900/30">
      <summary class="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-100">Redacted diagnostic bundle</summary>
      <div class="border-t border-slate-700/60 p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <span class="text-xs text-slate-400">{{ dryRun ? 'Preview only' : 'Sent to provider' }}</span>
          <div class="flex gap-2">
            <button class="button-small border border-slate-50/20 !p-2" title="Copy JSON" @click="copyBundle"><span class="material-symbols-rounded !text-[18px]">content_copy</span></button>
            <button class="button-small border border-slate-50/20 !p-2" title="Download JSON" @click="downloadBundle"><span class="material-symbols-rounded !text-[18px]">download</span></button>
          </div>
        </div>
        <pre class="max-h-[620px] overflow-auto border border-slate-800 bg-slate-950/80 p-3 text-xs leading-5 text-slate-200">{{ bundlePreview }}</pre>
      </div>
    </details>
  </div>
</template>
