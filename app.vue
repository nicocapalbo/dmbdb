<script setup>
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";
import { useMetricsStore } from "~/stores/metrics.js";
import { useStatusStore } from "~/stores/status.js";
import { useAuthStore } from "~/stores/auth.js";
import { useAppearance } from "~/composables/useAppearance.js";
import axios from "axios";
import InstallationBackupActivityBanner from '~/components/InstallationBackupActivityBanner.vue'
import StartupStatusBanner from "~/components/StartupStatusBanner.vue"
import { setupErrorText } from "~/helper/setupArrangements.js"
import { installationActivityJob } from '~/helper/installationServiceStatus.js'
import { initialInstallationBackupActivity } from '~/helper/installationBackupActivity.js'
import { initialInstallationBackupState } from '~/helper/installationBackupController.js'
import { rcloneOptimizerNotificationKind } from '~/helper/rcloneOptimizer.js'

const processesStore = useProcessesStore()
const logsStore = useLogsStore()
const metricsStore = useMetricsStore()
const statusStore = useStatusStore()
const authStore = useAuthStore()
const route = useRoute()
const toast = useToast()
const { initAppearance } = useAppearance()
const backupActivity = useState('installationBackupActivity', initialInstallationBackupActivity)
const backupPanel = useState('installationBackupState', initialInstallationBackupState)
watch(() => [backupActivity.value, backupPanel.value.job, authStore.isAuthenticated, authStore.isAuthEnabled, route.path], () => {
  const allowed = !['/login', '/setup'].includes(route.path) && (!authStore.isAuthEnabled || authStore.isAuthenticated) && !backupActivity.value.authorizationRejected
  statusStore.setInstallationActivity?.(allowed ? installationActivityJob(backupActivity.value, backupPanel.value) : null, { resume: allowed })
}, { immediate: true })
const metricsPollMs = 15000
let metricsRefreshTimer = null
let startupRefreshTimer = null
let rcloneOptimizerRefreshTimer = null
let rcloneOptimizerPollInitialized = false
const startupStatus = ref(null)
const startupLifecycleSupported = ref(null)
const startupStatusError = ref('')
const startupStatusLoading = ref(false)
const rcloneOptimizerSupported = ref(false)
const rcloneOptimizerStatusKey = 'dumb.rcloneOptimizer.jobStatuses'
const logRequestFailure = (message, error, endpoint) => {
  const status = Number(error?.response?.status)
  const result = Number.isInteger(status) && status >= 100 && status <= 599 ? 'HTTP ' + status : 'no HTTP response'
  console.warn(message + ' (' + result + ' · ' + endpoint + ')')
}

const refreshRcloneOptimizerJobs = async () => {
  if (!rcloneOptimizerSupported.value || !import.meta.client) return
  try {
    const { data } = await axios.get('/api/process/rclone-optimizer/jobs', { params: { limit: 20 } })
    const jobs = Array.isArray(data?.jobs) ? data.jobs : []
    let prior = {}
    try { prior = JSON.parse(localStorage.getItem(rcloneOptimizerStatusKey) || '{}') || {} } catch { prior = {} }
    const next = { ...prior }
    for (const job of jobs) {
      const previousStatus = prior[job.job_id]
      next[job.job_id] = job.status
      const notificationKind = rcloneOptimizerNotificationKind(
        previousStatus || (rcloneOptimizerPollInitialized ? 'new' : null),
        job.status
      )
      if (notificationKind === 'success') {
        toast.success({
          title: 'Rclone optimization complete',
          message: `${job.process_name}: the report and recommendation are ready. Nothing was applied automatically.`,
          timeout: 8000
        })
      } else if (notificationKind === 'warning') {
        toast.warning({
          title: 'Rclone optimization stopped',
          message: `${job.process_name}: open the rclone optimizer report for details.`,
          timeout: 8000
        })
      }
    }
    const retained = Object.fromEntries(jobs.map((job) => [job.job_id, next[job.job_id]]))
    localStorage.setItem(rcloneOptimizerStatusKey, JSON.stringify(retained))
    rcloneOptimizerPollInitialized = true
  } catch (err) {
    logRequestFailure('Could not refresh rclone optimizer jobs.', err, '/api/process/rclone-optimizer/jobs')
  }
}

