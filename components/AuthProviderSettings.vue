<template>
  <div class="rounded-lg border border-slate-700 bg-slate-800 p-4 sm:p-6">
    <div class="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
      <div class="min-w-0">
        <h3 class="text-lg font-semibold">Sign-in provider</h3>
        <p class="mt-1 max-w-4xl text-sm text-slate-400">
          Choose how people sign in to DUMB. Local accounts are stored by DUMB;
          OIDC delegates sign-in to Authelia, Google, or another identity provider.
          Hybrid mode keeps local accounts available as recovery access.
        </p>
      </div>
      <a
        href="https://dumbarr.com/features/authentication/#single-sign-on"
        target="_blank"
        rel="noopener noreferrer"
        class="shrink-0 text-sm text-sky-300 hover:text-sky-200"
      >
        SSO docs ↗
      </a>
    </div>

    <div
      class="mb-4 rounded border border-sky-500/35 bg-sky-950/25 p-3 text-sm text-slate-300"
    >
      <p class="font-semibold text-sky-100">How SSO setup works</p>
      <ol class="mt-2 list-decimal space-y-1 pl-5">
        <li>Choose a safe rollout mode and provider preset.</li>
        <li>Create an OIDC/OAuth web application at that provider.</li>
        <li>Register the exact DUMB redirect URI shown below.</li>
        <li>Enter the issued client ID and secret, then check discovery before saving.</li>
      </ol>
      <p class="mt-2 text-xs text-slate-400">
        A preset fills known provider metadata; it cannot create the provider-side
        application or obtain its client credentials. DUMB-managed Authelia is the
        exception: DUMB creates that client automatically when you link it.
      </p>
    </div>

    <div v-if="loading" class="text-sm text-slate-400">Loading provider settings…</div>
    <form v-else class="grid min-w-0 gap-4 lg:grid-cols-2" @submit.prevent="save">
      <label class="field">
        <span class="text-slate-200">Authentication mode</span>
        <select v-model="form.mode" class="input">
          <option value="local">Local accounts only</option>
          <option v-if="hybridSupported" value="hybrid">SSO + local fallback (recommended)</option>
          <option value="oidc">SSO only</option>
        </select>
        <small>{{ authenticationModeHelp }}</small>
      </label>

      <label v-if="form.mode !== 'local'" class="field">
        <span class="text-slate-200">Provider preset</span>
        <select v-model="selectedPresetId" class="input" @change="applySelectedPreset">
          <option v-for="preset in providerPresetOptions" :key="preset.id" :value="preset.id">
            {{ preset.label }}
          </option>
        </select>
        <small>Selecting a preset replaces unsaved provider-specific values.</small>
      </label>

      <div
        v-if="form.mode !== 'local'"
        class="lg:col-span-2 rounded border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-300"
      >
        <p class="font-semibold text-slate-100">{{ selectedPreset.label }}</p>
        <p class="mt-1 text-slate-400">{{ selectedPreset.description }}</p>
      </div>

      <div
        v-if="form.mode !== 'local' && managedAutheliaSelected"
        class="lg:col-span-2 rounded border border-violet-500/40 bg-violet-950/25 p-3 text-sm text-violet-100"
      >
        <p class="font-semibold">DUMB-managed Authelia detected</p>
        <p class="mt-1 text-slate-300">
          Issuer:
          <code class="break-all">{{ managedAutheliaIssuer }}</code>.
          Saving this provider creates or reuses Authelia's dedicated
          <code>dumb</code> client and stores its generated secret without displaying it.
          When TPA has a matching root domain, DUMB first creates or verifies the
          prerequisite Authelia portal route.
        </p>
        <NuxtLink
          to="/services/Authelia"
          class="mt-2 inline-flex text-violet-300 hover:text-violet-200"
        >
          Open the Authelia setup and integration wizard →
        </NuxtLink>
      </div>

      <template v-if="form.mode !== 'local'">
        <label class="field">
          <span class="text-slate-200">Sign-in button label</span>
          <input v-model="form.provider_name" class="input" :placeholder="selectedPreset.providerName" />
          <small>This appears on DUMB's login page, for example “Continue with Google.”</small>
        </label>

        <label class="field">
          <span class="text-slate-200">Issuer URL</span>
          <input
            v-model="form.issuer_url"
            class="input"
            :placeholder="selectedPreset.issuerPlaceholder"
            :readonly="managedAutheliaSelected"
            required
          />
          <small>
            The provider's exact case-sensitive OIDC issuer—not its admin console
            or a general homepage.
          </small>
        </label>

        <label class="field">
          <span class="text-slate-200">Discovery URL <span class="text-slate-500">(optional)</span></span>
          <input
            v-model="form.discovery_url"
            class="input"
            placeholder="Derived as <issuer>/.well-known/openid-configuration"
            :readonly="managedAutheliaSelected"
          />
          <small>
            Leave blank for standard discovery. Fill this only when the provider
            publishes metadata somewhere other than the issuer's well-known path.
          </small>
        </label>

        <label class="field">
          <span class="text-slate-200">Client ID</span>
          <input
            v-model="form.client_id"
            class="input"
            autocomplete="off"
            :readonly="managedAutheliaSelected"
            required
          />
          <small>
            The public application identifier issued after creating DUMB as an
            OIDC/OAuth web application.
          </small>
        </label>

        <label v-if="!managedAutheliaSelected" class="field">
          <span class="text-slate-200">
            Client secret
            <span v-if="secretConfigured" class="text-emerald-400">(configured; blank keeps it)</span>
          </span>
          <input
            v-model="form.client_secret"
            type="password"
            class="input"
            autocomplete="new-password"
            :required="!secretConfigured"
          />
          <small>
            Keep this private. DUMB stores it in its protected authentication
            configuration and never returns the saved value to the browser.
          </small>
        </label>
        <div v-else class="field">
          <span class="text-slate-200">Client secret</span>
          <div class="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 text-slate-400">
            {{ managedProviderLinked ? 'Generated and securely configured' : 'Generated automatically when linked' }}
          </div>
          <small>You do not need to generate, copy, or paste this secret.</small>
        </div>

        <label class="field">
          <span class="text-slate-200">Redirect URI</span>
          <input
            v-model="form.redirect_uri"
            class="input"
            placeholder="https://dumb.example.com/api/auth/oidc/callback"
            required
          />
          <small>
            Copy this exact value into the provider application's allowed callback
            or redirect URI list. Use DUMB's browser-facing HTTPS FQDN—never
            localhost, an IP address, or an embedded service URL.
          </small>
          <small v-if="redirectUriError" class="!text-amber-300">
            {{ redirectUriError }}
          </small>
        </label>

        <label class="field">
          <span class="text-slate-200">Scopes</span>
          <input v-model="scopesText" class="input" placeholder="openid profile email" />
          <small>
            <code>openid</code> is required. Presets request only the normal profile,
            email, and provider-supported group claims needed for sign-in.
          </small>
        </label>

        <label class="field">
          <span class="text-slate-200">Allowed groups <span class="text-slate-500">(optional)</span></span>
          <input v-model="allowedGroupsText" class="input" placeholder="admins, operators" />
          <small>{{ selectedPreset.groupsHint }}</small>
        </label>

        <div class="lg:col-span-2 rounded border border-slate-700 bg-slate-900/40 p-3">
          <p class="text-sm font-semibold text-slate-100">Provider connection safety</p>
          <p class="mt-1 text-xs text-slate-400">
            These options control which provider endpoints the DUMB backend is
            allowed to contact. They do not change browser-to-DUMB TLS.
          </p>
          <div class="mt-3 grid gap-3 lg:grid-cols-3">
            <label class="safety-option">
              <input v-model="form.tls_verify" type="checkbox" class="mt-0.5" />
              <span>
                <strong>Verify provider TLS</strong>
                <small>
                  Validates the provider's HTTPS certificate and hostname. Keep this
                  enabled unless testing a deliberately self-signed internal provider.
                </small>
              </span>
            </label>
            <label class="safety-option">
              <input v-model="form.allow_private_endpoints" type="checkbox" class="mt-0.5" />
              <span>
                <strong>Allow private endpoint IPs</strong>
                <small>
                  Permits provider hostnames that resolve to loopback, RFC1918, or
                  other private addresses. Enable only for a trusted self-hosted IdP.
                </small>
              </span>
            </label>
            <label class="safety-option">
              <input v-model="form.allow_http" type="checkbox" class="mt-0.5" />
              <span>
                <strong>Allow HTTP</strong>
                <small>
                  Permits unencrypted provider endpoints. Use only on an isolated,
                  trusted network when HTTPS is genuinely unavailable.
                </small>
              </span>
            </label>
          </div>
        </div>

        <label
          v-if="form.mode === 'oidc'"
          class="lg:col-span-2 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-950/25 p-3 text-sm text-amber-100"
        >
          <input v-model="form.confirm_oidc_only" type="checkbox" class="mt-0.5" />
          <span>
            I have successfully tested this provider and understand that SSO-only
            mode removes DUMB's local break-glass login.
          </span>
        </label>
      </template>

      <div v-if="message" class="lg:col-span-2 rounded border px-3 py-2 text-sm" :class="messageClass">
        {{ message }}
      </div>

      <div class="lg:col-span-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          v-if="form.mode !== 'local'"
          type="button"
          class="button-small w-full border border-sky-500/50 hover:bg-sky-900/40 sm:w-auto"
          :disabled="busy || !providerTestAvailable"
          :title="providerTestAvailable
            ? 'Fetch and validate the provider discovery document without saving'
            : 'Link managed Authelia first so DUMB has its generated client secret'"
          @click="test"
        >
          Check discovery
        </button>
        <button type="submit" class="button-small apply w-full sm:w-auto" :disabled="busy">
          {{ busy ? 'Saving…' : saveButtonLabel }}
        </button>
      </div>
      <p v-if="form.mode !== 'local'" class="lg:col-span-2 text-xs text-slate-400">
        <strong>Check discovery</strong> validates issuer metadata and endpoint safety
        without changing login. <strong>{{ saveButtonLabel }}</strong> persists the
        provider and selected authentication mode.
      </p>
    </form>
  </div>
