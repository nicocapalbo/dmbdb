<script setup>
import Logo from 'assets/icons/dmb.svg?component'
import { useLocalStorage } from '@vueuse/core'
import { useStatusStore } from '~/stores/status.js'
import { useUiStore } from '~/stores/ui.js'

const processesStore = useProcessesStore()
const statusStore = useStatusStore()
const uiStore = useUiStore()
const router = useRouter()
const { $grid } = useNuxtApp()

const showAllServices = useLocalStorage('sidebar.showAllServices', false)
const compactMode = useLocalStorage('sidebar.compactMode', false)
const toolsOpen = useLocalStorage('sidebar.toolsOpen', false)
const servicesDropdown = ref(true)
const logsDropdown = ref(true)
const serviceSearch = ref('')
const quickFilter = ref('all')
const savedViews = useLocalStorage('sidebar.savedViews', [])
const activeSavedViewId = useLocalStorage('sidebar.activeSavedViewId', '')
const serviceShortcuts = useLocalStorage('sidebar.serviceShortcuts', {})
const paletteOpen = ref(false)
const paletteQuery = ref('')
const pendingShortcutProcess = ref('')
const sidebarPrefsHydrating = ref(true)
let sidebarPrefsSaveTimer = null

const emit = defineEmits(['toggleSideBar'])

const normalizeValue = (value) => String(value || '').toLowerCase().trim()

const buildSidebarPreferencesPayload = () => ({
  show_all_services: !!showAllServices.value,
  compact_mode: !!compactMode.value,
  tools_open: !!toolsOpen.value,
  quick_filter: quickFilter.value,
  service_search: String(serviceSearch.value || ''),
  saved_views: Array.isArray(savedViews.value) ? savedViews.value : [],
  active_saved_view_id: String(activeSavedViewId.value || ''),
  service_shortcuts: serviceShortcuts.value && typeof serviceShortcuts.value === 'object'
    ? serviceShortcuts.value
    : {},
})

const applySidebarPreferences = (prefs) => {
  if (!prefs || typeof prefs !== 'object') return
  showAllServices.value = prefs.show_all_services === true
  compactMode.value = prefs.compact_mode === true
  toolsOpen.value = prefs.tools_open === true
  serviceSearch.value = String(prefs.service_search || '')
  quickFilter.value = String(prefs.quick_filter || 'all')
  savedViews.value = Array.isArray(prefs.saved_views) ? prefs.saved_views : []
  activeSavedViewId.value = String(prefs.active_saved_view_id || '')
  serviceShortcuts.value = prefs.service_shortcuts && typeof prefs.service_shortcuts === 'object'
    ? prefs.service_shortcuts
    : {}
}

const scheduleSidebarPreferencesSave = () => {
  if (sidebarPrefsHydrating.value) return
  if (sidebarPrefsSaveTimer) clearTimeout(sidebarPrefsSaveTimer)
  sidebarPrefsSaveTimer = setTimeout(async () => {
    sidebarPrefsSaveTimer = null
    try {
      await uiStore.saveSidebarPreferences(buildSidebarPreferencesPayload())
    } catch (error) {
      console.warn('Failed to persist sidebar preferences:', error)
    }
  }, 350)
}

const allServices = computed(() => processesStore.getProcessesList || [])

const baseServices = computed(() => {
  return showAllServices.value
    ? processesStore.getProcessesList
    : processesStore.enabledProcesses
})

const savedViewsList = computed(() => (Array.isArray(savedViews.value) ? savedViews.value : []))

const statusForService = (service) => {
  const name = service?.process_name || service?.name
  return statusStore.statusByName[name] || {}
}

const matchesSearch = (service, needle) => {
  if (!needle) return true
  const text = normalizeValue([
    service?.process_name,
    service?.name,
    service?.config_key,
  ].filter(Boolean).join(' '))
  return text.includes(needle)
}

const matchesQuickFilter = (service) => {
  if (quickFilter.value === 'all') return true
  const snapshot = statusForService(service)
  if (quickFilter.value === 'running') return snapshot.status === 'running'
  if (quickFilter.value === 'stopped') return snapshot.status === 'stopped'
  if (quickFilter.value === 'unhealthy') return snapshot.healthy === false
  return true
}

