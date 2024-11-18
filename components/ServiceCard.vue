<script setup>
import {computed, onMounted, ref} from 'vue'
import useService from "../composables/useService.js";
import {SERVICE_ACTIONS} from "../constants/enums.js";
const {statusService} = useService()

const props = defineProps({
  service: {type: Object}
})

const timer = ref(null)
const data = ref(null)
const selectedAction = ref('');

const getServiceStatus = async() => {
  try {
    const response = await statusService.getServiceStatus(props.service.id)
    data.value = await response.json(); // Await here to resolve the promise
  } catch (e) {
    throw new Error(e)
  }
}

const startService = async () => {
  try {
    await statusService.startService({body: JSON.stringify({ process_name: props.service.id })})
    await getServiceStatus()
  } catch (e) {
    throw new Error(e)
  }
}
const stopService = async () => {
  try {
    await statusService.stopService({body: JSON.stringify({ process_name: props.service.id })})
    await getServiceStatus()
  } catch (e) {
    throw new Error(e)
  }
}
const restartService = async () => {
  try {
    await statusService.restartService({body: JSON.stringify({ process_name: props.service.id })})
    await getServiceStatus()
  } catch (e) {
    throw new Error(e)
  }
}

// const formatName = computed(() => {
//   return data?.value.process_name.replaceAll('_', ' ')
// })

const statusStyle = computed(() => {
  const style = {
    bgColor: null,
    ballColor: null
  }
  switch (data?.value.status) {
    case 'running':
      style.bgColor = 'bg-teal-100'
      style.ballColor = 'bg-teal-700'
      style.textColor = 'text-teal-800'
      break
    case 'stopped':
      style.bgColor = 'bg-red-100'
      style.ballColor = 'bg-red-600'
      style.textColor = 'text-red-800'
  }
  return style
})

function executeAction() {
  switch (selectedAction.value) {
    case 1:
      startService()
      break
    case 2:
      stopService()
      break
    case 3:
      restartService()
      break
  }
  selectedAction.value = null
}

onMounted(() => {
  // timer.value = setInterval(() => {
    getServiceStatus()
  // }, 2000)
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<template>
  <div v-if="data" class="w-full h-40 rounded-lg shadow p-4 bg-gray-800 bg-opacity-[98%] flex flex-col justify-between">
    <div class="flex items-center gap-4 justify-between">
      <div class="flex items-center gap-2">
        <p class="text-xl font-semibold capitalize">{{service.name}}</p>
      </div>
      <div class="rounded-lg p-2 flex gap-2 items-center" :class="statusStyle.bgColor">
        <p><span class="text-slate-900">Status: </span><span class="font-medium" :class="statusStyle.textColor">{{data.status}}</span></p>
        <div class="h-3 w-3 rounded-full" :class="statusStyle.ballColor" />
      </div>
    </div>

    <div class="mt-4 w-full flex items-center justify-end gap-2">
      <select
          id="riven_frontend-action"
          v-model="selectedAction"
          class="text-sm border border-gray-300 rounded-md px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="" disabled>Select Action</option>
        <option
            v-for="(value, key) in SERVICE_ACTIONS"
            :key="value"
            :value='value'
            class="capitalize"
        >
          {{key}}
        </option>
      </select>
      <button
          @click="executeAction()"
          class="text-sm bg-blue-500 text-white font-semibold px-2 py-1 rounded-md hover:bg-blue-600 focus:outline-none focus:ring focus:ring-blue-500 focus:ring-offset"
          :disabled="!selectedAction"
      >
        Execute
      </button>
    </div>
  </div>
</template>

<style scoped>

</style>
