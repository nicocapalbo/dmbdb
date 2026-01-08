<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useLocalStorage } from '@vueuse/core'
import { useMetricsStore } from "~/stores/metrics.js"

const sideBar = ref(true)
const toggleSideBar = (value) => { sideBar.value = value ?? !sideBar.value }

// get the current path
const route = useRoute()

// only show sidebar when *not* on the onboarding page
const showSidebar = computed(() => !route.path.startsWith('/onboarding'))

const metricsStore = useMetricsStore()
const alertsEnabled = useLocalStorage('metrics.alertsEnabled', true)
const cpuWarnThreshold = useLocalStorage('metrics.cpuWarnThreshold', 85)
const memWarnThreshold = useLocalStorage('metrics.memWarnThreshold', 85)
const diskWarnThreshold = useLocalStorage('metrics.diskWarnThreshold', 90)

const splitViewEnabled = useState('appSplitViewEnabled', () => false)
const splitPanePath = useState('appSplitPanePath', () => '/')
const splitPaneWidth = useState('appSplitPaneWidth', () => 40)
const splitContainer = ref(null)
const isSplitResizing = ref(false)

const splitPaneSrc = computed(() => {
  const path = splitPanePath.value || '/'
  try {
    const url = new URL(path, 'http://local')
    url.searchParams.set('split', '1')
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return path.includes('?') ? `${path}&split=1` : `${path}?split=1`
  }
})

const globalAlerts = computed(() => {
  const snapshot = metricsStore.latestSnapshot
  if (!alertsEnabled.value) return []
  if (!snapshot?.system) return []
  const list = []
  if (snapshot.system.cpu_percent != null && snapshot.system.cpu_percent >= cpuWarnThreshold.value) {
    list.push(`CPU ${snapshot.system.cpu_percent.toFixed(1)}%`)
  }
  if (snapshot.system.mem?.percent != null && snapshot.system.mem.percent >= memWarnThreshold.value) {
    list.push(`Memory ${snapshot.system.mem.percent.toFixed(1)}%`)
  }
  if (snapshot.system.disk?.percent != null && snapshot.system.disk.percent >= diskWarnThreshold.value) {
    list.push(`Disk ${snapshot.system.disk.percent.toFixed(1)}%`)
  }
  return list
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const updateSplitWidthFromEvent = (event) => {
  if (!splitContainer.value) return
  const rect = splitContainer.value.getBoundingClientRect()
  const clientX = event.clientX
  const rightWidthPx = clamp(rect.right - clientX, 280, rect.width * 0.7)
  const percent = (rightWidthPx / rect.width) * 100
  splitPaneWidth.value = clamp(percent, 25, 60)
}

const onSplitResizeMove = (event) => {
  if (!isSplitResizing.value) return
  updateSplitWidthFromEvent(event)
}

const onSplitResizeEnd = () => {
  if (!isSplitResizing.value) return
  isSplitResizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', onSplitResizeMove)
  window.removeEventListener('pointerup', onSplitResizeEnd)
  window.removeEventListener('pointercancel', onSplitResizeEnd)
}

const startSplitResize = (event) => {
  if (!splitViewEnabled.value) return
  isSplitResizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  if (event?.currentTarget?.setPointerCapture) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  updateSplitWidthFromEvent(event)
  window.addEventListener('pointermove', onSplitResizeMove)
  window.addEventListener('pointerup', onSplitResizeEnd)
  window.addEventListener('pointercancel', onSplitResizeEnd)
}

onUnmounted(() => {
  onSplitResizeEnd()
})
</script>

<template>
  <div class="h-full max-h-full relative antialiased">
    <div class="flex w-full h-full max-h-full overflow-hidden min-w-0">
      <!-- Sidebar: only when showSidebar AND sideBar are both true -->
      <SideBar v-if="showSidebar && sideBar" @toggleSideBar="toggleSideBar" />

      <!-- Toggle button: also only when not onboarding -->
      <div v-if="showSidebar" :class="[
        sideBar
          ? '-left-6 md:-left-4'
          : '-left-6 md:-left-12 md:hover:-left-6'
      ]" class="z-20 fixed bottom-4 transition-all ease-in-out duration-200" @click="toggleSideBar()">
        <button class="h-10 w-16 bg-gray-800 flex items-center justify-end rounded-full pr-2">
          <span class="material-symbols-rounded text-white text-sm transition-all ease-in-out duration-200">
            {{ sideBar ? 'arrow_back_ios' : 'arrow_forward_ios' }}
          </span>
        </button>
      </div>

      <!-- Main Content -->
      <div class="flex-1 min-h-0 flex flex-col min-w-0">
        <div v-if="globalAlerts.length" class="px-4 md:px-8 pt-2">
          <div class="rounded border border-amber-600/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span class="font-semibold">System alerts:</span>
            <span class="ml-2">{{ globalAlerts.join(' · ') }}</span>
          </div>
        </div>
        <div class="flex-1 min-h-0 flex overflow-hidden min-w-0" ref="splitContainer">
          <div class="flex-1 min-h-0 overflow-y-auto overflow-x-auto min-w-0">
            <slot />
          </div>
          <div
            v-if="splitViewEnabled"
            class="w-3 cursor-col-resize bg-slate-800/80 hover:bg-slate-600/80 transition-colors z-10"
            style="touch-action: none;"
            @pointerdown.prevent="startSplitResize"
          />
          <div
            v-if="splitViewEnabled"
            class="border-l border-slate-700/70 bg-slate-950/40 flex flex-col overflow-hidden"
            :style="{ width: `${splitPaneWidth}%` }"
          >
            <div class="px-4 py-2 text-xs text-slate-400 flex items-center justify-between gap-3 border-b border-slate-700/60">
              <span>Split View</span>
              <button
                class="button-small border border-slate-50/20 hover:apply !py-1.5 !px-2 !gap-1"
                @click="splitViewEnabled = false"
              >
                <span class="material-symbols-rounded !text-[18px]">close</span>
                <span>Exit Split</span>
              </button>
            </div>
            <iframe
              v-if="splitPaneSrc"
              :src="splitPaneSrc"
              class="w-full h-full border-0 bg-black"
              referrerpolicy="same-origin"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
