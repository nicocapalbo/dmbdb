<script setup>
const processesStore = useProcessesStore()

const services = computed(() => {
  return processesStore.getProcessesList
})

// const selectedActions = {} // Stores selected action for each service
// Initialize selectedActions with empty strings
// this.selectedActions = Object.fromEntries(
//     servicesWithStatus.map(service => [service.process_name, ""])
// );


// const executeAction = async(processName) => {
//   const action = this.selectedActions[processName];
//   if (!action) return;
//
//   try {
//     await performServiceAction(processName, action, (updatedStatus) => {
//       this.SERVICES = this.SERVICES.map((service) =>
//           service.process_name === processName
//               ? { ...service, status: updatedStatus }
//               : service
//       );
//       alert(`Action '${action}' executed on '${processName}'`);
//     });
//   } catch (error) {
//     alert("Failed to execute action.");
//   }
// }
</script>

<template>
  <div class="relative h-full text-white overflow-auto bg-gray-900">
    <!-- Background Image -->
<!--    <div class="absolute inset-0" style="background: url('/images/DMB.png') no-repeat center center fixed; background-size: cover; opacity: 0.5;"></div>-->

    <!-- Version Box -->
    <VersionBox />

    <!-- Gray Overlay -->
    <div class="absolute inset-0 bg-gray-900 opacity-90"></div>

    <!-- Content -->
    <div class="relative">
      <!-- Header -->
      <div class="text-center py-6">
        <h1 class="text-4xl font-bold">Service Dashboard</h1>
      </div>

      <div v-if="services?.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-6 pb-8 mx-auto max-w-screen-2xl">
        <ServiceCard v-for="service in services" :key="service.process_name" :process="service" />
      </div>

      <!-- Services Grid -->
<!--      <div-->
<!--        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-6 pb-8 mx-auto max-w-screen-2xl"-->
<!--      >-->
<!--        <div-->
<!--          v-for="service in SERVICES"-->
<!--          :key="service.process_name"-->
<!--          class="bg-gray-800 rounded-lg shadow-md p-4 hover:scale-105 transition-transform"-->
<!--        >-->
<!--          &lt;!&ndash; Service Title and Status &ndash;&gt;-->
<!--          <div class="flex items-center justify-between mb-4">-->
<!--            <h2 class="text-lg font-bold">{{ service.process_name }}</h2>-->
<!--            <span-->
<!--              :class="{-->
<!--                'text-green-400': service.status === 'running',-->
<!--                'text-red-400': service.status === 'stopped',-->
<!--                'text-yellow-400': service.status === 'unknown',-->
<!--              }"-->
<!--              class="text-sm font-medium"-->
<!--            >-->
<!--              {{ service.status }}-->
<!--            </span>-->
<!--          </div>-->

<!--          &lt;!&ndash; Action Dropdown and Button &ndash;&gt;-->
<!--          <div class="flex flex-col gap-2 dropdown-filter">-->
<!--            <select v-model="selectedActions[service.process_name]">-->
<!--              <option value="" disabled hidden>Select Action</option>-->
<!--              <option value="start" :disabled="service.status === 'running'">-->
<!--                Start-->
<!--              </option>-->
<!--              <option value="stop" :disabled="service.status !== 'running'">-->
<!--                Stop-->
<!--              </option>-->
<!--              <option value="restart" :disabled="service.status !== 'running'">-->
<!--                Restart-->
<!--              </option>-->
<!--            </select>-->
<!--            <button-->
<!--              @click="executeAction(service.process_name)"-->
<!--              class="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 w-full"-->
<!--              :disabled="!selectedActions[service.process_name]"-->
<!--            >-->
<!--              Execute-->
<!--            </button>-->
<!--          </div>-->
<!--        </div>-->
<!--      </div>-->

    </div>
  </div>
</template>