const refreshStartupStatus = async () => {
  if (startupLifecycleSupported.value === false || startupStatusLoading.value) return
  startupStatusLoading.value = true
  let endpoint = '/api/process/startup-status'
  try {
    if (startupLifecycleSupported.value === null) {
      endpoint = '/api/process/capabilities'
      const { data } = await axios.get(endpoint, { timeout: 15000 })
      startupLifecycleSupported.value = data?.startup_lifecycle === true
      if (!startupLifecycleSupported.value) {
        startupStatusError.value = ''
        if (startupRefreshTimer) { clearInterval(startupRefreshTimer); startupRefreshTimer = null }
        return
      }
      endpoint = '/api/process/startup-status'
    }
    const { data } = await axios.get(endpoint, { timeout: 15000 })
    startupStatus.value = data
    startupStatusError.value = ''
    if (data?.terminal && startupRefreshTimer) {
      clearInterval(startupRefreshTimer)
      startupRefreshTimer = null
    }
  } catch (error) {
    startupStatusError.value = setupErrorText(error, 'Could not load startup readiness. Retry to check the controller.', endpoint)
  } finally { startupStatusLoading.value = false }
}

const refreshMetricsSnapshot = async () => {
  try {
    const response = await axios.get('/api/metrics')
    if (response?.data) {
      metricsStore.latestSnapshot = response.data
    }
  } catch (err) {
    logRequestFailure('Could not load metrics.', err, '/api/metrics')
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
    logRequestFailure('Could not load services.', err, '/api/process')
  }

  try {
    const { data: capabilities } = await axios.get('/api/process/capabilities', { timeout: 15000 })
    startupLifecycleSupported.value = capabilities?.startup_lifecycle === true
    rcloneOptimizerSupported.value = capabilities?.rclone_optimizer_infinidysk === true
      || capabilities?.rclone_optimizer_nzbdav === true
    if (startupLifecycleSupported.value) {
      await refreshStartupStatus()
      if (!startupStatus.value?.terminal && !startupRefreshTimer) {
        startupRefreshTimer = setInterval(refreshStartupStatus, 5000)
      }
    }
    if (rcloneOptimizerSupported.value) {
      await refreshRcloneOptimizerJobs()
      rcloneOptimizerRefreshTimer = setInterval(refreshRcloneOptimizerJobs, 5000)
    }
  } catch (err) {
    startupStatusError.value = setupErrorText(err, 'Could not check startup readiness support. Retry to check this backend.', '/api/process/capabilities')
  }

  if (startupLifecycleSupported.value !== false && !startupStatus.value?.terminal && !startupRefreshTimer) {
    startupRefreshTimer = setInterval(refreshStartupStatus, 5000)
  }

  try {
    await logsStore.getAllLogs()
  } catch (err) {
    logRequestFailure('Could not load logs.', err, '/api/logs')
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
  if (rcloneOptimizerRefreshTimer) {
    clearInterval(rcloneOptimizerRefreshTimer)
    rcloneOptimizerRefreshTimer = null
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
    <StartupStatusBanner
      v-if="startupLifecycleSupported !== false && ((startupStatus && startupStatus.phase !== 'ready') || startupStatusError)"
      :status="startupStatus" :error="startupStatusError" :loading="startupStatusLoading"
      @refresh="refreshStartupStatus"
    />
    <InstallationBackupActivityBanner />
    <NuxtPage />
    <InfiniDyskMigrationNotice />
    <InfiniDyskV2Notice />
    <UpdateNotice />
  </NuxtLayout>
</template>
