<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import useService from '~/services/useService.js'
import { useProcessesStore } from '~/stores/processes.js'

const store = useOnboardingStore()
const emit = defineEmits(['next'])
const { configService } = useService()
const processesStore = useProcessesStore()
const projectName = computed(() => processesStore.projectName)

// ------------------------------------
// Key + instance resolution
// ------------------------------------
const rawInstKey = computed(() => store.currentServiceKey || '') // e.g. 'radarr' or 'radarr.dependency'
const parentName = computed(() => rawInstKey.value.split('.', 2)[0])

// Collect instance list from coreServices (the user's chosen cores)
const instanceList = computed(() => {
  const list = Array.isArray(store.coreServices) ? store.coreServices : []
  return list.filter(s => s?.name === parentName.value && (s.instance_name || '').trim() !== '')
})

const supportsInstances = computed(() => store.coreSupportsInstances(parentName.value))
const hasMultiInstances = computed(() => supportsInstances.value && instanceList.value.length > 1)

// Best-effort single-instance name (fallback path)
const instanceName = computed(() => {
  const explicit = store.currentInstanceName || store.currentService?.instance_name || store.currentServiceOptions?.instance_name
  if (explicit) return explicit
  // If exactly one instance exists, use that so we key properly even in single card mode
  if (instanceList.value.length === 1) return instanceList.value[0].instance_name
  return ''
})

// Effective key for single-instance path (kept for back-compat); per-instance path builds keys ad-hoc
const instKey = computed(() => {
  const base = rawInstKey.value
  if (!base) return ''
  return supportsInstances.value && instanceName.value ? `${base}::${instanceName.value}` : base
})

// NOTE: split parent/service from the raw key so '::' never interferes
const parentKey = computed(() => rawInstKey.value.split('.', 2)[0] || '')
const serviceKey = computed(() => {
  const parts = rawInstKey.value.split('.', 2)
  return parts[1] || parts[0] || ''
})

// ------------------------------------
// Debug (comment out to disable)
// ------------------------------------
// function d(label, obj) { try { console.debug('[Step4ServiceOptions]', label, JSON.parse(JSON.stringify(obj))) } catch { console.debug('[Step4ServiceOptions]', label, obj) } }
// ------------------------------------
// Disabled Debugging (comment out the above line and uncomment this one to enable)
// ------------------------------------
function d(label, obj) { /* console.debug('[Step4ServiceOptions]', label, JSON.parse(JSON.stringify(obj))) */ }
// ------------------------------------
watch([rawInstKey, instanceName, instKey, instanceList], ([rawK, instName, effK, list]) => {
  d('keys', { currentServiceKey: store.currentServiceKey, rawInstKey: rawK, instanceName: instName, effectiveInstKey: effK, supportsInstances: supportsInstances.value, instanceList: list.map(i => i.instance_name) })
}, { immediate: true })

// ------------------------------------
// Metadata helpers (single-instance path)
// ------------------------------------
const metadata = computed(() => {
  const defaults = store.currentServiceOptions.options || {}
  const edits = store._userServiceOptions[instKey.value] || {}
  const filteredEdits = Object.fromEntries(Object.entries(edits).filter(([key]) => key in defaults))
  return { ...defaults, ...filteredEdits }
})

const rawMetadata = computed(() => {
  const defaults = store.currentServiceOptions.options || {}
  const allEdits = store._userServiceOptions[instKey.value] || {}
  const edits = Object.fromEntries(Object.entries(allEdits).filter(([key]) => key in defaults))
  return { defaults, edits }
})

watch(metadata, (m) => {
  const defaultsKeys = Object.keys(store.currentServiceOptions.options || {})
  const editKeys = Object.keys(store._userServiceOptions[instKey.value] || {})
  const mergedKeys = Object.keys(m || {})
  d('metadata(single)', { defaultsKeys, editKeys, mergedKeys, instKey: instKey.value })
}, { immediate: true })

// ------------------------------------
// Per-instance helpers (multi-instance rendering)
// ------------------------------------
const sharedDefaults = computed(() => store.currentServiceOptions.options || {})
const sharedDescriptions = computed(() => store.currentServiceOptions.descriptions || {})

