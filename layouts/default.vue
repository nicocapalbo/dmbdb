<script setup>
import { ref, onMounted } from "vue";
import useService from "../composables/useService";

const services = ref([]);
const servicesWithConfig = ref([]);
const { fetchProcesses } = useService();
const sideBar = ref(true)
const servicesDropdown = ref(true)
const logsDropdown = ref(true)

const toggleSideBar = (value) => { sideBar.value = value || !sideBar.value }
const toggleServicesDropdown = () => { servicesDropdown.value = !servicesDropdown.value }
const toggleLogsDropdown = () => { logsDropdown.value = !logsDropdown.value }

// Fetch services dynamically
onMounted(async () => {
  try {
    services.value = await fetchProcesses();
  } catch (error) {
    console.error("Failed to fetch services:", error);
  }
});
</script>

<template>
  <div class="h-full max-h-full antialiased relative">
    <div class="flex w-full h-full max-h-full overflow-hidden">
<!--      <SideBar v-if="sideBar">-->
      <!-- Sidebar -->
      <div v-if="sideBar" class="z-10 absolute top-0 bottom-0 left-0 md:relative w-full max-w-[250px] flex-shrink-0 border-r border-slate-800 shadow bg-gray-900 text-white overflow-y-auto pb-20 md:pb-0">
        <div class="flex flex-col gap-4 px-2 py-4">
          <NuxtLink :to="{ name: 'index' }" class="px-4 py-2 hover:bg-slate-800 rounded-lg text-3xl" @click="$grid.mobile && toggleSideBar(false)">
            DMB
          </NuxtLink>

          <div>
            <button class="w-full flex items-center justify-between rounded-lg group hover:bg-gray-800 px-2 py-1" @click="toggleServicesDropdown">
              <span class="flex items-center gap-2 grow">
                <span class="material-symbols-rounded !text-[18px]">stacks</span>
                <span class="text-lg font-bold">Services</span>
              </span>
              <span :class="[ servicesDropdown ? 'rotate-180' : 'rotate-0' ]" class="material-symbols-rounded group-hover:scale-105 transform transition ease-in-out">expand_more</span>
            </button>
              <div v-if="servicesDropdown" class="px-2">
                <NuxtLink v-for="service in services" :key="service.process_name" :to="{ name: 'services-serviceId', params: { serviceId: service.process_name } }" class="block px-2 py-1 hover:bg-slate-800 rounded-lg" @click="$grid.mobile && toggleSideBar(false)">
                  {{ service.process_name || service.name }}
                </NuxtLink>
              </div>
          </div>

          <div>
            <button class="w-full button-small group hover:bg-gray-800 px-2 py-1" @click="toggleLogsDropdown">
              <span class="flex items-center gap-2 grow">
                <span class="material-symbols-rounded !text-[18px]">data_object</span>
                <span class="text-lg font-bold">Realtime Logs</span>
              </span>
              <span :class="[ logsDropdown ? 'rotate-180' : 'rotate-0' ]" class="material-symbols-rounded group-hover:scale-105 transform transition ease-in-out">expand_more</span>
            </button>
            <div v-if="logsDropdown" class="px-2">
              <NuxtLink :to="{ name: 'rtl' }" class="block px-2 py-1 hover:bg-slate-800 rounded-lg" @click="$grid.mobile && toggleSideBar(false)">
                Logs
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>

      <div :class="[sideBar ? '-left-6 md:-left-4' : '-left-6 md:-left-12 md:hover:-left-6']" class="z-20 fixed bottom-4 transition-all ease-in-out duration-200" @click="toggleSideBar()">
        <button class="h-10 w-16 bg-gray-800 flex items-center justify-end rounded-full pr-2">
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
