<script setup>
import { computed } from 'vue'
import { useProcessesStore } from '~/stores/processes.js'
import { frontendBuildDisplay } from '~/helper/frontendSource.js'

const appVersion = useRuntimeConfig().public.appVersion
const processesStore = useProcessesStore()
const buildDisplay = computed(() => frontendBuildDisplay(appVersion, processesStore.processesList))

</script>

<template>
  <span data-testid="frontend-version" :title="buildDisplay.title || undefined" class="block max-w-full break-words text-xs text-slate-300">{{ buildDisplay.label }}</span>
</template>
