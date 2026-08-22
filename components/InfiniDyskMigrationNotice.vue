<script setup>
import useService from '~/services/useService.js'
import { useAuthStore } from '~/stores/auth.js'
import { useInfiniDyskMigrationState } from '~/composables/useInfiniDyskMigrationState.js'
import {
  INFINIDYSK_MIGRATION_CLEANUP_CONFIRMATION,
  isActiveInfiniDyskMigrationJob,
  isInfiniDyskMigrationCleanupAvailable,
  isInfiniDyskMigrationCleanupReady,
  normalizeInfiniDyskMigrationJob,
  reconcileInfiniDyskTerminalJob,
} from '~/helper/infinidyskMigration.js'

const { processService } = useService()
const authStore = useAuthStore()
const route = useRoute()
const toast = useToast()
const {
  update: updateSharedMigrationState,
  reset: resetSharedMigrationState,
} = useInfiniDyskMigrationState()

const migration = ref(null)
const capabilities = ref({})
const migrationJob = ref(null)
const terminalBannerVisible = ref(false)
const loading = ref(false)
const modalOpen = ref(false)
const applying = ref(false)
const reminding = ref(false)
const preflighting = ref(false)
const stoppingPlayback = ref(false)
const preflight = ref(null)
const selectedMode = ref('retain_legacy_namespace')
const renameAttachedServices = ref(true)
const confirmation = ref('')
const acknowledgeDowntime = ref(false)
const acknowledgeLibraryScan = ref(false)
const acknowledgeRollbackLimits = ref(false)
const acknowledgeExternalBackup = ref(false)
const cleanupPreview = ref(null)
const cleanupPreviewing = ref(false)
const cleanupApplying = ref(false)
const cleanupConfirmation = ref('')
const acknowledgeCleanupValidation = ref(false)
const acknowledgeCleanupRollbackLoss = ref(false)

watch(migration, (value) => updateSharedMigrationState({ migration: value }))
watch(migrationJob, (value) => updateSharedMigrationState({ job: value }))

const canLoad = computed(() => (
  !['/setup', '/login'].includes(route.path)
  && (!authStore.isAuthEnabled || authStore.isAuthenticated)
))
const routeServiceId = computed(() => String(route.params?.serviceId || '').toLowerCase())
const jobActive = computed(() => isActiveInfiniDyskMigrationJob(migrationJob.value))
const jobCompleted = computed(() => migrationJob.value?.status === 'completed')
const jobFailed = computed(() => Boolean(migrationJob.value) && !jobActive.value && !jobCompleted.value)
const jobProgress = computed(() => Math.max(0, Math.min(100, Number(migrationJob.value?.progress || 0))))
const jobDetail = computed(() => migrationJob.value?.detail || null)
const jobRecovery = computed(() => migrationJob.value?.result?.recovery || null)
const jobReferenceProgress = computed(() => {
  if (jobDetail.value?.kind !== 'arr_references') return null
  const completed = Math.max(0, Number(jobDetail.value.completed || 0))
  const total = Math.max(0, Number(jobDetail.value.total || 0))
  const overallCompleted = Math.max(0, Number(jobDetail.value.overall_completed || 0))
  const overallTotal = Math.max(0, Number(jobDetail.value.overall_total || 0))
  return {
    processName: String(jobDetail.value.process_name || 'Arr'),
    completed,
    total,
    percent: total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 100,
    overallCompleted,
    overallTotal,
  }
})
const activeMediaServers = computed(() => Array.isArray(migrationJob.value?.active_media_servers)
  ? migrationJob.value.active_media_servers
  : [])
const playbackOverrideVisible = computed(() => (
  capabilities.value?.infinidysk_migration_playback_override === true
  && jobActive.value
  && migrationJob.value?.stage === 'quiescing'
  && (migrationJob.value?.playback_override_available === true || migrationJob.value?.playback_stop_requested === true)
))
const recentJobEvents = computed(() => (migrationJob.value?.events || []).slice(-8).reverse())
const visible = computed(() => (
  migration.value?.notice_due === true
  && migration.value?.cleanup_finalized !== true
  && !jobActive.value
  && !terminalBannerVisible.value
))
const cleanupAvailable = computed(() => isInfiniDyskMigrationCleanupAvailable(
  migration.value,
  capabilities.value?.infinidysk_migration_cleanup === true,
  migrationJob.value,
))
const manualAccessVisible = computed(() => (
  !visible.value
  && !jobActive.value
  && migration.value?.cleanup_finalized !== true
  && (migration.value?.status === 'compatibility_completed' || Boolean(migrationJob.value) || cleanupAvailable.value)
  && ['infinidysk', 'nzbdav'].some((token) => routeServiceId.value.includes(token))
))
const cleanupReady = computed(() => isInfiniDyskMigrationCleanupReady({
  preview: cleanupPreview.value,
  confirmation: cleanupConfirmation.value,
  acknowledgeValidation: acknowledgeCleanupValidation.value,
  acknowledgeRollbackLoss: acknowledgeCleanupRollbackLoss.value,
}))
const cleanupRetainedItems = computed(() => Array.isArray(cleanupPreview.value?.retained)
  ? cleanupPreview.value.retained
  : [])
const cleanupCategories = computed(() => Array.isArray(cleanupPreview.value?.deletion?.categories)
  ? cleanupPreview.value.deletion.categories
  : [])
const cleanupFinalizesLegacyPaths = computed(() => (
  cleanupPreview.value?.selected_mode === 'retain_legacy_namespace'
))
const modes = computed(() => Array.isArray(migration.value?.modes) ? migration.value.modes : [])
const selected = computed(() => modes.value.find((mode) => mode.id === selectedMode.value))
const fullNamespaceSelected = computed(() => selectedMode.value === 'full_namespace')
const fullNamespaceReady = computed(() => preflight.value?.ready === true)
const pendingQuiescence = computed(() => Array.isArray(preflight.value?.pending_conditions)
  ? preflight.value.pending_conditions
  : [])
const arrDiscovery = computed(() => Array.isArray(preflight.value?.arr_discovery)
  ? preflight.value.arr_discovery
  : [])