const services = computed(() => {
  const needle = normalizeValue(serviceSearch.value)
  return baseServices.value.filter((service) =>
    matchesSearch(service, needle) && matchesQuickFilter(service)
  )
})

const quickFilterItems = computed(() => {
  const all = baseServices.value
  const running = all.filter((s) => statusForService(s).status === 'running').length
  const stopped = all.filter((s) => statusForService(s).status === 'stopped').length
  const unhealthy = all.filter((s) => statusForService(s).healthy === false).length
  return [
    { key: 'all', label: 'All', count: all.length },
    { key: 'running', label: 'Running', count: running },
    { key: 'stopped', label: 'Stopped', count: stopped },
    { key: 'unhealthy', label: 'Unhealthy', count: unhealthy },
  ]
})

const paletteItems = computed(() => {
  const needle = normalizeValue(paletteQuery.value)
  return (allServices.value || [])
    .filter((service) => matchesSearch(service, needle))
    .slice(0, 30)
})

const statusClass = (service) => {
  const snapshot = statusForService(service)
  if (snapshot.healthy === false) return 'bg-rose-400'
  if (snapshot.status === 'running') return 'bg-emerald-400'
  if (snapshot.status === 'stopped') return 'bg-slate-500'
  return 'bg-slate-600'
}

const saveCurrentView = () => {
  const name = window.prompt('Saved view name')
  if (!name || !name.trim()) return
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const next = {
    id,
    name: name.trim(),
    showAllServices: !!showAllServices.value,
    compactMode: !!compactMode.value,
    search: serviceSearch.value || '',
    quickFilter: quickFilter.value,
    toolsOpen: !!toolsOpen.value,
  }
  savedViews.value = [...savedViewsList.value, next].slice(-20)
  activeSavedViewId.value = id
}

const applySavedViewById = (id) => {
  const view = savedViewsList.value.find((item) => item.id === id)
  if (!view) return
  showAllServices.value = !!view.showAllServices
  compactMode.value = !!view.compactMode
  toolsOpen.value = !!view.toolsOpen
  serviceSearch.value = String(view.search || '')
  quickFilter.value = String(view.quickFilter || 'all')
  activeSavedViewId.value = view.id
}

const deleteActiveSavedView = () => {
  const id = activeSavedViewId.value
  if (!id) return
  savedViews.value = savedViewsList.value.filter((item) => item.id !== id)
  activeSavedViewId.value = ''
}

const normalizeShortcutCombo = (input) => {
  if (!input) return ''
  const raw = String(input).toLowerCase().trim()
  if (!raw) return ''
  const parts = raw
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return ''

  const modifiers = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  }
  let key = ''

  parts.forEach((part) => {
    if (part === 'control') modifiers.ctrl = true
    else if (part === 'cmd' || part === 'command') modifiers.meta = true
    else if (part in modifiers) modifiers[part] = true
    else if (!key) key = part
  })

  if (!key) return ''
  const ordered = []
  if (modifiers.ctrl) ordered.push('ctrl')
  if (modifiers.meta) ordered.push('meta')
  if (modifiers.alt) ordered.push('alt')
  if (modifiers.shift) ordered.push('shift')
  ordered.push(key)
  return ordered.join('+')
}

const comboFromEvent = (event) => {
  const key = String(event?.key || '').toLowerCase()
  if (!key || ['control', 'meta', 'alt', 'shift'].includes(key)) return ''
  const combo = []
  if (event.ctrlKey) combo.push('ctrl')
  if (event.metaKey) combo.push('meta')
  if (event.altKey) combo.push('alt')
  if (event.shiftKey) combo.push('shift')
  combo.push(key)
  return combo.join('+')
}

const assignedShortcutFor = (service) => {
  const processName = service?.process_name
  if (!processName) return ''
  const entries = Object.entries(serviceShortcuts.value || {})
  const found = entries.find(([, value]) => String(value || '') === String(processName))
  return found ? found[0] : ''
}

const bindShortcutFor = (service) => {
  if (!service?.process_name) return
  pendingShortcutProcess.value = service.process_name
}

