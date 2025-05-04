<script setup>
import JsonEditorVue from 'json-editor-vue'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'
import useService from "~/services/useService.js";
import { performServiceAction } from "@/composables/serviceActions";
import {PROCESS_STATUS} from "~/constants/enums.js";
import SelectComponent from "~/components/SelectComponent.vue";
import {logParserService} from "~/helper/logParserService.js";
const { processService, configService } = useService()
const route = useRoute()

const loading = ref(true)
const process_name_param = ref(null)
const service = ref(null)
const DMBConfig = ref(null)
const serviceConfig = ref(null)
const serviceStatus = ref("Unknown")
const serviceLogs = ref(null)

const isProcessing = ref(false)
const persisting = ref(false)
const successMessage = ref("")
const errorMessage = ref("")
const isDMBConfig = ref(true)
const configFormat = ref("json")


const filterText = ref("");
const selectedFilter = ref("");
const maxLength = ref(1000);
const logContainer = ref(null);

const selectedTab = ref(2)
const optionList = computed(() => [
  {
    icon: 'settings',
    text: 'DMB Config'
  },
  {
    icon: 'stacks',
    text: 'Service Config',
    disabled: !serviceConfig.value
  },
  {
    icon: 'data_object',
    text: 'Service Logs',
    disabled: !serviceLogs.value
  }
])

const items = [
  { value: '', label: 'All Logs' },
  { value: 'INFO', label: 'Info' },
  { value: 'DEBUG', label: 'Debug' },
  { value: 'ERROR', label: 'Error' },
  { value: 'WARNING', label: 'Warning' }
]

