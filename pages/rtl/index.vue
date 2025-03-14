<script setup>
import {useEventBus} from "@vueuse/core";
import SelectComponent from "~/pages/rtl/SelectComponent.vue";

const { fetchProcesses } = useService();

const logs = ref([]);
const filterText = ref("");
const selectedFilter = ref("");
const maxLength = ref(1000);
const isPaused = ref(false);
const SERVICES = ref([]);
const logBus = useEventBus("log-bus");
const items = [
  { value: '', label: 'All Logs' },
  { value: 'INFO', label: 'Info' },
  { value: 'DEBUG', label: 'Debug' },
  { value: 'ERROR', label: 'Error' },
  { value: 'WARNING', label: 'Warning' }
]

const filteredLogs = computed(() =>
    logs.value.filter((log) => {
      const textMatch = log.toLowerCase().includes(filterText.value.toLowerCase());
      const dropdownMatch =
          selectedFilter.value === "" || log.includes(selectedFilter.value);
      return textMatch && dropdownMatch;
    })
);

const getLogLevelClass = (log) => {
  if (log.includes("ERROR")) return "text-red-500";
  if (log.includes("WARN")) return "text-yellow-400";
  if (log.includes("INFO")) return "text-green-400";
  if (log.includes("DEBUG")) return "text-blue-400";
  return "text-gray-400";
};

const togglePause = () => {
  isPaused.value = !isPaused.value;
};

const downloadLogs = () => {
  const blob = new Blob([logs.value.join("\n")], { type: "text/plain" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "DMB_logs.txt";
  a.click();
  window.URL.revokeObjectURL(url);
};

const fetchServices = async () => {
  try {
    SERVICES.value = await fetchProcesses();
  } catch (error) {
    console.error("Failed to fetch services:", error);
  }
};

const subscribeToBus = () => {
  logBus.on((log) => {
    if (!isPaused.value) {
      logs.value.push(log);

      if (logs.value.length > maxLength.value) {
        logs.value.splice(0, logs.value.length - maxLength.value);
      }
    }
  });
}

// const getItems = computed(() => {
//   const itemsList = items
//   SERVICES?.value.forEach(service => itemsList.push({value: service.process_name, label: service.process_name}))
//   return itemsList
// })

onMounted(async () => {
  await fetchServices();
  subscribeToBus()
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex flex-col md:flex-row md:items-center gap-2 py-2 px-4 w-full border-b border-slate-700">
      <h1 class="text-lg font-bold">Real-Time Logs</h1>

      <!-- Controls Section -->
      <div class="flex items-center justify-between grow gap-2">
        <div class="flex items-center gap-4 grow">
          <Input v-model="filterText" :placeholder="'Enter text to filter logs'" class="hidden md:block"/>
          <Input v-model="maxLength" min="1" :placeholder="'Max Logs'" type="number" class="hidden md:block" />
          <SelectComponent v-model="selectedFilter" :items="items" />
        </div>

        <div class="flex gap-2 justify-start items-center">
          <button @click="togglePause" class="button-small" :class="[isPaused ? 'start' : 'restart']">
            <span class="material-symbols-rounded !text-[18px]">{{ isPaused ? "play_arrow" : "pause" }}</span>
            <span class="hidden md:inline">{{ isPaused ? "Resume Logs" : "Pause Logs" }}</span>
          </button>
          <button @click="downloadLogs" class="button-small download">
            <span class="material-symbols-rounded !text-[18px]">download</span>
            <span class="hidden md:inline">Download Logs</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Logs Section -->
    <ul class="grow overflow-auto snap-y bg-gray-900">
      <li
        v-for="(log, index) in filteredLogs"
        :key="index"
        :class="['', getLogLevelClass(log)]"
        class="odd:bg-gray-900 even:bg-gray-800 whitespace-nowrap w-full"
      >
        <span class="text-sm whitespace-nowrap px-2">{{ log }}</span>
      </li>
    </ul>
  </div>
</template>