function keyForInstance(instName) {
  const base = rawInstKey.value
  return supportsInstances.value && instName ? `${base}::${instName}` : base
}

function getInstMeta(instName) {
  const ik = keyForInstance(instName)
  const defaults = sharedDefaults.value
  const edits = store._userServiceOptions[ik] || {}
  const filtered = Object.fromEntries(Object.entries(edits).filter(([k]) => k in defaults))
  const merged = { ...defaults, ...filtered }
  d('metadata(per-inst)', { ik, defaultsKeys: Object.keys(defaults), editKeys: Object.keys(edits), mergedKeys: Object.keys(merged) })
  return merged
}

function onFieldChangeFor(instName, key, raw) {
  const meta = getInstMeta(instName)
  let val = raw
  if (typeof meta[key] === 'boolean') val = Boolean(raw)
  else if (typeof meta[key] === 'number') val = Number(raw)
  const ik = keyForInstance(instName)
  d('onFieldChangeFor', { ik, key, val })
  store.setUserServiceOptions(ik, { [key]: val })
  d('_userServiceOptions.afterWrite(per-inst)', { target: ik, value: store._userServiceOptions[ik], allKeys: Object.keys(store._userServiceOptions || {}) })
}

// ------------------------------------
// UI support
// ------------------------------------
const descriptions = computed(() => store.currentServiceOptions.descriptions || {})
const keys = computed(() => {
  const baseKeys = Object.keys(metadata.value)
  return baseKeys.filter((k) => {
    if (serviceKey.value === 'plex' && k === 'plex_token') return false
    if (serviceKey.value === 'riven_frontend' && k === 'origin') return false
    return true
  })
})

watch(keys, (ks) => d('render keys(single)', { serviceKey: serviceKey.value, keys: ks }), { immediate: true })

const edits = reactive({})
function onFieldChange(key, raw) {
  let val = raw
  if (typeof metadata.value[key] === 'boolean') val = Boolean(raw)
  else if (typeof metadata.value[key] === 'number') val = Number(raw)
  edits[key] = val
  d('onFieldChange(single)', { instKey: instKey.value, key, val, valueType: typeof metadata.value[key] })
  store.setUserServiceOptions(instKey.value, { [key]: val })
  d('_userServiceOptions.afterWrite(single)', { targetKey: instKey.value, optionsForKey: store._userServiceOptions[instKey.value], allKeys: Object.keys(store._userServiceOptions || {}) })
}

function linkify(text) {
  if (!text) return ''
  const urlRegex = /(https?:\/\/[^\s]+)/g
  return text.replace(urlRegex, url => `<a href="${url}" target="_blank" class="text-blue-400 underline">${url}</a>`)
}
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}
function fieldTitle(key, desc) {
  const clean = stripHtml(desc || key)
  if (key === 'core_service') return `${clean} ${coreServiceHelp}`.trim()
  return clean
}

// ------------------------------------
// Service-specific flags
// ------------------------------------
const isZurg = computed(() => serviceKey.value === 'zurg')
const useSponsored = ref()
const useNightly = ref()
const tokenInput = ref('')

const isPlex = computed(() => serviceKey.value === 'plex')
const plexToken = ref('')

const isCliDebrid = computed(() => serviceKey.value === 'cli_debrid')
const usePreRelease = ref()

const isRivenFrontend = computed(() => serviceKey.value === 'riven_frontend')
const rivenFrontendOrigin = ref('')

const isDecypharr = computed(() => serviceKey.value === 'decypharr')
const decypharrBetaEnabled = ref()
const decypharrMountSource = ref()
const decypharrMountType = ref()

const isRclone = computed(() => serviceKey.value === 'rclone')
const isRcloneDependency = computed(() => isRclone.value && parentKey.value && parentKey.value !== serviceKey.value)

