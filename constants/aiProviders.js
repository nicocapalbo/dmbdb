export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'

export const AI_PROVIDER_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic / Claude' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'litellm', label: 'LiteLLM' },
  { value: 'ollama', label: 'Local Ollama' },
  { value: 'open_webui', label: 'Open WebUI' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai_compatible', label: 'OpenAI-compatible' },
]

const GEMINI_PROVIDERS = new Set(['gemini', 'google_gemini'])
const API_KEY_PROVIDERS = new Set([
  'gemini',
  'google_gemini',
  'openai',
  'open_webui',
  'litellm',
  'anthropic',
  'claude',
])
const MODEL_DISCOVERY_PROVIDERS = new Set([
  'anthropic',
  'claude',
  'gemini',
  'google_gemini',
  'ollama',
  'openai',
  'openai_compatible',
  'compatible',
  'litellm',
  'open_webui',
])

const PROVIDER_BASE_URLS = {
  ollama: 'http://127.0.0.1:11434',
  gemini: GEMINI_API_BASE_URL,
  google_gemini: GEMINI_API_BASE_URL,
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1/messages',
  claude: 'https://api.anthropic.com/v1/messages',
}
const MANAGED_PROVIDER_ENDPOINT_LABELS = {
  gemini: 'Google Gemini API',
  google_gemini: 'Google Gemini API',
  openai: 'OpenAI API',
  anthropic: 'Anthropic API',
  claude: 'Anthropic API',
}

const normalizeProvider = provider => String(provider || '').trim().toLowerCase()
const normalizeModelName = model =>
  String(model || '').trim().replace(/^models\//i, '').toLowerCase()

export const resolveAiModelLifecycle = (
  model,
  discoveredModels = [],
  configuredLifecycle = null
) => {
  const normalizedModel = normalizeModelName(model)
  if (!normalizedModel) return null
  const discovered = (Array.isArray(discoveredModels) ? discoveredModels : [])
    .find(entry => normalizeModelName(entry?.value || entry?.name) === normalizedModel)
  const lifecycle = discovered?.lifecycle || configuredLifecycle
  if (!lifecycle || typeof lifecycle !== 'object') return null
  if (
    lifecycle.model
    && normalizeModelName(lifecycle.model) !== normalizedModel
  ) return null
  const status = String(lifecycle.status || '').trim().toLowerCase()
  if (!['retired', 'deprecated'].includes(status)) return null
  return {
    ...lifecycle,
    model: normalizedModel,
    status,
  }
}

export const aiModelLifecycleOptionPrefix = lifecycle => {
  const status = String(lifecycle?.status || '').trim().toLowerCase()
  if (status === 'retired') return '[retired] '
  if (status === 'deprecated' && lifecycle?.shutdown_date) {
    return `[retires ${lifecycle.shutdown_date}] `
  }
  return ''
}

export const resolveAiModelCompatibility = (
  model,
  discoveredModels = [],
  configuredCompatibility = null
) => {
  const normalizedModel = normalizeModelName(model)
  if (!normalizedModel) return null
  const discovered = (Array.isArray(discoveredModels) ? discoveredModels : [])
    .find(entry => normalizeModelName(entry?.value || entry?.name) === normalizedModel)
  const compatibility = discovered?.compatibility || configuredCompatibility
  if (!compatibility || typeof compatibility !== 'object') return null
  if (
    compatibility.model
    && normalizeModelName(compatibility.model) !== normalizedModel
  ) return null
  const status = String(compatibility.status || '').trim().toLowerCase()
  if (!['supported', 'unsupported', 'unknown'].includes(status)) return null
  return { ...compatibility, status }
}

export const aiModelCompatibilityOptionPrefix = compatibility =>
  String(compatibility?.status || '').trim().toLowerCase() === 'unsupported'
    ? '[unsupported] '
    : ''

export const isGeminiProvider = provider =>
  GEMINI_PROVIDERS.has(normalizeProvider(provider))

export const aiProviderNeedsKey = provider =>
  API_KEY_PROVIDERS.has(normalizeProvider(provider))

export const aiProviderSupportsModelDiscovery = provider =>
  MODEL_DISCOVERY_PROVIDERS.has(normalizeProvider(provider))

export const aiProviderHasManagedEndpoint = provider =>
  Boolean(MANAGED_PROVIDER_ENDPOINT_LABELS[normalizeProvider(provider)])

export const aiProviderManagedEndpointLabel = provider =>
  MANAGED_PROVIDER_ENDPOINT_LABELS[normalizeProvider(provider)] || ''

export const applyAiProviderDefaults = (settings, nextProvider, previousProvider) => {
  const next = normalizeProvider(nextProvider)
  const previous = normalizeProvider(previousProvider)
  const currentBaseUrl = String(settings.base_url || '').trim().replace(/\/+$/, '')
  const previousBaseUrl = String(PROVIDER_BASE_URLS[previous] || '').replace(/\/+$/, '')

  if (next !== previous) {
    settings.model_lifecycle = null
    settings.model_compatibility = null
  }

  if (aiProviderHasManagedEndpoint(next)) {
    settings.base_url = PROVIDER_BASE_URLS[next]
  }

  if (isGeminiProvider(next)) {
    if (!String(settings.model || '').trim().toLowerCase().startsWith('gemini-')) {
      settings.model = GEMINI_DEFAULT_MODEL
    }
    return
  }

  if (isGeminiProvider(previous)) {
    if (currentBaseUrl === GEMINI_API_BASE_URL) {
      settings.base_url = PROVIDER_BASE_URLS[next] || ''
    }
    if (String(settings.model || '').trim().toLowerCase().startsWith('gemini-')) {
      settings.model = ''
    }
  }

  if (
    aiProviderHasManagedEndpoint(previous)
    && !aiProviderHasManagedEndpoint(next)
    && currentBaseUrl === previousBaseUrl
  ) {
    settings.base_url = PROVIDER_BASE_URLS[next] || ''
  }
}
