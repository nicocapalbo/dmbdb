<script setup>
import { useConfigStore } from '~/stores/config.js'
import { useUiStore } from '~/stores/ui.js'
import { useGeekMetricsStore } from '~/stores/geekMetrics.js'
import { useLocalStorage } from '@vueuse/core'
import { mergeServiceOrder, orderServicesByPreference } from '~/helper/serviceOrder.js'
import {
  dashboardInstallableNames,
  dashboardUpdateStatus,
  formatDashboardUpdateTiming,
  formatDashboardUpdateStatus,
  installCacheLimitGibFromStatus,
  mergeDashboardUpdateResult,
  normalizeInstallCacheLimitGib,
  orderDashboardInstallNames,
  reconcileDashboardUpdateRows,
} from '~/helper/dashboardUpdates.js'
import useService from '~/services/useService.js'

const processesStore = useProcessesStore()
const configStore = useConfigStore()
const uiStore = useUiStore()
const geekMetricsStore = useGeekMetricsStore()
const { processService, configService } = useService()
const toast = useToast()
const route = useRoute()
const splitViewEnabled = useState('appSplitViewEnabled', () => false)
const splitPanePath = useState('appSplitPanePath', () => '/')
const touchReorderUnlocked = useLocalStorage('dashboard.touchReorderUnlocked', false)

const draggedServiceName = ref('')
const touchDraggingServiceName = ref('')
const isReordering = ref(false)
const reorderDirty = ref(false)
const persistInFlight = ref(false)
const backendCapabilities = ref(null)
// Keep an in-flight dashboard operation outside the modal/page instance. Closing
// the panel (or briefly navigating away) must not orphan its progress UI while
// the existing API request continues in the background.
const dashboardUpdateRows = useState('dashboardUpdateRows', () => [])
const selectedUpdateNames = useState('dashboardSelectedUpdateNames', () => [])
const updatesPanelOpen = ref(false)
const updateInventoryLoading = ref(false)
const checkingAllUpdates = useState('dashboardCheckingAllUpdates', () => false)
const installingUpdates = useState('dashboardInstallingUpdates', () => false)
const updateProgress = useState('dashboardUpdateProgress', () => '')
const installCacheStatus = ref(null)
const installCacheLoading = ref(false)
const installCacheAction = ref('')
const installCacheCleanupScope = ref('legacy')
const installCacheLimitGib = ref(25)
const installCacheLimitDirty = ref(false)
let dashboardUpdateRefreshTimer = null
const enabledProcesses = computed(() => {
  return orderServicesByPreference(
    processesStore.enabledProcesses || [],
    uiStore.sidebarPreferences?.service_order || []
  )
})
const displayedProcesses = ref([])
const geekModeEnabled = computed(() => !!uiStore.sidebarPreferences?.geek_mode)
const dashboardUpdatesSupported = computed(() => backendCapabilities.value?.dashboard_bulk_updates === true)
const updateTimingSupported = computed(() => backendCapabilities.value?.update_timing_metrics === true)
const installCacheSupported = computed(() => backendCapabilities.value?.install_cache_management === true)
const installCacheCleanupSupported = computed(() => backendCapabilities.value?.install_cache_cleanup === true)
const installCacheLimitSupported = computed(() => backendCapabilities.value?.install_cache_limit_settings === true)
const dashboardUpdateBusy = computed(() => checkingAllUpdates.value || installingUpdates.value)
const updateRowsByProcessName = computed(() => new Map(
  dashboardUpdateRows.value.map((row) => [row.process_name, row])
))
const availableUpdateNames = computed(() => dashboardInstallableNames(dashboardUpdateRows.value))
const availableUpdateCount = computed(() => availableUpdateNames.value.length)
const selectedInstallableNames = computed(() => {
  const available = new Set(availableUpdateNames.value)
  return selectedUpdateNames.value.filter((name) => available.has(name))
})
const installCacheCleanupOptions = [
  { value: 'legacy', label: 'Legacy release caches', scopes: ['legacy'], impact: 'old DUMB package-manager caches only' },
  { value: 'quarantine', label: 'Quarantined entries', scopes: ['quarantine'], impact: 'known invalid entries only' },
  { value: 'artifacts', label: 'Compiled artifacts', scopes: ['artifacts'], impact: 'future reinstalls must rebuild' },
  { value: 'downloads', label: 'Verified downloads', scopes: ['downloads'], impact: 'future installs must download again' },
  { value: 'dependencies', label: 'Dependency caches', scopes: ['dependencies'], impact: 'future builds must restore dependencies again' },
  { value: 'all', label: 'All rebuildable cache', scopes: ['downloads', 'dependencies', 'artifacts', 'quarantine', 'legacy'], impact: 'future installs start with cold caches' },
]
const selectedInstallCacheCleanup = computed(() => (
  installCacheCleanupOptions.find((option) => option.value === installCacheCleanupScope.value)
  || installCacheCleanupOptions[0]
))

