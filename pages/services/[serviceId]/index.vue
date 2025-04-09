<script setup>
import useService from "~/services/useService.js";
import { performServiceAction } from "@/composables/serviceActions";
import {PROCESS_STATUS} from "~/constants/enums.js";
const { processService, logsService, configService } = useService()
const route = useRoute()

const service = ref(null)
const editableConfig = ref(null)
const loading = ref(true)
const hasServiceConfig = ref(false)
const serviceStatus = ref("Unknown")
const isProcessing = ref(false)
const persisting = ref(false)
const successMessage = ref("")
const errorMessage = ref("")
const lineCount = ref(1)
const isDMBConfig = ref(true)
const isServiceConfig = ref(false)
const configFormat = ref("json")
const hasServiceLogs = ref(false)
const selectedLog = ref("")
const showLogsView = ref(false)
const logFilterText = ref("")
const logLevelFilter = ref("")
const logLimit = ref(1000)

const filteredLogs = computed(() => {
  let logs = selectedLog.value.split("\n");
  if (logLevelFilter.value) {
    logs = logs.filter((line) => line.includes(logLevelFilter.value));
  }
  if (logFilterText.value.trim()) {
    logs = logs.filter((line) => line.toLowerCase().includes(logFilterText.value.toLowerCase()));
  }
  return logs.slice(-Math.max(1, logLimit.value || 100)).join("\n");
})

