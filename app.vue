<script setup>
import {useProcessesStore} from "~/stores/processes.js";
import {useLogsStore} from "~/stores/logs.js";

useHead({
  titleTemplate: `DMB Dashboard`,
})

const processesStore = useProcessesStore()
const logsStore = useLogsStore()


onMounted(async () => {
  await processesStore.getProcesses()
  await logsStore.getAllLogs()
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