const errorMessage = (error, fallback) => String(
  error?.response?.data?.detail
  || error?.response?.data?.message
  || error?.message
  || fallback
)

const formatBytes = (value) => {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

const refreshInstallCacheStatus = async () => {
  if (!installCacheSupported.value) return
  installCacheLoading.value = true
  try {
    installCacheStatus.value = await processService.getInstallCacheStatus()
    if (!installCacheLimitDirty.value) {
      installCacheLimitGib.value = installCacheLimitGibFromStatus(installCacheStatus.value)
    }
  } catch (error) {
    console.warn('Install cache status is unavailable:', error)
  } finally {
    installCacheLoading.value = false
  }
}

const saveInstallCacheLimit = async () => {
  if (installCacheAction.value || !installCacheLimitSupported.value) return
  const normalized = normalizeInstallCacheLimitGib(installCacheLimitGib.value)
  if (normalized == null) {
    toast.error({ title: 'Invalid cache limit', message: 'Enter a value from 1 through 1024 GiB.' })
    return
  }
  installCacheAction.value = 'limit'
  try {
    await configService.updateGlobalConfig({
      dumb: { install_cache: { max_size_gib: normalized } },
    })
    installCacheLimitGib.value = normalized
    installCacheLimitDirty.value = false
    toast.success({
      title: 'Cache limit saved',
      message: 'The managed install-cache target was updated. Use “Prune to limit” to reclaim excess space now.',
    })
    await refreshInstallCacheStatus()
  } catch (error) {
    toast.error({ title: 'Save failed', message: errorMessage(error, 'Could not save the install-cache limit.') })
  } finally {
    installCacheAction.value = ''
  }
}

const verifyInstallCache = async () => {
  if (installCacheAction.value) return
  installCacheAction.value = 'verify'
  try {
    const result = await processService.verifyInstallCache()
    toast.success({
      title: 'Cache verification complete',
      message: `${result.checked || 0} download objects checked; ${result.quarantined || 0} quarantined.`,
    })
    await refreshInstallCacheStatus()
  } catch (error) {
    toast.error({ title: 'Verification failed', message: errorMessage(error, 'Could not verify the install cache.') })
  } finally {
    installCacheAction.value = ''
  }
}

const pruneInstallCache = async () => {
  if (installCacheAction.value) return
  if (!window.confirm('Prune least-recently-used downloads, dependency-cache buckets, build artifacts, and quarantined entries until the configured cache limit is met? Active runtimes and service data are never removed.')) return
  installCacheAction.value = 'prune'
  try {
    const result = await processService.pruneInstallCache()
    toast.success({ title: 'Install cache pruned', message: `${formatBytes(result.reclaimed_bytes)} reclaimed.` })
    await refreshInstallCacheStatus()
  } catch (error) {
    toast.error({ title: 'Prune failed', message: errorMessage(error, 'Could not prune the install cache.') })
  } finally {
    installCacheAction.value = ''
  }
}

const clearInstallArtifacts = async () => {
  if (installCacheAction.value) return
  if (!window.confirm('Clear cached compiled service artifacts? Dependency and download caches remain available, but the next reinstall must rebuild. Active services are not changed.')) return
  installCacheAction.value = 'clear'
  try {
    const result = await processService.clearInstallArtifacts()
    toast.success({ title: 'Build artifacts cleared', message: `${formatBytes(result.removed_bytes)} removed. The next reinstall will build cleanly.` })
    await refreshInstallCacheStatus()
  } catch (error) {
    toast.error({ title: 'Clear failed', message: errorMessage(error, 'Could not clear build artifacts.') })
  } finally {
    installCacheAction.value = ''
  }
}

const cleanupInstallCache = async () => {
  if (installCacheAction.value || !installCacheCleanupSupported.value) return
  const selection = selectedInstallCacheCleanup.value
  if (!window.confirm(`Clean ${selection.label.toLowerCase()}? This removes ${selection.impact}. Active runtimes, configuration, databases, and media are never removed.`)) return
  installCacheAction.value = 'cleanup'
  try {
    const result = await processService.cleanupInstallCache(selection.scopes)
    const warning = result.errors?.length ? ` ${result.errors.length} entries could not be removed safely.` : ''
    toast.success({
      title: 'Install cache cleanup complete',
      message: `${formatBytes(result.removed_bytes)} reclaimed.${warning}`,
    })
    await refreshInstallCacheStatus()
  } catch (error) {
    toast.error({ title: 'Cleanup failed', message: errorMessage(error, 'Could not clean the selected install cache.') })
  } finally {
    installCacheAction.value = ''
  }
}

const updateStatusClass = (row) => ({
  update_available: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  updated: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  up_to_date: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  no_update: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  blocked: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  deferred: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
}[row?.operation === 'error' ? 'error' : row?.operation === 'deferred' ? 'deferred' : dashboardUpdateStatus(row)]
  || 'border-slate-600/60 bg-slate-800 text-slate-300')

const refreshDashboardUpdateInventory = async (refreshProcesses = false) => {
  if (!dashboardUpdatesSupported.value) return
  updateInventoryLoading.value = true
  try {
    if (refreshProcesses) await processesStore.getProcesses()
    dashboardUpdateRows.value = reconcileDashboardUpdateRows(
      processesStore.getProcessesList,
      dashboardUpdateRows.value,
      dashboardUpdateBusy.value,
    )
    const available = new Set(dashboardInstallableNames(dashboardUpdateRows.value))
    selectedUpdateNames.value = selectedUpdateNames.value.filter((name) => available.has(name))
  } catch (error) {
    console.error('Failed to load dashboard update inventory:', error)
    toast.error({ title: 'Updates unavailable', message: 'Could not load service update status.' })
  } finally {
    updateInventoryLoading.value = false
  }
}

const initializeDashboardUpdates = async () => {
  try {
    backendCapabilities.value = await processService.getCapabilities()
    if (dashboardUpdatesSupported.value) await refreshDashboardUpdateInventory(true)
  } catch (error) {
    console.warn('Dashboard bulk updates are unavailable on this backend:', error)
  }
}

const setDashboardUpdateResult = (processName, payload, operation = 'idle', error = '') => {
  dashboardUpdateRows.value = mergeDashboardUpdateResult(
    dashboardUpdateRows.value,
    processName,
    payload,
    operation,
    error,
  )
}

const openUpdatesPanel = async () => {
  updatesPanelOpen.value = true
  await Promise.all([
    refreshDashboardUpdateInventory(false),
    refreshInstallCacheStatus(),
  ])
}

const closeUpdatesPanel = () => {
  if (
    dashboardUpdateBusy.value
    && !window.confirm('The update operation will keep running in the background. Reopen Updates at any time to see its current progress. Close the progress panel?')
  ) return
  updatesPanelOpen.value = false
}

const checkAllDashboardUpdates = async () => {
  if (dashboardUpdateBusy.value || !dashboardUpdateRows.value.length) return
  checkingAllUpdates.value = true
  selectedUpdateNames.value = []
  let failures = 0
  try {
    for (const [index, row] of dashboardUpdateRows.value.entries()) {
      updateProgress.value = `Checking ${index + 1} of ${dashboardUpdateRows.value.length}: ${row.display_name || row.process_name}`
      setDashboardUpdateResult(row.process_name, row.update_status, 'checking')
      try {
        const payload = await processService.runUpdateCheck(row.process_name, true)
        setDashboardUpdateResult(row.process_name, payload)
        if (payload?.status === 'error') failures += 1
      } catch (error) {
        failures += 1
        const message = errorMessage(error, 'Update check failed.')
        setDashboardUpdateResult(row.process_name, row.update_status, 'error', message)
      }
    }
    selectedUpdateNames.value = dashboardInstallableNames(dashboardUpdateRows.value)
    const count = availableUpdateCount.value
    toast.success({
      title: 'Update check complete',
      message: `${count} update${count === 1 ? '' : 's'} available${failures ? `; ${failures} check${failures === 1 ? '' : 's'} failed` : ''}.`,
    })
  } finally {
    checkingAllUpdates.value = false
    updateProgress.value = ''
  }
}

const installDashboardUpdates = async (requestedNames) => {
  const names = orderDashboardInstallNames(requestedNames, dashboardUpdateRows.value)
  if (dashboardUpdateBusy.value || !names.length) return
  installingUpdates.value = true
  let updated = 0
  let failed = 0
  let deferred = 0
  try {
    for (const [index, processName] of names.entries()) {
      const row = updateRowsByProcessName.value.get(processName)
      updateProgress.value = `Installing ${index + 1} of ${names.length}: ${row?.display_name || processName}`
      setDashboardUpdateResult(processName, row?.update_status, 'installing')
      try {
        const payload = await processService.runUpdateInstall(processName, false)
        if (payload?.status === 'updated') {
          updated += 1
          setDashboardUpdateResult(processName, payload)
        } else if (payload?.status === 'protection_required') {
          deferred += 1
          setDashboardUpdateResult(
            processName,
            {
              ...payload,
              message: 'Deferred by Media Library Protection. Review active streams and overrides on the service page.',
            },
            'deferred',
          )
        } else {
          failed += 1
          setDashboardUpdateResult(
            processName,
            payload,
            'error',
            payload?.message || 'The update was not installed.',
          )
        }
      } catch (error) {
        failed += 1
        const message = errorMessage(error, 'Update install failed.')
        setDashboardUpdateResult(processName, row?.update_status, 'error', message)
      }
    }
    selectedUpdateNames.value = []
    if (updated) {
      toast.success({
        title: 'Updates complete',
        message: `${updated} service${updated === 1 ? '' : 's'} updated${deferred ? `; ${deferred} deferred by library protection` : ''}${failed ? `; ${failed} failed` : ''}. Verify service health before continuing.`,
      })
    } else if (deferred) {
      toast.warning({
        title: 'Updates deferred',
        message: `${deferred} update${deferred === 1 ? ' was' : 's were'} deferred to protect active or unknown media-server activity.`,
      })
    } else if (failed) {
      toast.error({ title: 'Updates failed', message: `${failed} service update${failed === 1 ? '' : 's'} failed.` })
    }
  } finally {
    installingUpdates.value = false
    updateProgress.value = ''
    try {
      await refreshDashboardUpdateInventory(true)
    } catch {
      // A DUMB API self-update can briefly interrupt this final refresh.
    }
  }
}

const installSelectedDashboardUpdates = async () => {
  const names = selectedInstallableNames.value
  if (!names.length) return
  const confirmed = window.confirm(
    `Install ${names.length} selected update${names.length === 1 ? '' : 's'} sequentially? Services will restart and may be briefly unavailable.`,
  )
  if (!confirmed) return
  await installDashboardUpdates(names)
}

const installDashboardServiceUpdate = async (service) => {
  const processName = String(service?.process_name || '').trim()
  const row = updateRowsByProcessName.value.get(processName)
  if (!processName || dashboardUpdateStatus(row) !== 'update_available') return
  const version = String(row?.update_status?.available_version || '').trim()
  const confirmed = window.confirm(
    `Install ${version || 'the available update'} for ${row?.display_name || processName}? The service will restart.`,
  )
  if (!confirmed) return
  await installDashboardUpdates([processName])
}

const selectAllAvailableUpdates = () => {
  selectedUpdateNames.value = [...availableUpdateNames.value]
}

const toggleSplitView = () => {
  splitViewEnabled.value = !splitViewEnabled.value
  if (splitViewEnabled.value) {
    splitPanePath.value = route.fullPath || '/'
  }
}

const toggleTouchReorderLock = () => {
  touchReorderUnlocked.value = !touchReorderUnlocked.value
}

const persistServiceOrder = async (orderedVisibleServices) => {
  const visibleOrderedNames = (orderedVisibleServices || [])
    .map((service) => String(service?.process_name || '').trim())
    .filter(Boolean)
  const allServiceNames = (processesStore.getProcessesList || [])
    .map((service) => String(service?.process_name || '').trim())
    .filter(Boolean)
  const existingOrder = uiStore.sidebarPreferences?.service_order || []
  const nextOrder = mergeServiceOrder({ visibleOrderedNames, allServiceNames, existingOrder })
  if (JSON.stringify(nextOrder) === JSON.stringify(existingOrder)) return

  const nextPrefs = {
    ...(uiStore.sidebarPreferences || {}),
    service_order: nextOrder,
  }
  try {
    await uiStore.saveSidebarPreferences(nextPrefs)
  } catch (error) {
    console.error('Failed to save service order:', error)
    toast.error({ title: 'Save failed', message: 'Could not persist tile order.' })
  }
}

const reorderDisplayedByName = (sourceName, targetName) => {
  if (!sourceName || !targetName || sourceName === targetName) return
  const current = [...displayedProcesses.value]
  const sourceIndex = current.findIndex((service) => service?.process_name === sourceName)
  const targetIndex = current.findIndex((service) => service?.process_name === targetName)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
  const [moved] = current.splice(sourceIndex, 1)
  current.splice(targetIndex, 0, moved)
  displayedProcesses.value = current
  reorderDirty.value = true
}

const onTileDragStart = (service, event) => {
  const name = String(service?.process_name || '').trim()
  if (!name) return
  isReordering.value = true
  draggedServiceName.value = name
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', name)
  }
}

