<script setup>
import { useLocalStorage } from '@vueuse/core'
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";
import { useMetricsStore } from "~/stores/metrics.js";

const processesStore = useProcessesStore()
const logsStore = useLogsStore()
const metricsStore = useMetricsStore()
const cpuWarnThreshold = useLocalStorage('metrics.cpuWarnThreshold', 85)
const memWarnThreshold = useLocalStorage('metrics.memWarnThreshold', 85)
const diskWarnThreshold = useLocalStorage('metrics.diskWarnThreshold', 90)

const globalAlerts = computed(() => {
  const snapshot = metricsStore.latestSnapshot
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


onMounted(async () => {
  await processesStore.getProcesses()
  await logsStore.getAllLogs()
  metricsStore.connect()
});

watchEffect(() => {
  useHead({
    titleTemplate: `${processesStore.projectName} Dashboard`,
  });
});
</script>

<template>
  <NuxtLayout>
    <div v-if="globalAlerts.length" class="mx-4 md:mx-8 mt-3 mb-2 rounded border border-amber-600/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <span class="font-semibold">System alerts:</span>
      <span class="ml-2">{{ globalAlerts.join(' · ') }}</span>
    </div>
    <NuxtPage />
  </NuxtLayout>
</template>
