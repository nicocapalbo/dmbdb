<script setup>

useHead({
  titleTemplate: `DMB Dashboard`,
})

import {useProcessesStore} from "~/stores/processes.js";
const processesStore = useProcessesStore()
onMounted(async () => {
  await processesStore.getProcesses()
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
