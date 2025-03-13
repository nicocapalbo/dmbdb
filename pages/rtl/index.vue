<script setup>
import { useEventBus } from "@vueuse/core";
const { fetchProcesses } = useService();

const logs = ref([]);
const filterText = ref("");
const selectedFilter = ref("");
const maxLength = ref(1000);
const isPaused = ref(false);
const SERVICES = ref([]);
const logBus = useEventBus("log-bus");

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

onMounted(() => {
  fetchServices();
  logBus.on((log) => {
    if (!isPaused.value) {
      logs.value.push(log);

      if (logs.value.length > maxLength.value) {
        logs.value.splice(0, logs.value.length - maxLength.value);
      }
    }
  });
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex gap-2 items-center py-2 px-4 w-full border-b border-slate-700">
      <h1 class="text-lg font-bold">Real-Time Logs</h1>

      <!-- Controls Section -->
      <div class="flex items-center gap-4 grow">
        <!-- Filter Input -->
        <Input v-model="filterText" :placeholder="'Enter text to filter logs'"/>

        <!-- Max Logs Input -->
        <Input
          v-model="maxLength"
          min="1"
          :placeholder="'Max Logs'"
          type="number"
        />

        <!-- Dropdown Filter -->
        <div class="flex flex-col gap-1">
          <select id="logLevel" v-model="selectedFilter" class="text-slate-900">
            <option value="">All Logs</option>
            <option value="INFO">INFO</option>
            <option value="DEBUG">DEBUG</option>
            <option value="ERROR">ERROR</option>
            <option value="WARNING">WARNING</option>
            <option v-for="service in SERVICES" :key="service.process_name" :value="service.process_name">
              {{ service.process_name }}
            </option>
          </select>
        </div>
      </div>

      <!-- Buttons Section -->
      <div class="flex gap-2 justify-start items-center">
        <button @click="togglePause" class="button-small" :class="[isPaused ? 'start' : 'restart']">
          <span class="material-symbols-rounded !text-[18px]">{{ isPaused ? "play_arrow" : "pause" }}</span>
          <span>{{ isPaused ? "Resume Logs" : "Pause Logs" }}</span>
        </button>
        <button @click="downloadLogs" class="button-small download">
          <span class="material-symbols-rounded !text-[18px]">download</span>
          Download Logs
        </button>
      </div>
    </div>

    <!-- Logs Section -->
    <ul class="grow overflow-auto snap-y bg-secondary">
      <li
        v-for="(log, index) in filteredLogs"
        :key="index"
        :class="['', getLogLevelClass(log)]"
        class="odd:bg-secondary even:bg-dark whitespace-nowrap w-full"
      >
        <span class="text-sm whitespace-nowrap px-2">{{ log }}</span>
      </li>
    </ul>
  </div>
</template>