const supportsCombinedCoreService = computed(() => ['sonarr', 'radarr', 'whisparr', 'lidarr', 'huntarr', 'profilarr'].includes(serviceKey.value))
const coreServiceOptions = computed(() => {
  const options = [
    { label: 'decypharr', value: 'decypharr' },
    { label: 'nzbdav', value: 'nzbdav' }
  ]
  if (supportsCombinedCoreService.value) {
    options.push({ label: 'decypharr, nzbdav', value: 'decypharr, nzbdav' })
  }
  options.push({ label: 'none', value: '' })
  return options
})
const coreServiceHelp = 'Choose which core service(s) this app should use for download/stream handling. Combined decypharr+nzbdav uses /mnt/debrid/combined_symlinks.'
const logLevelOptions = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
const isLogLevelKey = (key) => ['log_level', 'loglevel', 'log_verbosity', 'verbosity'].includes(key)
const guidedApplied = computed(() => store.guidedApplied)
const portKeys = ['port', 'frontend_port', 'backend_port']
const hasPortFields = computed(() => {
  const list = hasMultiInstances.value ? Object.keys(sharedDefaults.value || {}) : keys.value
  return list.some(k => portKeys.includes(k))
})
const logLevelChoicesFor = (value) => {
  const str = value == null ? '' : String(value)
  return logLevelOptions.includes(str) || !str ? logLevelOptions : [str, ...logLevelOptions]
}
const displayServiceName = computed(() => {
  const base = (serviceKey.value || parentName.value || 'service').split('::', 1)[0]
  return base
})
const displayInstanceName = computed(() => {
  const key = serviceKey.value || parentName.value || ''
  const parts = key.split('::', 2)
  return parts[1] || ''
})
const hasAnyOptions = computed(() => {
  if (hasMultiInstances.value) return Object.keys(sharedDefaults.value || {}).length > 0
  const baseKeys = keys.value || []
  return baseKeys.length > 0 || isZurg.value || isPlex.value || isCliDebrid.value || isRivenFrontend.value || (isDecypharr.value && ('use_embedded_rclone' in metadata.value || 'mount_type' in metadata.value || 'branch' in metadata.value))
})

// auto-skip handled by servicesMetaWithOptions in onboarding store

onMounted(() => {
  const projectKey = projectName.value.toLowerCase()
  tokenInput.value = store._Config[projectKey]?.github_token || ''
  plexToken.value = store._Config[projectKey]?.plex_token || ''
  d('mounted', { currentServiceKey: store.currentServiceKey, effectiveInstKey: instKey.value, userServiceOptionsKeys: Object.keys(store._userServiceOptions || {}), userServiceOptionsForInst: store._userServiceOptions[instKey.value], coreServices: store.coreServices })
})

const hasGithubToken = computed(() => {
  const projectKey = projectName.value.toLowerCase()
  return !!store._Config[projectKey]?.github_token
})

watch([useSponsored, hasGithubToken], ([yes, hasToken]) => {
  if (!isZurg.value) return
  if (yes && hasToken) {
    d('zurg sponsor -> set repo_name=zurg', { instKey: instKey.value })
    store.setUserServiceOptions(instKey.value, { repo_name: 'zurg' })
  } else if (!yes) {
    d('zurg sponsor off -> revert repo_name', { instKey: instKey.value })
    store.setUserServiceOptions(instKey.value, { repo_name: rawMetadata.value.defaults.repo_name })
    if (useNightly.value) {
      d('zurg nightly off due to sponsor off', { instKey: instKey.value })
      store.setUserServiceOptions(instKey.value, { release_version_enabled: false, release_version: rawMetadata.value.defaults.release_version || '' })
      useNightly.value = false
    }
  }
})

watch(useNightly, (yes) => {
  if (!isZurg.value) return
  if (yes) {
    d('nightly on', { instKey: instKey.value })
    store.setUserServiceOptions(instKey.value, { release_version_enabled: true, release_version: 'nightly' })
  } else {
    const def = rawMetadata.value.defaults.release_version || ''
    d('nightly off', { instKey: instKey.value, def })
    store.setUserServiceOptions(instKey.value, { release_version_enabled: false, release_version: def })
  }
})

async function saveZurgToken() {
  try {
    const projectKey = projectName.value.toLowerCase()
    await configService.updateConfig(null, { [projectKey]: { github_token: tokenInput.value } }, true)
    store._Config[projectKey].github_token = tokenInput.value
    useSponsored.value = true
  } catch (err) {
    console.error('Failed to save GitHub token', err)
  }
}