const onTileDragOver = (targetService, event) => {
  const targetName = String(targetService?.process_name || '').trim()
  if (!targetName || !draggedServiceName.value || targetName === draggedServiceName.value) return
  event.preventDefault()
  if (event?.dataTransfer) event.dataTransfer.dropEffect = 'move'
  reorderDisplayedByName(draggedServiceName.value, targetName)
}

const onTileDrop = async (targetService, event) => {
  const targetName = String(targetService?.process_name || '').trim()
  const sourceName = draggedServiceName.value
    || String(event?.dataTransfer?.getData('text/plain') || '').trim()
  try {
    if (event?.preventDefault) event.preventDefault()
    if (sourceName && targetName && sourceName !== targetName) {
      reorderDisplayedByName(sourceName, targetName)
    }
    if (reorderDirty.value && !persistInFlight.value) {
      persistInFlight.value = true
      await persistServiceOrder(displayedProcesses.value)
      reorderDirty.value = false
    }
  } finally {
    persistInFlight.value = false
    draggedServiceName.value = ''
    isReordering.value = false
  }
}

const onTileDragEnd = async () => {
  if (reorderDirty.value && !persistInFlight.value) {
    try {
      persistInFlight.value = true
      await persistServiceOrder(displayedProcesses.value)
      reorderDirty.value = false
    } finally {
      persistInFlight.value = false
    }
  }
  draggedServiceName.value = ''
  isReordering.value = false
}