</template>

<script setup>
import axios from 'axios'
import { computed, onMounted, reactive, ref } from 'vue'
import { authRepository } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import {
  availableOidcProviderPresets,
  detectOidcProviderPreset,
  getOidcProviderPreset,
} from '~/helper/oidcProviderPresets.js'
import {
  oidcRedirectUriForOrigin,
  validateOidcRedirectUri,
} from '~/helper/oidcRedirectUri.js'

const props = defineProps({
  hybridSupported: {
    type: Boolean,
    default: false,
  },
  managedAutheliaSupported: {
    type: Boolean,
    default: false,
  },
})

const auth = authRepository()
const authStore = useAuthStore()
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const messageKind = ref('info')
const secretConfigured = ref(false)
const currentProviderSource = ref('')
const selectedPresetId = ref('external-authelia')
const managedAutheliaStatus = ref(null)
const scopesText = ref('openid profile email groups')
const allowedGroupsText = ref('')
const form = reactive({
  mode: 'local',
  enabled: true,
  provider_name: 'Authelia',
  source: 'external_authelia',
  issuer_url: '',
  discovery_url: '',
  authorization_endpoint: '',
  token_endpoint: '',
  userinfo_endpoint: '',
  jwks_uri: '',
  client_id: '',
  client_secret: '',
  redirect_uri: '',
  scopes: [],
  username_claim: 'preferred_username',
  groups_claim: 'groups',
  allowed_groups: [],
  tls_verify: true,
  allow_private_endpoints: false,
  allow_http: false,
  timeout_seconds: 10,
  confirm_oidc_only: false,
})