const includedArrDiscovery = computed(() => arrDiscovery.value.filter(item => item.included === true))
const excludedArrDiscovery = computed(() => arrDiscovery.value.filter(item => item.included !== true))
const externalMediaServers = computed(() => (preflight.value?.media_servers || []).filter(
  item => item.external_api_only === true,
))
const legacyPathCount = computed(() => migration.value?.legacy?.paths?.length || 0)
const attachedCount = computed(() => migration.value?.legacy?.attached_services?.length || 0)
const arrChangeCount = computed(() => (preflight.value?.arr_services || []).reduce(
  (total, item) => total
    + (item.item_changes || 0)
    + (item.root_changes || 0)
    + (item.client_changes || 0)
    + (item.import_list_changes || 0)
    + (item.collection_changes || 0)
    + (item.tag_changes || 0),
  0,
))
const prowlarrChangeCount = computed(() => (preflight.value?.prowlarr_services || []).reduce(
  (total, item) => total + (item.application_changes || 0) + (item.tag_changes || 0),
  0,
))
const mediaChangeCount = computed(() => (preflight.value?.media_servers || []).reduce(
  (total, item) => total + (item.library_changes || 0),
  0,
))
const linkedServiceCount = computed(() => preflight.value?.linked_services?.length || 0)
const runningLinkedServiceCount = computed(() => (preflight.value?.linked_services || []).filter(
  item => item.running === true,
).length)

