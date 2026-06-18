<script setup>
import SelectComponent from '~/components/SelectComponent.vue'
import useService from '~/services/useService.js'

const { aiService, processService } = useService()
const toast = useToast()

const aiSettings = reactive({
  enabled: false,
  provider: 'ollama',
  base_url: 'http://127.0.0.1:11434',
  model: '',
  api_key: '',
  api_key_configured: false,
  timeout_sec: 60,
  temperature: 0.2,
  max_log_chars: 4000,
  include_logs: true,
  include_service_config: false,
  include_dependency_graph: true,
  include_docs_context: true,
  include_process_list: true,
  max_docs_chars: 5000,
})

const aiProviderOptions = [
  { value: 'ollama', label: 'Local Ollama' },
  { value: 'litellm', label: 'LiteLLM' },
  { value: 'open_webui', label: 'Open WebUI' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai_compatible', label: 'OpenAI-compatible' },
  { value: 'anthropic', label: 'Anthropic / Claude' }
]

const supported = ref(null)
const question = ref('')
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const modelsLoading = ref(false)
const error = ref('')
const analysis = ref('')
const bundle = ref(null)
const dryRun = ref(true)
const lastProvider = ref('')
const usage = ref(null)
const testResult = ref(null)
const modelOptions = ref([])
const modelsStatus = ref('')
const apiKeyVisible = ref(false)

const providerNeedsKey = computed(() => ['openai', 'open_webui', 'litellm', 'anthropic', 'claude'].includes(String(aiSettings.provider || '').toLowerCase()))
const modelDiscoverySupported = computed(() => ['ollama', 'openai', 'openai_compatible', 'compatible', 'litellm', 'open_webui'].includes(String(aiSettings.provider || '').toLowerCase()))
const modelSourceLabel = (source) => {
  const value = String(source || '').toLowerCase()
  if (value === 'local') return 'local'
  if (value === 'external') return 'external'
  return value || 'unknown'
}
const formatModelOption = (model) => {
  const name = String(model?.name || '').trim()
  if (!name) return null
  const source = modelSourceLabel(model?.source)
  const detail = String(model?.source_detail || model?.owned_by || '').trim()
  const label = source === 'unknown'
    ? name
    : `[${source}] ${name}${detail && !name.toLowerCase().includes(detail.toLowerCase()) ? ` (${detail})` : ''}`
  return { value: name, label, source }
}
const modelSourceSummary = (models) => {
  const counts = models.reduce((acc, model) => {
    const source = modelSourceLabel(model?.source)
    acc[source] = (acc[source] || 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, count]) => `${count} ${source}`)
    .join(', ')
}
const formatDurationNs = (value) => {
  const ns = Number(value)
  if (!Number.isFinite(ns) || ns <= 0) return ''
  const ms = ns / 1_000_000
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
}
const usageSummary = computed(() => {
  const data = usage.value || {}
  const parts = []
  if (data.prompt_tokens != null) parts.push(`prompt ${data.prompt_tokens}`)
  if (data.completion_tokens != null) parts.push(`completion ${data.completion_tokens}`)
  if (data.total_tokens != null) parts.push(`total ${data.total_tokens}`)
  const duration = formatDurationNs(data.total_duration)
  if (duration) parts.push(duration)
  return parts.join(' · ')
})
const bundlePreview = computed(() => {
  if (!bundle.value) return ''
  try { return JSON.stringify(bundle.value, null, 2) }
  catch { return String(bundle.value) }
})

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

const loadSettings = async () => {
  try {
    const caps = await processService.getCapabilities()
    supported.value = !!caps?.ai_diagnostics
    if (!supported.value) return
    const settings = await aiService.getSettings()
    Object.assign(aiSettings, settings || {})
    aiSettings.include_service_config = false
    aiSettings.max_log_chars = Math.min(Number(aiSettings.max_log_chars) || 4000, 4000)
    aiSettings.max_docs_chars = Math.min(Number(aiSettings.max_docs_chars) || 5000, 5000)
    aiSettings.api_key = ''
  } catch (err) {
    supported.value = false
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to load AI settings.')
  }
}

const saveSettings = async () => {
  saving.value = true
  error.value = ''
  try {
    const updates = {
      enabled: aiSettings.enabled === true,
      provider: aiSettings.provider,
      base_url: aiSettings.base_url || '',
      model: aiSettings.model || '',
      timeout_sec: Number(aiSettings.timeout_sec) || 60,
      temperature: Number(aiSettings.temperature) || 0.2,
      max_log_chars: Number(aiSettings.max_log_chars) || 4000,
      include_logs: aiSettings.include_logs === true,
      include_service_config: aiSettings.include_service_config === true,
      include_dependency_graph: aiSettings.include_dependency_graph === true,
      include_docs_context: aiSettings.include_docs_context === true,
      include_process_list: aiSettings.include_process_list === true,
      max_docs_chars: Number(aiSettings.max_docs_chars) || 5000,
    }
    if (String(aiSettings.api_key || '').trim()) updates.api_key = String(aiSettings.api_key).trim()
    const saved = await aiService.updateSettings(updates)
    Object.assign(aiSettings, saved || {})
    aiSettings.api_key = ''
    toast.success({ title: 'AI settings saved', message: 'Stack assistant settings updated.' })
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to save AI settings.')
  } finally {
    saving.value = false
  }
}

const loadModels = async () => {
  modelsLoading.value = true
  error.value = ''
  modelsStatus.value = ''
  try {
    const result = await aiService.listModels(buildProviderPayload())
    const models = Array.isArray(result?.models) ? result.models : []
    modelOptions.value = models.map(formatModelOption).filter(Boolean)
    const sourceSummary = modelSourceSummary(models)
    modelsStatus.value = modelOptions.value.length
      ? `${modelOptions.value.length} model${modelOptions.value.length === 1 ? '' : 's'} found${sourceSummary ? ` (${sourceSummary})` : ''}.`
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
    const result = await aiService.testProvider(buildProviderPayload())
    testResult.value = result || null
    toast.success({ title: 'AI provider test passed', message: result?.response || 'Provider responded.' })
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'AI provider test failed.')
  } finally {
    testing.value = false
  }
}