const managedAutheliaConfigured = computed(() => (
  props.managedAutheliaSupported
  && managedAutheliaStatus.value?.managed?.configured === true
))
const managedAutheliaIssuer = computed(() => (
  String(managedAutheliaStatus.value?.managed?.public_url || '').trim()
))
const providerPresetOptions = computed(() => availableOidcProviderPresets({
  managedAutheliaConfigured: (
    managedAutheliaConfigured.value || currentProviderSource.value === 'managed'
  ),
}))
const selectedPreset = computed(() => getOidcProviderPreset(selectedPresetId.value))
const managedAutheliaSelected = computed(() => selectedPresetId.value === 'managed-authelia')
const managedProviderLinked = computed(() => (
  managedAutheliaSelected.value
  && currentProviderSource.value === 'managed'
  && secretConfigured.value
))
const providerTestAvailable = computed(() => (
  form.mode !== 'local'
  && (!managedAutheliaSelected.value || managedProviderLinked.value)
))
const redirectUriError = computed(() => validateOidcRedirectUri(form.redirect_uri))
const saveButtonLabel = computed(() => (
  form.mode !== 'local' && managedAutheliaSelected.value
    ? 'Link managed Authelia'
    : 'Save provider'
))
const authenticationModeHelp = computed(() => {
  if (form.mode === 'local') {
    return 'Only DUMB usernames and passwords are offered. Existing OIDC settings remain stored for later reuse.'
  }
  if (form.mode === 'hybrid') {
    return 'Shows the SSO button and keeps local password login available as a recovery path.'
  }
  return 'Shows only the SSO button. A provider outage or bad configuration can lock you out.'
})

