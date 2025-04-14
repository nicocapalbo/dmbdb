<script setup>
import useService from "~/services/useService.js";
import {computed, onMounted, ref} from "vue";

const {processService} = useService()
const data = ref(null)
const loading = ref(false)

const statusStyle = computed(() => {
  const style = {
    bgColor: null,
    ballColor: null
  }

  switch (data?.value.status) {
    case 'healthy':
      style.bgColor = 'bg-teal-100'
      style.ballColor = 'bg-teal-700'
      style.textColor = 'text-teal-800'
      break
    case 'unhealthy':
      style.bgColor = 'bg-red-100'
      style.ballColor = 'bg-red-600'
      style.textColor = 'text-red-800'
  }
  return style
})

const refreshStatus = async () => {
  loading.value = true
  try {
    const response = await processService.getHealthCheck()
    data.value = await response.json()
    loading.value = false
  } catch (e) {
    throw new Error(e)
  }
}

onMounted(() => {
  refreshStatus()
})

</script>

<template>
<div class="w-full flex items-center justify-end gap-4 px-4">
  <div class="relative group">
    <div v-if="data" class="rounded-lg px-3 py-2 flex gap-2 items-center" :class="statusStyle.bgColor">
      <p class="text-slate-900">DMB Status:</p>
      <span v-if="loading" class="animate-spin material-symbols-rounded text-black">progress_activity</span>
      <div v-else class="flex items-center gap-1">
        <span class="font-medium" :class="statusStyle.textColor">{{data?.status}}</span>
        <div class="h-3 w-3 rounded-full" :class="statusStyle.ballColor" />
      </div>
    </div>
    <button class="hidden group-hover:flex items-center justify-center absolute top-0 right-0 bottom-0 left-0 w-full h-full rounded-lg bg-black bg-opacity-40" @click="refreshStatus">
      <span v-if="loading" class="animate-spin material-symbols-rounded text-white">progress_activity</span>
      <span v-else class="material-symbols-rounded text-white">refresh</span>
    </button>
  </div>
</div>
</template>

<style scoped>

</style>
