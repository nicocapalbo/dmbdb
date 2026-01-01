<script setup>
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";
import { useMetricsStore } from "~/stores/metrics.js";

const processesStore = useProcessesStore()
const logsStore = useLogsStore()
const metricsStore = useMetricsStore()


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
    <NuxtPage />
  </NuxtLayout>
</template>