const messageClass = computed(() => ({
  'border-emerald-500/40 bg-emerald-950/25 text-emerald-100': messageKind.value === 'success',
  'border-red-500/40 bg-red-950/25 text-red-100': messageKind.value === 'error',
  'border-sky-500/40 bg-sky-950/25 text-sky-100': messageKind.value === 'info',
}))

const list = (value) => String(value || '').split(/[\s,]+/).filter(Boolean)

const payload = () => ({
  ...form,
  scopes: list(scopesText.value),
  allowed_groups: list(allowedGroupsText.value),
})

const callbackUrl = () => {
  const value = String(form.redirect_uri || '').trim()
  const error = validateOidcRedirectUri(value)
  if (error) throw new Error(error)
  return new URL(value)
}

const suggestRedirectUri = () => {
  if (!form.redirect_uri && import.meta.client) {
    form.redirect_uri = oidcRedirectUriForOrigin(window.location.origin)
  }
}

const clearProviderCredentials = () => {
  form.client_secret = ''
  secretConfigured.value = false
  currentProviderSource.value = ''
}

const applyPreset = (presetId) => {
  const preset = getOidcProviderPreset(presetId)
  selectedPresetId.value = preset.id
  form.source = preset.source
  form.provider_name = preset.providerName
  form.issuer_url = preset.id === 'managed-authelia'
    ? managedAutheliaIssuer.value
    : preset.issuerUrl
  form.discovery_url = preset.discoveryUrl
  form.authorization_endpoint = ''
  form.token_endpoint = ''
  form.userinfo_endpoint = ''
  form.jwks_uri = ''
  form.client_id = preset.id === 'managed-authelia' ? 'dumb' : ''
  form.username_claim = preset.usernameClaim
  form.groups_claim = preset.groupsClaim
  scopesText.value = preset.scopes.join(' ')
  allowedGroupsText.value = ''
  form.tls_verify = true
  form.allow_private_endpoints = false
  form.allow_http = false
  form.timeout_seconds = 10
  form.confirm_oidc_only = false
  clearProviderCredentials()
  suggestRedirectUri()
}

const applySelectedPreset = () => {
  message.value = ''
  applyPreset(selectedPresetId.value)
}

const loadManagedAuthelia = async () => {
  managedAutheliaStatus.value = null
  if (!props.managedAutheliaSupported) return
  try {
    managedAutheliaStatus.value = (
      await axios.get('/api/integrations/authelia/status')
    ).data
  } catch (error) {
    console.warn('Managed Authelia status is unavailable:', error)
  }
}

const ensureManagedAutheliaRoute = async () => {
  if (managedAutheliaStatus.value?.tpa?.enabled !== true) return null

  const issuerHost = new URL(managedAutheliaIssuer.value).hostname.toLowerCase()
  const discovery = (await axios.get('/api/integrations/authelia/tpa-domains')).data
  const applications = Array.isArray(discovery?.route_applications)
    ? discovery.route_applications
    : []
  if (!applications.includes('authelia')) return null

  const domains = Array.isArray(discovery?.domains) ? discovery.domains : []
  const domain = domains.find((candidate) => {
    const root = String(candidate?.domain || '').toLowerCase()
    return root && (issuerHost === root || issuerHost.endsWith(`.${root}`))
  })
  if (!domain?.id) return null

  return (
    await axios.post('/api/integrations/authelia/tpa-route', {
      domain_id: domain.id,
      application: 'authelia',
    })
  ).data
}