const runStackDiagnosis = async (preview = true) => {
  loading.value = true
  error.value = ''
  analysis.value = ''
  usage.value = null
  try {
    const result = await aiService.diagnoseStack({
      question: question.value || '',
      dry_run: preview,
      include_logs: aiSettings.include_logs === true,
      include_service_config: aiSettings.include_service_config === true,
      include_dependency_graph: aiSettings.include_dependency_graph === true,
      include_docs_context: aiSettings.include_docs_context === true,
      include_process_list: aiSettings.include_process_list === true,
      max_log_chars: Number(aiSettings.max_log_chars) || 4000,
      max_docs_chars: Number(aiSettings.max_docs_chars) || 5000,
    })
    bundle.value = result?.bundle || null
    analysis.value = result?.analysis || ''
    usage.value = result?.usage || null
    dryRun.value = result?.dry_run !== false
    lastProvider.value = [result?.provider, result?.model].filter(Boolean).join(' / ')
  } catch (err) {
    error.value = String(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Stack AI diagnosis failed.')
  } finally {
    loading.value = false
  }
}

watch(
  () => [aiSettings.provider, aiSettings.base_url],
  () => {
    modelOptions.value = []
    modelsStatus.value = ''
    testResult.value = null
  }
)

onMounted(loadSettings)
</script>

<template>
  <div class="min-h-full bg-gray-900 text-white px-4 py-4 md:px-8 space-y-4">
    <InfoBar />

    <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-3xl font-bold">Stack AI Assist</h1>
        <p class="text-xs text-slate-400 mt-1">Analyze the whole DUMB stack: service status, dependency chains, selected logs, config context, and DUMB docs snippets.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1"
          :disabled="testing || !aiSettings.model || supported === false"
          @click="testProvider"
          title="Send a short provider connectivity prompt using the current provider settings."
        >
          <span v-if="testing" class="animate-spin material-symbols-rounded !text-[18px]">progress_activity</span>
          <span v-else class="material-symbols-rounded !text-[18px]">network_check</span>
          <span>Test provider</span>
        </button>
        <button
          class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1"
          :disabled="loading || supported === false"
          @click="runStackDiagnosis(true)"
          title="Build the stack diagnostic bundle without sending it to a provider."
        >
          <span class="material-symbols-rounded !text-[18px]">visibility</span>
          <span>Preview stack</span>
        </button>
        <button
          class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1"
          :disabled="loading || !aiSettings.enabled || supported === false"
          @click="runStackDiagnosis(false)"
          title="Send the stack diagnostic bundle to the configured provider."
        >
          <span v-if="loading" class="animate-spin material-symbols-rounded !text-[18px]">progress_activity</span>
          <span v-else class="material-symbols-rounded !text-[18px]">psychology</span>
          <span>Analyze stack</span>
        </button>
      </div>
    </div>

    <div v-if="supported === false" class="rounded border border-amber-500/30 bg-amber-950/30 p-3 text-sm text-amber-100">
      This backend does not expose AI diagnostics.
    </div>

    <div class="rounded border border-slate-700/70 bg-slate-900/30 p-3 md:p-4 space-y-4">
      <div class="grid gap-4 2xl:grid-cols-[minmax(420px,0.9fr)_minmax(420px,1.1fr)]">
        <div class="space-y-3">
          <div class="flex items-center gap-2 border-b border-slate-700/60 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <span class="material-symbols-rounded !text-[17px] text-sky-300">hub</span>
            <span>Provider</span>
          </div>
          <div class="grid gap-3 xl:grid-cols-[minmax(180px,0.7fr)_minmax(260px,1fr)]">
            <label class="space-y-1">
              <span class="text-xs text-slate-400">Provider</span>
              <SelectComponent v-model="aiSettings.provider" :items="aiProviderOptions" class="w-full" />
            </label>
            <label class="space-y-1">
              <span class="text-xs text-slate-400">Base URL</span>
              <Input
                v-model="aiSettings.base_url"
                class="w-full"
                placeholder="http://127.0.0.1:11434"
                title="Provider endpoint reachable from the DUMB backend container."
              />
            </label>
          </div>
          <div class="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_minmax(220px,0.8fr)]">
            <div class="space-y-1">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-slate-400">Model</span>
                <button
                  class="button-small border border-slate-50/20 hover:apply !py-1 !px-2 !gap-1 text-xs"
                  :disabled="modelsLoading || !modelDiscoverySupported"
                  @click="loadModels"
                  title="Fetch available models from Ollama /api/tags or an OpenAI-compatible /models endpoint."
                >
                  <span v-if="modelsLoading" class="animate-spin material-symbols-rounded !text-[16px]">progress_activity</span>
                  <span v-else class="material-symbols-rounded !text-[16px]">refresh</span>
                  <span>Load models</span>
                </button>
              </div>
              <Input v-if="!modelOptions.length" v-model="aiSettings.model" class="w-full" placeholder="llama3.1, gpt-4.1-mini, claude..." />
              <SelectComponent v-else v-model="aiSettings.model" :items="modelOptions" class="w-full" />
              <div v-if="modelsStatus" class="text-[11px] text-slate-500">{{ modelsStatus }}</div>
            </div>
            <label class="space-y-1">
              <span class="text-xs text-slate-400">API key</span>
              <div class="relative">
                <Input
                  v-model="aiSettings.api_key"
                  :type="apiKeyVisible ? 'text' : 'password'"
                  class="w-full pr-10"
                  :placeholder="aiSettings.api_key_configured ? 'Stored key configured' : (providerNeedsKey ? 'Required for this provider' : 'Optional')"
                  title="Leave blank when saving to keep an existing stored key unchanged."
                />
                <button
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                  :title="apiKeyVisible ? 'Hide API key' : 'Show API key'"
                  @click="apiKeyVisible = !apiKeyVisible"
                >
                  <span class="material-symbols-rounded !text-[18px]">{{ apiKeyVisible ? 'visibility_off' : 'visibility' }}</span>
                </button>
              </div>
            </label>
          </div>
        </div>

        <div class="space-y-3">
          <div class="flex items-center gap-2 border-b border-slate-700/60 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <span class="material-symbols-rounded !text-[17px] text-sky-300">tune</span>
            <span>Context</span>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label class="space-y-1">
              <span class="text-xs text-slate-400">Log characters</span>
              <Input v-model="aiSettings.max_log_chars" type="number" min="1000" max="50000" />
            </label>
            <label class="space-y-1">
              <span class="text-xs text-slate-400">Docs characters</span>
              <Input v-model="aiSettings.max_docs_chars" type="number" min="1000" max="60000" />
            </label>
            <label class="space-y-1">
              <span class="text-xs text-slate-400">Timeout seconds</span>
              <Input v-model="aiSettings.timeout_sec" type="number" min="5" max="300" />
            </label>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <label class="flex min-h-[34px] items-center gap-2 rounded border border-slate-700/50 bg-slate-950/30 px-2 text-xs text-slate-300" title="When off, Preview stack still works but Analyze stack will not call a provider.">
              <input type="checkbox" v-model="aiSettings.enabled" class="accent-slate-400" />
              Enable provider calls
            </label>
            <label class="flex min-h-[34px] items-center gap-2 rounded border border-slate-700/50 bg-slate-950/30 px-2 text-xs text-slate-300" title="Adds short log tails for services that need attention, such as stopped or unhealthy services.">
              <input type="checkbox" v-model="aiSettings.include_logs" class="accent-slate-400" />
              Targeted logs
            </label>
            <label class="flex min-h-[34px] items-center gap-2 rounded border border-slate-700/50 bg-slate-950/30 px-2 text-xs text-slate-300" title="Adds redacted configs for enabled services. This can be large; use Preview stack first.">
              <input type="checkbox" v-model="aiSettings.include_service_config" class="accent-slate-400" />
              Configs
            </label>
            <label class="flex min-h-[34px] items-center gap-2 rounded border border-slate-700/50 bg-slate-950/30 px-2 text-xs text-slate-300" title="Adds an aggregated runtime dependency graph across enabled services.">
              <input type="checkbox" v-model="aiSettings.include_dependency_graph" class="accent-slate-400" />
              Dependency graph
            </label>
            <label class="flex min-h-[34px] items-center gap-2 rounded border border-slate-700/50 bg-slate-950/30 px-2 text-xs text-slate-300" title="Adds selected public DUMB documentation snippets that match the stack state and question.">
              <input type="checkbox" v-model="aiSettings.include_docs_context" class="accent-slate-400" />
              Docs context
            </label>
            <label class="flex min-h-[34px] items-center gap-2 rounded border border-slate-700/50 bg-slate-950/30 px-2 text-xs text-slate-300" title="Adds compact status rows for all included services. This is normally useful for stack diagnostics.">
              <input type="checkbox" v-model="aiSettings.include_process_list" class="accent-slate-400" />
              Process list
            </label>
          </div>
        </div>
      </div>

      <div class="space-y-1">
        <span class="text-xs text-slate-400">Question or focus</span>
        <textarea
          v-model="question"
          rows="3"
          class="w-full rounded border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-400"
          placeholder="What should the stack assistant focus on?"
          title="Optional stack-wide focus, such as startup ordering, missing dependencies, unhealthy services, proxy routing, or media path issues."
        ></textarea>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-700/60 pt-3">
        <button
          class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1"
          :disabled="saving"
          @click="saveSettings"
          title="Save AI provider and stack context defaults to dumb.ai."
        >
          <span v-if="saving" class="animate-spin material-symbols-rounded !text-[18px]">progress_activity</span>
          <span v-else class="material-symbols-rounded !text-[18px]">save</span>
          <span>Save AI settings</span>
        </button>
      </div>

      <div v-if="error" class="rounded border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-200">{{ error }}</div>
      <div v-if="testResult" class="rounded border border-emerald-500/30 bg-emerald-950/20 p-2 text-xs text-emerald-100">
        <div class="font-semibold">Provider test passed</div>
        <div class="text-emerald-100/80">{{ testResult.response || 'Provider responded.' }}</div>
        <div v-if="testResult.usage?.total_tokens != null" class="text-emerald-100/60">
          Tokens: {{ testResult.usage.total_tokens }}
        </div>
      </div>
    </div>

    <div v-if="analysis" class="rounded border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold text-emerald-100">Stack analysis</div>
        <div class="text-right text-xs text-emerald-200/80">
          <div>{{ lastProvider }}</div>
          <div v-if="usageSummary" class="text-emerald-200/60">{{ usageSummary }}</div>
        </div>
      </div>
      <pre class="whitespace-pre-wrap text-sm leading-6 text-slate-100">{{ analysis }}</pre>
    </div>

    <div v-if="bundlePreview" class="rounded border border-slate-700/70 bg-slate-900/30 p-3 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold text-slate-100">Stack diagnostic bundle</div>
        <div class="text-xs text-slate-400">{{ dryRun ? 'Preview only' : 'Sent to provider' }}</div>
      </div>
      <pre class="max-h-[620px] overflow-auto rounded border border-slate-800 bg-slate-950/80 p-3 text-xs leading-5 text-slate-200">{{ bundlePreview }}</pre>
    </div>
  </div>
</template>
