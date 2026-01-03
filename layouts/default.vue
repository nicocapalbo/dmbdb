<script setup>
import { ref, computed } from 'vue'
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
        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-auto min-w-0">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
