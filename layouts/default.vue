<script setup>
import {useProcessesStore} from "~/stores/processes.js";

const useProcesses = useProcessesStore()
const sideBar = ref(true)

const toggleSideBar = (value) => { sideBar.value = value || !sideBar.value }

// Fetch services dynamically
onMounted(async () => {
  await useProcesses.getProcesses()
});
</script>

<template>
  <div class="h-full max-h-full relative antialiased">
    <div class="flex w-full h-full max-h-full overflow-hidden">
      <SideBar v-if="sideBar" />

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
