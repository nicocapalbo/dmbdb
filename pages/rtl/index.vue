<template>
  <div class="rtl-page">
    <!-- Controls Section -->
    <div class="controls">
      <!-- Filter Input -->
      <div class="filter-input">
        <label for="filter" class="text-sm text-gray-300">Filter Logs:</label>
        <input
          id="filter"
          type="text"
          v-model="filterText"
          placeholder="Enter text to filter logs"
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
          <option value="Zurg w/ RealDebrid subprocess">Zurg w/ RealDebrid subprocess</option>
          <option value="rclone mount">rclone mount</option>
          <option value="riven_frontend subprocess">riven_frontend subprocess</option>
          <option value="riven_backend subprocess">riven_backend subprocess</option>
          <option value="Zilean subprocess">Zilean subprocess</option>
          <option value="PostgreSQL subprocess">PostgreSQL subprocess</option>
          <option value="pgAdmin subprocess">pgAdmin subprocess</option>
        </select>
      </div>

      <!-- Max Logs Input -->
      <div class="max-length-input">
        <label for="maxLength" class="text-sm text-gray-300">Max Logs:</label>
        <input
          id="maxLength"
          type="number"
          v-model="maxLength"
          min="1"
          placeholder="100"
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
      <h1 class="text-lg text-white mb-4">Real-Time Logs</h1>
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
    const selectedFilter = ref(""); // Dropdown filter
    const maxLength = ref(100);
    const isPaused = ref(false); // Pause functionality

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
      a.download = "logs.txt";
      a.click();
      window.URL.revokeObjectURL(url);
    };

    onMounted(() => {
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
      filteredLogs,
      getLogLevelClass,
      togglePause,
      downloadLogs,
    };
  },
};
</script>