const assignShortcutComboToProcess = (processName, combo) => {
  if (!processName || !combo) return
  const hasModifier = combo.includes('ctrl+') || combo.includes('meta+') || combo.includes('alt+') || combo.includes('shift+')
  if (!hasModifier) return
  const blockedCombos = new Set(['ctrl+k', 'meta+k'])
  if (blockedCombos.has(combo)) return
  const next = { ...(serviceShortcuts.value || {}) }
  Object.keys(next).forEach((key) => {
    if (String(next[key] || '') === String(processName) || key === combo) {
      delete next[key]
    }
  })
  next[combo] = processName
  serviceShortcuts.value = next
}

const clearShortcutFor = (service) => {
  const combo = assignedShortcutFor(service)
  if (!combo) return
  const next = { ...(serviceShortcuts.value || {}) }
  delete next[combo]
  serviceShortcuts.value = next
}

const openService = (service) => {
  if (!service?.process_name) return
  router.push({ name: 'services-serviceId', params: { serviceId: service.process_name } })
  closeSidebarOnMobile()
}

const openServiceByProcessName = (processName) => {
  if (!processName) return
  const target = (allServices.value || []).find((service) => service?.process_name === processName)
  if (!target) return
  openService(target)
}

const migrateLegacyShortcuts = () => {
  const current = serviceShortcuts.value || {}
  const keys = Object.keys(current)
  if (!keys.length) return
  let changed = false
  const next = {}
  keys.forEach((key) => {
    const processName = current[key]
    if (!processName) return
    if (/^[1-9]$/.test(key)) {
      next[`alt+${key}`] = processName
      changed = true
      return
    }
    const normalized = normalizeShortcutCombo(key)
    if (normalized && normalized !== key) changed = true
    if (normalized) next[normalized] = processName
  })
  if (changed) {
    serviceShortcuts.value = next
  }
}

const onGlobalKeydown = (event) => {
  const target = event?.target
  const tagName = String(target?.tagName || '').toLowerCase()
  const inEditable = !!target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'

  const isPaletteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
  const shortcutCombo = comboFromEvent(event)
  const mappedService = shortcutCombo ? serviceShortcuts.value?.[shortcutCombo] : ''

  if (pendingShortcutProcess.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      pendingShortcutProcess.value = ''
      return
    }
    const captureCombo = comboFromEvent(event)
    if (!captureCombo) return
    event.preventDefault()
    assignShortcutComboToProcess(pendingShortcutProcess.value, captureCombo)
    pendingShortcutProcess.value = ''
    return
  }

  if (isPaletteShortcut) {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
    if (paletteOpen.value) paletteQuery.value = ''
  } else if (mappedService && !inEditable) {
    event.preventDefault()
    openServiceByProcessName(mappedService)
  } else if (event.key === 'Escape' && paletteOpen.value) {
    paletteOpen.value = false
  }
}

const projectName = computed(() => processesStore.projectName)
const toggleServicesDropdown = () => { servicesDropdown.value = !servicesDropdown.value }
const toggleLogsDropdown = () => { logsDropdown.value = !logsDropdown.value }
const toggleSideBar = (value) => emit('toggleSideBar', value)
const closeSidebarOnMobile = () => {
  if ($grid?.mobile) toggleSideBar(false)
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  ;(async () => {
    try {
      const prefs = await uiStore.getSidebarPreferences()
      applySidebarPreferences(prefs)
    } catch (error) {
      console.warn('Failed to hydrate sidebar preferences from config:', error)
    } finally {
      migrateLegacyShortcuts()
      if (activeSavedViewId.value) {
        applySavedViewById(activeSavedViewId.value)
      }
      sidebarPrefsHydrating.value = false
    }
  })()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  if (sidebarPrefsSaveTimer) {
    clearTimeout(sidebarPrefsSaveTimer)
    sidebarPrefsSaveTimer = null
  }
})

watch([
  showAllServices,
  compactMode,
  toolsOpen,
  quickFilter,
  serviceSearch,
  savedViews,
  activeSavedViewId,
  serviceShortcuts,
], () => {
  scheduleSidebarPreferencesSave()
}, { deep: true })
</script>