const onDragHandleTouchStart = (service, event) => {
  if (!touchReorderUnlocked.value) return
  const name = String(service?.process_name || '').trim()
  if (!name) return
  touchDraggingServiceName.value = name
  draggedServiceName.value = name
  isReordering.value = true
  if (event?.cancelable) event.preventDefault()
}

const onTileTouchMove = (event) => {
  if (!touchReorderUnlocked.value) return
  if (!touchDraggingServiceName.value) return
  const touch = event?.touches?.[0]
  if (!touch) return
  const target = document.elementFromPoint(touch.clientX, touch.clientY)
  const tile = target?.closest?.('[data-service-name]')
  const targetName = String(tile?.dataset?.serviceName || '').trim()
  if (targetName) {
    reorderDisplayedByName(touchDraggingServiceName.value, targetName)
  }
  if (event?.cancelable) event.preventDefault()
}

const onTileTouchEnd = async () => {
  if (!touchReorderUnlocked.value) return
  if (!touchDraggingServiceName.value) return
  if (reorderDirty.value) {
    await persistServiceOrder(displayedProcesses.value)
    reorderDirty.value = false
  }
  touchDraggingServiceName.value = ''
  draggedServiceName.value = ''
  isReordering.value = false
}

watch(enabledProcesses, (next) => {
  if (isReordering.value) return
  displayedProcesses.value = [...(next || [])]
}, { immediate: true })