const updateLineCount = () => {
  lineCount.value = editableConfig.value.split("\n").length
}
const syncScroll = () => {
  const textarea = this.$refs.textarea;
  const lineNumbers = this.$refs.lineNumbers;
  lineNumbers.scrollTop = textarea.scrollTop;
}
const loadDMBConfig = async () => {
  try {
    const process_name = route.params.serviceId;
    // service.value = await processService.fetchProcess(process_name)

    ///////// TMP WORKAROUND ///////////////
    const response = await processService.fetchProcess(process_name)
    service.value = response.find((service) => service.process_name === process_name)
    ///////// TMP WORKAROUND ///////////////

    const serviceWithConfig = service.value.config && service.value.config.config_file;
    if (serviceWithConfig) {
      hasServiceConfig.value = true;
    }
    editableConfig.value = service.value.config_raw || JSON.stringify(service.value.config, null, 2)
    hasServiceLogs.value = await checkLogsAvailability(service.value.process_name)
    serviceStatus.value = await processService.fetchProcessStatus(service.value.process_name)
    updateLineCount()
  } catch (error) {
    console.error("Failed to load DMB config:", error);
    errorMessage.value = "Failed to load DMB configuration.";
  } finally {
    loading.value = false
  }
}
const loadServiceConfig = async() => {
  isDMBConfig.value = false
  isServiceConfig.value = true
  successMessage.value = ""
  errorMessage.value = ""
  loading.value = true
  try {
    const serviceConfig = await configService.fetchServiceConfig(service.value.process_name)
    const configMapping = {
      yaml: () => serviceConfig.raw,
      json: () => JSON.stringify(serviceConfig.config, null, 2),
      python: () => serviceConfig.raw,
      postgresql: () => serviceConfig.raw,
      rclone: () => serviceConfig.raw,
    }

    if (configMapping[serviceConfig.config_format] && serviceConfig.raw) {
      editableConfig.value = configMapping[serviceConfig.config_format]()
      configFormat.value = serviceConfig.config_format
      hasServiceConfig.value = true
    } else {
      throw new Error("Invalid config format received.")
    }
    updateLineCount()
  } catch (error) {
    console.error("Failed to load service-specific config:", error);
    errorMessage.value = "Failed to load service-specific configuration.";
  } finally {
    loading.value = false;
  }
}
const checkLogsAvailability = async(serviceName) => {
  try {
    const logs = await logsService.fetchServiceLogs(serviceName)
    if (!logs || logs.trim() === "" || logs.includes("No logs")) {
      return false
    }
    return true;
  } catch (error) {
    console.error(`Error checking logs for ${serviceName}:`, error);
    return false;
  }
}
const fetchLogs = async() => {
  if (!service.value.process_name) return;

  try {
    const { logsService } = useService()
    selectedLog.value = await logsService.fetchServiceLogs(service.value.process_name);
    showLogsView.value = true;

    await nextTick(() => {
      const logBox = ref.logBox
      if (logBox) {
        logBox.scrollTop = logBox.scrollHeight;
      }
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    selectedLog.value = "Failed to load logs.";
  }
}
const downloadLogs = () => {
  const blob = new Blob([selectedLog.value], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `logs_${service.value.process_name}.log`;
  link.click();
}
const updateConfig = async(persist) => {
  isProcessing.value = true;
  persisting.value = persist;
  successMessage.value = "";
  errorMessage.value = "";
  try {
    const { configService } = useService()
    if (isDMBConfig.value) {
      const configToSend = configFormat.value === "json" ? JSON.parse(editableConfig.value) : editableConfig.value;
      await configService.updateDMBConfig(service.value.process_name, configToSend, persist);
    } else {
      await configService.updateServiceConfig(
          service.value.process_name,
          editableConfig.value,
          configFormat.value
      );
    }
    successMessage.value = persist ? "Configuration saved successfully to file." : "Configuration applied in memory successfully.";
  } catch (error) {
    console.error("Failed to update config:", error);
    errorMessage.value = error.message || "An error occurred while updating the configuration.";
  } finally {
    isProcessing.value = false;
  }
}
const startService = async() => {
  if (serviceStatus.value === "running") {
    successMessage.value = "The process is already running.";
    return;
  }
  await performAction("start", (status) => {
    serviceStatus.value = status;
    successMessage.value = "Service started successfully.";
  });
}
const stopService = async() => {
  if (serviceStatus.value === "stopped") {
    successMessage.value = "The process is already stopped.";
    return;
  }
  await performAction("stop", (status) => {
    serviceStatus.value = status;
    successMessage.value = "Service stopped successfully.";
  });
}
const restartService = async() => {
  await performAction("restart", (status) => {
    serviceStatus.value = status;
    successMessage.value = "Service restarted successfully.";
  });
}
const performAction = async(action, successCallback) => {
  isProcessing.value = true;
  try {
    await performServiceAction(service.value.process_name, action, successCallback);
  } catch (error) {
    errorMessage.value = `Failed to ${action} service: ${error.message}`;
  } finally {
    isProcessing.value = false;
  }
}

onMounted(async () => {
  await loadDMBConfig()
})
</script>

<template>
  <div class="relative h-full text-white overflow-auto bg-gray-900 flex flex-col gap-8 px-4 py-4 md:px-8">

    <div class="flex items-center justify-between gap-2 w-full">
      <div class="flex items-center gap-3">
        <p class="text-xl font-bold">{{ service?.process_name }}</p>
        <div
            :class="{'bg-green-400': serviceStatus === PROCESS_STATUS.RUNNING,'bg-red-400': serviceStatus === PROCESS_STATUS.STOPPED,'bg-yellow-400': serviceStatus === PROCESS_STATUS.UNKNOWN}"
            class="w-4 h-4 rounded-full"
        />
      </div>

      <div class="flex justify-center gap-2">
        <button
            v-if="hasServiceConfig"
            @click="() => { loadDMBConfig(); showLogsView = false; }"
            :class="{ 'bg-gray-500 text-gray-300': isDMBConfig && !showLogsView, 'bg-gray-700 text-white': !isDMBConfig || showLogsView }"
            class="button-small"
        >
          Edit DMB Config
        </button>
        <button
            v-if="hasServiceConfig"
            @click="() => { loadServiceConfig(); showLogsView = false; }"
            :class="{ 'bg-gray-500 text-gray-300': !isDMBConfig && !showLogsView, 'bg-gray-700 text-white': isDMBConfig || showLogsView }"
            class="button-small"
        >
          Edit Service Config
        </button>
        <button
            v-if="hasServiceLogs"
            @click="() => { fetchLogs(); showLogsView = true; }"
            :class="{ 'bg-gray-500 text-gray-300': showLogsView, 'bg-gray-700 text-white': !showLogsView }"
            class="button-small"
        >
          View Logs
        </button>
      </div>
    </div>

    <!-- Logs View with Filters -->
    <div v-if="showLogsView" class="log-container">
      <div class="log-header flex justify-between items-center w-full">
        <h3>Logs for {{ service?.process_name }}</h3>
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
          <button @click="downloadLogs" class="px-2 py-1 text-sm border rounded bg-blue-500 text-white hover:bg-blue-600">
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
        <div class="flex gap-2">
          <button
            @click="startService"
            :disabled="isProcessing || serviceStatus === PROCESS_STATUS.RUNNING "
            class="button-small start"
          >
            Start
          </button>
          <button
            @click="stopService"
            :disabled="isProcessing || serviceStatus === PROCESS_STATUS.STOPPED"
            class="button-small stop"
          >
            Stop
          </button>
          <button
            @click="restartService"
            :disabled="isProcessing"
            class="button-small restart"
          >
            Restart
          </button>
        </div>

        <!-- Apply and Save Buttons (Right-Aligned) -->
        <div class="flex gap-4">
          <button
            @click="updateConfig(false)"
            :disabled="isProcessing"
            class="button-small apply"
          >
            Apply in Memory
          </button>
          <button
            @click="updateConfig(true)"
            :disabled="isProcessing"
            class="button-small start"
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
