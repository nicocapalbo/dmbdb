<script setup>
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";
import { useMetricsStore } from "~/stores/metrics.js";
import { useStatusStore } from "~/stores/status.js";
import { useAuthStore } from "~/stores/auth.js";
import { useAppearance } from "~/composables/useAppearance.js";
import axios from "axios";

const processesStore = useProcessesStore()
const logsStore = useLogsStore()
const metricsStore = useMetricsStore()
const statusStore = useStatusStore()
const authStore = useAuthStore()
const route = useRoute()
const { initAppearance } = useAppearance()
const metricsPollMs = 15000
let metricsRefreshTimer = null
let startupRefreshTimer = null
const startupStatus = ref(null)
const startupLifecycleSupported = ref(false)

const startupPhaseLabel = computed(() => ({
  initializing: 'Initializing DUMB',
  preinstalling: 'Preinstalling enabled services',
  starting_services: 'Starting enabled services',
  stabilizing: 'Waiting for service readiness',
  degraded: 'Startup completed with degraded services',
}[startupStatus.value?.phase] || 'Starting DUMB'))

const startupFailureNames = computed(() =>
  Object.keys(startupStatus.value?.failures || {})
)

const refreshStartupStatus = async () => {
  if (!startupLifecycleSupported.value) return
  try {
    const { data } = await axios.get('/api/process/startup-status')
    startupStatus.value = data
    if (data?.terminal && startupRefreshTimer) {
      clearInterval(startupRefreshTimer)
      startupRefreshTimer = null
    }
  } catch (err) {
    console.warn('Failed to load startup lifecycle status:', err)
  }
}

const refreshMetricsSnapshot = async () => {
  try {
    const response = await axios.get('/api/metrics')
    if (response?.data) {
      metricsStore.latestSnapshot = response.data
    }
  } catch (err) {
    console.warn('Failed to load metrics snapshot in app.vue:', err)
  }
}


onMounted(async () => {
  initAppearance()

  // Note: Auth initialization is handled by the middleware, not here
  // Only load app data if we're authenticated and past the setup/login flow

  // Don't load data if:
  // 1. We're on the setup page (no users exist yet)
  // 2. We're on the login page (not authenticated yet)
  // 3. Auth is enabled but user isn't authenticated
  const isAuthPage = route.path === '/setup' || route.path === '/login'

  if (isAuthPage) {
    console.log('Skipping data load on auth page:', route.path)
    return
  }

  // If auth is enabled, wait until user is authenticated
  if (authStore.isAuthEnabled && !authStore.isAuthenticated) {
    console.log('Skipping data load - auth required but not authenticated')
    return
  }

  try {
    await processesStore.getProcesses()
  } catch (err) {
    console.warn('Failed to load processes in app.vue:', err)
  }

  try {
    const { data: capabilities } = await axios.get('/api/process/capabilities')
    startupLifecycleSupported.value = capabilities?.startup_lifecycle === true
    if (startupLifecycleSupported.value) {
      await refreshStartupStatus()
      if (!startupStatus.value?.terminal && !startupRefreshTimer) {
        startupRefreshTimer = setInterval(refreshStartupStatus, 5000)
      }
    }
  } catch (err) {
    console.warn('Startup lifecycle is unavailable on this backend:', err)
  }

  try {
    await logsStore.getAllLogs()
  } catch (err) {
    console.warn('Failed to load logs in app.vue:', err)
  }

  // Keep app-level alert context without a global metrics websocket.
  await refreshMetricsSnapshot()
  if (!metricsRefreshTimer) {
    metricsRefreshTimer = setInterval(() => {
      refreshMetricsSnapshot()
    }, metricsPollMs)
  }

  // Keep service status live across all pages.
  statusStore.resume({ interval: 2, health: true })
});

onBeforeUnmount(() => {
  if (metricsRefreshTimer) {
    clearInterval(metricsRefreshTimer)
    metricsRefreshTimer = null
  }
  if (startupRefreshTimer) {
    clearInterval(startupRefreshTimer)
    startupRefreshTimer = null
  }
})

watchEffect(() => {
  useHead({
    titleTemplate: `${processesStore.projectName} Dashboard`,
  });
});
</script>

<template>
  <NuxtLayout>
    <div
      v-if="startupLifecycleSupported && startupStatus && startupStatus.phase !== 'ready'"
      class="mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-7xl items-start gap-3 rounded-lg border px-4 py-3 text-sm"
      :class="startupStatus.phase === 'degraded'
        ? 'border-rose-500/50 bg-rose-500/10 text-rose-100'
        : 'border-sky-500/50 bg-sky-500/10 text-sky-100'"
    >
      <span class="material-symbols-rounded !text-[20px]">
        {{ startupStatus.phase === 'degraded' ? 'error' : 'progress_activity' }}
      </span>
      <div>
        <p class="font-semibold">{{ startupPhaseLabel }}</p>
        <p v-if="startupStatus.phase === 'degraded'" class="mt-1 text-xs opacity-90">
          The control plane is available, but these services missed the readiness deadline:
          {{ startupFailureNames.join(', ') || 'unknown' }}. Review service and DUMB logs.
        </p>
        <p v-else class="mt-1 text-xs opacity-90">
          Services are still settling. Health alerts and automatic restarts remain paused until startup reaches a terminal state.
        </p>
      </div>
    </div>
    <NuxtPage />
    <UpdateNotice />
  </NuxtLayout>
</template>
