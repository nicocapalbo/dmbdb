<script setup>
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";

const processesStore = useProcessesStore()
const logsStore = useLogsStore()


onMounted(async () => {
  await processesStore.getProcesses()
  await logsStore.getAllLogs()
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