const filteredLogs = computed(() => {
  const text = filterText.value.toLowerCase()
  const levelOrProcessFilter = selectedFilter.value

  // Apply text and filter logic
  const filtered = serviceLogs?.value?.filter(log => {
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
    return filtered?.slice(-max)
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

const syncScroll = () => {
  const textarea = this.$refs.textarea;
  const lineNumbers = this.$refs.lineNumbers;
  lineNumbers.scrollTop = textarea.scrollTop;
}

const loadDMBConfig = async (processName) => {
  try {

    service.value = await processService.fetchProcess(processName)
    DMBConfig.value = service.value.config_raw || service.value.config
    // hasServiceLogs.value = await checkLogsAvailability(service.value.process_name)
    serviceStatus.value = await processService.fetchProcessStatus(service.value.process_name)
  } catch (error) {
    console.error("Failed to load DMB config:", error);
    errorMessage.value = "Failed to load DMB configuration.";
  } finally {
    loading.value = false
  }
}

const loadServiceConfig = async(processName) => {
  errorMessage.value = ""
  try {
    const response = await configService.fetchServiceConfig(processName)
    serviceConfig.value = response.config
    // const configMapping = {
    //   yaml: () => serviceConfig.raw,
    //   json: () => JSON.stringify(serviceConfig.config, null, 2),
    //   python: () => serviceConfig.raw,
    //   postgresql: () => serviceConfig.raw,
    //   rclone: () => serviceConfig.raw,
    // }
    // if (configMapping[serviceConfig.config_format] && serviceConfig.raw) {
    //   serviceConfig.value = configMapping[serviceConfig.config_format]()
    //   configFormat.value = serviceConfig.config_format
    //
    // } else {
    //   throw new Error("Invalid config format received.")
    // }

  } catch (error) {
    console.error("Failed to load service-specific config:", error);
    errorMessage.value = "Failed to load service-specific configuration.";
  }
}

const fetchLogs = async(processName) => {
  try {
    const { logsService } = useService()
    const response = await logsService.fetchServiceLogs(processName);
    console.log('processName: ', response);
    if (!response || response.trim() === "" || response.includes("No logs")) {
      return
    }
    serviceLogs.value = logParserService(response, 'Riven')
    // await nextTick(() => {
    //   const logBox = ref.logBox
    //   if (logBox) {
    //     logBox.scrollTop = logBox.scrollHeight;
    //   }
    // });
  } catch (error) {
    console.error("Error fetching logs:", error);
    serviceLogs.value = "Failed to load logs.";
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
      const configToSend = configFormat.value === "json" ? JSON.parse(serviceConfig.value) : serviceConfig.value;
      await configService.updateDMBConfig(service.value.process_name, configToSend, persist);
    } else {
      await configService.updateServiceConfig(
          service.value.process_name,
          serviceConfig.value,
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
const scrollToBottom = () => {
  if (logContainer.value) {
    // Smooth scroll is optional; remove behavior for instant scroll
    logContainer.value.scrollTop = logContainer.value.scrollHeight;
  }
};

const setActiveSavedTab = (tabId) => { selectedTab.value = tabId }

onMounted(async () => {
  process_name_param.value = route.params.serviceId
  await Promise.all([loadDMBConfig(process_name_param.value), loadServiceConfig(process_name_param.value), fetchLogs(process_name_param.value)])
  loading.value = false
})
</script>

<template>
  <div class="grow flex flex-col">

    <!-- Loading State -->
    <div v-if="loading" class="mx-auto flex gap-2 items-center mt-24">
      <span class="animate-spin material-symbols-rounded text-gray-400">progress_activity</span>
      <span class="text-center text-xl text-gray-400">Loading configuration...</span>
    </div>

    <div v-else class="grow flex flex-col">
      <div class="flex items-center justify-between gap-2 w-full px-4 py-2">
        <div class="flex items-center gap-3">
          <p class="text-xl font-bold">{{ service?.process_name }}</p>
          <div
              :class="{'bg-green-400': serviceStatus === PROCESS_STATUS.RUNNING,'bg-red-400': serviceStatus === PROCESS_STATUS.STOPPED,'bg-yellow-400': serviceStatus === PROCESS_STATUS.UNKNOWN}"
              class="w-3 h-3 rounded-full"
          />
        </div>
      </div>

      <TabBar :selected-tab="selectedTab" :option-list="optionList" @selected-tab="setActiveSavedTab" class="mb-2" />

      <div v-if="selectedTab === 0">
        <JsonEditorVue
            v-model="DMBConfig"
            v-bind="{/* local props & attrs */}"
            class="jse-theme-dark"
        />
      </div>

      <!-- Config View (Default) -->
      <div v-if="selectedTab === 1" class="flex flex-col overscroll-contain">
        <!-- Config Box -->
        <JsonEditorVue
            v-model="serviceConfig"
            v-bind="{/* local props & attrs */}"
            class="jse-theme-dark"
        />

        <!-- Actions -->
        <div class="flex justify-between items-center mt-4">
          <!-- Start, Stop, Restart Buttons (Left-Aligned) -->
          <div class="flex gap-2">
            <button @click="startService" :disabled="isProcessing || serviceStatus === PROCESS_STATUS.RUNNING " class="button-small start">
              Start
            </button>
            <button @click="stopService" :disabled="isProcessing || serviceStatus === PROCESS_STATUS.STOPPED" class="button-small stop">
              Stop
            </button>
            <button @click="restartService" :disabled="isProcessing" class="button-small restart">
              Restart
            </button>
          </div>

          <!-- Apply and Save Buttons (Right-Aligned) -->
          <div class="flex gap-4">
            <button @click="updateConfig(false)" :disabled="isProcessing" class="button-small apply">
              Apply in Memory
            </button>
            <button @click="updateConfig(true)" :disabled="isProcessing" class="button-small start">
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
      <!-- Logs View with Filters -->
      <div v-if="selectedTab === 2" class="log-container">

        <div class="flex flex-col md:flex-row md:items-center gap-2 py-2 px-4 w-full border-b border-slate-700">
          <!-- Controls Section -->
          <div class="flex items-center justify-between grow gap-2">
            <div class="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 grow">
              <Input v-model="filterText" :placeholder="'Enter text to filter logs'" class="block"/>

              <div class="grow flex items-center justify-between">
                <div class="flex items-center gap-2 md:gap-4 grow">
                  <Input v-model="maxLength" min="1" :placeholder="'Max Logs'" type="number" class="block" />
                  <SelectComponent v-model="selectedFilter" :items="items" />
                </div>

                <button @click="downloadLogs" class="button-small download">
                  <span class="material-symbols-rounded !text-[18px]">download</span>
                  <span class="hidden md:inline">Download Logs</span>
                </button>
              </div>
            </div>

          </div>
        </div>

        <!-- Logs Section -->
        <div class="relative overflow-x-auto grow" ref="logContainer">
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
<!--            <tr v-for="log in filteredLogs" :key="log.timestamp" :class="getLogLevelClass(log.level)" class="whitespace-nowrap odd:bg-gray-900 even:bg-gray-800">-->
<!--              <td class="text-xs px-2 py-0.1">{{ log.timestamp.toLocaleString() }}</td>-->
<!--              <td class="text-xs px-2 py-0.1">{{ log.level }}</td>-->
<!--              <td class="text-xs px-2 py-0.1">{{ log.process }}</td>-->
<!--              <td class="text-xs px-2 py-0.1">{{ log.message }}</td>-->
<!--            </tr>-->
            <tr v-for="(log, index) in serviceLogs" :key="index" class="whitespace-nowrap odd:bg-gray-900 even:bg-gray-800">
              <td class="text-xs px-2 py-0.1">{{ log }}</td>
            </tr>
            </tbody>
          </table>
        </div>

<!--        <pre ref="logContainer" class="log-output">{{ filteredLogs }}</pre>-->
        <button class="fixed bottom-4 right-4 rounded-full bg-slate-700 hover:bg-slate-500 flex items-center justify-center w-8 h-8" @click="scrollToBottom">
          <span class="material-symbols-rounded !text-[26px]">keyboard_arrow_down</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>
