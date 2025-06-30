<script setup>
import { useEventBus } from "@vueuse/core";
import SelectComponent from "~/components/SelectComponent.vue";
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";
import { logsParser } from "~/helper/logsParser.js";

const processesStore = useProcessesStore()
const projectName = computed(() => processesStore.projectName)
const logs = ref([]);
const logContainer = ref(null);
const filterText = ref("");
const selectedFilter = ref("");
const maxLength = ref(1000);
const isPaused = ref(false);
const logBus = useEventBus("log-bus");
const items = [
  { value: '', label: 'All Logs' },
  { value: 'INFO', label: 'Info' },
  { value: 'DEBUG', label: 'Debug' },
  { value: 'ERROR', label: 'Error' },
  { value: 'WARNING', label: 'Warning' }
]

const services = computed(() => {
  return processesStore?.getProcessesList || []
})

const getItems = computed(() => {
  return [
    ...items,  // Keep the initial log levels
    ...services.value.map(service => ({
      value: service.process_name,
      label: service.process_name
    }))
  ]
})

const filteredLogs = computed(() => {
  const text = filterText.value.toLowerCase()
  const levelOrProcessFilter = selectedFilter.value

  // Apply text and filter logic
  const filtered = fullParsedLogs.value.filter(log => {
    const matchesLevelOrProcess =
      levelOrProcessFilter === '' ||
      log.level === levelOrProcessFilter ||
      log.process === levelOrProcessFilter

    const matchesText =
      text === '' ||
      log.level.toLowerCase().includes(text) ||
      log.process.toLowerCase().includes(text) ||
      log.message.toLowerCase().includes(text)

    return matchesLevelOrProcess && matchesText
  })

  // Slice the last `maxLength` logs
  const max = parseInt(maxLength.value, 10)
  if (!isNaN(max) && max > 0) {
    return filtered.slice(-max)
  }

  return filtered
})

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
  const logs = filteredLogs.value.map(({ timestamp, level, process, message }) => {
    const d = new Date(timestamp);
    const f = n => String(n).padStart(2, '0');
    const date = `${f(d.getDate())}/${f(d.getMonth() + 1)}/${d.getFullYear()} ${f(d.getHours())}:${f(d.getMinutes())}:${f(d.getSeconds())}`;
    return `[${date}] [${level}] [${process}] ${message}`;
  });

  const blob = new Blob([logs.join("\n")], { type: "text/plain" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.value}_logs.txt`;
  a.click();
  window.URL.revokeObjectURL(url);
};

const subscribeToBus = () => {
  logBus.on((log) => {
    if (!isPaused.value) {
      logs.value.push(log);

      if (logs.value.length > maxLength.value) {
        logs.value.splice(0, logs.value.length - maxLength.value);
      }

      // Scroll to bottom when a new log is added
      nextTick(() => {
        scrollToBottom();
      });
    }
  });
}

const fullParsedLogs = computed(() => [
  ...logsParser(getLogs?.value || ''),
  ...logsParser(logs?.value || '')
]);

const getLogs = computed(() => {
  return useLogsStore().getLogsList
})

const scrollToBottom = () => {
  if (logContainer.value) {
    // Smooth scroll is optional; remove behavior for instant scroll
    logContainer.value.scrollTop = logContainer.value.scrollHeight;
  }
};

onMounted(async () => {
  subscribeToBus()
  // Scroll to bottom when a new log is added
  await nextTick(() => {
    scrollToBottom();
  });
});

</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex flex-col md:flex-row md:items-center gap-2 py-2 px-4 w-full border-b border-slate-700">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-bold">Real-Time Logs</h1>

        <div class="md:hidden flex gap-2 justify-start items-center">
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

      <!-- Controls Section -->
      <div class="flex items-center justify-between grow gap-2">
        <div class="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 grow">
          <Input v-model="filterText" :placeholder="'Enter text to filter logs'" class="block" />
          <div class="flex items-center justify-between gap-2 md:gap-4">
            <Input v-model="maxLength" min="1" :placeholder="'Max Logs'" type="number" class="block" />
            <SelectComponent v-model="selectedFilter" :items="getItems" />
          </div>
        </div>

        <div class="hidden md:flex gap-2 justify-start items-center">
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
    <div class="relative overflow-auto grow" ref="logContainer">
      <table class="w-full text-sm text-left rtl:text-right text-gray-500 dark:text-gray-400 relative">
        <thead class="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-300 sticky top-0">
          <tr>
            <th scope="col" class="px-2 py-2">Timestamp</th>
            <th scope="col" class="px-2 py-2">Level</th>
            <th scope="col" class="px-2 py-2">Process</th>
            <th scope="col" class="px-2 py-2">Message</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in filteredLogs" :key="log.timestamp" :class="getLogLevelClass(log.level)"
            class="whitespace-nowrap odd:bg-gray-900 even:bg-gray-800">
            <td class="text-xs px-2 py-0.1">{{ log.timestamp.toLocaleString() }}</td>
            <td class="text-xs px-2 py-0.1">{{ log.level }}</td>
            <td class="text-xs px-2 py-0.1">{{ log.process }}</td>
            <td class="text-xs px-2 py-0.1 whitespace-pre-wrap break-words">{{ log.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <button
      class="fixed bottom-4 right-4 rounded-full bg-slate-700 hover:bg-slate-500 flex items-center justify-center w-8 h-8"
      @click="scrollToBottom">
      <span class="material-symbols-rounded !text-[26px]">keyboard_arrow_down</span>
    </button>
  </div>
</template>
