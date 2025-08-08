<script setup>
import { ref, computed, nextTick, onMounted } from "vue";
import SelectComponent from "~/components/SelectComponent.vue";
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";
import { logsParser } from "~/helper/logsParser.js";
import { useWebSocket } from '~/composables/useWebSocket.js'

const processesStore = useProcessesStore();
const projectName = computed(() => processesStore.projectName);
const rawLogs = ref([]);
const parsedLogs = ref([]);
const logContainer = ref(null);
const filterText = ref("");
const selectedLevelFilter = ref("");
const selectedProcessFilter = ref("");
const maxLength = ref(1000);
const isPaused = ref(false);
const logBus = useWebSocket();
const buffer = [];
const flushThreshold = 100;
const flushInterval = 50;
let lastFlush = Date.now();
let logIdCounter = 0;
const items = [
  { value: '', label: 'All Logs' },
  { value: 'INFO', label: 'Info' },
  { value: 'DEBUG', label: 'Debug' },
  { value: 'ERROR', label: 'Error' },
  { value: 'WARNING', label: 'Warning' }
];

const services = computed(() => processesStore?.enabledProcesses || []);
const combinedServices = computed(() => {
  const combined = {};
  services.value.forEach(service => {
    const key = service.process_name.includes(projectName.value) ? projectName.value : service.process_name;
    if (!combined[key]) {
      combined[key] = { ...service, process_name: key };
    } else {
      combined[key].process_name = projectName.value;
    }
  });
  return Object.values(combined);
});
const getServices = computed(() => [
  { value: '', label: 'Services' },
  ...combinedServices.value.map(service => ({
    value: service.process_name,
    label: service.process_name
  }))
]);

const filteredLogs = computed(() => {
  const text = filterText.value.toLowerCase();
  const level = selectedLevelFilter.value.toLowerCase();
  const process = selectedProcessFilter.value.toLowerCase();

  return parsedLogs.value
    .filter(log => {
      const matchesLevel = !level || log.level.toLowerCase().includes(level);
      const matchesProcess = !process || log.process.toLowerCase().includes(process);
      const matchesText = !text || log.message.toLowerCase().includes(text);
      return matchesLevel && matchesProcess && matchesText;
    })
    .slice(-maxLength.value);
});

const scrollToBottom = () => {
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight;
  }
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

const getLogLevelClass = (level) => {
  if (level.includes("ERROR")) return "text-red-500";
  if (level.includes("WARN")) return "text-yellow-400";
  if (level.includes("INFO")) return "text-green-400";
  if (level.includes("DEBUG")) return "text-blue-400";
  return "text-gray-400";
};

const subscribeToBus = () => {
  logBus.on((log) => {
    if (!isPaused.value) {
      buffer.push(log);
    }
  });
};
const flushLogs = () => {
  const now = Date.now();

  if (isPaused.value || buffer.length === 0) return;

  const shouldFlushBySize = buffer.length >= flushThreshold;
  const shouldFlushByTime = now - lastFlush >= flushInterval;

  if (shouldFlushBySize || shouldFlushByTime) {
    const copy = [...buffer];
    buffer.length = 0;

    rawLogs.value.push(...copy);

    const parsed = logsParser(copy).map((log) => ({
      id: logIdCounter++,
      ...log
    }));
    parsedLogs.value.push(...parsed);

    const excess = parsedLogs.value.length - maxLength.value;
    if (excess > 0) {
      rawLogs.value.splice(0, excess);
      parsedLogs.value.splice(0, excess);
    }

    lastFlush = now;
    nextTick(() => scrollToBottom());
  }
};

setInterval(flushLogs, 25);

onMounted(() => {
  subscribeToBus();
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
            <Input v-model="maxLength" min="1" :placeholder="'Max Logs'" type="number" class="w-16 md:w-24" />
            <SelectComponent v-model="selectedLevelFilter" :items="items" />
            <SelectComponent v-model="selectedProcessFilter" :items="getServices" />
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
      <table class="w-full text-sm text-left text-gray-500 dark:text-gray-400">
        <thead class="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-300 sticky top-0 z-10">
          <tr>
            <th scope="col" class="px-2 py-2 w-48">Timestamp</th>
            <th scope="col" class="px-2 py-2 w-24">Level</th>
            <th scope="col" class="px-2 py-2 w-40">Process</th>
            <th scope="col" class="px-2 py-2">Message</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(log, index) in filteredLogs" :key="log.id" :class="getLogLevelClass(log.level)"
            class="whitespace-nowrap odd:bg-gray-900 even:bg-gray-800 text-xs">
            <td class="px-2 py-0.5">{{ log.timestamp.toLocaleString() }}</td>
            <td class="px-2 py-0.5">{{ log.level }}</td>
            <td class="px-2 py-0.5">{{ log.process }}</td>
            <td class="px-2 py-0.5 break-all">{{ log.message }}</td>
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
