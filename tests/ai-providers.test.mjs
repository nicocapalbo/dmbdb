import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, reactive } from 'vue'

import { useAiProviderProfiles } from '../composables/useAiProviderProfiles.js'
import {
  aiModelCompatibilityOptionPrefix,
  aiModelLifecycleOptionPrefix,
  AI_PROVIDER_OPTIONS,
  GEMINI_API_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  aiProviderHasManagedEndpoint,
  aiProviderManagedEndpointLabel,
  aiProviderNeedsKey,
  aiProviderSupportsModelDiscovery,
  applyAiProviderDefaults,
  isGeminiProvider,
  resolveAiModelCompatibility,
  resolveAiModelLifecycle,
} from '../constants/aiProviders.js'

test('provider options are alphabetical by label', () => {
  const labels = AI_PROVIDER_OPTIONS.map(option => option.label)
  assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right)))
})

test('Gemini model lifecycle metadata follows the selected model', () => {
  const retired = {
    model: 'gemini-2.0-flash-lite',
    status: 'retired',
    shutdown_date: '2026-06-01',
    replacement: 'gemini-3.1-flash-lite',
  }
  const discovered = [
    { value: 'gemini-2.0-flash-lite', lifecycle: retired },
    { value: 'gemini-3.5-flash-lite' },
  ]

  assert.deepEqual(
    resolveAiModelLifecycle('models/gemini-2.0-flash-lite', discovered),
    retired
  )
  assert.equal(
    resolveAiModelLifecycle('gemini-3.5-flash-lite', discovered, retired),
    null
  )
  assert.equal(aiModelLifecycleOptionPrefix(retired), '[retired] ')
  assert.equal(
    aiModelLifecycleOptionPrefix({
      status: 'deprecated',
      shutdown_date: '2026-10-16',
    }),
    '[retires 2026-10-16] '
  )
})

test('model compatibility metadata marks non-diagnostic provider models', () => {
  const unsupported = {
    status: 'unsupported',
    api_surface: 'responses',
    reason: 'DUMB AI Assist requires diagnostic text.',
  }
  const discovered = [
    { value: 'text-embedding-3-small', compatibility: unsupported },
    {
      value: 'gpt-5.3-codex',
      compatibility: { status: 'supported', api_surface: 'responses' },
    },
  ]

  assert.deepEqual(
    resolveAiModelCompatibility('text-embedding-3-small', discovered),
    unsupported
  )
  assert.equal(
    resolveAiModelCompatibility('gpt-5.3-codex', discovered).api_surface,
    'responses'
  )
  assert.equal(
    aiModelCompatibilityOptionPrefix(unsupported),
    '[unsupported] '
  )
  assert.equal(
    aiModelCompatibilityOptionPrefix({ status: 'supported' }),
    ''
  )
})

test('Gemini provider aliases require a key and support model discovery', () => {
  for (const provider of ['gemini', 'google_gemini']) {
    assert.equal(isGeminiProvider(provider), true)
    assert.equal(aiProviderNeedsKey(provider), true)
    assert.equal(aiProviderSupportsModelDiscovery(provider), true)
  }
})

test('native hosted providers expose managed endpoints', () => {
  assert.equal(aiProviderHasManagedEndpoint('openai'), true)
  assert.equal(aiProviderManagedEndpointLabel('openai'), 'OpenAI API')
  assert.equal(aiProviderHasManagedEndpoint('anthropic'), true)
  assert.equal(aiProviderSupportsModelDiscovery('anthropic'), true)
  assert.equal(aiProviderManagedEndpointLabel('claude'), 'Anthropic API')
  assert.equal(aiProviderHasManagedEndpoint('litellm'), false)
  assert.equal(aiProviderManagedEndpointLabel('openai_compatible'), '')
})

test('native OpenAI and Anthropic selections replace custom gateway URLs', () => {
  const openAiSettings = {
    base_url: 'https://gateway.example.invalid/v1',
    model: 'gpt-test',
    model_lifecycle: { model: 'gpt-test', status: 'retired' },
    model_compatibility: { model: 'gpt-test', status: 'unsupported' },
  }
  applyAiProviderDefaults(openAiSettings, 'openai', 'openai_compatible')
  assert.equal(openAiSettings.base_url, 'https://api.openai.com/v1')
  assert.equal(openAiSettings.model_lifecycle, null)
  assert.equal(openAiSettings.model_compatibility, null)

  const anthropicSettings = { base_url: 'https://gateway.example.invalid/anthropic', model: 'claude-test' }
  applyAiProviderDefaults(anthropicSettings, 'anthropic', 'openai_compatible')
  assert.equal(anthropicSettings.base_url, 'https://api.anthropic.com/v1/messages')

  applyAiProviderDefaults(anthropicSettings, 'openai_compatible', 'anthropic')
  assert.equal(anthropicSettings.base_url, '')
})

test('selecting Gemini replaces untouched Ollama defaults', () => {
  const settings = {
    base_url: 'http://127.0.0.1:11434',
    model: 'llama3.1',
  }

  applyAiProviderDefaults(settings, 'gemini', 'ollama')

  assert.equal(settings.base_url, GEMINI_API_BASE_URL)
  assert.equal(settings.model, GEMINI_DEFAULT_MODEL)
})

