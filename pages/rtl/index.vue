<template>
  <div class="log-page">
    <!-- Header -->
    <div class="text-center py-6">
      <h1 class="text-4xl font-bold">Real-Time Logs</h1>
    </div>

    <!-- Controls Section -->
    <div class="controls">

      <!-- Filter Input -->
      <div>
        <label for="filter" class="text-sm text-gray-300">Filter Logs:</label>
        <input
          id="filter"
          type="text"
          v-model="filterText"
          placeholder="Enter text to filter logs"
          class="text-input"
        />
      </div>

      <!-- Dropdown Filter -->
      <div class="dropdown-filter">
        <label for="logLevel" class="text-sm text-gray-300">Select Filter:</label>
        <select id="logLevel" v-model="selectedFilter">
          <option value="">All Logs</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
          <option value="ERROR">ERROR</option>
          <option value="WARNING">WARNING</option>
          <option
            v-for="service in SERVICES"
            :key="service.process_name"
            :value="service.process_name"
          >
            {{ service.process_name }}
          </option>
        </select>
      </div>

      <!-- Max Logs Input -->
      <div>
        <label for="maxLength" class="text-sm text-gray-300">Max Logs:</label>
        <input
          id="maxLength"
          type="number"
          v-model="maxLength"
          min="1"
          placeholder="100"
          class="text-input"
        />
      </div>

      <!-- Buttons Section -->
      <div class="button-group">
        <button
          @click="togglePause"
          class="pause-button"
        >
          {{ isPaused ? "Resume Logs" : "Pause Logs" }}
        </button>
        <button
          @click="downloadLogs"
          class="download-button"
        >
          Download Logs
        </button>
      </div>
    </div>

    <!-- Logs Section -->
    <div class="log-container">
      <div
        v-for="(log, index) in filteredLogs"
        :key="index"
        :class="['log-message', getLogLevelClass(log)]"
      >
        {{ log }}
      </div>
    </div>
  </div>
</template>


<script>
import { ref, computed, onMounted } from "vue";
import { useEventBus } from "@vueuse/core";

export default {
  setup() {
    const logs = ref([]);
    const filterText = ref("");
    const selectedFilter = ref("");
    const maxLength = ref(100);
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
      const { fetchProcesses } = useService();
      try {
        const services = await fetchProcesses();
        SERVICES.value = services;
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

    return {
      logs,
      filterText,
      selectedFilter,
      maxLength,
      isPaused,
      SERVICES,
      filteredLogs,
      getLogLevelClass,
      togglePause,
      downloadLogs,
    };
  },
};
</script>
