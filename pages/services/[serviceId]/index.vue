<template>
  <div class="flex flex-col items-center justify-center h-full w-full p-6 overflow-hidden">
    <!-- Service Title -->
    <h1 class="text-3xl font-bold mb-2">
      {{ currentService.process_name || "Service Details" }}
    </h1>

    <!-- Config Type Toggle -->
    <!-- only show the Edit Service Config if a config exist-->

    <div class="flex justify-center gap-4 mb-4">
      <button
        v-if="hasServiceConfig"
        @click="() => { loadDMBConfig(); showLogsView = false; }"
        :class="{ 'bg-gray-500 text-gray-300': isDMBConfig && !showLogsView, 'bg-gray-700 text-white': !isDMBConfig || showLogsView }"
        class="px-4 py-2 rounded hover:bg-gray-600"
      >
        Edit DMB Config
      </button>
      <button
        v-if="hasServiceConfig"
        @click="() => { loadServiceConfig(); showLogsView = false; }"
        :class="{ 'bg-gray-500 text-gray-300': !isDMBConfig && !showLogsView, 'bg-gray-700 text-white': isDMBConfig || showLogsView }"
        class="px-4 py-2 rounded hover:bg-gray-600"
      >
        Edit Service Config
      </button>
      <button
        v-if="hasServiceLogs"
        @click="() => { fetchLogs(); showLogsView = true; }"
        :class="{ 'bg-gray-500 text-gray-300': showLogsView, 'bg-gray-700 text-white': !showLogsView }"
        class="px-4 py-2 rounded hover:bg-gray-600"
      >
        View Logs
      </button>
    </div>

    <!-- Service Status -->
    <p v-if="!loading" class="text-lg mb-6">
      Status: <span :class="statusClass">{{ serviceStatus }}</span>
    </p>
    <!-- Logs View with Filters -->
    <div v-if="showLogsView" class="log-container">
      <div class="log-header flex justify-between items-center w-full">
        <h3>Logs for {{ currentService.process_name }}</h3>
        <!-- Filters and Actions -->
        <div class="flex gap-2">
          <input
            v-model="logFilterText"
            placeholder="Filter logs..."
            class="px-2 py-1 text-sm border rounded bg-gray-800 text-white"
          />
          <select v-model="logLevelFilter" class="px-2 py-1 text-sm border rounded bg-gray-800 text-white">
            <option value="">All Levels</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <input
            v-model.number="logLimit"
            type="number"
            min="1"
            placeholder="Log Lines"
            class="px-2 py-1 text-sm border rounded bg-gray-800 text-white w-24"
          />
          <button
            @click="downloadLogs"
            class="px-2 py-1 text-sm border rounded bg-blue-500 text-white hover:bg-blue-600"
          >
            Download Logs
          </button>
        </div>
      </div>

      <pre ref="logBox" class="log-output">{{ filteredLogs }}</pre>
    </div>
    <!-- Loading State -->
    <div v-if="loading" class="text-center text-lg text-gray-400">
      Loading configuration...
    </div>
    <!-- Config View (Default) -->
    <div v-else-if="!showLogsView" class="w-full max-h-[calc(100vh-200px)] overflow-y-auto flex flex-col h-full">
      <!-- Config Box -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Line Numbers and Textarea -->
        <div class="flex w-full h-full">
          <!-- Line Numbers -->
          <div class="line-number-container" ref="lineNumbers">
            <div v-for="line in lineCount" :key="line" class="line-number">
              {{ line }}
            </div>
          </div>
          <textarea
            v-model="editableConfig"
            @input="updateLineCount"
            @scroll="syncScroll"
            class="config-textarea"
            spellcheck="false"
            ref="textarea"
          ></textarea>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-between items-center mt-4">
        <!-- Start, Stop, Restart Buttons (Left-Aligned) -->
        <div class="flex gap-4">
          <button
            @click="startService"
            :disabled="isProcessing || serviceStatus === 'running'"
            class="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Start
          </button>
          <button
            @click="stopService"
            :disabled="isProcessing || serviceStatus === 'stopped'"
            class="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Stop
          </button>
          <button
            @click="restartService"
            :disabled="isProcessing"
            class="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
          >
            Restart
          </button>
        </div>

        <!-- Apply and Save Buttons (Right-Aligned) -->
        <div class="flex gap-4">
          <button
            @click="updateConfig(false)"
            :disabled="isProcessing"
            class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Apply in Memory
          </button>
          <button
            @click="updateConfig(true)"
            :disabled="isProcessing"
            class="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Save to File
          </button>
        </div>
      </div>

      <!-- Success/Failure Messages -->
      <div v-if="successMessage" class="text-green-400 mt-4">
        {{ successMessage }}
      </div>
      <div v-if="errorMessage" class="text-red-400 mt-4">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>