async function savePlexToken() {
  try {
    const projectKey = projectName.value.toLowerCase()
    await configService.updateConfig(null, { [projectKey]: { plex_token: plexToken.value } }, true)
    store._Config[projectKey].plex_token = plexToken.value
  } catch (err) {
    console.error('Failed to save Plex token', err)
  }
}

watch(usePreRelease, (yes) => {
  if (!isCliDebrid.value) return
  if (yes) {
    d('cli_debrid prerelease on', { instKey: instKey.value })
    store.setUserServiceOptions(instKey.value, { release_version_enabled: true, release_version: 'prerelease' })
  } else {
    const def = rawMetadata.value.defaults.release_version || ''
    d('cli_debrid prerelease off', { instKey: instKey.value, def })
    store.setUserServiceOptions(instKey.value, { release_version_enabled: false, release_version: def })
  }
})

watch(rivenFrontendOrigin, (val) => {
  if (!isRivenFrontend.value || !val) return
  d('riven_frontend origin change', { instKey: instKey.value, origin: val })
  store.setUserServiceOptions(instKey.value, { origin: val })
})

watch(instKey, () => {
  if (isZurg.value) {
    useSponsored.value = metadata.value.repo_name === 'zurg'
    useNightly.value = metadata.value.release_version === 'nightly'
  }
  if (isCliDebrid.value) {
    usePreRelease.value = metadata.value.release_version === 'prerelease'
  }
  d('instKey switched', { instKey: instKey.value, zurg: { useSponsored: useSponsored.value, useNightly: useNightly.value }, cli_debrid: { usePreRelease: usePreRelease.value } })
}, { immediate: true })

watch(instKey, () => {
  if (isDecypharr.value) {
    decypharrBetaEnabled.value = (String(metadata.value.branch || '').toLowerCase() === 'beta')
    const mountType = String(metadata.value.mount_type || '').toLowerCase()
    decypharrMountSource.value = mountType === 'external_rclone' ? 'dumb' : 'embedded'
    decypharrMountType.value = mountType || (decypharrBetaEnabled.value ? 'dfs' : 'rclone')
    if (!decypharrBetaEnabled.value && mountType === 'dfs') {
      decypharrMountType.value = 'rclone'
      store.setUserServiceOptions(instKey.value, { mount_type: 'rclone' })
    }
  }
}, { immediate: true })

watch(decypharrBetaEnabled, (enabled) => {
  if (!isDecypharr.value) return
  store.setUserServiceOptions(instKey.value, {
    branch_enabled: Boolean(enabled),
    branch: enabled ? 'beta' : (rawMetadata.value?.defaults?.branch || 'main')
  })
  if (!enabled) {
    const mountType = String(metadata.value.mount_type || '').toLowerCase()
    if (!mountType || mountType === 'dfs') {
      decypharrMountType.value = 'rclone'
      store.setUserServiceOptions(instKey.value, { mount_type: 'rclone' })
    }
  }
})

watch(decypharrMountSource, (mode) => {
  if (!isDecypharr.value) return
  store.setUserServiceOptions(instKey.value, {
    mount_type: mode === 'embedded' ? 'rclone' : 'external_rclone'
  })
})

watch(decypharrMountType, (mode) => {
  if (!isDecypharr.value || !mode) return
  store.setUserServiceOptions(instKey.value, {
    mount_type: mode
  })
})

function ensureRcloneCoreServiceTag(targetKey, defaults) {
  if (!isRcloneDependency.value) return
  if (!targetKey) return
  if (!('core_service' in (defaults || {}))) return
  const existing = store._userServiceOptions[targetKey]?.core_service
  if (existing !== undefined) return
  if (defaults.core_service === parentKey.value) return
  store.setUserServiceOptions(targetKey, { core_service: parentKey.value })
}

watch([instKey, sharedDefaults, instanceList], () => {
  if (!isRcloneDependency.value) return
  if (hasMultiInstances.value) {
    for (const inst of instanceList.value) {
      const targetKey = keyForInstance(inst.instance_name)
      ensureRcloneCoreServiceTag(targetKey, sharedDefaults.value)
    }
    return
  }
  ensureRcloneCoreServiceTag(instKey.value, sharedDefaults.value)
}, { immediate: true })

