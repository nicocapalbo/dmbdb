<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import useService from '~/services/useService.js'
import { useProcessesStore } from '~/stores/processes.js'

const store = useOnboardingStore()
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
const [parentKey, serviceKey = parentKey] = rawInstKey.value.split('.', 2)

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
    if (serviceKey === 'plex' && k === 'plex_token') return false
    if (serviceKey === 'riven_frontend' && k === 'origin') return false
    return true
  })
})

watch(keys, (ks) => d('render keys(single)', { serviceKey, keys: ks }), { immediate: true })

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

// ------------------------------------
// Service-specific flags
// ------------------------------------
const isZurg = computed(() => serviceKey === 'zurg')
const useSponsored = ref()
const useNightly = ref()
const tokenInput = ref('')

const isPlex = computed(() => serviceKey === 'plex')
const plexToken = ref('')

const isCliDebrid = computed(() => serviceKey === 'cli_debrid')
const usePreRelease = ref()

const isRivenFrontend = computed(() => serviceKey === 'riven_frontend')
const rivenFrontendOrigin = ref('')

const isDecypharr = computed(() => serviceKey === 'decypharr')
const decypharrMountSource = ref()

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
    decypharrMountSource.value =
      metadata.value.use_embedded_rclone ? 'embedded' : 'dumb'
  }
}, { immediate: true })

watch(decypharrMountSource, (mode) => {
  if (!isDecypharr.value) return
  store.setUserServiceOptions(instKey.value, {
    use_embedded_rclone: mode === 'embedded'
  })
})

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

</script>

<template>
    <section class="bg-gray-900 text-gray-100 p-6 rounded-lg">
        <h2 class="text-2xl font-bold mb-4">
            Configure <strong>{{ serviceKey }}</strong> Options
            <em v-if="serviceKey !== parentKey" class="text-sm text-gray-400">
                (for {{ parentKey }})
            </em>
        </h2>

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
                :href="`https://i-am-puid-0.github.io/${projectName}/services/zurg/#-zurg-repositories`"
                target="_blank"
                class="text-blue-400 underline"
              >
                View Zurg repository documentation
              </a>
            </dd>

            <!-- Toggle -->
            <dd class="flex items-center space-x-2">
              <input type="checkbox" v-model="useSponsored" class="h-5 w-5" />
              <span>Use Sponsored Zurg Repo</span>
            </dd>

            <!-- GitHub Token Input -->
            <div v-if="useSponsored && !store._Config.github_token" class="space-y-2">
              <input
                type="password"
                v-model="tokenInput"
                placeholder="Paste GitHub token"
                class="w-full px-3 py-2 bg-gray-800 text-white rounded"
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
              <input type="checkbox" v-model="useNightly" class="h-5 w-5" />
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
                    <input type="text" v-model="plexToken" placeholder="Enter Plex token"
                        class="w-full px-3 py-2 bg-gray-800 text-white rounded" />
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
            <input type="checkbox" v-model="usePreRelease" class="h-5 w-5" />
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
                :href="`https://i-am-puid-0.github.io/${projectName}/services/riven-frontend/#-origin-variable`"
                target="_blank"
                class="text-blue-400 underline"
                >
                Docs: Riven Frontend Origin
                </a>
            </dd>
            <dd class="flex space-x-2">
                <input type="text" v-model="rivenFrontendOrigin" placeholder="Enter Riven Frontend origin"
                    class="w-full px-3 py-2 bg-gray-800 text-white rounded" />
            </dd>
        </div>
        </template>

        <!-- Decypharr-specific controls -->
        <template v-if="isDecypharr && 'use_embedded_rclone' in metadata">
          <div class="mb-4 space-y-3">
            <dt class="text-gray-300 font-medium">Decypharr: Rclone mount source</dt>
            <dd class="text-gray-400">
              Choose whether to use <strong>Decypharr's native rclone mounts</strong>
              or the <strong>DUMB-managed rclone mounts</strong>.
            </dd>

            <label class="flex items-center gap-2">
              <input type="radio" value="embedded" v-model="decypharrMountSource" />
              <span>Use Decypharr's native rclone mounts</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" value="dumb" v-model="decypharrMountSource" />
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
                  <dt class="text-gray-300 font-medium"><span v-html="linkify(sharedDescriptions[key] || key)"></span></dt>
                  <dd>
                    <template v-if="typeof val === 'boolean'">
                      <input type="checkbox" :checked="val" @change="onFieldChangeFor(inst.instance_name, key, $event.target.checked)" class="h-5 w-5" />
                    </template>
                    <template v-else>
                      <input :type="typeof val === 'number' ? 'number' : 'text'" :value="val" @input="onFieldChangeFor(inst.instance_name, key, $event.target.value)" class="w-full px-3 py-2 bg-gray-900 text-white rounded" />
                    </template>
                  </dd>
                </template>
              </dl>
            </div>
          </div>
        </template>

        <!-- SINGLE-INSTANCE PATH: standard UI -->
        <template v-else>
          <div v-if="!keys.length && !isZurg && !isPlex && !isCliDebrid && !isRivenFrontend" class="text-center text-gray-400 py-12">
            No service options to configure for this step.
          </div>
          <dl v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <template v-for="key in keys" :key="key">
              <dt class="text-gray-300 font-medium">
                <span v-html="linkify(descriptions[key] || key)"></span>
              </dt>
              <dd>
                <template v-if="typeof metadata[key] === 'boolean'">
                  <input type="checkbox" :checked="key in edits ? edits[key] : metadata[key]" @change="onFieldChange(key, $event.target.checked)" class="h-5 w-5" />
                </template>
                <template v-else>
                  <input :type="typeof metadata[key] === 'number' ? 'number' : 'text'" :value="key in edits ? edits[key] : metadata[key]" @input="onFieldChange(key, $event.target.value)" class="w-full px-3 py-2 bg-gray-800 text-white rounded" />
                </template>
              </dd>
            </template>
        </dl>
        </template>
    </section>
</template>