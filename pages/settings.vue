<script setup>
import { useProcessesStore } from "~/stores/processes.js";
import { useAuthStore } from "~/stores/auth.js";
import { useOnboardingStore } from "~/stores/onboarding.js";
import useService from '~/services/useService.js'
import { useRouter } from 'vue-router'
import { useUiStore } from '~/stores/ui.js'
import { formatTimestamp } from '~/helper/formatTimestamp.js'
const router = useRouter()
const processesStore = useProcessesStore()
const authStore = useAuthStore()
const onboardingStore = useOnboardingStore()
import axios from "axios";
const { configService } = useService()
const uiStore = useUiStore()
const uiEmbedEnabled = ref(false)
const uiEmbedSupported = ref(false)
const uiEmbedLoading = ref(false)
const uiEmbedError = ref('')
const uiEmbedServices = ref([])
const goToOnboarding = async () => {
  try {
    await configService.resetOnboarding()
    onboardingStore.$reset()
    router.push('/onboarding')
  } catch (e) {
    console.error('Failed to reset onboarding:', e)
  }
}
const services = computed(() => processesStore.enabledProcesses)
const projectName = computed(() => processesStore.projectName)
const sponsorUrl = (svc) => {
  const v = (svc && svc.sponsorship_url ? svc.sponsorship_url : '').trim()
  return v.length ? v : null
}
const Discord = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://discord.gg/T6uZGy5XYb'
    : 'https://discord.gg/8dqKUBtbp5'
)

const githubRepo = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://github.com/I-am-PUID-0/DUMB'
    : 'https://github.com/I-am-PUID-0/DMB'
)

const DocsUrl = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://dumbarr.com'
    : 'https://i-am-puid-0.github.io/DMB'
)

const dockerHubUrl = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://hub.docker.com/r/iampuid0/dumb'
    : 'https://hub.docker.com/r/iampuid0/dmb'
)

const contributorsList = ref(null)
const logTimestampDraft = reactive({
  dateOrder: 'MDY',
  hourFormat: '12',
  zeroPad: false,
})
const logTimestampSaving = ref(false)
const logTimestampSaved = ref(false)
const logTimestampError = ref('')
let logTimestampSavedTimer = null

const tokenDraft = reactive({
  plex_token: '',
  github_token: '',
  github_username: '',
})
const tokenLoading = ref(false)
const tokenSaving = ref(false)
const tokenSaved = ref(false)
const tokenError = ref('')
let tokenSavedTimer = null
const showPlexToken = ref(false)
const showGithubToken = ref(false)

const logTimestampPreview = computed(() => formatTimestamp(new Date(), logTimestampDraft))

const geekModeEnabled = ref(false)
const geekModeLoading = ref(false)
const geekModeError = ref('')

const loadGeekMode = async () => {
  const prefs = await uiStore.getSidebarPreferences()
  geekModeEnabled.value = !!prefs.geek_mode
}

const toggleGeekMode = async (event) => {
  const nextValue = !!event?.target?.checked
  geekModeLoading.value = true
  geekModeError.value = ''
  try {
    await uiStore.saveSidebarPreferences({ ...uiStore.sidebarPreferences, geek_mode: nextValue })
    geekModeEnabled.value = nextValue
  } catch (e) {
    geekModeError.value = 'Failed to update setting.'
    geekModeEnabled.value = !nextValue
  } finally {
    geekModeLoading.value = false
  }
}

const loadLogTimestampFormat = async () => {
  await uiStore.loadLogTimestampFormat()
  Object.assign(logTimestampDraft, uiStore.logTimestampFormat)
}

const resetLogTimestampDraft = () => {
  Object.assign(logTimestampDraft, uiStore.logTimestampFormat)
  logTimestampError.value = ''
}

const saveLogTimestampFormat = async () => {
  logTimestampSaving.value = true
  logTimestampError.value = ''
  try {
    await uiStore.saveLogTimestampFormat(logTimestampDraft)
    logTimestampSaved.value = true
    if (logTimestampSavedTimer) clearTimeout(logTimestampSavedTimer)
    logTimestampSavedTimer = setTimeout(() => {
      logTimestampSaved.value = false
    }, 2500)
  } catch (e) {
    logTimestampError.value = 'Failed to save log timestamp format.'
  } finally {
    logTimestampSaving.value = false
  }
}

