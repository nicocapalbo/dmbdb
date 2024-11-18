<script setup>
import useService from "../composables/useService.js";
import {computed, onMounted, ref} from "vue";

const {statusService} = useService()
const data = ref(null)

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
  try {
    const response = await statusService.getHealthCheck()
    data.value = await response.json()
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
  <div v-if="data" class="rounded-lg p-2 flex gap-2 items-center" :class="statusStyle.bgColor">
    <p>DMB Status: <span class="font-medium" :class="statusStyle.textColor">{{data?.status}}</span></p>
    <div class="h-3 w-3 rounded-full" :class="statusStyle.ballColor" />
  </div>
  <button class="bg-blue-500 text-white font-semibold p-2 rounded-md hover:bg-blue-600 focus:outline-none focus:ring focus:ring-blue-500 focus:ring-offset" @click="refreshStatus">Refresh status</button>
</div>
</template>

<style scoped>

</style>
