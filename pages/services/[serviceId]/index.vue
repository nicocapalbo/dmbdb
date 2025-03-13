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
        @click="loadDMBConfig"
        :class="{ 'bg-gray-700 text-white': !isDMBConfig, 'bg-gray-500 text-gray-300': isDMBConfig }"
        class="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
      >
        Edit DMB Config
      </button>
      <button
        v-if="hasServiceConfig"
        @click="loadServiceConfig"
        :class="{ 'bg-gray-700 text-white': isDMBConfig, 'bg-gray-500 text-gray-300': !isDMBConfig }"
        class="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
      >
        Edit Service Config
      </button>
    </div>

    <!-- Service Status -->
    <p v-if="!loading" class="text-lg mb-6">
      Status: <span :class="statusClass">{{ serviceStatus }}</span>
    </p>

    <!-- Loading State -->
    <div v-if="loading" class="text-center text-lg text-gray-400">
      Loading configuration...
    </div>

    <!-- Editable Service Configuration -->
    <div v-else class="w-full max-h-[calc(100vh-200px)] overflow-y-auto flex flex-col h-full">
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
import useService from "@/composables/useService";
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
      configFormat: "json",
      hasServiceConfig: false,
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
      this.successMessage = "";
      this.errorMessage = "";
      this.loading = true;
      this.hasServiceConfig = false;
      try {
        const { fetchProcesses, fetchProcessStatus } = useService();
        const serviceId = this.$route.params.serviceId;
        const services = await fetchProcesses();
        this.currentService =
          services.find((service) => service.process_name === serviceId) || {};
        const serviceWithConfig = this.currentService.config && this.currentService.config.config_file;
        if (serviceWithConfig) {
          this.hasServiceConfig = true;
        }
        this.editableConfig = this.currentService.config_raw || JSON.stringify(this.currentService.config, null, 2);
        this.configFormat = "json";
        this.serviceStatus = await fetchProcessStatus(this.currentService.process_name);
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
      this.successMessage = "";
      this.errorMessage = "";
      this.loading = true;
      try {
        const { fetchServiceConfig } = useService();
        const serviceId = this.$route.params.serviceId;
        const serviceConfig = await fetchServiceConfig(serviceId);
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
    async updateConfig(persist) {
      this.isProcessing = true;
      this.persisting = persist;
      this.successMessage = "";
      this.errorMessage = "";
      try {
        const { updateDMBConfig, updateServiceConfig } = useService();
        if (this.isDMBConfig) {
          const configToSend =
            this.configFormat === "json" ? JSON.parse(this.editableConfig) : this.editableConfig;
          await updateDMBConfig(this.currentService.process_name, configToSend, persist);
        } else {
          await updateServiceConfig(
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
</style>