const loadTokens = async () => {
  tokenLoading.value = true
  tokenError.value = ''
  try {
    const config = await configService.getConfig()
    const projectKey = projectName.value.toLowerCase()
    const projectConfig = config?.[projectKey] || {}
    tokenDraft.plex_token = projectConfig.plex_token || ''
    tokenDraft.github_token = projectConfig.github_token || ''
    tokenDraft.github_username = projectConfig.github_username || ''
  } catch (e) {
    tokenError.value = 'Failed to load token settings.'
  } finally {
    tokenLoading.value = false
  }
}

const saveTokens = async () => {
  tokenSaving.value = true
  tokenError.value = ''
  try {
    const projectKey = projectName.value.toLowerCase()
    await configService.updateConfig(
      null,
      {
        [projectKey]: {
          plex_token: tokenDraft.plex_token,
          github_token: tokenDraft.github_token,
          github_username: tokenDraft.github_username,
        },
      },
      true
    )
    tokenSaved.value = true
    if (tokenSavedTimer) clearTimeout(tokenSavedTimer)
    tokenSavedTimer = setTimeout(() => {
      tokenSaved.value = false
    }, 2500)
  } catch (e) {
    tokenError.value = 'Failed to save token settings.'
  } finally {
    tokenSaving.value = false
  }
}

const getContributors = async () => {
  try {
    const repoUrl = githubRepo.value.replace('https://github.com/', '')
    const [repo1, repo2] = await Promise.all([
      axios.get(`https://api.github.com/repos/${repoUrl}/contributors`),
      axios.get('https://api.github.com/repos/nicocapalbo/dmbdb/contributors'),
    ])
    const merged = [...repo1.data, ...repo2.data]
    contributorsList.value = Array.from(
      new Map(merged.map(c => [c.id, c])).values()
    ).filter(c => c.id !== 41898282)
  } catch (e) {
    throw new Error(e)
  }
}

const goToContributor = (url) => window.open(url, '_blank')

const loadServiceUiStatus = async () => {
  uiEmbedLoading.value = true
  uiEmbedError.value = ''
  try {
    const data = await configService.getServiceUiStatus()
    uiEmbedSupported.value = true
    uiEmbedEnabled.value = !!data?.enabled
    uiEmbedServices.value = Array.isArray(data?.services) ? data.services : []
  } catch (e) {
    uiEmbedSupported.value = false
    uiEmbedEnabled.value = false
    uiEmbedServices.value = []
    uiEmbedError.value = 'Embedded UI support is not available on this backend.'
  } finally {
    uiEmbedLoading.value = false
  }
}

const toggleServiceUi = async (event) => {
  if (!uiEmbedSupported.value) return
  const nextValue = !!event?.target?.checked
  uiEmbedLoading.value = true
  uiEmbedError.value = ''
  try {
    const data = await configService.setServiceUiEnabled(nextValue)
    uiEmbedEnabled.value = !!data?.enabled
    uiEmbedServices.value = Array.isArray(data?.services) ? data.services : []
  } catch (e) {
    uiEmbedError.value = 'Failed to update embedded UI settings.'
    uiEmbedEnabled.value = !nextValue
  } finally {
    uiEmbedLoading.value = false
  }
}

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}

// Auth toggle state
const showDisableAuthWarning = ref(false)
const disableAuthLoading = ref(false)

// User management state
const usersList = ref([])
const usersLoading = ref(false)
const usersError = ref('')
const showAddUserModal = ref(false)
const newUserForm = reactive({
  username: '',
  password: '',
  confirmPassword: ''
})
const newUserError = ref('')
const newUserLoading = ref(false)
const userActionLoading = ref({})
const showDeleteConfirm = ref(null)
const showNewUserPassword = ref(false)
const showNewUserConfirmPassword = ref(false)

const { authRepository } = useService()
const authService = authRepository()

const loadUsers = async () => {
  usersLoading.value = true
  usersError.value = ''
  try {
    const data = await authService.listUsers()
    usersList.value = data.users || []
  } catch (e) {
    usersError.value = 'Failed to load users.'
  } finally {
    usersLoading.value = false
  }
}