<script>
import useService from "~/services/useService.js";
import { performServiceAction } from "@/composables/serviceActions";

export default {
  data() {
    return {
      currentService: {},
      editableConfig: "",
      serviceStatus: "Unknown",
      loading: true,
      isProcessing: false,
      persisting: false,
      successMessage: "",
      errorMessage: "",
      lineCount: 1,
      isDMBConfig: true,
      isServiceConfig: false,
      configFormat: "json",
      hasServiceConfig: false,
      hasServiceLogs: false,
      selectedLog: "",
      showLogsView: false,
      logFilterText: "",
      logLevelFilter: "",
      logLimit: 1000,
    };
  },
  async mounted() {
    await this.loadDMBConfig();
  },
  computed: {
    statusClass() {
      return {
        "text-green-500": this.serviceStatus === "running",
        "text-red-500": this.serviceStatus === "stopped",
        "text-yellow-500": this.serviceStatus === "unknown",
      };
    },
    filteredLogs() {
      let logs = this.selectedLog.split("\n");
      if (this.logLevelFilter) {
        logs = logs.filter((line) => line.includes(this.logLevelFilter));
      }
      if (this.logFilterText.trim()) {
        logs = logs.filter((line) => line.toLowerCase().includes(this.logFilterText.toLowerCase()));
      }
      return logs.slice(-Math.max(1, this.logLimit || 100)).join("\n");
    },
  },
  methods: {
    updateLineCount() {
      this.lineCount = this.editableConfig.split("\n").length;
    },
    syncScroll() {
      const textarea = this.$refs.textarea;
      const lineNumbers = this.$refs.lineNumbers;
      lineNumbers.scrollTop = textarea.scrollTop;
    },
    async loadDMBConfig() {
      this.isDMBConfig = true;
      this.isServiceConfig = false;
      this.successMessage = "";
      this.errorMessage = "";
      this.loading = true;
      this.hasServiceConfig = false;
      this.hasServiceLogs = false;
      this.selectedLog = "";
      try {
        const { processService } = useService()
        const serviceId = this.$route.params.serviceId;
        const services = await processService.fetchProcesses();
        this.currentService =
          services.find((service) => service.process_name === serviceId) || {};
        const serviceWithConfig = this.currentService.config && this.currentService.config.config_file;
        if (serviceWithConfig) {
          this.hasServiceConfig = true;
        }
        this.editableConfig = this.currentService.config_raw || JSON.stringify(this.currentService.config, null, 2);
        this.configFormat = "json";
        const logsExist = await this.checkLogsAvailability(this.currentService.process_name);
        this.hasServiceLogs = logsExist;
        this.serviceStatus = await processService.fetchProcessStatus(this.currentService.process_name);
        this.updateLineCount();
      } catch (error) {
        console.error("Failed to load DMB config:", error);
        this.errorMessage = "Failed to load DMB configuration.";
      } finally {
        this.loading = false;
      }
    },
    async loadServiceConfig() {
      this.isDMBConfig = false;
      this.isServiceConfig = true;
      this.successMessage = "";
      this.errorMessage = "";
      this.loading = true;
      try {
        const { configService } = useService()
        const serviceId = this.$route.params.serviceId;
        const serviceConfig = await configService.fetchServiceConfig(serviceId);
        const configMapping = {
          yaml: () => serviceConfig.raw,
          json: () => JSON.stringify(serviceConfig.config, null, 2),
          python: () => serviceConfig.raw,
          postgresql: () => serviceConfig.raw,
          rclone: () => serviceConfig.raw,
        };

        if (configMapping[serviceConfig.config_format] && serviceConfig.raw) {
          this.editableConfig = configMapping[serviceConfig.config_format]();
          this.configFormat = serviceConfig.config_format;
          this.hasServiceConfig = true;
        } else {
          throw new Error("Invalid config format received.");
        }
        this.updateLineCount();
      } catch (error) {
        console.error("Failed to load service-specific config:", error);
        this.errorMessage = "Failed to load service-specific configuration.";
      } finally {
        this.loading = false;
      }
    },
    async checkLogsAvailability(serviceName) {
      try {
        const { logsService } = useService()
        const logs = await logsService.fetchServiceLogs(serviceName);
        if (!logs || logs.trim() === "" || logs.includes("No logs")){
          return false;
        }
        return true;
      } catch (error) {
        console.error(`Error checking logs for ${serviceName}:`, error);
        return false;
      }
    },
    async fetchLogs() {
      if (!this.currentService.process_name) return;

      try {
        const { logsService } = useService()
        this.selectedLog = await logsService.fetchServiceLogs(this.currentService.process_name);
        this.showLogsView = true;

        this.$nextTick(() => {
          const logBox = this.$refs.logBox;
          if (logBox) {
            logBox.scrollTop = logBox.scrollHeight;
          }
        });
      } catch (error) {
        console.error("Error fetching logs:", error);
        this.selectedLog = "Failed to load logs.";
      }
    },
    downloadLogs() {
      const blob = new Blob([this.selectedLog], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `logs_${this.currentService.process_name}.log`;
      link.click();
    },
    async updateConfig(persist) {
      this.isProcessing = true;
      this.persisting = persist;
      this.successMessage = "";
      this.errorMessage = "";
      try {
        const { configService } = useService()
        if (this.isDMBConfig) {
          const configToSend =
            this.configFormat === "json" ? JSON.parse(this.editableConfig) : this.editableConfig;
          await configService.updateDMBConfig(this.currentService.process_name, configToSend, persist);
        } else {
          await configService.updateServiceConfig(
            this.currentService.process_name,
            this.editableConfig,
            this.configFormat
          );
        }
        this.successMessage = persist
          ? "Configuration saved successfully to file."
          : "Configuration applied in memory successfully.";
      } catch (error) {
        console.error("Failed to update config:", error);
        this.errorMessage = error.message || "An error occurred while updating the configuration.";
      } finally {
        this.isProcessing = false;
      }
    },
    async startService() {
      if (this.serviceStatus === "running") {
        this.successMessage = "The process is already running.";
        return;
      }
      await this.performAction("start", (status) => {
        this.serviceStatus = status;
        this.successMessage = "Service started successfully.";
      });
    },
    async stopService() {
      if (this.serviceStatus === "stopped") {
        this.successMessage = "The process is already stopped.";
        return;
      }
      await this.performAction("stop", (status) => {
        this.serviceStatus = status;
        this.successMessage = "Service stopped successfully.";
      });
    },
    async restartService() {
      await this.performAction("restart", (status) => {
        this.serviceStatus = status;
        this.successMessage = "Service restarted successfully.";
      });
    },
    async performAction(action, successCallback) {
      this.isProcessing = true;
      try {
        await performServiceAction(this.currentService.process_name, action, successCallback);
      } catch (error) {
        this.errorMessage = `Failed to ${action} service: ${error.message}`;
      } finally {
        this.isProcessing = false;
      }
    },
  },
};
</script>


<style scoped>
textarea {
  font-family: monospace;
  font-size: 1rem;
  width: 100%;
  height: 60vh;
  min-height: 300px;
  resize: none;
  overflow: auto;
  box-sizing: border-box;
}
@media (min-width: 768px) {
  textarea {
    height: 70vh;
  }
}
@media (min-width: 1200px) {
  textarea {
    height: 75vh;
  }
}
button {
  transition: background-color 0.3s, color 0.3s;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.text-green-500 {
  color: #10b981;
}
.text-red-500 {
  color: #ef4444;
}
.text-yellow-500 {
  color: #f59e0b;
}
.line-number-container {
  font-family: monospace;
  font-size: 1rem;
  line-height: 1.5rem;
  text-align: right;
  padding-right: 0.5rem;
  color: #aaa;
  background-color: #2a2a2a;
  overflow: hidden;
  height: 100%;
}
.line-number {
  line-height: 1.5rem;
}
.config-textarea {
  font-family: monospace;
  font-size: 1rem;
  line-height: 1.5rem;
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  overflow-y: auto;
  box-sizing: border-box;
  background-color: #1e1e1e;
  color: white;
}
.log-container {
  background-color: #1e1e1e;
  color: white;
  padding: 10px;
  border-radius: 5px;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  margin-top: 20px;
  border: 1px solid #333;
  position: relative;
}
.log-header {
  font-weight: bold;
  padding-bottom: 5px;
  border-bottom: 1px solid #444;
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #1e1e1e;
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 10px;
}
.log-output {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  font-size: 0.9rem;
  height: 100%;
  max-height: none;
  flex-grow: 1;
  overflow-y: auto;
}
</style>