<template>
  <div
    class="z-10 absolute top-0 bottom-0 left-0 md:relative w-full max-w-[250px] flex-shrink-0 border-r border-slate-800 shadow bg-gray-900 text-white overflow-y-auto pb-20 md:pb-0"
  >
    <div class="flex flex-col gap-4 px-2 py-4">
      <NuxtLink
        :to="{ name: 'index' }"
        class="px-4 py-2 hover:bg-slate-800 rounded-lg text-3xl flex items-center gap-2 w-max"
        @click="closeSidebarOnMobile"
      >
        <Logo class="h-[34px] w-[34px]" />
        <span class="text-3xl">{{ projectName }}</span>
      </NuxtLink>

      <div>
        <button class="w-full flex items-center justify-between rounded-lg group hover:bg-gray-800 px-2 py-1" @click="toggleServicesDropdown">
          <span class="flex items-center gap-2 grow">
            <span class="material-symbols-rounded !text-[18px]">stacks</span>
            <span class="text-lg font-bold">Services</span>
          </span>
          <span :class="[servicesDropdown ? 'rotate-180' : 'rotate-0']" class="material-symbols-rounded group-hover:scale-105 transform transition ease-in-out">expand_more</span>
        </button>

        <div v-if="servicesDropdown" class="px-2">
          <div class="mb-2 rounded border border-slate-700/70">
            <button class="w-full flex items-center justify-between px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800" @click="toolsOpen = !toolsOpen">
              <span class="flex items-center gap-1">
                <span class="material-symbols-rounded !text-[14px]">tune</span>
                <span>Sidebar tools</span>
              </span>
              <span class="material-symbols-rounded !text-[16px]">{{ toolsOpen ? 'expand_less' : 'expand_more' }}</span>
            </button>

            <div v-if="toolsOpen" class="p-2 border-t border-slate-700/70">
              <button
                class="w-full flex items-center justify-between rounded border border-slate-700 hover:bg-slate-800 px-2 py-1 mb-2 text-xs text-slate-300"
                title="Open command palette (Ctrl/Cmd + K)"
                @click="paletteOpen = true"
              >
                <span class="flex items-center gap-1">
                  <span class="material-symbols-rounded !text-[14px]">keyboard_command_key</span>
                  <span>Command palette</span>
                </span>
                <span class="text-[10px] text-slate-500">Ctrl/Cmd + K</span>
              </button>

              <Input v-model="serviceSearch" type="text" placeholder="Filter services..." class="mb-2" />

              <div class="grid grid-cols-2 gap-1 mb-2">
                <button
                  v-for="item in quickFilterItems"
                  :key="item.key"
                  class="rounded border px-2 py-1 text-[11px] text-left"
                  :class="quickFilter === item.key ? 'border-sky-500/70 bg-sky-500/10 text-sky-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'"
                  @click="quickFilter = item.key"
                >
                  {{ item.label }} ({{ item.count }})
                </button>
              </div>

              <div class="flex items-center justify-between py-1 text-sm text-gray-400">
                <span>Show Disabled</span>
                <input type="checkbox" v-model="showAllServices" class="form-checkbox h-4 w-4 text-blue-500" />
              </div>
              <div class="flex items-center justify-between py-1 text-sm text-gray-400">
                <span>Compact mode</span>
                <input type="checkbox" v-model="compactMode" class="form-checkbox h-4 w-4 text-blue-500" />
              </div>

              <div class="rounded border border-slate-700/70 p-2 mt-2 space-y-2">
                <div class="text-[11px] uppercase tracking-wide text-slate-500">Saved views</div>
                <select
                  v-model="activeSavedViewId"
                  class="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200"
                  @change="applySavedViewById(activeSavedViewId)"
                >
                  <option value="">Select saved view</option>
                  <option v-for="view in savedViewsList" :key="view.id" :value="view.id">{{ view.name }}</option>
                </select>
                <div class="flex items-center gap-1">
                  <button class="button-small border border-slate-50/20 hover:apply !py-1 !px-2 !gap-1" @click="saveCurrentView">
                    <span class="material-symbols-rounded !text-[14px]">save</span>
                    <span>Save</span>
                  </button>
                  <button
                    class="button-small border border-slate-50/20 hover:apply !py-1 !px-2 !gap-1"
                    :disabled="!activeSavedViewId"
                    @click="deleteActiveSavedView"
                  >
                    <span class="material-symbols-rounded !text-[14px]">delete</span>
                    <span>Delete</span>
                  </button>
                </div>
              </div>

            </div>
          </div>

          <NuxtLink
            v-for="service in services"
            :key="service.process_name"
            :to="{ name: 'services-serviceId', params: { serviceId: service.process_name } }"
            class="block px-2 rounded-lg hover:bg-slate-800"
            :class="[
              compactMode ? 'py-0.5 text-sm' : 'py-1',
              { 'text-gray-500 italic': service?.config?.enabled !== true && service?.config?.enabled !== 'true' },
            ]"
            @click="closeSidebarOnMobile"
          >
            <span class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-2 min-w-0">
                <span class="inline-block h-2 w-2 rounded-full" :class="statusClass(service)"></span>
                <span class="truncate">{{ service.process_name || service.name }}</span>
              </span>
            </span>
          </NuxtLink>

          <div v-if="!services.length" class="text-xs text-slate-500 py-1">
            No services match current filters.
          </div>
        </div>
      </div>

      <div>
        <button class="w-full button-small group hover:bg-gray-800 px-2 py-1" @click="toggleLogsDropdown">
          <span class="flex items-center gap-2 grow">
            <span class="material-symbols-rounded !text-[18px]">data_object</span>
            <span class="text-lg font-bold">Realtime Logs</span>
          </span>
          <span :class="[logsDropdown ? 'rotate-180' : 'rotate-0']" class="material-symbols-rounded group-hover:scale-105 transform transition ease-in-out">expand_more</span>
        </button>
        <div v-if="logsDropdown" class="px-2">
          <NuxtLink :to="{ name: 'rtl' }" class="block px-2 py-1 hover:bg-slate-800 rounded-lg" @click="closeSidebarOnMobile">
            Logs
          </NuxtLink>
        </div>
      </div>
    </div>

    <div v-if="paletteOpen" class="fixed inset-0 z-50 bg-slate-900/80 p-3 flex items-start justify-center" @click.self="paletteOpen = false">
      <div class="w-full max-w-xl rounded border border-slate-700 bg-slate-900 shadow-xl mt-10">
        <div class="p-3 border-b border-slate-700">
          <Input v-model="paletteQuery" type="text" placeholder="Jump to service..." autofocus />
          <div v-if="pendingShortcutProcess" class="mt-2 text-xs text-amber-300">
            Press shortcut keys now for <span class="text-amber-200">{{ pendingShortcutProcess }}</span> (Esc to cancel).
          </div>
        </div>
        <div class="max-h-[60vh] overflow-auto p-2">
          <button
            v-for="service in paletteItems"
            :key="`palette-${service.process_name}`"
            class="w-full text-left rounded px-2 py-2 hover:bg-slate-800 flex items-center justify-between gap-2"
            @click="openService(service); paletteOpen = false"
          >
            <span class="flex items-center gap-2 min-w-0">
              <span class="inline-block h-2 w-2 rounded-full" :class="statusClass(service)"></span>
              <span class="truncate">{{ service.process_name || service.name }}</span>
            </span>
            <span class="flex items-center gap-1">
              <button
                class="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
                :title="assignedShortcutFor(service) ? `Clear ${assignedShortcutFor(service)}` : 'Assign service shortcut'"
                @click.stop="pendingShortcutProcess === service.process_name ? (pendingShortcutProcess = '') : (assignedShortcutFor(service) ? clearShortcutFor(service) : bindShortcutFor(service))"
              >
                {{ pendingShortcutProcess === service.process_name ? 'Press keys...' : (assignedShortcutFor(service) || 'Bind') }}
              </button>
              <span class="text-xs text-slate-500">{{ service.config_key }}</span>
            </span>
          </button>
          <div v-if="!paletteItems.length" class="text-sm text-slate-500 px-2 py-4">
            No matching services.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