test('Gemini always uses its managed endpoint and leaving it restores provider defaults', () => {
  const defaultSettings = {
    base_url: GEMINI_API_BASE_URL,
    model: GEMINI_DEFAULT_MODEL,
  }
  applyAiProviderDefaults(defaultSettings, 'openai', 'gemini')
  assert.equal(defaultSettings.base_url, 'https://api.openai.com/v1')
  assert.equal(defaultSettings.model, '')

  const customSettings = {
    base_url: 'https://gateway.example.invalid/gemini',
    model: 'custom-model',
  }
  applyAiProviderDefaults(customSettings, 'gemini', 'openai_compatible')
  assert.equal(customSettings.base_url, GEMINI_API_BASE_URL)
  assert.equal(customSettings.model, GEMINI_DEFAULT_MODEL)
})

test('saved provider profiles synchronize, update, activate, and delete', async () => {
  const profile = {
    id: 'gemini-profile',
    name: 'Free Gemini',
    provider: 'gemini',
    base_url: GEMINI_API_BASE_URL,
    model: GEMINI_DEFAULT_MODEL,
    api_key_configured: true,
  }
  const settings = reactive({
    active_profile_id: '',
    profiles: [],
    api_key: 'must-be-cleared',
    api_key_configured: false,
  })
  const calls = []
  const service = {
    async saveProfile(payload) {
      calls.push(['save', payload])
      return {
        ...settings,
        ...profile,
        active_profile_id: profile.id,
        profiles: [profile],
        api_key_configured: true,
      }
    },
    async activateProfile(profileId) {
      calls.push(['activate', profileId])
      return {
        ...settings,
        ...profile,
        active_profile_id: profile.id,
        profiles: [profile],
        api_key_configured: true,
      }
    },
    async deleteProfile(profileId) {
      calls.push(['delete', profileId])
      return {
        ...settings,
        active_profile_id: '',
        profiles: [],
        api_key_configured: false,
      }
    },
  }
  const profiles = useAiProviderProfiles(settings, service)

  profiles.syncProfileSettings({
    ...settings,
    ...profile,
    active_profile_id: profile.id,
    profiles: [profile],
    api_key_configured: true,
  })
  assert.equal(profiles.selectedProfileId.value, profile.id)
  assert.equal(profiles.profileName.value, profile.name)
  assert.equal(settings.api_key, '')
  await nextTick()

  profiles.profileName.value = 'Gemini Updated'
  assert.equal(profiles.markProfileDirty(), true)
  assert.equal(profiles.selectedProfileId.value, '')
  assert.equal(profiles.editingProfileId.value, profile.id)
  assert.equal(settings.active_profile_id, '')
  await profiles.saveProfile({
    provider: 'gemini',
    base_url: GEMINI_API_BASE_URL,
    model: GEMINI_DEFAULT_MODEL,
  })
  assert.equal(calls[0][0], 'save')
  assert.equal(calls[0][1].id, profile.id)
  assert.equal(calls[0][1].name, 'Gemini Updated')

  await profiles.activateProfile(profile.id)
  assert.deepEqual(calls[1], ['activate', profile.id])

  await profiles.deleteProfile()
  assert.deepEqual(calls[2], ['delete', profile.id])
  assert.equal(profiles.selectedProfileId.value, '')
  assert.equal(profiles.profileOptions.value[0].label, 'Unsaved provider')
})

test('saved provider profile options are alphabetical after Unsaved provider', () => {
  const settings = reactive({
    profiles: [
      { id: 'openai-mini', name: 'OpenAI - GPT5.4-Mini' },
      { id: 'gemini', name: 'Gemini' },
      { id: 'claude', name: 'Claude Fable5' },
      { id: 'litellm', name: 'LiteLLM - GPT5.5' },
      { id: 'openai-codex', name: 'OpenAI - GPT5.3-Codex' },
    ],
  })
  const profiles = useAiProviderProfiles(settings, {})

  assert.deepEqual(
    profiles.profileOptions.value.map(option => option.label),
    [
      'Unsaved provider',
      'Claude Fable5',
      'Gemini',
      'LiteLLM - GPT5.5',
      'OpenAI - GPT5.3-Codex',
      'OpenAI - GPT5.4-Mini',
    ]
  )
})

test('switching provider types detaches from the selected profile as a new provider', async () => {
  const profile = {
    id: 'openai-profile',
    name: 'Hosted OpenAI',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-test',
    api_key_configured: true,
  }
  const settings = reactive({
    ...profile,
    active_profile_id: profile.id,
    profiles: [profile],
    api_key: '',
  })
  const profiles = useAiProviderProfiles(settings, {})

  profiles.syncProfileSettings(settings)
  await nextTick()
  settings.provider = 'anthropic'

  assert.equal(profiles.markProfileDirty({ newProvider: true }), true)
  assert.equal(profiles.selectedProfileId.value, '')
  assert.equal(profiles.editingProfileId.value, '')
  assert.equal(profiles.profileName.value, '')
  assert.equal(settings.active_profile_id, '')
  assert.equal(settings.api_key_configured, false)
})