const openAddUserModal = () => {
  newUserForm.username = ''
  newUserForm.password = ''
  newUserForm.confirmPassword = ''
  newUserError.value = ''
  showNewUserPassword.value = false
  showNewUserConfirmPassword.value = false
  showAddUserModal.value = true
}

const closeAddUserModal = () => {
  showNewUserPassword.value = false
  showNewUserConfirmPassword.value = false
  showAddUserModal.value = false
}

const validateNewUser = () => {
  if (!newUserForm.username || newUserForm.username.length < 3) {
    newUserError.value = 'Username must be at least 3 characters long.'
    return false
  }
  if (!newUserForm.password || newUserForm.password.length < 8) {
    newUserError.value = 'Password must be at least 8 characters long.'
    return false
  }
  if (newUserForm.password.length > 72) {
    newUserError.value = 'Password cannot be longer than 72 characters.'
    return false
  }
  if (newUserForm.password !== newUserForm.confirmPassword) {
    newUserError.value = 'Passwords do not match.'
    return false
  }
  return true
}

const handleAddUser = async () => {
  newUserError.value = ''
  if (!validateNewUser()) return

  newUserLoading.value = true
  try {
    const wasFirstUser = !authStore.hasUsers
    await authService.createUser(newUserForm.username, newUserForm.password)
    await loadUsers()
    // Refresh auth status to update hasUsers flag
    await authStore.checkAuthStatus()
    closeAddUserModal()

    // If this was the first user, auth is now enabled - reload page to trigger login redirect
    if (wasFirstUser) {
      window.location.reload()
    }
  } catch (e) {
    newUserError.value = e.response?.data?.detail || 'Failed to create user.'
  } finally {
    newUserLoading.value = false
  }
}

const toggleUserStatus = async (username, currentDisabled) => {
  userActionLoading.value[username] = true
  try {
    await authService.updateUser(username, !currentDisabled)
    await loadUsers()
  } catch (e) {
    // Show specific error message from backend (e.g., last user protection)
    usersError.value = e.response?.data?.detail || `Failed to update user ${username}.`
  } finally {
    delete userActionLoading.value[username]
  }
}

const confirmDeleteUser = (username) => {
  showDeleteConfirm.value = username
}

const cancelDelete = () => {
  showDeleteConfirm.value = null
}

const handleDeleteUser = async (username) => {
  userActionLoading.value[username] = true
  try {
    await authService.deleteUser(username)
    await loadUsers()
    showDeleteConfirm.value = null
  } catch (e) {
    usersError.value = e.response?.data?.detail || `Failed to delete user ${username}.`
  } finally {
    delete userActionLoading.value[username]
  }
}

// Auth toggle functions
const handleEnableAuth = async () => {
  // If no users exist, show the add user modal to create first user
  if (!authStore.hasUsers) {
    showAddUserModal.value = true
    return
  }

  // Users exist, just enable auth
  try {
    const success = await authStore.enableAuth()
    if (success) {
      // Reload to show updated state
      await authStore.checkAuthStatus()
    } else {
      alert('Failed to enable authentication. Please try again.')
    }
  } catch (e) {
    console.error('Failed to enable auth:', e)
    alert('An error occurred while enabling authentication.')
  }
}

const handleDisableAuth = async () => {
  disableAuthLoading.value = true
  try {
    const success = await authStore.disableAuth()
    if (success) {
      showDisableAuthWarning.value = false
      // Redirect to home since we're logged out
      router.push('/')
    } else {
      alert('Failed to disable authentication. Please try again.')
    }
  } catch (e) {
    console.error('Failed to disable auth:', e)
    alert('An error occurred while disabling authentication.')
  } finally {
    disableAuthLoading.value = false
  }
}

getContributors()
onMounted(() => {
  loadServiceUiStatus()
  loadLogTimestampFormat()
  loadTokens()
  loadGeekMode()
  if (authStore.hasUsers) {
    loadUsers()
  }
})
</script>