// create an example origin URL for riven_frontend and determine if port is needed based on current window address, e.g., http://localhost:3000 or https://example.com use metadata.value?.port for port if window.location.port is 3005
const protocol = window.location.protocol === 'https:' ? 'https' : 'http'
const rivenOriginExample = computed(() => {
  const host = window.location.hostname
  const currentPort = window.location.port
  const port =
    currentPort === '3005' ? metadata.value?.port || '3000' : currentPort

  const isStandardPort =
    (protocol === 'https' && port === '443') ||
    (protocol === 'http' && port === '80')

  return isStandardPort || !port
    ? `${protocol}://${host}`
    : `${protocol}://${host}:${port}`
})

const mountTypeOptions = [
  { value: 'dfs', label: 'dfs' },
  { value: 'rclone', label: 'rclone' },
  { value: 'external_rclone', label: 'external_rclone' },
  { value: 'none', label: 'none' }
]

</script>

<template>
    <section class="bg-gray-900 flex justify-center py-12 px-4">
      <div class="w-full max-w-3xl space-y-6 text-gray-100">
        <h2 class="text-2xl font-bold mb-4">
          Configure <strong>{{ displayServiceName }}</strong> Options
          <em v-if="displayInstanceName" class="text-sm text-gray-400">
            ({{ displayInstanceName }})
          </em>
          <em v-else-if="serviceKey && serviceKey !== parentKey" class="text-sm text-gray-400">
            (for {{ parentKey }})
          </em>
        </h2>

        <div v-if="guidedApplied" class="mb-4 rounded-md border border-indigo-500/40 bg-indigo-900/20 p-3 text-sm text-indigo-100">
          Guided setup applied recommended defaults. Review these settings and adjust anything that doesn't match your workflow.
        </div>

        <div v-if="supportsCombinedCoreService" class="mb-4 rounded-md border border-blue-500/40 bg-blue-900/20 p-3 text-sm text-blue-100">
          <strong>Core service routing:</strong> choose Decypharr, NzbDAV, or both. Combined selection routes
          Arr roots to <code class="text-blue-200">/mnt/debrid/combined_symlinks/&lt;slug&gt;</code>.
        </div>

        <div v-if="hasPortFields" class="mb-4 rounded-md border border-amber-500/40 bg-amber-900/20 p-3 text-sm text-amber-100">
          <strong>Ports:</strong> expose ports in your compose file if you want direct UI access. Port conflicts
          are auto-shifted only during onboarding or container startup.
        </div>

        <!-- Zurg-specific controls -->
        <template v-if="isZurg">
          <div class="mb-4 space-y-4">

            <!-- Header -->
            <dt class="text-gray-300 font-medium">Sponsored Zurg Access</dt>

            <!-- Description -->
            <dd class="text-gray-400">
              Enable access to the <strong>sponsored Zurg repository</strong>, which includes nightly and prerelease builds.
              A GitHub personal access token (PAT) with access to private repositories is required.
              <br />
              <a
                :href="`https://i-am-puid-0.github.io/${projectName}/services/dependent/zurg/#zurg-repositories`"
                target="_blank"
                class="text-blue-400 underline"
              >
                View Zurg repository documentation
              </a>
            </dd>

            <!-- Toggle -->
            <dd class="flex items-center space-x-2">
              <input type="checkbox" v-model="useSponsored" class="h-5 w-5" title="Enable sponsored Zurg repository access." />
              <span>Use Sponsored Zurg Repo</span>
            </dd>

            <!-- GitHub Token Input -->
            <div v-if="useSponsored && !store._Config.github_token" class="space-y-2">
              <input
                type="password"
                v-model="tokenInput"
                placeholder="Paste GitHub token"
                title="GitHub personal access token for the sponsored Zurg repo."
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded"
              />
              <button
                @click="saveZurgToken"
                class="px-4 py-1 bg-green-600 rounded hover:bg-green-500"
              >
                Save Token & Enable
              </button>
            </div>

            <!-- Nightly Toggle -->
            <dd v-if="useSponsored" class="flex items-center space-x-2 mt-4">
              <input type="checkbox" v-model="useNightly" class="h-5 w-5" title="Pull nightly builds from the sponsored repo." />
              <span>Pull Nightly Build</span>
            </dd>
          </div>
        </template>

        <!-- Plex-specific controls -->
        <template v-if="isPlex">
            <div class="mb-4 space-y-4">
                <dt class="text-gray-300 font-medium">Plex Token</dt>
                <dd class="text-gray-400">
                    Enter your Plex token to enable metadata fetching from Plex for Core Services.
                    <br />
                    <a href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
                        target="_blank" class="text-blue-400 underline">How to find your Plex token</a>
                </dd>
                <dd class="flex space-x-2">
                    <input type="text" v-model="plexToken" placeholder="Enter Plex token" title="Plex API token used for metadata lookups."
                        class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded" />
                    <button @click="savePlexToken" class="px-4 py-1 bg-green-600 rounded hover:bg-green-500">
                        Save Token
                    </button>
                </dd>
            </div>
        </template>

        <!-- CLI Debrid-specific controls -->
        <template v-if="isCliDebrid">
        <div class="mb-4">
            <label class="flex items-center space-x-2">
            <input type="checkbox" v-model="usePreRelease" class="h-5 w-5" title="Use prerelease builds for CLI Debrid." />
            <span>Use PreRelease Version?</span>
            </label>
        </div>
        </template>

        <!-- Riven Frontend-specific controls -->
        <template v-if="isRivenFrontend">
        <div class="mb-4 space-y-4">
            <dt class="text-gray-300 font-medium">Riven Frontend Origin</dt>
            <dd class="text-gray-400">
                Enter the origin URL for the Riven Frontend service. This is required to properly configure the frontend.
                <br />
                Example (based on your current browser): {{rivenOriginExample}}
                <br />
                <a
                :href="`https://i-am-puid-0.github.io/${projectName}/services/optional/riven-frontend/#origin-variable`"
                target="_blank"
                class="text-blue-400 underline"
                >
                Docs: Riven Frontend Origin
                </a>
            </dd>
            <dd class="flex space-x-2">
                <input type="text" v-model="rivenFrontendOrigin" placeholder="Enter Riven Frontend origin" title="Origin URL used by the Riven frontend to connect to the backend."
                    class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded" />
            </dd>
        </div>
        </template>

        <!-- Decypharr-specific controls -->
        <template v-if="isDecypharr">
          <div class="mb-4 space-y-3">
            <dt class="text-gray-300 font-medium">Decypharr: Beta Features</dt>
            <dd class="text-gray-400">
              Enable beta builds to use DFS mounts and native Usenet support.
            </dd>
            <label class="flex items-center gap-2">
              <input type="checkbox" v-model="decypharrBetaEnabled" title="Use Decypharr beta branch builds." />
              <span>Use Decypharr beta branch</span>
            </label>
          </div>

          <div v-if="decypharrBetaEnabled" class="mb-4 space-y-3">
            <dt class="text-gray-300 font-medium">Decypharr: Mount Type</dt>
            <dd class="text-gray-400">
              DFS is recommended for streaming. Rclone uses Decypharr's embedded rclone.
            </dd>
            <label class="flex items-center gap-2">
              <input type="radio" value="dfs" v-model="decypharrMountType" />
              <span>DFS (recommended)</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" value="rclone" v-model="decypharrMountType" />
              <span>Embedded Rclone</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" value="external_rclone" v-model="decypharrMountType" />
              <span>External Rclone (manual RC)</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" value="none" v-model="decypharrMountType" />
              <span>No mount</span>
            </label>
          </div>

          <div v-else-if="'use_embedded_rclone' in metadata" class="mb-4 space-y-3">
            <dt class="text-gray-300 font-medium">Decypharr: Rclone mount source</dt>
            <dd class="text-gray-400">
              Choose whether to use <strong>Decypharr's native rclone mounts</strong>
              or the <strong>DUMB-managed rclone mounts</strong>.
            </dd>
            <label class="flex items-center gap-2">
              <input type="radio" value="embedded" v-model="decypharrMountSource" title="Use Decypharr to manage rclone mounts internally." />
              <span>Use Decypharr's native rclone mounts</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" value="dumb" v-model="decypharrMountSource" title="Use DUMB-managed rclone mounts instead." />
              <span>Use DUMB rclone mounts</span>
            </label>
          </div>
        </template>

        <!-- MULTI-INSTANCE PATH: render one panel per instance when supported and multiple exist -->
        <template v-if="hasMultiInstances">
          <div class="space-y-6">
            <div v-for="inst in instanceList" :key="inst.instance_name" class="border border-gray-700 rounded-lg p-4 bg-gray-800">
              <h3 class="text-lg font-semibold mb-3">Instance: <code class="text-gray-300">{{ inst.instance_name }}</code></h3>
              <dl class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <template v-for="(val, key) in getInstMeta(inst.instance_name)" :key="inst.instance_name + ':' + key">
                  <dt class="text-gray-300 font-medium">
                    <span v-html="linkify(sharedDescriptions[key] || key)" :title="fieldTitle(key, sharedDescriptions[key])"></span>
                  </dt>
                  <dd>
                    <template v-if="key === 'core_service'">
                      <select :value="val || ''" @change="onFieldChangeFor(inst.instance_name, key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded">
                        <option v-for="option in coreServiceOptions" :key="option.value" :value="option.value">
                          {{ option.label }}
                        </option>
                      </select>
                    </template>
                    <template v-else-if="isLogLevelKey(key)">
                      <select :value="val || ''" @change="onFieldChangeFor(inst.instance_name, key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded">
                        <option v-for="level in logLevelChoicesFor(val)" :key="level" :value="level">
                          {{ level }}
                        </option>
                      </select>
                    </template>
                    <template v-else-if="key === 'mount_type'">
                      <select :value="val || ''" @change="onFieldChangeFor(inst.instance_name, key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded">
                        <option v-for="option in mountTypeOptions" :key="option.value || 'auto'" :value="option.value">
                          {{ option.label }}
                        </option>
                      </select>
                    </template>
                    <template v-else-if="typeof val === 'boolean'">
                      <input type="checkbox" :checked="val" @change="onFieldChangeFor(inst.instance_name, key, $event.target.checked)" class="h-5 w-5" />
                    </template>
                    <template v-else>
                      <input :type="typeof val === 'number' ? 'number' : 'text'" :value="val" @input="onFieldChangeFor(inst.instance_name, key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded" />
                    </template>
                  </dd>
                </template>
              </dl>
            </div>
          </div>
        </template>

        <!-- SINGLE-INSTANCE PATH: standard UI -->
        <template v-else>
          <dl class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <template v-for="key in keys" :key="key">
              <dt class="text-gray-300 font-medium">
                <span v-html="linkify(descriptions[key] || key)" :title="fieldTitle(key, descriptions[key])"></span>
              </dt>
              <dd>
                <template v-if="key === 'core_service'">
                  <select :value="key in edits ? edits[key] : (metadata[key] || '')" @change="onFieldChange(key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded">
                    <option v-for="option in coreServiceOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </template>
                <template v-else-if="isLogLevelKey(key)">
                  <select :value="key in edits ? edits[key] : (metadata[key] || '')" @change="onFieldChange(key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded">
                    <option v-for="level in logLevelChoicesFor(key in edits ? edits[key] : metadata[key])" :key="level" :value="level">
                      {{ level }}
                    </option>
                  </select>
                </template>
                <template v-else-if="key === 'mount_type'">
                  <select :value="key in edits ? edits[key] : (metadata[key] || '')" @change="onFieldChange(key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded">
                    <option v-for="option in mountTypeOptions" :key="option.value || 'auto'" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </template>
                <template v-else-if="typeof metadata[key] === 'boolean'">
                  <input type="checkbox" :checked="key in edits ? edits[key] : metadata[key]" @change="onFieldChange(key, $event.target.checked)" class="h-5 w-5" />
                </template>
                <template v-else>
                  <input :type="typeof metadata[key] === 'number' ? 'number' : 'text'" :value="key in edits ? edits[key] : metadata[key]" @input="onFieldChange(key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white rounded" />
                </template>
              </dd>
            </template>
        </dl>
        </template>
      </div>
    </section>
</template>
