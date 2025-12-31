<script setup>
import { useLocalStorage } from '@vueuse/core'
import { useMetricsStore } from "~/stores/metrics.js"

const router = useRouter()
const route = useRoute()
const metricsStore = useMetricsStore()
const cpuWarnThreshold = useLocalStorage('metrics.cpuWarnThreshold', 85)
const memWarnThreshold = useLocalStorage('metrics.memWarnThreshold', 85)
const diskWarnThreshold = useLocalStorage('metrics.diskWarnThreshold', 90)

let metricsAvailabilityPromise = null
let metricsAvailabilityValue = null
const metricsAvailable = ref(false)

const toggleSettingsPage = () => {
  if (route.path === "/settings") {
    router.push({ name: 'index' })
  } else {
    router.push({ name: 'settings' })
  }
}

const toggleMetricsPage = () => {
  if (route.path === "/metrics") {
    router.push({ name: 'index' })
  } else {
    router.push({ name: 'metrics' })
  }
}

const checkMetricsAvailability = async () => {
  if (metricsAvailabilityPromise) return metricsAvailabilityPromise
  metricsAvailabilityPromise = fetch('/api/metrics')
    .then((response) => {
      metricsAvailabilityValue = response.ok
      return metricsAvailabilityValue
    })
    .catch(() => {
      metricsAvailabilityValue = false
      return false
    })
  return metricsAvailabilityPromise
}

const alerts = computed(() => {
  const snapshot = metricsStore.latestSnapshot
  if (!snapshot?.system) return []
  const list = []
  if (snapshot.system.cpu_percent != null && snapshot.system.cpu_percent >= cpuWarnThreshold.value) {
    list.push('CPU')
  }
  if (snapshot.system.mem?.percent != null && snapshot.system.mem.percent >= memWarnThreshold.value) {
    list.push('Memory')
  }
  if (snapshot.system.disk?.percent != null && snapshot.system.disk.percent >= diskWarnThreshold.value) {
    list.push('Disk')
  }
  return list
})

onMounted(async () => {
  if (metricsAvailabilityValue !== null) {
    metricsAvailable.value = metricsAvailabilityValue
    return
  }
  metricsAvailable.value = await checkMetricsAvailability()
})
</script>

<template>
  <div class="w-full flex gap-2 items-center justify-end">

    <button
      v-if="metricsAvailable"
      class="w-max button-small group bg-gray-800 hover:bg-gray-700 relative"
      @click="toggleMetricsPage()"
      :title="alerts.length ? `Alerts: ${alerts.join(', ')}` : 'Metrics'"
    >
      <span
        class="material-symbols-rounded !text-[16px] rotate-0 group-hover:-rotate-12 transform transition ease-in-out duration-200">monitoring</span>
      <span
        v-if="alerts.length"
        class="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400 border border-gray-900"
      ></span>
    </button>
    <button class="w-max button-small group bg-gray-800 hover:bg-gray-700" @click="toggleSettingsPage()">
      <span
        class="material-symbols-rounded !text-[16px] rotate-0 group-hover:rotate-90 transform transition ease-in-out duration-200">settings</span>
    </button>
  </div>
</template>
