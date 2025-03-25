<script setup>
import useService from "../composables/useService";
import {PROCESS_STATUS} from "~/constants/enums.js";

const props = defineProps({
  process: {type: Object}
})

const status = ref("unknown") // Process status
const selectedAction = ref("") // Selected dropdown action
const loading = ref(false) // Loading state

const updateStatus = async () => {
  try {
    const { fetchProcessStatus } = useService();
    status.value = await fetchProcessStatus(props.process.process_name);
  } catch (e) {
    console.error("Failed to get process status:", e);
  }
}
const executeAction = async () => {
  if (!selectedAction.value) return;

  const { startProcess, stopProcess } = useService();
  loading.value = true; // Start loading spinner

  try {
    if (selectedAction.value === "start") {
      await startProcess(props.process.process_name);
    } else if (selectedAction.value === "stop") {
      await stopProcess(props.process.process_name);
    } else if (selectedAction.value === "restart") {
      await stopProcess(props.process.process_name);
      await startProcess(props.process.process_name);
    }
    await updateStatus();
  } catch (err) {
    console.error(`Failed to execute action: ${err.message}`);
    alert("An error occurred while performing the action.");
  } finally {
    loading.value = false; // Stop loading spinner
    selectedAction.value = "";
  }
}

onMounted(() => {
  updateStatus();
})
</script>

<template>
  <div class="bg-gray-800 rounded-lg shadow-md p-4 hover:scale-105 transition-transform">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">{{ process.process_name }}</h2>
      <div class="flex items-center gap-2">
        <div
          :class="{'bg-green-400': status === PROCESS_STATUS.RUNNING,'bg-red-400': status === PROCESS_STATUS.STOPPED,'bg-yellow-400': status === PROCESS_STATUS.UNKNOWN}"
          class="w-3 h-3 rounded-full"
        />
      </div>
    </div>

    <!-- Dropdown for Actions -->
    <div class="flex flex-col items-center gap-4 mt-4">
      <!-- Dropdown Selection -->
      <select
        v-model="selectedAction"
        :disabled="loading"
        class="w-full px-4 py-2 rounded border border-gray-600 bg-stone-800 text-white focus:outline-none focus:ring focus:ring-blue-500"
      >
        <option value="" disabled>Select Action</option>
        <option value="start" :disabled="status === PROCESS_STATUS.RUNNING">Start</option>
        <option value="stop" :disabled="status === PROCESS_STATUS.STOPPED">Stop</option>
        <option value="restart">Restart</option>
      </select>

      <!-- Execute Button -->
      <button @click="executeAction" :disabled="loading || !selectedAction" class="button-small apply w-full">
        <span v-if="loading" class="animate-spin material-symbols-rounded !text-[16px]">progress_activity</span>
        <span v-if="loading">Processing...</span>
        <span v-else>Execute</span>
      </button>
    </div>
  </div>
</template>
