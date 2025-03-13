<template>
  <div class="service-card">
    <!-- Process Name -->
    <h2>{{ process.process_name }}</h2>
    <p>Status: {{ status }}</p>

    <!-- Dropdown for Actions -->
    <div class="flex flex-col items-center gap-4 mt-4">
      <!-- Dropdown Selection -->
      <select
        v-model="selectedAction"
        :disabled="loading"
        class="w-full px-4 py-2 rounded border border-gray-600 bg-stone-800 text-white focus:outline-none focus:ring focus:ring-blue-500"
      >
        <option value="" disabled>Select Action</option>
        <option value="start" :disabled="status === 'running'">Start</option>
        <option value="stop" :disabled="status === 'stopped'">Stop</option>
        <option value="restart">Restart</option>
      </select>

      <!-- Execute Button -->
      <button
        @click="executeAction"
        :disabled="loading || !selectedAction"
        class="w-full px-4 py-2 rounded text-white font-bold bg-blue-500 hover:bg-blue-600"
      >
        <span v-if="loading" class="flex items-center justify-center">
          <svg
            class="animate-spin h-5 w-5 mr-2 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            ></path>
          </svg>
          Processing...
        </span>
        <span v-else>Execute</span>
      </button>
    </div>
  </div>
</template>

<script>
import useService from "../composables/useService";

export default {
  props: ["process"],
  data() {
    return {
      status: "unknown", // Process status
      selectedAction: "", // Selected dropdown action
      loading: false, // Loading state
    };
  },
  mounted() {
    this.updateStatus();
  },
  methods: {
    async updateStatus() {
      const { fetchProcessStatus } = useService();
      this.status = await fetchProcessStatus(this.process.process_name);
    },
    async executeAction() {
      if (!this.selectedAction) return;

      const { startProcess, stopProcess } = useService();
      this.loading = true; // Start loading spinner

      try {
        if (this.selectedAction === "start") {
          await startProcess(this.process.process_name);
        } else if (this.selectedAction === "stop") {
          await stopProcess(this.process.process_name);
        } else if (this.selectedAction === "restart") {
          await stopProcess(this.process.process_name);
          await startProcess(this.process.process_name);
        }
        this.updateStatus();
      } catch (err) {
        console.error(`Failed to execute action: ${err.message}`);
        alert("An error occurred while performing the action.");
      } finally {
        this.loading = false; // Stop loading spinner
        this.selectedAction = "";
      }
    },
  },
};
</script>

<!--<style scoped>-->
<!--.service-card {-->
<!--  border: 1px solid #ccc;-->
<!--  padding: 1rem;-->
<!--  margin: 1rem 0;-->
<!--  text-align: center;-->
<!--  background-color: #2d2d2d;-->
<!--  border-radius: 8px;-->
<!--}-->
<!--select {-->
<!--  @apply w-full px-4 py-2 rounded border border-gray-600 bg-stone-800 text-white focus:outline-none focus:ring focus:ring-blue-500;-->
<!--}-->
<!--button {-->
<!--  @apply w-full px-4 py-2 rounded text-white font-bold bg-blue-500 hover:bg-blue-600;-->
<!--}-->
<!--svg {-->
<!--  @apply h-5 w-5 mr-2 text-white;-->
<!--}-->
<!--</style>-->
