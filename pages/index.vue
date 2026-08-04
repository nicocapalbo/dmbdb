<script setup>
import { useConfigStore } from '~/stores/config.js'
import { useUiStore } from '~/stores/ui.js'
import { useGeekMetricsStore } from '~/stores/geekMetrics.js'
import { useLocalStorage } from '@vueuse/core'
import { mergeServiceOrder, orderServicesByPreference } from '~/helper/serviceOrder.js'
import {
  createDashboardUpdateRows,
  dashboardInstallableNames,
  dashboardUpdateStatus,
  formatDashboardUpdateStatus,
  mergeDashboardUpdateResult,
  orderDashboardInstallNames,
} from '~/helper/dashboardUpdates.js'
import useService from '~/services/useService.js'

const processesStore = useProcessesStore()
const configStore = useConfigStore()
const uiStore = useUiStore()
const geekMetricsStore = useGeekMetricsStore()
const { processService } = useService()
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
const dashboardUpdateRows = ref([])
const selectedUpdateNames = ref([])
const updatesPanelOpen = ref(false)
const updateInventoryLoading = ref(false)
const checkingAllUpdates = ref(false)
const installingUpdates = ref(false)
const updateProgress = ref('')
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

const errorMessage = (error, fallback) => String(
  error?.response?.data?.detail
  || error?.response?.data?.message
  || error?.message
  || fallback
)

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
    dashboardUpdateRows.value = createDashboardUpdateRows(processesStore.getProcessesList)
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
  await refreshDashboardUpdateInventory(false)
}

const closeUpdatesPanel = () => {
  if (
    dashboardUpdateBusy.value
    && !window.confirm('The update operation will keep running in the background on this dashboard. Close the progress panel?')
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
          <span class="material-symbols-rounded !text-[18px]">system_update_alt</span>
          <span>Updates</span>
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
              <span>Install selected ({{ selectedInstallableNames.length }})</span>
            </button>
          </div>
          <div class="text-xs text-slate-400">
            {{ availableUpdateCount }} available · {{ dashboardUpdateRows.length }} update-capable
          </div>
        </div>

        <div v-if="updateProgress" class="border-b border-slate-700/70 bg-sky-950/30 px-4 py-2 text-xs text-sky-200">
          {{ updateProgress }}
        </div>

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
