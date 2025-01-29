<template>
  <div class="h-full max-h-full antialiased relative">
    <div class="flex w-full h-full max-h-full overflow-hidden">
      <!-- Sidebar -->
      <div v-if="sideBar" class="z-10 absolute top-0 bottom-0 left-0 md:relative w-full max-w-[200px] flex-shrink-0 border-r border-slate-200 shadow bg-gray-900 text-white overflow-y-auto pb-20 md:pb-0">
        <div class="flex flex-col gap-8 p-4">

          <!-- DMB Home Link -->
          <NuxtLink :to="{ name: 'index' }" class="px-4 py-2 hover:bg-stone-700 rounded-lg text-3xl" @click="$grid.mobile && toggleSideBar(false)">
            DMB
          </NuxtLink>

          <!-- Services Links -->
          <div>
            <h2 class="text-lg font-bold mb-2">Services</h2>
            <NuxtLink v-for="service in services" :key="service.process_name" :to="{ name: 'services-serviceId', params: { serviceId: service.process_name } }" class="block px-4 py-2 hover:bg-stone-700 rounded-lg" @click="$grid.mobile && toggleSideBar(false)">
              {{ service.process_name || service.name }}
            </NuxtLink>
          </div>

          <!-- Real-Time Logs Link -->
          <div>
            <h2 class="text-lg font-bold mb-2">Logs</h2>
            <NuxtLink :to="{ name: 'rtl' }" class="px-4 py-2 hover:bg-stone-700 rounded-lg font-bold" @click="$grid.mobile && toggleSideBar(false)">
              Real-Time Logs
            </NuxtLink>
          </div>
        </div>
      </div>

      <div :class="[sideBar ? '-left-6 md:-left-4' : '-left-6 md:-left-12 md:hover:-left-6']" class="z-20 fixed bottom-4 transition-all ease-in-out duration-200" @click="toggleSideBar()">
        <button class="h-10 w-16 bg-gray-700 flex items-center justify-end rounded-full">
          <span class="material-symbols-rounded text-white text-sm transition-all ease-in-out duration-200">{{ sideBar ? 'arrow_back_ios' : 'arrow_forward_ios' }}</span>
        </button>
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
const sideBar = ref(true)

const toggleSideBar = (value) => {
  console.log(value);
  sideBar.value = value || !sideBar.value
}

// Fetch services dynamically
onMounted(async () => {
  try {
    services.value = await fetchProcesses();
  } catch (error) {
    console.error("Failed to fetch services:", error);
  }
});
</script>
