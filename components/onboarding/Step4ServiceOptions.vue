<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import useService from '~/services/useService.js'
import { useProcessesStore } from '~/stores/processes.js'

const store = useOnboardingStore()
const { configService } = useService()
const processesStore = useProcessesStore()
const projectName = computed(() => processesStore.projectName)


// Determine current instance
const instKey = computed(() => store.currentServiceKey || '')
const [parentKey, serviceKey = parentKey] = instKey.value.split('.', 2)

// Reactive instance metadata
const metadata = computed(() => {
  const defaults = store.currentServiceOptions.options || {}
  const edits = store._userServiceOptions[instKey.value] || {}
  const filteredEdits = Object.fromEntries(
    Object.entries(edits).filter(([key]) => key in defaults)
  )

  return { ...defaults, ...filteredEdits }
})

// Raw metadata for the current service instance
const rawMetadata = computed(() => {
  const defaults = store.currentServiceOptions.options || {}
  const allEdits = store._userServiceOptions[instKey.value] || {}

  const edits = Object.fromEntries(
    Object.entries(allEdits).filter(([key]) => key in defaults)
  )

  return { defaults, edits }
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


const descriptions = computed(() => store.currentServiceOptions.descriptions || {})
// Filter out plex_token and origin from service options display
const keys = computed(() => {
  const baseKeys = Object.keys(metadata.value)

  return baseKeys.filter((k) => {
    if (serviceKey === 'plex' && k === 'plex_token') return false
    if (serviceKey === 'riven_frontend' && k === 'origin') return false
    return true
  })
})

// Reactive edit buffer for default fields
const edits = reactive({})
function onFieldChange(key, raw) {
    let val = raw
    if (typeof metadata.value[key] === 'boolean') val = Boolean(raw)
    else if (typeof metadata.value[key] === 'number') val = Number(raw)
    edits[key] = val
    store.setUserServiceOptions(instKey.value, { [key]: val })
}

function linkify(text) {
    if (!text) return ''
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return text.replace(urlRegex, url =>
        `<a href="${url}" target="_blank" class="text-blue-400 underline">${url}</a>`
    )
}

// Zurg-specific logic
const isZurg = computed(() => serviceKey === 'zurg')
const useSponsored = ref()
const useNightly = ref()
const tokenInput = ref('')

// Plex-specific logic
const isPlex = computed(() => serviceKey === 'plex')
const plexToken = ref('')

// cli_debrid specific logic
const isCliDebrid = computed(() => serviceKey === 'cli_debrid')
const usePreRelease = ref()

// riven_frontend specific logic
const isRivenFrontend = computed(() => serviceKey === 'riven_frontend')
const rivenFrontendOrigin = ref('')

onMounted(() => {
    const projectKey = projectName.value.toLowerCase()

    // Prefill GitHub token for Zurg
    tokenInput.value = store._Config[projectKey].github_token || ''
    // Prefill Plex token
    plexToken.value = store._Config[projectKey].plex_token || ''
})

// Handle GitHub token presence
const hasGithubToken = computed(() => {
  const projectKey = projectName.value.toLowerCase()
  return !!store._Config[projectKey]?.github_token
})

// Handle Zurg sponsor toggle
watch([useSponsored, hasGithubToken], ([yes, hasToken]) => {
  if (!isZurg.value) return

  if (yes && hasToken) {
    store.setUserServiceOptions(instKey.value, { repo_name: 'zurg' })
    console.log('Zurg sponsor enabled with token, using zurg repo')
  } else if (!yes) {
    // Revert repo_name
    store.setUserServiceOptions(instKey.value, {
      repo_name: rawMetadata.value.defaults.repo_name,
    })
    console.log('Zurg sponsor disabled, using default repo:', rawMetadata.value.defaults.repo_name)

    // Revert nightly if it's still enabled
    if (useNightly.value) {
      store.setUserServiceOptions(instKey.value, {
        release_version_enabled: false,
        release_version: rawMetadata.value.defaults.release_version || '',
      })
      // Also uncheck the box to sync UI
      useNightly.value = false

      console.log(
        'Zurg sponsor disabled while nightly was active — reverting nightly settings to default:',
        rawMetadata.value.defaults.release_version || ''
      )
    }
  }
})


// Handle Zurg nightly toggle
watch(useNightly, (yes) => {
  if (!isZurg.value) return

  if (yes) {
    store.setUserServiceOptions(instKey.value, {
      release_version_enabled: true,
      release_version: 'nightly',
    })
    console.log('Nightly enabled: using nightly release')
  } else {
    const defaultRelease = rawMetadata.value.defaults.release_version || ''
    store.setUserServiceOptions(instKey.value, {
      release_version_enabled: false,
      release_version: defaultRelease,
    })
    console.log('Nightly disabled: using default release:', defaultRelease)
  }
})

// Save GitHub token for Zurg
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

// Handle Plex token submission only to config, not service options
async function savePlexToken() {
    try {
        const projectKey = projectName.value.toLowerCase()
        await configService.updateConfig(null, { [projectKey]: { plex_token: plexToken.value } }, true)
        store._Config[projectKey].plex_token = plexToken.value
    } catch (err) {
        console.error('Failed to save Plex token', err)
    }
}

// Handle cli_debrid pre-release toggle
watch(usePreRelease, (yes) => {
  if (!isCliDebrid.value) return

  if (yes) {
    store.setUserServiceOptions(instKey.value, {
      release_version_enabled: true,
      release_version: 'prerelease',
    })
    console.log('PreRelease enabled for cli_debrid')
  } else {
    const defaultVersion = rawMetadata.value.defaults.release_version || ''
    store.setUserServiceOptions(instKey.value, {
      release_version_enabled: false,
      release_version: defaultVersion,
    })
    console.log('PreRelease disabled for cli_debrid, reverted to default:', defaultVersion)
  }
})

// Watch for changes in rivenFrontendOrigin to update the store
watch(rivenFrontendOrigin, (val) => {
  if (!isRivenFrontend.value || !val) return
  store.setUserServiceOptions(instKey.value, { origin: val })
})


// Watch for changes in instKey to update Zurg and cli_debrid specific options
watch(instKey, () => {
  if (isZurg.value) {
    useSponsored.value = metadata.value.repo_name === 'zurg'
    useNightly.value = metadata.value.release_version === 'nightly'
  }

  if (isCliDebrid.value) {
    usePreRelease.value = metadata.value.release_version === 'prerelease'
  }
}, { immediate: true })


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

        <!-- Default metadata fields -->
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
                        <input type="checkbox" :checked="key in edits ? edits[key] : metadata[key]"
                            @change="onFieldChange(key, $event.target.checked)" class="h-5 w-5" />
                    </template>
                    <template v-else>
                        <input :type="typeof metadata[key] === 'number' ? 'number' : 'text'"
                            :value="key in edits ? edits[key] : metadata[key]"
                            @input="onFieldChange(key, $event.target.value)"
                            class="w-full px-3 py-2 bg-gray-800 text-white rounded" />
                    </template>
                </dd>
            </template>
        </dl>
    </section>
</template>