const messageFromError = (error, fallback) => String(
  error?.response?.data?.detail || error?.message || fallback
)
const formatJobStage = (value) => String(value || '')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const formatBytes = (value) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable'
  if (bytes < 1024) return `${bytes.toLocaleString()} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = bytes
  let unitIndex = -1
  do {
    size /= 1024
    unitIndex += 1
  } while (size >= 1024 && unitIndex < units.length - 1)
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`
}
const formatDateTime = (value) => {
  if (!value) return 'Unknown'
  const numeric = Number(value)
  const normalized = Number.isFinite(numeric)
    ? (numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : value
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString()
}

let jobPollTimer = null
let discoveryRetryTimer = null
let notifiedTerminalJobId = null

const stopJobPolling = () => {
  if (jobPollTimer) {
    clearTimeout(jobPollTimer)
    jobPollTimer = null
  }
}

const stopDiscoveryRetry = () => {
  if (discoveryRetryTimer) {
    clearTimeout(discoveryRetryTimer)
    discoveryRetryTimer = null
  }
}

const resetCleanupPreview = () => {
  cleanupPreview.value = null
  cleanupConfirmation.value = ''
  acknowledgeCleanupValidation.value = false
  acknowledgeCleanupRollbackLoss.value = false
}

const scheduleDiscoveryRetry = (delay = 15000) => {
  stopDiscoveryRetry()
  if (!canLoad.value || jobActive.value || migration.value?.cleanup_finalized === true) return
  discoveryRetryTimer = setTimeout(() => loadMigration(), delay)
}

const notifyTerminalJob = async (job) => {
  if (!job?.job_id || notifiedTerminalJobId === job.job_id) return
  notifiedTerminalJobId = job.job_id
  terminalBannerVisible.value = true
  if (job.status === 'completed') {
    migration.value = { ...migration.value, notice_due: false, status: 'completed' }
    toast.success({
      title: 'InfiniDysk namespace migration complete',
      message: job.message || 'The guarded namespace cutover completed successfully.',
      timeout: 10000,
    })
    return
  }
  toast.error({
    title: job.status === 'interrupted' ? 'Migration interrupted' : 'Migration needs attention',
    message: job.message || job.error || 'Open migration progress for recovery details.',
    timeout: 12000,
  })
}

const refreshMigrationJob = async (jobId = null, scheduleNext = true, notifyTerminal = true) => {
  if (capabilities.value?.infinidysk_migration_jobs !== true) return
  try {
    const response = await processService.getInfiniDyskMigrationJob(jobId)
    migrationJob.value = normalizeInfiniDyskMigrationJob(response?.job)
    updateSharedMigrationState({ jobResolved: true, error: '' })
    stopJobPolling()
    if (jobActive.value && scheduleNext) {
      jobPollTimer = setTimeout(() => refreshMigrationJob(migrationJob.value?.job_id), 2000)
    } else if (migrationJob.value) {
      const terminalPresentation = reconcileInfiniDyskTerminalJob(
        migrationJob.value,
        {
          announcementsEnabled: notifyTerminal,
          acknowledgedJobId: notifiedTerminalJobId,
        },
      )
      if (terminalPresentation.announce) {
        await notifyTerminalJob(migrationJob.value)
      } else {
        // Loading an already-terminal persisted job is discovery, not a new
        // completion event. Keep it available from the service page without
        // raising the result banner on every focus, reload, or new browser.
        notifiedTerminalJobId = terminalPresentation.acknowledgedJobId
      }
    }
  } catch (error) {
    updateSharedMigrationState({
      jobResolved: false,
      error: messageFromError(error, 'InfiniDysk namespace migration job status is unavailable.'),
    })
    if (error?.response?.status !== 404) {
      console.warn('InfiniDysk migration job status is unavailable:', error)
    }
    stopJobPolling()
    if (scheduleNext && migrationJob.value && jobActive.value) {
      jobPollTimer = setTimeout(() => refreshMigrationJob(migrationJob.value?.job_id), 4000)
    }
  }
}

const openModal = () => {
  modalOpen.value = true
}

const closeModal = () => {
  if (jobActive.value && typeof window !== 'undefined') {
    const close = window.confirm(
      'The InfiniDysk namespace migration will keep running in the background. Close progress and reopen it from the migration banner?'
    )
    if (!close) return
  }
  modalOpen.value = false
  resetCleanupPreview()
}

const loadMigration = async () => {
  if (!canLoad.value || loading.value) return
  loading.value = true
  try {
    capabilities.value = await processService.getCapabilities()
    updateSharedMigrationState({
      migrationCapability: capabilities.value?.infinidysk_migration === true,
      migrationJobsCapability: capabilities.value?.infinidysk_migration_jobs === true,
      error: '',
    })
    if (capabilities.value?.infinidysk_migration !== true) {
      updateSharedMigrationState({ statusResolved: false, jobResolved: false })
      return
    }
    migration.value = await processService.getInfiniDyskMigrationStatus()
    updateSharedMigrationState({ statusResolved: true, error: '' })
    if (migration.value?.cleanup_finalized === true) {
      stopJobPolling()
      stopDiscoveryRetry()
      migrationJob.value = null
      terminalBannerVisible.value = false
      modalOpen.value = false
      resetCleanupPreview()
      updateSharedMigrationState({ jobResolved: true, job: null })
      return
    }
    if (capabilities.value?.infinidysk_migration_jobs === true) {
      await refreshMigrationJob(null, true, false)
    } else {
      updateSharedMigrationState({ jobResolved: false })
    }
    scheduleDiscoveryRetry()
  } catch (error) {
    updateSharedMigrationState({
      statusResolved: false,
      jobResolved: false,
      error: messageFromError(error, 'InfiniDysk namespace migration status is unavailable.'),
    })
    if (error?.response?.status !== 404) {
      console.warn('InfiniDysk migration status is unavailable:', error)
    }
    scheduleDiscoveryRetry(5000)
  } finally {
    loading.value = false
  }
}

const remindLater = async () => {
  if (reminding.value) return
  reminding.value = true
  try {
    migration.value = await processService.remindInfiniDyskMigrationLater(7)
    modalOpen.value = false
    resetCleanupPreview()
    toast.info({
      title: 'InfiniDysk migration snoozed',
      message: 'DUMB will show this migration again in 7 days.',
    })
  } catch (error) {
    toast.error({
      title: 'Could not save reminder',
      message: messageFromError(error, 'Try again after checking DUMB API health.'),
    })
  } finally {
    reminding.value = false
  }
}

const previewMigrationCleanup = async () => {
  if (cleanupPreviewing.value || !cleanupAvailable.value) return
  cleanupPreviewing.value = true
  resetCleanupPreview()
  try {
    cleanupPreview.value = await processService.getInfiniDyskMigrationCleanupPreview()
    if (cleanupPreview.value?.available !== true) {
      toast.warning({
        title: 'Migration cleanup is not available',
        message: 'DUMB did not authorize cleanup. Refresh migration status and resolve any reported blocker before trying again.',
      })
    }
  } catch (error) {
    toast.error({
      title: 'Could not preview migration cleanup',
      message: messageFromError(error, 'No migration data was removed.'),
    })
  } finally {
    cleanupPreviewing.value = false
  }
}

const cleanupInfiniDyskMigration = async () => {
  if (cleanupApplying.value || !cleanupReady.value) return
  cleanupApplying.value = true
  try {
    const result = await processService.cleanupInfiniDyskMigration({
      previewToken: cleanupPreview.value.preview_token,
      confirmation: cleanupConfirmation.value,
      acknowledgeValidation: acknowledgeCleanupValidation.value,
      acknowledgeRollbackLoss: acknowledgeCleanupRollbackLoss.value,
    })
    const deleted = result?.deleted || {}
    const deletedFiles = Math.max(0, Number(deleted.files || 0))
    const deletedDirectories = Math.max(0, Number(deleted.directories || 0))
    const deletedSize = formatBytes(deleted.bytes || 0)

    stopJobPolling()
    stopDiscoveryRetry()
    migrationJob.value = null
    terminalBannerVisible.value = false
    preflight.value = null
    notifiedTerminalJobId = null
    migration.value = {
      ...migration.value,
      cleanup_available: false,
      cleanup_finalized: true,
      cleanup_finalized_at: result?.cleanup_finalized_at || null,
      notice_due: false,
    }
    resetCleanupPreview()

    try {
      migration.value = await processService.getInfiniDyskMigrationStatus()
    } catch (statusError) {
      console.warn('InfiniDysk cleanup completed, but refreshed migration status is unavailable:', statusError)
    }

    modalOpen.value = false
    toast.success({
      title: result?.status === 'already_completed'
        ? 'Migration cleanup was already finalized'
        : 'Migration recovery data removed',
      message: `Removed ${deletedFiles.toLocaleString()} file${deletedFiles === 1 ? '' : 's'} and ${deletedDirectories.toLocaleString()} director${deletedDirectories === 1 ? 'y' : 'ies'} (${deletedSize}). Live service data and independent backups were retained.`,
      timeout: 12000,
    })
  } catch (error) {
    toast.error({
      title: 'Migration cleanup was not applied',
      message: messageFromError(error, 'No migration data was removed. Run a new preview before trying again.'),
      timeout: 10000,
    })
    if ([409, 422].includes(error?.response?.status)) resetCleanupPreview()
  } finally {
    cleanupApplying.value = false
  }
}

const runPreflight = async () => {
  if (preflighting.value) return
  preflighting.value = true
  preflight.value = null
  try {
    preflight.value = await processService.preflightInfiniDyskNamespaceMigration()
    if (preflight.value?.ready) {
      toast.success({
        title: 'Namespace preflight passed',
        message: pendingQuiescence.value.length
          ? 'DUMB can start the job and automatically hold services as queues and playback drain.'
          : 'Review the planned changes and acknowledgements before applying.',
      })
    } else {
      toast.warning({
        title: 'Namespace preflight found blockers',
        message: 'Resolve every blocker, then run the preflight again.',
      })
    }
  } catch (error) {
    toast.error({
      title: 'Namespace preflight failed',
      message: messageFromError(error, 'No migration changes were made.'),
    })
  } finally {
    preflighting.value = false
  }
}

const stopActivePlayback = async () => {
  if (
    stoppingPlayback.value
    || migrationJob.value?.playback_override_available !== true
    || typeof window === 'undefined'
  ) return
  const confirmationText = 'STOP ACTIVE PLAYBACK'
  const entered = window.prompt(
    `This immediately stops ${activeMediaServers.value.join(', ') || 'the affected media server'} and terminates its active streams. DUMB will still wait for InfiniDysk reads to close and will not bypass Arr queues or other safety checks.\n\nType ${confirmationText} to continue.`
  )
  if (entered?.trim() !== confirmationText) return
  stoppingPlayback.value = true
  try {
    const response = await processService.stopInfiniDyskMigrationPlayback(
      migrationJob.value.job_id,
      confirmationText,
    )
    migrationJob.value = normalizeInfiniDyskMigrationJob(response?.job) || migrationJob.value
    toast.warning({
      title: 'Stopping active playback',
      message: 'The affected media server will stop now. Migration will continue only after its InfiniDysk reads close.',
      timeout: 10000,
    })
    await refreshMigrationJob(migrationJob.value?.job_id)
  } catch (error) {
    toast.error({
      title: 'Could not stop active playback',
      message: messageFromError(error, 'The migration remains waiting for playback to end normally.'),
      timeout: 9000,
    })
  } finally {
    stoppingPlayback.value = false
  }
}

const applyMigration = async () => {
  if (applying.value || jobActive.value || selected.value?.available !== true) return
  applying.value = true
  try {
    const result = await processService.applyInfiniDyskMigration({
      mode: selectedMode.value,
      renameAttachedServices: renameAttachedServices.value,
      confirmation: confirmation.value,
      preflightToken: preflight.value?.token || null,
      acknowledgeDowntime: acknowledgeDowntime.value,
      acknowledgeLibraryScan: acknowledgeLibraryScan.value,
      acknowledgeRollbackLimits: acknowledgeRollbackLimits.value,
      acknowledgeExternalBackup: acknowledgeExternalBackup.value,
    })
    const startedJob = normalizeInfiniDyskMigrationJob(result?.job)
    if (fullNamespaceSelected.value && !startedJob) {
      throw new Error('DUMB did not return a valid namespace migration job.')
    }
    if (fullNamespaceSelected.value && startedJob) {
      migrationJob.value = startedJob
      notifiedTerminalJobId = null
      await refreshMigrationJob(startedJob.job_id, true)
      if (jobActive.value) {
        toast.info({
          title: 'Namespace migration started',
          message: 'You can close this dialog. The migration will continue and its progress can be reopened from the banner.',
          timeout: 10000,
        })
      }
      return
    }
    migration.value = { ...migration.value, notice_due: false, status: result.status }
    modalOpen.value = false
    toast.success({
      title: 'InfiniDysk cutover saved',
      message: result.restart_required
        ? 'Restart DUMB when convenient to apply the new process identity. Existing paths and libraries were retained.'
        : result.message,
      timeout: 10000,
    })
  } catch (error) {
    toast.error({
      title: 'Migration was not applied',
      message: messageFromError(error, 'No migration changes were saved.'),
      timeout: 9000,
    })
  } finally {
    applying.value = false
  }
}

const refreshOnBrowserReturn = () => {
  if (!canLoad.value || migration.value?.cleanup_finalized === true) return
  loadMigration()
}

onMounted(() => {
  loadMigration()
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', refreshOnBrowserReturn)
    window.addEventListener('pageshow', refreshOnBrowserReturn)
  }
})
onBeforeUnmount(() => {
  stopJobPolling()
  stopDiscoveryRetry()
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', refreshOnBrowserReturn)
    window.removeEventListener('pageshow', refreshOnBrowserReturn)
  }
})
watch(canLoad, (ready) => {
  if (ready) loadMigration()
  else {
    stopJobPolling()
    stopDiscoveryRetry()
    migration.value = null
    migrationJob.value = null
    resetSharedMigrationState()
    terminalBannerVisible.value = false
    resetCleanupPreview()
  }
})
watch(
  [() => route.path, () => authStore.isAuthEnabled, () => authStore.isAuthenticated],
  () => {
    if (canLoad.value) loadMigration()
  },
)
watch(selectedMode, () => {
  preflight.value = null
  acknowledgeDowntime.value = false
  acknowledgeLibraryScan.value = false
  acknowledgeRollbackLimits.value = false
  acknowledgeExternalBackup.value = false
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="jobActive && !modalOpen"
      class="fixed bottom-4 right-4 z-[82] w-[min(94vw,440px)] rounded-lg border border-cyan-400/35 bg-slate-950/95 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur"
    >
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded animate-spin text-cyan-300">progress_activity</span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-3">
            <p class="font-semibold text-slate-50">InfiniDysk migration running</p>
            <span class="text-xs font-medium text-cyan-200">{{ jobProgress }}%</span>
          </div>
          <p class="mt-1 text-xs leading-5 text-slate-300">{{ migrationJob?.message }}</p>
          <p v-if="jobReferenceProgress" class="mt-1 text-xs font-medium text-cyan-100">
            {{ jobReferenceProgress.processName }}:
            {{ jobReferenceProgress.completed.toLocaleString() }} / {{ jobReferenceProgress.total.toLocaleString() }} references
            ({{ jobReferenceProgress.percent }}%)
          </p>
          <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div class="h-full rounded-full bg-cyan-400 transition-[width] duration-500" :style="{ width: `${jobProgress}%` }" />
          </div>
          <button class="button-small mt-3 border border-cyan-300/30 hover:apply !px-3 !py-1.5 !text-xs" @click="openModal">
            Open progress
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="terminalBannerVisible && migrationJob && !jobActive && !modalOpen"
      class="fixed bottom-4 right-4 z-[82] w-[min(94vw,440px)] rounded-lg border bg-slate-950/95 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur"
      :class="jobCompleted ? 'border-emerald-400/35' : 'border-red-400/35'"
    >
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded" :class="jobCompleted ? 'text-emerald-300' : 'text-red-300'">
          {{ jobCompleted ? 'check_circle' : 'error' }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-slate-50">
            {{ jobCompleted ? 'InfiniDysk migration complete' : 'InfiniDysk migration needs attention' }}
          </p>
          <p class="mt-1 text-xs leading-5 text-slate-300">{{ migrationJob.message || migrationJob.error }}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="button-small border border-slate-50/15 hover:apply !px-3 !py-1.5 !text-xs" @click="openModal">
              Open result
            </button>
            <button class="button-small border border-slate-50/15 hover:stop !px-3 !py-1.5 !text-xs" @click="terminalBannerVisible = false">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>

    <button
      v-if="manualAccessVisible"
      class="fixed bottom-4 right-4 z-[82] rounded-md border border-cyan-400/35 bg-slate-950/95 px-3 py-2 text-xs font-medium text-cyan-100 shadow-xl backdrop-blur hover:border-cyan-300"
      title="Open the optional guarded InfiniDysk namespace migration"
      @click="openModal"
    >
      InfiniDysk namespace migration
    </button>

    <div
      v-if="visible"
      class="fixed bottom-4 right-4 z-[82] w-[min(94vw,440px)] rounded-lg border border-cyan-400/35 bg-slate-950/95 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur"
    >
      <div class="flex gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-500/15 text-cyan-100">
          <span class="material-symbols-rounded">swap_horiz</span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-slate-50">NzbDAV is now InfiniDysk</p>
          <p class="mt-1 text-xs leading-5 text-slate-300">
            {{ migration?.status === 'compatibility_completed'
              ? 'The identity cutover is complete. You can keep the legacy paths or run the guarded full namespace migration.'
              : 'DUMB found an existing NzbDAV configuration. Review the compatibility or complete namespace migration.' }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="button-small border border-cyan-300/30 hover:apply !px-3 !py-1.5 !text-xs" @click="openModal">
              Review migration
            </button>
            <button class="button-small border border-slate-50/15 hover:stop !px-3 !py-1.5 !text-xs" :disabled="reminding" @click="remindLater">
              {{ reminding ? 'Saving…' : 'Remind me later' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="modalOpen" class="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/85 p-3">
      <div class="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 shadow-2xl">
        <div class="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold text-slate-50">Migrate NzbDAV to InfiniDysk</h2>
            <p class="mt-1 text-xs leading-5 text-slate-400">Nothing is changed until you select an available path and confirm it.</p>
          </div>
          <button class="material-symbols-rounded text-slate-400 hover:text-white" title="Close" @click="closeModal">close</button>
        </div>

        <div class="space-y-5 p-5 text-sm text-slate-300">
          <div
            v-if="migrationJob"
            class="space-y-3 rounded-md border p-4"
            :class="jobCompleted ? 'border-emerald-400/30 bg-emerald-500/5' : (jobFailed ? 'border-red-400/30 bg-red-500/5' : 'border-cyan-400/30 bg-cyan-500/5')"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-medium" :class="jobCompleted ? 'text-emerald-200' : (jobFailed ? 'text-red-200' : 'text-cyan-100')">
                  {{ jobActive ? 'Namespace migration in progress' : (jobCompleted ? 'Namespace migration completed' : 'Latest namespace migration needs attention') }}
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-300">{{ migrationJob.message || migrationJob.error }}</p>
                <p v-if="jobReferenceProgress" class="mt-1 text-xs font-medium text-cyan-100">
                  {{ jobReferenceProgress.processName }}:
                  {{ jobReferenceProgress.completed.toLocaleString() }} / {{ jobReferenceProgress.total.toLocaleString() }} references
                  ({{ jobReferenceProgress.percent }}%)
                  <span v-if="jobReferenceProgress.overallTotal" class="text-slate-400">
                    · all Arrs {{ jobReferenceProgress.overallCompleted.toLocaleString() }} / {{ jobReferenceProgress.overallTotal.toLocaleString() }}
                  </span>
                </p>
              </div>
              <span class="rounded border border-slate-600 bg-slate-950/50 px-2 py-1 text-xs uppercase tracking-wide text-slate-300">
                {{ formatJobStage(migrationJob.stage || migrationJob.status) }} · {{ jobProgress }}%
              </span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                class="h-full rounded-full transition-[width] duration-500"
                :class="jobCompleted ? 'bg-emerald-400' : (jobFailed ? 'bg-red-400' : 'bg-cyan-400')"
                :style="{ width: `${jobProgress}%` }"
              />
            </div>
            <p v-if="jobActive" class="text-xs leading-5 text-slate-400">
              This job is persisted by DUMB. You may close this dialog or navigate elsewhere and reopen progress from the banner.
            </p>
            <div v-if="jobCompleted" class="space-y-2 rounded border border-emerald-400/30 bg-slate-950/45 p-3 text-xs leading-5">
              <p class="font-semibold text-emerald-100">Required post-migration checks</p>
              <ol class="list-decimal space-y-1 pl-5 text-slate-300">
                <li>Confirm InfiniDysk, rclone, affected Arrs, Prowlarr, and media servers are healthy.</li>
                <li>Confirm canonical Arr roots are populated and System → Health has no path warnings.</li>
                <li>On each affected Arr's main library page, click the top-toolbar <strong class="font-medium text-slate-200">Update All</strong>: Movies in Radarr, Series in Sonarr, Artists in Lidarr, or the equivalent Whisparr library page. Do not change roots or move files; DUMB already updated those references.</li>
                <li>Keep automatic trash/deletion disabled, then scan the affected media-server libraries.</li>
                <li>Verify library counts and test movie/episode playback plus seeking before restoring normal trash behavior.</li>
              </ol>
              <a
                href="https://dumbarr.com/services/core/infinidysk/#after-the-full-migration-succeeds"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex text-cyan-300 hover:text-cyan-200"
              >Open the complete post-migration checklist</a>
            </div>
            <div v-if="jobFailed && jobRecovery" class="space-y-2 rounded border border-red-400/30 bg-slate-950/45 p-3 text-xs leading-5">
              <p class="font-semibold text-red-100">Recovery details</p>
              <p v-if="jobRecovery.cause" class="text-slate-300"><strong class="font-medium text-slate-200">Cutover failure:</strong> {{ jobRecovery.cause }}</p>
              <template v-if="jobRecovery.rollback_errors?.length">
                <p class="text-red-100">Rollback reported {{ jobRecovery.rollback_errors.length }} issue{{ jobRecovery.rollback_errors.length === 1 ? '' : 's' }}. Review the affected component before restoring anything manually:</p>
                <ul class="list-disc space-y-1 pl-5 text-slate-300">
                  <li v-for="error in jobRecovery.rollback_errors" :key="error">{{ error }}</li>
                </ul>
              </template>
              <p v-else class="text-emerald-200">Rollback completed without a reported recovery error. Verify legacy service health and playback before retrying.</p>
              <p v-if="jobRecovery.backup_bundle_path" class="break-all text-slate-400"><strong class="font-medium text-slate-300">Rollback bundle:</strong> {{ jobRecovery.backup_bundle_path }}</p>
              <p v-if="jobRecovery.config_backup_path" class="break-all text-slate-400"><strong class="font-medium text-slate-300">Config backup:</strong> {{ jobRecovery.config_backup_path }}</p>
              <p class="font-medium text-amber-200">Do not rerun the migration or restore the complete bundle blindly. Confirm which legacy paths, services, and application references are already healthy first.</p>
            </div>
            <div v-if="playbackOverrideVisible" class="rounded border border-red-400/35 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
              <p class="font-semibold">Active playback is delaying the cutover</p>
              <p v-if="migrationJob.playback_stop_requested" class="mt-1 text-red-100/90">
                The playback-stop request was accepted. DUMB is stopping the affected media server and waiting for InfiniDysk reads to close.
              </p>
              <template v-else>
                <p class="mt-1 text-red-100/90">
                  Waiting for {{ activeMediaServers.join(', ') }}. You may keep waiting, or explicitly stop {{ activeMediaServers.length === 1 ? 'this media server' : 'these media servers' }} and terminate active streams. This does not bypass queue, API, read-drain, or filesystem safety checks.
                </p>
                <button
                  class="button-small mt-3 border border-red-300/40 hover:stop !px-3 !py-1.5 !text-xs"
                  :disabled="stoppingPlayback"
                  @click="stopActivePlayback"
                >
                  {{ stoppingPlayback ? 'Requesting stop…' : 'Stop active playback and continue' }}
                </button>
              </template>
            </div>
            <details v-if="recentJobEvents.length" class="rounded border border-slate-700 bg-slate-950/35 p-3 text-xs">
              <summary class="cursor-pointer text-slate-300">Recent stages</summary>
              <ol class="mt-3 space-y-2">
                <li v-for="(event, index) in recentJobEvents" :key="`${event.at}-${event.stage}-${index}`" class="flex gap-3">
                  <span class="w-10 shrink-0 text-right text-slate-500">{{ event.percent }}%</span>
                  <span><strong class="font-medium text-slate-300">{{ formatJobStage(event.stage) }}</strong> — {{ event.message }}</span>
                </li>
              </ol>
            </details>
          </div>

          <div v-if="cleanupAvailable" class="space-y-3 rounded-md border border-red-400/35 bg-red-500/5 p-4 text-xs leading-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="max-w-xl">
                <p class="font-semibold text-red-100">Finalize migration and remove recovery data</p>
                <p class="mt-1 text-slate-300">
                  This optional, permanent cleanup is available only after DUMB records a successful migration. Review the backend-calculated scope before deleting migration history, preflight state, DUMB configuration backups, and rollback bundles.
                </p>
              </div>
              <button
                class="button-small border border-red-300/35 hover:stop !px-3 !py-1.5 !text-xs"
                :disabled="cleanupPreviewing || cleanupApplying"
                @click="previewMigrationCleanup"
              >
                {{ cleanupPreviewing ? 'Calculating…' : (cleanupPreview ? 'Refresh preview' : 'Review cleanup') }}
              </button>
            </div>

            <div v-if="cleanupPreview?.available === true" class="space-y-3 border-t border-red-300/15 pt-3">
              <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">
                  <span class="block text-slate-500">Migration mode</span>
                  <strong class="font-medium text-slate-200">{{ cleanupPreview.selected_mode === 'full_namespace' ? 'Full namespace' : 'Legacy paths retained' }}</strong>
                </div>
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">
                  <span class="block text-slate-500">Files</span>
                  <strong class="font-medium text-slate-200">{{ Number(cleanupPreview.deletion?.files || 0).toLocaleString() }}</strong>
                </div>
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">
                  <span class="block text-slate-500">Directories</span>
                  <strong class="font-medium text-slate-200">{{ Number(cleanupPreview.deletion?.directories || 0).toLocaleString() }}</strong>
                </div>
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">
                  <span class="block text-slate-500">Recovery data</span>
                  <strong class="font-medium text-slate-200">{{ formatBytes(cleanupPreview.deletion?.bytes || 0) }}</strong>
                </div>
              </div>

              <div v-if="cleanupCategories.length" class="rounded border border-red-400/20 bg-slate-950/40 p-3">
                <p class="font-medium text-red-100">Permanently removed</p>
                <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-300">
                  <li v-for="category in cleanupCategories" :key="category">{{ category }}</li>
                </ul>
              </div>

              <div v-if="cleanupRetainedItems.length" class="rounded border border-emerald-400/20 bg-emerald-500/5 p-3">
                <p class="font-medium text-emerald-100">Retained</p>
                <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-300">
                  <li v-for="item in cleanupRetainedItems" :key="item">{{ item }}</li>
                </ul>
              </div>

              <p class="text-slate-400">
                Preview expires {{ formatDateTime(cleanupPreview.expires_at) }}. If it expires or the migration state changes, DUMB refuses cleanup and requires a new preview.
              </p>
              <p v-if="cleanupFinalizesLegacyPaths" class="rounded border border-amber-400/30 bg-amber-500/10 p-3 font-medium text-amber-100">
                This compatibility migration intentionally keeps legacy NzbDAV paths. Finalizing accepts those paths as the completed state and permanently hides the optional full-namespace migration prompt.
              </p>

              <div class="space-y-2 rounded border border-red-400/30 bg-red-500/10 p-3 text-red-100">
                <label class="flex items-start gap-2">
                  <input v-model="acknowledgeCleanupValidation" type="checkbox" class="mt-1" :disabled="cleanupApplying" />
                  <span>I completed the post-migration service, path, library, playback, and seek validation. If I retained legacy paths, I confirm that layout is intentional.</span>
                </label>
                <label class="flex items-start gap-2">
                  <input v-model="acknowledgeCleanupRollbackLoss" type="checkbox" class="mt-1" :disabled="cleanupApplying" />
                  <span>I understand DUMB will permanently delete this migration's job history and recovery bundles, so its automated rollback evidence will no longer be available.</span>
                </label>
              </div>

              <div>
                <label for="infinidysk-cleanup-confirmation" class="font-medium text-red-100">
                  Type {{ INFINIDYSK_MIGRATION_CLEANUP_CONFIRMATION }}
                </label>
                <input
                  id="infinidysk-cleanup-confirmation"
                  v-model="cleanupConfirmation"
                  autocomplete="off"
                  class="mt-2 w-full rounded-md border border-red-400/40 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-300"
                  :placeholder="INFINIDYSK_MIGRATION_CLEANUP_CONFIRMATION"
                  :disabled="cleanupApplying"
                />
              </div>

              <button
                class="button-small border border-red-300/45 bg-red-500/10 hover:stop !px-3 !py-1.5"
                :disabled="cleanupApplying || !cleanupReady"
                @click="cleanupInfiniDyskMigration"
              >
                {{ cleanupApplying ? 'Removing migration data…' : 'Permanently remove migration data' }}
              </button>
            </div>

            <p v-else-if="cleanupPreview" class="rounded border border-amber-400/25 bg-amber-500/5 p-3 text-amber-100">
              DUMB did not authorize cleanup. Refresh migration status and resolve any reported blocker before trying again.
            </p>
          </div>

          <div class="rounded-md border border-slate-700 bg-slate-900/45 p-4 text-xs leading-5">
            Found {{ legacyPathCount }} legacy path reference{{ legacyPathCount === 1 ? '' : 's' }} and
            {{ attachedCount }} attached service name{{ attachedCount === 1 ? '' : 's' }}. DUMB saves private configuration and application snapshots before applying the complete namespace cutover.
          </div>

          <p class="rounded border border-amber-300/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            Complete the selected identity or namespace migration while InfiniDysk still uses SQLite. DUMB blocks both modes once PostgreSQL is selected so a process rename or active-database mismatch cannot disconnect guarded rollback.
          </p>

          <div class="space-y-2 rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
            <p class="font-semibold">Back up your stack before continuing.</p>
            <p class="text-red-100/90">
              Keep a current independent backup outside the paths being migrated, including DUMB configuration, InfiniDysk/NzbDAV state, Arr and Prowlarr databases, media-server configuration, and your symlink library. DUMB creates a private rollback bundle, but it is a recovery aid—not a substitute for your own verified backup.
            </p>
            <label class="flex items-start gap-2"><input v-model="acknowledgeExternalBackup" type="checkbox" class="mt-1" /><span>I have a current, verified backup stored outside the paths DUMB will migrate. I understand DUMB's rollback bundle is not a replacement for that backup.</span></label>
          </div>

          <div v-if="fullNamespaceSelected" class="space-y-3 rounded-md border border-amber-400/30 bg-amber-500/5 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-medium text-amber-100">Guarded namespace preflight</p>
                <p class="mt-1 text-xs leading-5 text-slate-400">
                  DUMB checks active reads, Arr queues, Prowlarr application connections and tags, media-server activity, API access, path conflicts, mounts, and rollback-safe filesystem placement. Transient queue or playback activity is handled by automatic quiescence after you start the job. Nothing moves during preflight.
                </p>
              </div>
              <button class="button-small border border-amber-300/30 hover:apply !px-3 !py-1.5 !text-xs" :disabled="preflighting || jobActive" @click="runPreflight">
                {{ preflighting ? 'Checking…' : (preflight ? 'Run again' : 'Run preflight') }}
              </button>
            </div>

            <div v-if="preflight" class="space-y-3 text-xs leading-5">
              <p :class="preflight.ready ? 'text-emerald-300' : 'text-amber-200'">
                {{ preflight.ready ? (pendingQuiescence.length ? 'Preflight passed. DUMB will wait for and hold safe cutover conditions after the job starts.' : 'Preflight passed. The apply action is unlocked after all acknowledgements.') : 'Preflight is blocked. No changes were made.' }}
              </p>
              <ul v-if="preflight.blockers?.length" class="list-disc space-y-1 pl-5 text-amber-100">
                <li v-for="blocker in preflight.blockers" :key="blocker">{{ blocker }}</li>
              </ul>
              <div v-if="pendingQuiescence.length" class="rounded border border-cyan-400/25 bg-cyan-500/5 p-3 text-cyan-100">
                <p class="font-medium">Activity DUMB will quiesce automatically</p>
                <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-300">
                  <li v-for="condition in pendingQuiescence" :key="condition">{{ condition }}</li>
                </ul>
                <p class="mt-2 text-slate-400">Linked NeutArr, Seerr, Profilarr, and Prowlarr processes stop first. You can resolve failed or held queue entries in each Arr while its producers remain stopped. DUMB latches each managed Arr/media server stopped as soon as it becomes safe, keeps any external Plex API-guarded and idle, waits up to one hour, and aborts without moving paths if activity cannot drain.</p>
              </div>
              <div v-if="externalMediaServers.length" class="rounded border border-violet-400/25 bg-violet-500/5 p-3 text-violet-100">
                <p class="font-medium">External Plex connected through its API</p>
                <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-300">
                  <li v-for="server in externalMediaServers" :key="server.process_name">
                    {{ server.server_name || server.process_name }}<span v-if="server.server_version"> · Plex {{ server.server_version }}</span> — {{ server.library_changes }} affected library path{{ server.library_changes === 1 ? '' : 's' }}
                  </li>
                </ul>
                <p class="mt-2 text-slate-400">DUMB inferred this server from the configured Plex address and token because no managed media server is enabled. It can guard scans and update/validate/restore library paths, but it cannot stop the external Plex process or pause Autoscan.</p>
              </div>
              <details v-if="arrDiscovery.length" class="rounded border border-slate-700 bg-slate-950/35 p-3">
                <summary class="cursor-pointer text-slate-300">Arr migration discovery · {{ includedArrDiscovery.length }} included, {{ excludedArrDiscovery.length }} excluded</summary>
                <div class="mt-3 space-y-3">
                  <div v-if="includedArrDiscovery.length">
                    <p class="font-medium text-emerald-200">Included</p>
                    <ul class="mt-1 space-y-1 text-slate-300">
                      <li v-for="item in includedArrDiscovery" :key="`${item.service_key}-${item.instance_name}`"><strong class="font-medium">{{ item.process_name }}</strong> — {{ item.reasons.join('; ') }}</li>
                    </ul>
                  </div>
                  <div v-if="excludedArrDiscovery.length">
                    <p class="font-medium text-slate-300">Excluded</p>
                    <ul class="mt-1 space-y-1 text-slate-400">
                      <li v-for="item in excludedArrDiscovery" :key="`${item.service_key}-${item.instance_name}`"><strong class="font-medium">{{ item.process_name }}</strong> — {{ item.reasons.join('; ') }}</li>
                    </ul>
                  </div>
                </div>
              </details>
              <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">{{ preflight.filesystem?.length || 0 }} filesystem move{{ preflight.filesystem?.length === 1 ? '' : 's' }}</div>
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">{{ arrChangeCount }} Arr reference update{{ arrChangeCount === 1 ? '' : 's' }}</div>
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">{{ prowlarrChangeCount }} Prowlarr connection/tag update{{ prowlarrChangeCount === 1 ? '' : 's' }}</div>
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">{{ mediaChangeCount }} media-library update{{ mediaChangeCount === 1 ? '' : 's' }}</div>
                <div class="rounded border border-slate-700 bg-slate-950/45 p-2">{{ linkedServiceCount }} linked service{{ linkedServiceCount === 1 ? '' : 's' }} ({{ runningLinkedServiceCount }} running)</div>
              </div>
              <ul v-if="preflight.warnings?.length" class="list-disc space-y-1 pl-5 text-slate-400">
                <li v-for="warning in preflight.warnings" :key="warning">{{ warning }}</li>
              </ul>
            </div>

            <div v-if="fullNamespaceReady" class="space-y-2 border-t border-amber-300/15 pt-3">
              <label class="flex items-start gap-2"><input v-model="acknowledgeDowntime" type="checkbox" class="mt-1" /><span>I understand DUMB will stop linked request/search producers first, wait up to one hour for queues and playback to drain, hold each safe managed service stopped, and then stop/restart InfiniDysk, linked rclone/Arr services, Prowlarr, renamed attached services, and managed media servers. External Plex is API-guarded but must remain idle; DUMB cannot stop it or pause Autoscan.</span></label>
              <label class="flex items-start gap-2"><input v-model="acknowledgeLibraryScan" type="checkbox" class="mt-1" /><span>I will scan the affected Arr and media-server libraries after migration; DUMB updates paths but does not launch scans.</span></label>
              <label class="flex items-start gap-2"><input v-model="acknowledgeRollbackLimits" type="checkbox" class="mt-1" /><span>I understand rollback restores captured paths and configuration, but cannot merge unrelated application changes made during the cutover.</span></label>
            </div>
          </div>

          <div class="space-y-3">
            <label
              v-for="mode in modes"
              :key="mode.id"
              class="block rounded-md border p-4"
              :class="mode.available ? 'cursor-pointer border-slate-600 bg-slate-900/40 hover:border-cyan-400/50' : 'cursor-not-allowed border-slate-800 bg-slate-900/20 opacity-70'"
            >
              <div class="flex items-start gap-3">
                <input v-model="selectedMode" type="radio" :value="mode.id" :disabled="!mode.available" class="mt-1" />
                <div>
                  <div class="flex flex-wrap items-center gap-2 font-medium text-slate-100">
                    {{ mode.title }}
                    <span v-if="mode.recommended" class="rounded bg-cyan-500/15 px-2 py-0.5 text-[11px] text-cyan-100">Recommended</span>
                  </div>
                  <p class="mt-1 text-xs leading-5 text-slate-400">{{ mode.description }}</p>
                  <p v-if="mode.unavailable_reason" class="mt-2 text-xs leading-5 text-amber-200">{{ mode.unavailable_reason }}</p>
                </div>
              </div>
            </label>
          </div>

          <label class="flex items-start gap-3 rounded-md border border-slate-700 bg-slate-900/35 p-4">
            <input v-model="renameAttachedServices" type="checkbox" class="mt-1" />
            <span>
              <span class="block font-medium text-slate-100">Rename DUMB-generated attached service labels</span>
              <span class="mt-1 block text-xs leading-5 text-slate-400">For example, the DUMB-generated “Radarr NzbDAV” instance and process labels become “Radarr InfiniDysk.” Saved dashboard order, shortcuts, and notification filters follow renamed process labels. Custom labels without NzbDAV are left alone. The compatibility path leaves paths and Arr categories unchanged; the complete path rewrites legacy namespace references.</span>
            </span>
          </label>

          <div>
            <label for="infinidysk-confirmation" class="text-xs font-medium text-slate-200">Type MIGRATE TO INFINIDYSK</label>
            <input
              id="infinidysk-confirmation"
              v-model="confirmation"
              autocomplete="off"
              class="mt-2 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
              placeholder="MIGRATE TO INFINIDYSK"
            />
          </div>
        </div>

        <div class="flex flex-wrap justify-end gap-2 border-t border-slate-800 bg-slate-900/40 px-5 py-4">
          <button v-if="!jobActive" class="button-small border border-slate-50/15 hover:stop !px-3 !py-1.5" :disabled="reminding" @click="remindLater">
            Remind me later
          </button>
          <button class="button-small border border-slate-50/15 hover:stop !px-3 !py-1.5" @click="closeModal">{{ jobActive ? 'Close progress' : 'Cancel' }}</button>
          <button
            v-if="!jobActive"
            class="button-small border border-cyan-300/30 hover:apply !px-3 !py-1.5"
            :disabled="applying || selected?.available !== true || confirmation !== 'MIGRATE TO INFINIDYSK' || !acknowledgeExternalBackup || (fullNamespaceSelected && (!fullNamespaceReady || !acknowledgeDowntime || !acknowledgeLibraryScan || !acknowledgeRollbackLimits))"
            @click="applyMigration"
          >
            {{ applying ? (fullNamespaceSelected ? 'Migrating namespace…' : 'Applying…') : 'Apply selected migration' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