<template>
  <div class="relative min-h-full text-white bg-gray-900 flex flex-col gap-10 px-4 py-4 md:px-8 pb-16">
    <InfoBar />

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">About</p>
      </div>

      <div class="px-2 flex flex-col gap-4">
        <div v-for="(service, index) in services" :key="index" class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
          <p class="font-semibold sm:min-w-48">{{ service.process_name }}</p>
          <a :href="service?.repo_url" target="_blank"
            class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
            <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
            <span>v{{ service?.version?.trim().replace(/^v/i, '') }}</span>
          </a>
          <a
            v-if="sponsorUrl(service)"
            :href="sponsorUrl(service)"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-pink-500/10 text-xs font-medium px-2 py-1 text-pink-300 border border-pink-500/30 hover:bg-pink-500/20 hover:text-pink-200 transition"
            aria-label="Sponsor this project"
            title="Sponsor this project"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                class="h-3.5 w-3.5 fill-current" aria-hidden="true">
              <path d="M12 21s-6.716-4.324-9.193-7.04C1.02 11.972 1 9.558 2.64 7.918a5.01 5.01 0 0 1 7.09 0L12 10.187l2.27-2.27a5.01 5.01 0 0 1 7.09 0c1.64 1.64 1.62 4.054-.167 6.042C18.716 16.676 12 21 12 21z"/>
            </svg>
            <span>Sponsor</span>
          </a>
        </div>
      </div>
    </div>

    <div class="mt-10 px-2">
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-medium"
        @click="goToOnboarding"
      >
        Launch Onboarding
      </button>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Embedded UIs</p>
      </div>
      <div class="px-2 flex flex-col gap-3">
        <label class="flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            class="accent-emerald-400 h-4 w-4"
            :checked="uiEmbedEnabled"
            :disabled="uiEmbedLoading || !uiEmbedSupported"
            @change="toggleServiceUi"
          />
          <span>Enable embedded service iFrames</span>
        </label>
        <p v-if="uiEmbedLoading" class="text-xs text-slate-400">Updating embedded UI settings...</p>
        <p v-else-if="uiEmbedError" class="text-xs text-amber-300">{{ uiEmbedError }}</p>
        <p v-else-if="uiEmbedSupported" class="text-xs text-slate-400">
          Detected UI services: {{ uiEmbedServices.length }}
        </p>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Tokens</p>
      </div>
      <div class="px-2 flex flex-col gap-4">
        <label class="text-sm text-slate-200 flex flex-col gap-2">
          <span class="flex items-center gap-2">
            <span>Plex Token</span>
            <span
              class="material-symbols-rounded !text-[16px] text-slate-400"
              title="This token is used when installing Plex Media Server, and by Riven backend for interacting with your Plex account."
            >info</span>
          </span>
          <a
            href="https://dumbarr.com/features/configuration/?h=token#plex-integration"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-blue-400 underline w-fit"
          >
            Docs: Plex integration
          </a>
          <div class="flex items-center gap-2">
            <input
              v-model="tokenDraft.plex_token"
              :type="showPlexToken ? 'text' : 'password'"
              class="flex-1 text-sm bg-slate-900 text-slate-200 rounded px-3 py-2 border border-slate-600 focus:border-blue-500 outline-none"
              placeholder="Enter Plex token"
            />
            <button
              type="button"
              class="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
              :aria-label="showPlexToken ? 'Hide Plex token' : 'Show Plex token'"
              @click="showPlexToken = !showPlexToken"
            >
              <span class="material-symbols-rounded !text-[18px]">
                {{ showPlexToken ? 'visibility_off' : 'visibility' }}
              </span>
            </button>
          </div>
        </label>
        <label class="text-sm text-slate-200 flex flex-col gap-2">
          <span class="flex items-center gap-2">
            <span>GitHub Token</span>
            <span
              class="material-symbols-rounded !text-[16px] text-slate-400"
              title="Used to increase GitHub API rate limits and unlock access to private/sponsored repositories such as zurg when associated with your GitHub account."
            >info</span>
          </span>
          <a
            href="https://dumbarr.com/features/configuration/?h=token#github-integration"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-blue-400 underline w-fit"
          >
            Docs: GitHub integration
          </a>
          <div class="flex items-center gap-2">
            <input
              v-model="tokenDraft.github_token"
              :type="showGithubToken ? 'text' : 'password'"
              class="flex-1 text-sm bg-slate-900 text-slate-200 rounded px-3 py-2 border border-slate-600 focus:border-blue-500 outline-none"
              placeholder="Enter GitHub token"
            />
            <button
              type="button"
              class="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
              :aria-label="showGithubToken ? 'Hide GitHub token' : 'Show GitHub token'"
              @click="showGithubToken = !showGithubToken"
            >
              <span class="material-symbols-rounded !text-[18px]">
                {{ showGithubToken ? 'visibility_off' : 'visibility' }}
              </span>
            </button>
          </div>
        </label>
        <label class="text-sm text-slate-200 flex flex-col gap-2">
          <span class="flex items-center gap-2">
            <span>GitHub Username</span>
            <span
              class="material-symbols-rounded !text-[16px] text-slate-400"
              title="Reserved for future use. Will support additional GitHub-sourced services and contributor personalization."
            >info</span>
          </span>
          <input
            v-model="tokenDraft.github_username"
            type="text"
            class="text-sm bg-slate-900 text-slate-200 rounded px-3 py-2 border border-slate-600 focus:border-blue-500 outline-none"
            placeholder="Enter GitHub username"
          />
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-medium disabled:opacity-60"
            :disabled="tokenSaving || tokenLoading"
            @click="saveTokens"
          >
            Save
          </button>
          <span v-if="tokenLoading" class="text-xs text-slate-400">Loading...</span>
          <span v-else-if="tokenSaving" class="text-xs text-slate-400">Saving...</span>
          <span v-else-if="tokenSaved" class="text-xs text-emerald-300">Saved</span>
          <span v-else-if="tokenError" class="text-xs text-amber-300">{{ tokenError }}</span>
        </div>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Log Timestamp Format</p>
      </div>
      <div class="px-2 flex flex-col gap-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
          <label class="text-sm text-slate-200 flex flex-col gap-1">
            <span>Date order</span>
            <select
              v-model="logTimestampDraft.dateOrder"
              class="h-[34px] text-sm bg-slate-900 text-slate-200 rounded px-2 py-1 border border-slate-600 focus:border-blue-500 outline-none"
            >
              <option value="MDY">Month / Day / Year</option>
              <option value="DMY">Day / Month / Year</option>
            </select>
          </label>
          <label class="text-sm text-slate-200 flex flex-col gap-1">
            <span>Time format</span>
            <select
              v-model="logTimestampDraft.hourFormat"
              class="h-[34px] text-sm bg-slate-900 text-slate-200 rounded px-2 py-1 border border-slate-600 focus:border-blue-500 outline-none"
            >
              <option value="12">12-hour</option>
              <option value="24">24-hour</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              class="accent-emerald-400 h-4 w-4"
              v-model="logTimestampDraft.zeroPad"
            />
            <span>Zero-pad day/time</span>
          </label>
        </div>
        <div class="text-xs text-slate-400">Preview: {{ logTimestampPreview }}</div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-medium disabled:opacity-60"
            :disabled="logTimestampSaving"
            @click="saveLogTimestampFormat"
          >
            Save
          </button>
          <button
            class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-white font-medium disabled:opacity-60"
            :disabled="logTimestampSaving"
            @click="resetLogTimestampDraft"
          >
            Reset
          </button>
          <span v-if="logTimestampSaving" class="text-xs text-slate-400">Saving...</span>
          <span v-else-if="logTimestampSaved" class="text-xs text-emerald-300">Saved</span>
          <span v-else-if="logTimestampError" class="text-xs text-amber-300">{{ logTimestampError }}</span>
        </div>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Advanced</p>
      </div>
      <div class="px-2 flex flex-col gap-3">
        <label class="flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            class="accent-emerald-400 h-4 w-4"
            :checked="geekModeEnabled"
            :disabled="geekModeLoading"
            @change="toggleGeekMode"
          />
          <span>Enable Geek Mode</span>
        </label>
        <p class="text-xs text-slate-400">
          Reveals power-user information across the UI: process metrics panel with CPU, memory, disk I/O, and port details on each service page; resource badges on dashboard cards; dependency graph JSON export and API latency badges.
          <a
            href="https://dumbarr.com/frontend/settings/#geek-mode"
            target="_blank"
            rel="noopener"
            class="text-sky-400 hover:text-sky-300 underline"
          >Learn more</a>
        </p>
        <p v-if="geekModeLoading" class="text-xs text-slate-400">Updating...</p>
        <p v-else-if="geekModeError" class="text-xs text-amber-300">{{ geekModeError }}</p>
      </div>
    </div>

    <!-- Authentication Section -->
    <div v-if="authStore.authSupported">
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Authentication</p>
      </div>
      <div class="px-2 flex flex-col gap-6">
        <!-- Authentication Toggle -->
        <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <h3 class="text-lg font-semibold mb-2 flex items-center gap-2">
                <span class="material-symbols-rounded !text-[20px]">{{ authStore.isAuthEnabled ? 'lock' : 'lock_open' }}</span>
                <span>Authentication</span>
              </h3>
              <p class="text-sm text-slate-400 mb-4">
                {{ authStore.isAuthEnabled
                  ? 'Authentication is enabled. API access requires a valid token.'
                  : 'Authentication is disabled. API access is unrestricted.'
                }}
              </p>
              <div v-if="!authStore.isAuthEnabled && !authStore.hasUsers" class="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 mb-4">
                <div class="flex items-start gap-3">
                  <span class="material-symbols-rounded text-blue-400 text-xl">info</span>
                  <div class="text-sm text-blue-200 flex-1">
                    <p class="font-semibold mb-1">No users configured</p>
                    <p class="text-blue-300 mb-3">
                      Create your first user account to enable authentication and secure your dashboard.
                    </p>
                    <button
                      @click="openAddUserModal"
                      class="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-medium transition-colors"
                    >
                      <span class="material-symbols-rounded !text-[18px]">person_add</span>
                      <span>Create First User</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="ml-4">
              <button
                v-if="authStore.isAuthEnabled"
                @click="showDisableAuthWarning = true"
                class="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded text-white font-medium transition-colors"
              >
                <span class="material-symbols-rounded !text-[18px]">lock_open</span>
                <span>Disable Auth</span>
              </button>
              <button
                v-else
                @click="handleEnableAuth"
                :disabled="!authStore.hasUsers"
                :title="!authStore.hasUsers ? 'Create a user account first' : 'Enable authentication'"
                class="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="material-symbols-rounded !text-[18px]">lock</span>
                <span>Enable Auth</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Logged in user info -->
        <div v-if="authStore.isAuthEnabled" class="flex flex-col items-start gap-3">
          <div class="flex items-center gap-2 text-sm text-slate-300">
            <span class="material-symbols-rounded !text-[18px] text-emerald-400">check_circle</span>
            <span>Logged in as <strong class="text-white">{{ authStore.user?.username }}</strong></span>
          </div>
          <button
            @click="handleLogout"
            class="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-white font-medium transition-colors"
          >
            <span class="material-symbols-rounded !text-[18px]">logout</span>
            <span>Logout</span>
          </button>
        </div>

        <!-- User Management -->
        <div v-if="authStore.hasUsers" class="mt-4">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-xl font-semibold">User Management</h3>
            <button
              v-if="authStore.isAuthEnabled"
              @click="openAddUserModal"
              class="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-medium transition-colors"
            >
              <span class="material-symbols-rounded !text-[18px]">add</span>
              <span>Add User</span>
            </button>
          </div>

          <p v-if="usersLoading" class="text-sm text-slate-400 mb-4">Loading users...</p>
          <div v-if="usersError" class="bg-red-900/30 border border-red-700/50 rounded-lg p-4 mb-4">
            <div class="flex items-start gap-3">
              <span class="material-symbols-rounded text-red-400 text-xl">error</span>
              <p class="text-sm text-red-200">{{ usersError }}</p>
            </div>
          </div>
          <div v-if="!usersLoading" class="bg-slate-800 rounded-lg overflow-hidden">
            <table class="w-full">
              <thead class="bg-slate-700">
                <tr>
                  <th class="px-4 py-3 text-left text-sm font-semibold">Username</th>
                  <th class="px-4 py-3 text-left text-sm font-semibold">Status</th>
                  <th class="px-4 py-3 text-right text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-700">
                <tr v-for="user in usersList" :key="user.username" class="hover:bg-slate-750">
                  <td class="px-4 py-3 text-sm">{{ user.username }}</td>
                  <td class="px-4 py-3 text-sm">
                    <span
                      :class="user.disabled ? 'text-red-400 bg-red-900/20 border-red-700/50' : 'text-emerald-400 bg-emerald-900/20 border-emerald-700/50'"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border"
                    >
                      <span class="material-symbols-rounded !text-[14px]">
                        {{ user.disabled ? 'block' : 'check_circle' }}
                      </span>
                      <span>{{ user.disabled ? 'Disabled' : 'Active' }}</span>
                    </span>
                  </td>
                  <td class="px-4 py-3 text-sm text-right">
                    <div class="flex items-center justify-end gap-2">
                      <button
                        @click="toggleUserStatus(user.username, user.disabled)"
                        :disabled="!!userActionLoading[user.username]"
                        class="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        <span class="material-symbols-rounded !text-[14px]">
                          {{ user.disabled ? 'check' : 'block' }}
                        </span>
                        <span>{{ user.disabled ? 'Enable' : 'Disable' }}</span>
                      </button>
                      <button
                        v-if="showDeleteConfirm === user.username"
                        @click="handleDeleteUser(user.username)"
                        :disabled="!!userActionLoading[user.username] || user.username === authStore.user?.username"
                        class="flex items-center gap-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        <span class="material-symbols-rounded !text-[14px]">check</span>
                        <span>Confirm</span>
                      </button>
                      <button
                        v-else
                        @click="confirmDeleteUser(user.username)"
                        :disabled="!!userActionLoading[user.username] || user.username === authStore.user?.username"
                        :title="user.username === authStore.user?.username ? 'Cannot delete your own account' : 'Delete user'"
                        class="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span class="material-symbols-rounded !text-[14px]">delete</span>
                        <span>Delete</span>
                      </button>
                      <button
                        v-if="showDeleteConfirm === user.username"
                        @click="cancelDelete"
                        class="flex items-center gap-1 px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-xs font-medium transition-colors"
                      >
                        <span class="material-symbols-rounded !text-[14px]">close</span>
                        <span>Cancel</span>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Add User Modal -->
    <div
      v-if="showAddUserModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
      @click.self="closeAddUserModal"
    >
      <div class="bg-slate-800 rounded-lg p-6 max-w-md w-full">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-semibold">Add New User</h3>
          <button
            @click="closeAddUserModal"
            class="text-slate-400 hover:text-white transition-colors"
          >
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>

        <form @submit.prevent="handleAddUser" class="flex flex-col gap-4">
          <div>
            <label for="new-username" class="block text-sm font-medium mb-1">Username</label>
            <input
              id="new-username"
              v-model="newUserForm.username"
              type="text"
              minlength="3"
              required
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:border-blue-500 outline-none"
              placeholder="Enter username (min 3 characters)"
            />
          </div>

          <div>
            <label for="new-password" class="block text-sm font-medium mb-1">Password</label>
            <div class="flex items-center gap-2">
              <input
                id="new-password"
                v-model="newUserForm.password"
                :type="showNewUserPassword ? 'text' : 'password'"
                minlength="8"
                maxlength="72"
                required
                class="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:border-blue-500 outline-none"
                placeholder="Enter password (8-72 characters)"
              />
              <button
                type="button"
                class="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-200 hover:bg-slate-600"
                :aria-label="showNewUserPassword ? 'Hide password' : 'Show password'"
                @click="showNewUserPassword = !showNewUserPassword"
              >
                <span class="material-symbols-rounded !text-[18px]">
                  {{ showNewUserPassword ? 'visibility_off' : 'visibility' }}
                </span>
              </button>
            </div>
          </div>

          <div>
            <label for="confirm-password" class="block text-sm font-medium mb-1">Confirm Password</label>
            <div class="flex items-center gap-2">
              <input
                id="confirm-password"
                v-model="newUserForm.confirmPassword"
                :type="showNewUserConfirmPassword ? 'text' : 'password'"
                minlength="8"
                maxlength="72"
                required
                class="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:border-blue-500 outline-none"
                placeholder="Confirm password"
              />
              <button
                type="button"
                class="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-200 hover:bg-slate-600"
                :aria-label="showNewUserConfirmPassword ? 'Hide confirm password' : 'Show confirm password'"
                @click="showNewUserConfirmPassword = !showNewUserConfirmPassword"
              >
                <span class="material-symbols-rounded !text-[18px]">
                  {{ showNewUserConfirmPassword ? 'visibility_off' : 'visibility' }}
                </span>
              </button>
            </div>
          </div>

          <p v-if="newUserError" class="text-sm text-red-400">{{ newUserError }}</p>

          <div class="flex gap-3 mt-2">
            <button
              type="submit"
              :disabled="newUserLoading"
              class="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-medium transition-colors disabled:opacity-50"
            >
              {{ newUserLoading ? 'Creating...' : 'Create User' }}
            </button>
            <button
              type="button"
              @click="closeAddUserModal"
              :disabled="newUserLoading"
              class="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-white font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Support</p>
      </div>
      <div class="px-2 flex flex-col gap-4 divide-y divide-slate-700">
        <div class="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-4">
          <p class="font-semibold sm:min-w-48">Discord</p>
          <a :href="Discord" class="underline break-all">{{ Discord }}</a>
        </div>

        <div class="flex flex-col items-start gap-1 pt-4 sm:flex-row sm:items-center sm:gap-4">
          <p class="font-semibold sm:min-w-48">Github</p>
          <a :href="githubRepo" class="underline break-all">{{ githubRepo }}</a>
        </div>

        <div class="flex flex-col items-start gap-1 pt-4 sm:flex-row sm:items-center sm:gap-4">
          <p class="font-semibold sm:min-w-48">Docs</p>
          <a :href="DocsUrl" class="underline break-all">{{ DocsUrl }}</a>
        </div>

        <div class="flex flex-col items-start gap-1 pt-4 sm:flex-row sm:items-center sm:gap-4">
          <p class="font-semibold sm:min-w-48">DockerHub</p>
          <a :href="dockerHubUrl" class="underline break-all">{{ dockerHubUrl }}</a>
        </div>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Contributors</p>
      </div>
      <div class="px-2 flex flex-wrap gap-2 items-center">
        <button v-for="contributor in contributorsList" :key="contributor.id"
          class="rounded-full h-16 w-16 bg-slate-800 border border-slate-500"
          @click="goToContributor(contributor.html_url)">
          <img :src="contributor.avatar_url" :alt="contributor.login" class="object-cover object-center rounded-full">
        </button>
      </div>
    </div>

    <!-- Disable Auth Warning Modal -->
    <div
      v-if="showDisableAuthWarning"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
      @click.self="showDisableAuthWarning = false"
    >
      <div class="bg-slate-800 rounded-lg p-6 max-w-md w-full border-2 border-amber-600">
        <div class="flex items-start gap-4 mb-4">
          <span class="material-symbols-rounded text-amber-500 text-3xl">warning</span>
          <div class="flex-1">
            <h3 class="text-xl font-semibold mb-2 text-amber-400">Disable Authentication?</h3>
            <div class="text-sm text-slate-300 space-y-2">
              <p class="font-semibold">This will:</p>
              <ul class="list-disc list-inside space-y-1 ml-2">
                <li>Remove all authentication requirements</li>
                <li>Allow unrestricted API access</li>
                <li>Make your dashboard publicly accessible</li>
                <li>Log you out immediately</li>
              </ul>
              <p class="mt-3 text-amber-300 font-medium">
                ⚠️ Your user accounts will be preserved and you can re-enable authentication at any time.
              </p>
            </div>
          </div>
        </div>

        <div class="flex gap-3 mt-6">
          <button
            @click="handleDisableAuth"
            :disabled="disableAuthLoading"
            class="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span v-if="!disableAuthLoading" class="material-symbols-rounded !text-[18px]">lock_open</span>
            <span>{{ disableAuthLoading ? 'Disabling...' : 'Yes, Disable Authentication' }}</span>
          </button>
          <button
            @click="showDisableAuthWarning = false"
            :disabled="disableAuthLoading"
            class="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-white font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
