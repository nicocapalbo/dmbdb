<script setup>
const processesStore = useProcessesStore()

const services = computed(() => {
  return processesStore.getProcessesList
})
</script>

<template>
  <div class="relative h-full text-white overflow-auto bg-gray-900 flex flex-col gap-8 px-4 py-4 md:px-8">
    <!-- Version Box -->
<!--    <VersionBox />-->

    <InfoBar />

    <h1 class="text-4xl font-bold">Service Dashboard</h1>
    <div v-if="services?.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <ServiceCard v-for="service in services" :key="service.process_name" :process="service" />
    </div>

  </div>
</template>
