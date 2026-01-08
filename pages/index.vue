<script setup>
import { useStatusStore } from '~/stores/status.js'

const processesStore = useProcessesStore()
const statusStore = useStatusStore()
const route = useRoute()
const splitViewEnabled = useState('appSplitViewEnabled', () => false)
const splitPanePath = useState('appSplitPanePath', () => '/')

const enabledProcesses = computed(() => processesStore.enabledProcesses)

const toggleSplitView = () => {
  splitViewEnabled.value = !splitViewEnabled.value
  if (splitViewEnabled.value) {
    splitPanePath.value = route.fullPath || '/'
  }
}

onMounted(() => {
  statusStore.connect({ interval: 2, health: true })
})

onUnmounted(() => {
  statusStore.disconnect()
})
</script>

<template>
  <div class="relative min-h-full text-white bg-gray-900 flex flex-col gap-8 px-4 py-4 md:px-8">
    <InfoBar />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-4xl font-bold">Service Dashboard</h1>
      <button
        class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1"
        @click="toggleSplitView"
      >
        <span class="material-symbols-rounded !text-[18px]">
          {{ splitViewEnabled ? 'splitscreen' : 'splitscreen_right' }}
        </span>
        <span>{{ splitViewEnabled ? 'Exit Split' : 'Split View' }}</span>
      </button>
    </div>
    <div v-if="enabledProcesses?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <ServiceCard v-for="service in enabledProcesses" :key="service.process_name" :process="service" />
    </div>

  </div>
</template>
