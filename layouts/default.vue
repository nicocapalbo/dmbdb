<template>
  <div class="h-full max-h-full antialiased relative">
    <div class="flex w-full h-full max-h-full overflow-hidden">
      <!-- Sidebar -->
      <div class="w-full max-w-[200px] flex-shrink-0 border-r border-slate-200 shadow bg-gray-900 text-white">
        <div class="h-full p-4 flex flex-col gap-8">

          <!-- DMB Home Link -->
          <NuxtLink
            :to="{ name: 'index' }"
            class="px-4 py-2 hover:bg-stone-700 rounded-lg text-3xl"
          >
            DMB
          </NuxtLink>

          <!-- Services Links -->
          <div>
            <h2 class="text-lg font-bold mb-2">Services</h2>
            <NuxtLink
              v-for="service in services"
              :key="service.process_name"
              :to="{ name: 'services-serviceId', params: { serviceId: service.process_name } }"
              class="block px-4 py-2 hover:bg-stone-700 rounded-lg"
            >
              {{ service.process_name || service.name }}
            </NuxtLink>
          </div>

          <!-- Real-Time Logs Link -->
          <div>
            <h2 class="text-lg font-bold mb-2">Logs</h2>           
          <NuxtLink
            :to="{ name: 'rtl' }"
            class="px-4 py-2 hover:bg-stone-700 rounded-lg font-bold"
          >
            Real-Time Logs
          </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="flex-1 overflow-auto">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import useService from "../composables/useService";

const services = ref([]);
const servicesWithConfig = ref([]);
const { fetchProcesses } = useService();

// Fetch services dynamically
onMounted(async () => {
  try {
    services.value = await fetchProcesses();
  } catch (error) {
    console.error("Failed to fetch services:", error);
  }
});
</script>