watch(geekModeEnabled, (enabled) => {
  if (enabled) geekMetricsStore.startPolling(5000)
  else geekMetricsStore.stopPolling()
}, { immediate: true })

onMounted(() => {
  configStore.loadAutoRestartPolicy()
  uiStore.loadSidebarPreferences()
  initializeDashboardUpdates()
  dashboardUpdateRefreshTimer = setInterval(() => {
    if (
      dashboardUpdatesSupported.value
      && !dashboardUpdateBusy.value
      && !updateInventoryLoading.value
    ) {
      refreshDashboardUpdateInventory(true)
    }
  }, 60_000)
})

onUnmounted(() => {
  geekMetricsStore.stopPolling()
  if (dashboardUpdateRefreshTimer) clearInterval(dashboardUpdateRefreshTimer)
  dashboardUpdateRefreshTimer = null
})
</script>

<template>
  <div class="relative min-h-full text-white bg-gray-900 flex flex-col gap-8 px-4 py-4 md:px-8">
    <InfoBar />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-4xl font-bold">Service Dashboard</h1>
        <p class="text-xs text-slate-400 mt-1">
          Drag tiles to reorder your dashboard and sidebar.
          <span class="md:hidden">
            Touch reorder is {{ touchReorderUnlocked ? 'unlocked' : 'locked' }}.
          </span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="dashboardUpdatesSupported"
          class="button-small border border-emerald-500/30 hover:start !py-2 !px-3 !gap-1"
          title="Check, review, and install updates for enabled services."
          @click="openUpdatesPanel"
        >
          <span
            class="material-symbols-rounded !text-[18px]"
            :class="dashboardUpdateBusy ? 'animate-spin' : ''"
          >{{ dashboardUpdateBusy ? 'sync' : 'system_update_alt' }}</span>
          <span>{{ dashboardUpdateBusy ? 'Updates running' : 'Updates' }}</span>
          <span
            v-if="availableUpdateCount"
            class="min-w-5 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[10px] font-bold text-emerald-950"
          >
            {{ availableUpdateCount }}
          </span>
        </button>
        <button
          class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1 md:hidden"
          :title="touchReorderUnlocked ? 'Lock touch reordering' : 'Unlock touch reordering'"
          @click="toggleTouchReorderLock"
        >
          <span class="material-symbols-rounded !text-[18px]">
            {{ touchReorderUnlocked ? 'lock_open' : 'lock' }}
          </span>
          <span>{{ touchReorderUnlocked ? 'Reorder On' : 'Reorder Off' }}</span>
        </button>
        <button
          class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1"
          @click="toggleSplitView"
        >
          <span class="material-symbols-rounded !text-[18px]">
            {{ splitViewEnabled ? 'splitscreen' : 'splitscreen_right' }}
          </span>
          <span>{{ splitViewEnabled ? 'Exit Split' : 'Split View' }}</span>
        </button>
      </div>
    </div>

    <button
      v-if="dashboardUpdateBusy && !updatesPanelOpen"
      type="button"
      class="flex w-full items-center gap-3 rounded-lg border border-sky-700/60 bg-sky-950/35 px-4 py-3 text-left text-sm text-sky-100 hover:bg-sky-950/55"
      @click="openUpdatesPanel"
    >
      <span class="material-symbols-rounded animate-spin">sync</span>
      <span class="min-w-0 flex-1">
        <span class="block font-medium">Service updates are continuing in the background</span>
        <span class="block truncate text-xs text-sky-200/80">{{ updateProgress || 'Waiting for the current update request...' }}</span>
      </span>
      <span class="text-xs font-medium">Open progress</span>
    </button>
    <div
      v-if="displayedProcesses?.length"
      class="grid grid-cols-1 lg:grid-cols-2 gap-4"
      @touchmove="onTileTouchMove"
      @touchend="onTileTouchEnd"
      @touchcancel="onTileTouchEnd"
    >
      <div
        v-for="service in displayedProcesses"
        :key="service.process_name"
        draggable="true"
        :data-service-name="service.process_name"
        class="w-full cursor-grab active:cursor-grabbing transition-transform duration-150"
        :class="draggedServiceName === service.process_name ? 'opacity-75 scale-[0.99]' : ''"
        @dragstart="onTileDragStart(service, $event)"
        @dragover="onTileDragOver(service, $event)"
        @drop="onTileDrop(service, $event)"
        @dragend="onTileDragEnd"
      >
        <ServiceCard
          :process="service"
          :geek-metrics="geekModeEnabled ? geekMetricsStore.metricsByProcessName[service.process_name] : null"
          :database-health="geekModeEnabled ? geekMetricsStore.databaseHealthByProcessName[service.process_name] : null"
          :show-drag-handle="true"
          :update-status="updateRowsByProcessName.get(service.process_name)?.update_status || null"
          :update-loading="updateRowsByProcessName.get(service.process_name)?.operation === 'installing'"
          @drag-handle-touchstart="onDragHandleTouchStart(service, $event)"
          @install-update="installDashboardServiceUpdate(service)"
        />
      </div>
    </div>

    <div
      v-if="updatesPanelOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3"
      @click.self="closeUpdatesPanel"
    >
      <section class="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <header class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 p-4">
          <div>
            <h2 class="text-lg font-semibold text-white">Service updates</h2>
            <p class="mt-1 text-xs text-slate-400">
              Check enabled services, select ordinary available updates, and install them sequentially.
              Scheduled check-only results remain visible here and in the Updates badge.
              Pinned or custom source targets require review on the service page.
            </p>
          </div>
          <button
            class="material-symbols-rounded rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Close service updates."
            @click="closeUpdatesPanel"
          >
            close
          </button>
        </header>

        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/70 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <button
              class="button-small border border-slate-500/40 hover:apply !px-3 !py-2 !gap-1"
              :disabled="dashboardUpdateBusy || updateInventoryLoading || !dashboardUpdateRows.length"
              @click="checkAllDashboardUpdates"
            >
              <span class="material-symbols-rounded !text-[18px]" :class="checkingAllUpdates ? 'animate-spin' : ''">sync</span>
              <span>{{ checkingAllUpdates ? 'Checking...' : 'Check all' }}</span>
            </button>
            <button
              class="button-small border border-slate-500/40 hover:apply !px-3 !py-2 !gap-1"
              :disabled="dashboardUpdateBusy || !availableUpdateCount"
              @click="selectAllAvailableUpdates"
            >
              Select available
            </button>
            <button
              class="button-small border border-emerald-500/40 hover:start !px-3 !py-2 !gap-1"
              :disabled="dashboardUpdateBusy || !selectedInstallableNames.length"
              @click="installSelectedDashboardUpdates"
            >
              <span class="material-symbols-rounded !text-[18px]" :class="installingUpdates ? 'animate-spin' : ''">
                {{ installingUpdates ? 'sync' : 'download' }}
              </span>
              <span>{{ installingUpdates ? 'Installation running' : `Install selected (${selectedInstallableNames.length})` }}</span>
            </button>
          </div>
          <div class="text-xs text-slate-400">
            {{ availableUpdateCount }} available · {{ dashboardUpdateRows.length }} update-capable
          </div>
        </div>

        <div v-if="updateProgress" class="border-b border-slate-700/70 bg-sky-950/30 px-4 py-2 text-xs text-sky-200">
          <div>{{ updateProgress }}</div>
          <div class="mt-0.5 text-sky-300/70">Closing this panel does not stop the update; reopen it to resume this progress view.</div>
        </div>

        <details
          v-if="installCacheSupported"
          class="border-b border-slate-700/70 bg-slate-950/30 px-4 py-3"
        >
          <summary class="cursor-pointer text-sm font-medium text-slate-200">
            Install cache
            <span v-if="installCacheStatus" class="ml-2 text-xs font-normal text-slate-400">
              {{ formatBytes(installCacheStatus.total_bytes) }} total
            </span>
          </summary>
          <div class="mt-3 space-y-3 text-xs text-slate-400">
            <p>
              DUMB verifies cached downloads and compiled artifacts before use. Invalid entries are quarantined and rebuilt; active runtimes, configuration, databases, and media are outside this cache.
            </p>
            <div v-if="installCacheLoading" class="text-slate-300">Loading cache status...</div>
            <template v-else-if="installCacheStatus">
              <div
                v-if="installCacheStatus.using_fallback"
                class="rounded border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-amber-100"
              >
                <div class="font-medium">Configured install cache is unavailable</div>
                <div class="mt-1 text-amber-200/80">
                  DUMB could not safely use
                  <span class="break-all">{{ installCacheStatus.configured_path }}</span>
                  and is using the isolated temporary cache
                  <span class="break-all">{{ installCacheStatus.path }}</span>
                  for this process. Active services are unaffected, but this fallback cache will not be reused after DUMB restarts.
                </div>
                <div v-if="installCacheStatus.fallback_reason" class="mt-1 break-all text-amber-300/70">
                  Reason: {{ installCacheStatus.fallback_reason }}
                </div>
              </div>
              <div class="grid gap-2 sm:grid-cols-3">
                <div class="rounded border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <div class="text-slate-200">Managed cache</div>
                  <div>{{ formatBytes(installCacheStatus.managed_bytes ?? installCacheStatus.total_bytes) }} / {{ formatBytes(installCacheStatus.max_size_bytes) }} limit</div>
                </div>
                <div class="rounded border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <div class="text-slate-200">Legacy release caches</div>
                  <div>{{ formatBytes(installCacheStatus.legacy_bytes) }} · {{ installCacheStatus.legacy_files || 0 }} files</div>
                </div>
                <div class="rounded border border-sky-700/60 bg-sky-950/30 px-3 py-2">
                  <div class="text-sky-100">Combined install cache</div>
                  <div>{{ formatBytes(installCacheStatus.total_bytes) }}</div>
                </div>
              </div>
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div
                  v-for="(namespace, name) in installCacheStatus.namespaces"
                  :key="name"
                  class="rounded border border-slate-700 bg-slate-900/70 px-3 py-2"
                >
                  <div class="capitalize text-slate-200">{{ name }}</div>
                  <div>{{ formatBytes(namespace.bytes) }} · {{ namespace.files }} files</div>
                </div>
              </div>
              <details v-if="installCacheStatus.legacy_entries?.length" class="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2">
                <summary class="cursor-pointer text-amber-200">
                  {{ installCacheStatus.legacy_entries.length }} legacy cache location{{ installCacheStatus.legacy_entries.length === 1 ? '' : 's' }} found
                </summary>
                <div class="mt-2 space-y-1">
                  <div v-for="entry in installCacheStatus.legacy_entries" :key="entry.path" class="break-all">
                    <span class="text-slate-200">{{ entry.label }}</span>
                    · {{ formatBytes(entry.bytes) }} · {{ entry.path }}
                  </div>
                </div>
              </details>
            </template>
            <div
              v-if="installCacheLimitSupported"
              class="flex flex-col gap-2 rounded border border-slate-700 bg-slate-900/50 p-3 sm:flex-row sm:items-center"
            >
              <label for="install-cache-limit-gib" class="text-slate-200">Managed cache limit</label>
              <div class="flex items-center gap-2">
                <input
                  id="install-cache-limit-gib"
                  v-model="installCacheLimitGib"
                  type="number"
                  min="1"
                  max="1024"
                  step="1"
                  class="w-28 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-slate-200"
                  :disabled="!!installCacheAction"
                  @input="installCacheLimitDirty = true"
                />
                <span>GiB</span>
              </div>
              <span class="min-w-0 flex-1 text-slate-400">
                Saving changes the pruning target; it does not remove active runtimes or service data.
              </span>
              <button
                class="button-small border border-sky-500/40 hover:apply !px-3 !py-2"
                :disabled="!!installCacheAction || !installCacheLimitDirty"
                title="Persist dumb.install_cache.max_size_gib. Prune separately to reclaim space immediately."
                @click="saveInstallCacheLimit"
              >
                {{ installCacheAction === 'limit' ? 'Saving...' : 'Save limit' }}
              </button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                class="button-small border border-slate-500/40 hover:apply !px-3 !py-2"
                :disabled="!!installCacheAction"
                title="Hash every cached download object and quarantine corrupt entries."
                @click="verifyInstallCache"
              >
                {{ installCacheAction === 'verify' ? 'Verifying...' : 'Verify downloads' }}
              </button>
              <button
                class="button-small border border-slate-500/40 hover:apply !px-3 !py-2"
                :disabled="!!installCacheAction"
                title="Remove least-recently-used entries only when the configured cache limit is exceeded."
                @click="pruneInstallCache"
              >
                {{ installCacheAction === 'prune' ? 'Pruning...' : 'Prune to limit' }}
              </button>
              <button
                class="button-small border border-amber-500/40 hover:stop !px-3 !py-2"
                :disabled="!!installCacheAction"
                title="Force future reinstalls to compile again without touching active service runtimes."
                @click="clearInstallArtifacts"
              >
                {{ installCacheAction === 'clear' ? 'Clearing...' : 'Clear build artifacts' }}
              </button>
            </div>
            <div v-if="installCacheCleanupSupported" class="flex flex-col gap-2 rounded border border-slate-700 bg-slate-900/50 p-3 sm:flex-row sm:items-center">
              <label for="install-cache-cleanup-scope" class="text-slate-200">Cleanup scope</label>
              <select
                id="install-cache-cleanup-scope"
                v-model="installCacheCleanupScope"
                class="min-w-0 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-slate-200 sm:min-w-56"
                :disabled="!!installCacheAction"
              >
                <option v-for="option in installCacheCleanupOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <span class="min-w-0 flex-1 text-slate-400">Removes {{ selectedInstallCacheCleanup.impact }}.</span>
              <button
                class="button-small border border-rose-500/40 hover:stop !px-3 !py-2"
                :disabled="!!installCacheAction"
                title="Remove only the selected DUMB-owned cache scope after confirmation."
                @click="cleanupInstallCache"
              >
                {{ installCacheAction === 'cleanup' ? 'Cleaning...' : 'Clean selected cache' }}
              </button>
            </div>
          </div>
        </details>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <div v-if="updateInventoryLoading" class="p-8 text-center text-sm text-slate-400">
            Loading service update status...
          </div>
          <div v-else-if="!dashboardUpdateRows.length" class="p-8 text-center text-sm text-slate-400">
            No enabled services report manual update support.
          </div>
          <div v-else class="space-y-2">
            <article
              v-for="row in dashboardUpdateRows"
              :key="row.process_name"
              class="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-slate-700 bg-slate-800/70 p-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center"
            >
              <input
                v-model="selectedUpdateNames"
                type="checkbox"
                :value="row.process_name"
                :disabled="dashboardUpdateBusy || dashboardUpdateStatus(row) !== 'update_available'"
                class="mt-1 size-4 accent-emerald-500 md:mt-0"
                :title="dashboardUpdateStatus(row) === 'blocked' ? 'Review the saved source target on this service page.' : 'Select this update.'"
              />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-slate-100">{{ row.display_name || row.process_name }}</span>
                  <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="updateStatusClass(row)">
                    {{ formatDashboardUpdateStatus(row) }}
                  </span>
                </div>
                <div class="mt-1 text-xs text-slate-400">
                  Current: {{ row.update_status?.current_version || row.current_version || 'unknown' }}
                  <template v-if="row.update_status?.available_version">
                    · Available: <span class="text-slate-200">{{ row.update_status.available_version }}</span>
                  </template>
                </div>
                <div v-if="row.error || row.update_status?.message" class="mt-1 text-xs" :class="row.error ? 'text-rose-200' : 'text-slate-400'">
                  {{ row.error || row.update_status.message }}
                </div>
                <div
                  v-if="updateTimingSupported && formatDashboardUpdateTiming(row.update_status)"
                  class="mt-1 text-xs font-medium"
                  :class="row.update_status?.downtime_status === 'ongoing' ? 'text-rose-200' : 'text-emerald-200'"
                  title="Install is the complete update operation. Downtime is measured from stopping the old service until an application readiness probe succeeds."
                >
                  {{ formatDashboardUpdateTiming(row.update_status) }}
                </div>
              </div>
              <NuxtLink
                :to="{ name: 'services-serviceId', params: { serviceId: row.process_name } }"
                class="col-start-2 text-xs text-sky-300 hover:text-sky-200 md:col-start-auto"
                @click="updatesPanelOpen = false"
              >
                Review service
              </NuxtLink>
            </article>
          </div>
        </div>

        <footer class="border-t border-slate-700 px-4 py-3 text-xs text-slate-400">
          Checking does not restart services. Installing does; DUMB Frontend and DUMB API are ordered last so the dashboard can keep reporting progress as long as possible.
        </footer>
      </section>
    </div>

  </div>
</template>
