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
    const maxLength = ref(100);

    const logBus = useEventBus("log-bus");

    const filteredLogs = computed(() =>
      logs.value.filter((log) =>
        log.toLowerCase().includes(filterText.value.toLowerCase())
      )
    );

    const getLogLevelClass = (log) => {
      if (log.includes("ERROR")) return "text-red-500";
      if (log.includes("WARN")) return "text-yellow-400";
      if (log.includes("INFO")) return "text-green-400";
      if (log.includes("DEBUG")) return "text-blue-400";
      return "text-gray-400";
    };

    onMounted(() => {
      logBus.on((log) => {
        logs.value.push(log);

        if (logs.value.length > maxLength.value) {
          logs.value.splice(0, logs.value.length - maxLength.value);
        }
      });
    });

    return { logs, filterText, maxLength, filteredLogs, getLogLevelClass };
  },
};
</script>