const load = async () => {
  loading.value = true
  try {
    await loadManagedAuthelia()
    const result = await auth.getAuthProvider()
    const oidc = result?.oidc || {}
    Object.assign(form, {
      ...form,
      ...oidc,
      mode: result?.mode || 'local',
      client_secret: '',
      confirm_oidc_only: false,
    })
    currentProviderSource.value = String(oidc.source || '')
    secretConfigured.value = oidc.client_secret_configured === true
    scopesText.value = (oidc.scopes || ['openid', 'profile', 'email', 'groups']).join(' ')
    allowedGroupsText.value = (oidc.allowed_groups || []).join(', ')
    suggestRedirectUri()

    const storedProviderPresent = Boolean(
      oidc.source || oidc.issuer_url || oidc.client_id || oidc.client_secret_configured
    )
    if (!storedProviderPresent && managedAutheliaConfigured.value) {
      const mode = form.mode
      const redirectUri = form.redirect_uri
      applyPreset('managed-authelia')
      form.mode = mode
      form.redirect_uri = redirectUri
    } else {
      selectedPresetId.value = detectOidcProviderPreset({
        source: oidc.source,
        issuerUrl: oidc.issuer_url,
      })
      if (selectedPresetId.value === 'managed-authelia' && managedAutheliaIssuer.value) {
        form.source = 'managed'
        form.issuer_url = managedAutheliaIssuer.value
        form.client_id = 'dumb'
      }
    }
  } catch (error) {
    messageKind.value = 'error'
    message.value = error.response?.data?.detail || 'Unable to load provider settings.'
  } finally {
    loading.value = false
  }
}

const test = async () => {
  busy.value = true
  message.value = ''
  try {
    if (form.mode !== 'local') callbackUrl()
    if (!providerTestAvailable.value) {
      throw new Error('Link managed Authelia first so DUMB can create its client secret.')
    }
    const result = await auth.testAuthProvider(payload())
    messageKind.value = 'success'
    message.value = `Discovery succeeded for ${result.issuer}. No login settings were changed.`
  } catch (error) {
    messageKind.value = 'error'
    message.value = error.response?.data?.detail || error.message || 'Provider discovery failed.'
  } finally {
    busy.value = false
  }
}

const save = async () => {
  busy.value = true
  message.value = ''
  try {
    const redirect = form.mode !== 'local' ? callbackUrl() : null
    if (form.mode !== 'local' && managedAutheliaSelected.value) {
      const routeResult = await ensureManagedAutheliaRoute()
      await axios.post('/api/integrations/authelia/link-dumb', {
        source: 'managed',
        mode: form.mode,
        provider_name: form.provider_name,
        dumb_public_url: redirect.origin,
        issuer_url: form.issuer_url,
        discovery_url: form.discovery_url,
        client_id: 'dumb',
        client_secret: '',
        scopes: list(scopesText.value),
        username_claim: form.username_claim,
        groups_claim: form.groups_claim,
        allowed_groups: list(allowedGroupsText.value),
        tls_verify: form.tls_verify,
        allow_private_endpoints: form.allow_private_endpoints,
        allow_http: form.allow_http,
        confirm_oidc_only: form.confirm_oidc_only,
      })
      const routeMessage = routeResult?.created
        ? ' Its public portal route was created in TPA.'
        : routeResult?.reused
          ? ' Its existing TPA portal route was verified.'
          : ''
      message.value = `DUMB-managed Authelia is linked.${routeMessage} Test SSO before removing local fallback.`
    } else {
      await auth.updateAuthProvider(payload())
      message.value = form.mode === 'local'
        ? 'Local authentication mode saved.'
        : 'Authentication provider saved. Test sign-in before ending the current session.'
    }
    await authStore.checkAuthStatus()
    messageKind.value = 'success'
    form.client_secret = ''
    await load()
  } catch (error) {
    messageKind.value = 'error'
    message.value = error.response?.data?.detail || error.message || 'Unable to save provider.'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.field {
  @apply grid min-w-0 content-start gap-1 text-sm text-slate-300;
}

.field small {
  @apply text-xs leading-5 text-slate-500;
}

.input {
  @apply block w-full min-w-0 max-w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none;
}

.input:focus {
  border-color: rgb(14 165 233);
}

.input[readonly] {
  @apply cursor-default bg-slate-950/50 text-slate-300;
}

.safety-option {
  @apply flex items-start gap-2 rounded border border-slate-700 bg-slate-950/30 p-3 text-sm text-slate-300;
}

.safety-option strong {
  @apply block text-slate-200;
}

.safety-option small {
  @apply mt-1 block text-xs leading-5 text-slate-500;
}
</style>
