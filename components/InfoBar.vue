<script setup>
import { useLocalStorage } from '@vueuse/core'
import { useMetricsStore } from "~/stores/metrics.js"
import axios from 'axios'

const router = useRouter()
const route = useRoute()
const metricsStore = useMetricsStore()
const cpuWarnThreshold = useLocalStorage('metrics.cpuWarnThreshold', 85)
const memWarnThreshold = useLocalStorage('metrics.memWarnThreshold', 85)
const diskWarnThreshold = useLocalStorage('metrics.diskWarnThreshold', 90)
const alertsEnabled = useLocalStorage('metrics.alertsEnabled', true)
const databaseHealthAlertsEnabled = useLocalStorage('metrics.databaseHealthAlertsEnabled', false)
const databaseHealthAlertLevel = useLocalStorage('metrics.databaseHealthAlertLevel', 'high')
const databasePressureRank = { moderate: 1, high: 2, critical: 3 }

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
  metricsAvailabilityPromise = axios
    .get('/api/metrics')
    .then((response) => {
      metricsAvailabilityValue = response.status === 200
      return metricsAvailabilityValue
    })
    .catch(() => {
      metricsAvailabilityValue = false
      return false
    })
  return metricsAvailabilityPromise
}

const alerts = computed(() => {
  if (!alertsEnabled.value) return []
  const snapshot = metricsStore.latestSnapshot
  if (!snapshot?.system) return []
  const list = []
  if (snapshot.system.cpu_percent != null && snapshot.system.cpu_percent >= cpuWarnThreshold.value) {
    list.push('CPU')
  }
  if (snapshot.system.mem?.percent != null && snapshot.system.mem.percent >= memWarnThreshold.value) {
    list.push('Memory')
  }
  const filesystems = snapshot.system.filesystems?.length
    ? snapshot.system.filesystems
    : [{ ...snapshot.system.disk, path: snapshot.system.disk?.path || '/' }]
  filesystems.forEach((filesystem) => {
    if (filesystem?.percent != null && filesystem.percent >= diskWarnThreshold.value) {
      list.push(`Disk: ${filesystem.path || '/'}`)
    }
  })
  if (databaseHealthAlertsEnabled.value) {
    const minimum = databasePressureRank[databaseHealthAlertLevel.value] ?? databasePressureRank.high
    const databaseServices = snapshot.database_health?.services || []
    databaseServices.forEach((service) => {
      if (!service?.monitoring_enabled) return
      const rank = databasePressureRank[service.pressure] ?? 0
      if (rank >= minimum) list.push(`DB: ${service.process_name}`)
    })
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
