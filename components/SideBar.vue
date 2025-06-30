<script setup>
import Logo from 'assets/icons/dmb.svg?component'
const processesStore = useProcessesStore()
const servicesDropdown = ref(true)
const logsDropdown = ref(true)

const services = computed(() => {
  return processesStore.getProcessesList
})

const projectName = computed(() => processesStore.projectName)
const toggleServicesDropdown = () => { servicesDropdown.value = !servicesDropdown.value }
const toggleLogsDropdown = () => { logsDropdown.value = !logsDropdown.value }
</script>

<template>
  <div
    class="z-10 absolute top-0 bottom-0 left-0 md:relative w-full max-w-[250px] flex-shrink-0 border-r border-slate-800 shadow bg-gray-900 text-white overflow-y-auto pb-20 md:pb-0">
    <div class="flex flex-col gap-4 px-2 py-4">
      <NuxtLink :to="{ name: 'index' }"
        class="px-4 py-2 hover:bg-slate-800 rounded-lg text-3xl flex items-center gap-2 w-max"
        @click="$grid.mobile && toggleSideBar(false)">
        <Logo class="h-[34px] w-[34px]" />
        <span class="text-3xl">{{ projectName }}</span>
      </NuxtLink>

      <div>
        <button class="w-full flex items-center justify-between rounded-lg group hover:bg-gray-800 px-2 py-1"
          @click="toggleServicesDropdown">
          <span class="flex items-center gap-2 grow">
            <span class="material-symbols-rounded !text-[18px]">stacks</span>
            <span class="text-lg font-bold">Services</span>
          </span>
          <span :class="[servicesDropdown ? 'rotate-180' : 'rotate-0']"
            class="material-symbols-rounded group-hover:scale-105 transform transition ease-in-out">expand_more</span>
        </button>
        <div v-if="servicesDropdown && services?.length" class="px-2">
          <NuxtLink v-for="service in services" :key="service.process_name"
            :to="{ name: 'services-serviceId', params: { serviceId: service.process_name } }"
            class="block px-2 py-1 hover:bg-slate-800 rounded-lg" @click="$grid.mobile && toggleSideBar(false)">
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
          <span :class="[logsDropdown ? 'rotate-180' : 'rotate-0']"
            class="material-symbols-rounded group-hover:scale-105 transform transition ease-in-out">expand_more</span>
        </button>
        <div v-if="logsDropdown" class="px-2">
          <NuxtLink :to="{ name: 'rtl' }" class="block px-2 py-1 hover:bg-slate-800 rounded-lg"
            @click="$grid.mobile && toggleSideBar(false)">
            Logs
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
