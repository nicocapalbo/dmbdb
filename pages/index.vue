<script setup>
import { useConfigStore } from '~/stores/config.js'
import { useUiStore } from '~/stores/ui.js'
import { useGeekMetricsStore } from '~/stores/geekMetrics.js'
import { useLocalStorage } from '@vueuse/core'
import { mergeServiceOrder, orderServicesByPreference } from '~/helper/serviceOrder.js'

const processesStore = useProcessesStore()
const configStore = useConfigStore()
const uiStore = useUiStore()
const geekMetricsStore = useGeekMetricsStore()
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
const enabledProcesses = computed(() => {
  return orderServicesByPreference(
    processesStore.enabledProcesses || [],
    uiStore.sidebarPreferences?.service_order || []
  )
})
const displayedProcesses = ref([])
const geekModeEnabled = computed(() => !!uiStore.sidebarPreferences?.geek_mode)

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
})

onUnmounted(() => {
  geekMetricsStore.stopPolling()
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
          :show-drag-handle="true"
          @drag-handle-touchstart="onDragHandleTouchStart(service, $event)"
        />
      </div>
    </div>

  </div>
</template>
