<script setup>
import {useProcessesStore} from "~/stores/processes.js";

const processesStore = useProcessesStore()

const services = computed(() => {
  return processesStore.getProcessesList
})

onMounted(async () => {
  await processesStore.getProcesses()
});
</script>

<template>
  <div class="relative h-full text-white overflow-auto bg-gray-900">
    <!-- Background Image -->
<!--    <div class="absolute inset-0" style="background: url('/images/DMB.png') no-repeat center center fixed; background-size: cover; opacity: 0.5;"></div>-->

    <!-- Version Box -->
    <VersionBox />

    <!-- Gray Overlay -->
    <div class="absolute inset-0 bg-gray-900 opacity-90"></div>

    <div class="relative">

      <div class="text-center py-6">
        <h1 class="text-4xl font-bold">Service Dashboard</h1>
      </div>

      <div v-if="services?.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-6 pb-8 mx-auto max-w-screen-2xl">
        <ServiceCard v-for="service in services" :key="service.process_name" :process="service" />
      </div>
    </div>
  </div>
</template>
