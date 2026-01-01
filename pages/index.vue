<script setup>
const processesStore = useProcessesStore()

const enabledProcesses = computed(() => processesStore.enabledProcesses)
</script>

<template>
  <div class="relative min-h-full text-white overflow-x-hidden bg-gray-900 flex flex-col gap-8 px-4 py-4 md:px-8">
    <InfoBar />

    <h1 class="text-4xl font-bold">Service Dashboard</h1>
    <div v-if="enabledProcesses?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <ServiceCard v-for="service in enabledProcesses" :key="service.process_name" :process="service" />
    </div>

  </div>
</template>
