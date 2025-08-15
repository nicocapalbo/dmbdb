<script setup>
import JsonEditorVue from 'json-editor-vue'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'
import useService from "~/services/useService.js"
import { performServiceAction } from "@/composables/serviceActions"
import { PROCESS_STATUS, SERVICE_ACTIONS } from "~/constants/enums.js"
import SelectComponent from "~/components/SelectComponent.vue"
import { serviceTypeLP } from "~/helper/ServiceTypeLP.js"
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true, useDefaults: true })
addFormats(ajv)

const toast = useToast()
const { processService, configService } = useService()
const route = useRoute()
import { useProcessesStore } from '~/stores/processes.js'
const processesStore = useProcessesStore()
const projectName = computed(() => processesStore.projectName)

const loading = ref(true)
const process_name_param = ref(null)
const service = ref(null)
const Config = ref(null)
const serviceConfig = ref(null)
const serviceStatus = ref('Unknown')
const serviceLogs = ref([]) // keep array to avoid .filter crashes
const isProcessing = ref(false)
const configFormat = ref(null)
const filterText = ref('')
const selectedFilter = ref('')
const maxLength = ref(1000)
const logContainer = ref(null)
const selectedTab = ref(0)
const processSchema = ref(null)
const validationErrors = ref([])
const logCursor = ref(null) // byte offset maintained by server

const optionList = computed(() => [
  { icon: 'settings', text: `${projectName.value} Config` },
  { icon: 'stacks', text: 'Service Config', disabled: !serviceConfig.value },
  { icon: 'data_object', text: 'Service Logs', disabled: !serviceLogs.value?.length }
])

const items = [
  { value: '', label: 'All Logs' },
  { value: 'INFO', label: 'Info' },
  { value: 'DEBUG', label: 'Debug' },
  { value: 'ERROR', label: 'Error' },
  { value: 'WARNING', label: 'Warning' }
]

const filteredLogs = computed(() => {
  const logs = Array.isArray(serviceLogs.value) ? serviceLogs.value : []
  const text = (filterText.value || '').toLowerCase()
  const levelFilter = (selectedFilter?.value || '').toLowerCase()
  const filtered = logs.filter(log => {
    const lv = (log.level || '').toLowerCase()
    const msg = (log.message || '').toLowerCase()
    const matchesLevel = !levelFilter || lv.includes(levelFilter)
    const matchesText = !text || msg.includes(text)
    return matchesLevel && matchesText
  })
  const max = parseInt(maxLength.value, 10)
  return (!isNaN(max) && max > 0) ? filtered.slice(-max) : filtered
})

const getLogLevelClass = (level) => {
  const l = String(level || '').toUpperCase()
  if (l.includes('ERROR')) return 'text-red-500'
  if (l.includes('WARN')) return 'text-yellow-400'
  if (l.includes('NOTICE')) return 'text-green-400'
  if (l.includes('INFO')) return 'text-green-400'
  if (l.includes('DEBUG')) return 'text-blue-400'
  return 'text-gray-400'
}

const getServiceStatus = async (processName) => {
  try { serviceStatus.value = await processService.fetchProcessStatus(processName) }
  catch (error) { console.error('Failed to fetch service status:', error); serviceStatus.value = 'Unknown' }
}

const getConfig = async (processName) => {
  try {
    service.value = await processService.fetchProcess(processName)
    // If backend returns a raw string, keep it for the editor, but we'll parse on change/save
    Config.value = service.value?.config_raw ?? service.value?.config ?? {}
  } catch (error) {
    console.error(`Failed to load ${projectName.value} config:`, error)
  } finally { loading.value = false }
}

const getProcessSchema = async (processName) => {
  try { processSchema.value = await configService.getProcessConfigSchema(processName) }
  catch (e) { console.warn('Process schema unavailable; backend will validate on save.', e); processSchema.value = null }
}

const getServiceConfig = async (processName) => {
  try {
    const response = await configService.fetchServiceConfig(processName)
    serviceConfig.value = response?.config
    configFormat.value = response?.config_format
  } catch (error) { console.error('Failed to load service-specific config:', error) }
}

const getLogs = async (processName, initial = false) => {
  try {
    const { logsService } = useService()

    // Only include cursor if we actually have one
    const params = {
      tail_bytes: Math.max(65536, (parseInt(maxLength.value, 10) || 1000) * 200),
      ...(initial ? {} : (typeof logCursor.value === 'number' ? { cursor: logCursor.value } : {}))
    }

    const resp = await logsService.fetchServiceLogs(processName, params)

    // Legacy server: resp is a string of the full log
    if (typeof resp === 'string') {
      // Treat as "reset" since it's a full snapshot
      serviceLogs.value = []
      appendParsedLogs(resp)
      // No reliable cursor from legacy endpoint – leave logCursor as-is
      return
    }

    // New server: resp is { cursor, chunk, reset[, log] }
    if (!resp) return
    if (typeof resp.cursor === 'number') logCursor.value = resp.cursor
    if (resp.reset) {
      serviceLogs.value = []
      appendParsedLogs(resp.chunk || resp.log || '')
    } else {
      appendParsedLogs(resp.chunk || '')
    }
  } catch (e) {
    console.error('Error fetching logs:', e)
  }
}

const downloadLogs = () => {
  const rows = (Array.isArray(filteredLogs.value) ? filteredLogs.value : []).map(({ timestamp, level, process, message }) => {
    const d = new Date(timestamp); const f = n => String(n).padStart(2, '0')
    const date = `${f(d.getDate())}/${f(d.getMonth() + 1)}/${d.getFullYear()} ${f(d.getHours())}:${f(d.getMinutes())}:${f(d.getSeconds())}`
    return `[${date}] [${level}] [${process}] ${message}`
  })
  const blob = new Blob([rows.join('\n')], { type: 'text/plain' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `logs_${service.value?.process_name || 'service'}.log`; a.click(); window.URL.revokeObjectURL(url)
}

// --- Validation helpers (PROCESS TAB ONLY) ---
function validateAndCoerce(schema, data) {
  if (!schema || typeof schema !== 'object') return { ok: true, data, errors: [] }
  let validator
  try {
    const hasId = typeof schema.$id === 'string' && schema.$id.length > 0
    if (hasId) validator = ajv.getSchema(schema.$id)
    if (!validator) validator = ajv.compile(schema)
  } catch (e) {
    console.warn('Schema compile failed; skipping client validation', e)
    return { ok: true, data, errors: [] }
  }
  const draft = JSON.parse(JSON.stringify(data))
  const ok = validator(draft)
  return { ok, data: draft, errors: ok ? [] : (validator.errors || []) }
}

// Parse the editor text into an object when in text mode
function normalizeToObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : parsed }
    catch (e) { throw new Error(`Invalid JSON: ${e.message}`) }
  }
  return value
}

function onProcessChange({ json, text }) {
  if (selectedTab.value !== 0) return
  let draft = json
  if (json === undefined) { // text mode
    try { draft = JSON.parse(text ?? '') }
    catch (e) { validationErrors.value = [{ instancePath: '', message: e.message }]; return }
  }
  Config.value = draft
  const { ok, errors } = validateAndCoerce(processSchema.value, draft)
  validationErrors.value = ok ? [] : errors
}

watch([processSchema, selectedTab], () => {
  if (selectedTab.value !== 0) return
  if (!processSchema.value || Config.value == null) return
  const candidate = (() => { try { return normalizeToObject(Config.value) } catch { return null } })()
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) { validationErrors.value = [{ instancePath: '', message: 'root must be object' }]; return }
  const { ok, errors } = validateAndCoerce(processSchema.value, candidate)
  validationErrors.value = ok ? [] : errors
})

const updateConfig = async (persist) => {
  isProcessing.value = true
  try {
    if (selectedTab.value === 0) {
      // Defensively parse if user pasted in text mode
      let candidate
      try { candidate = normalizeToObject(Config.value) }
      catch (e) { validationErrors.value = [{ instancePath: '', message: e.message }]; toast.error({ title: 'Invalid JSON', message: 'Fix JSON before saving.' }); return }

      const { ok, data, errors } = validateAndCoerce(processSchema.value, candidate)
      if (!ok) { validationErrors.value = errors; toast.error({ title: 'Invalid config', message: 'Fix validation errors before saving.' }); return }

      await configService.updateConfig(service.value.process_name, data, persist)
      await getConfig(service.value.process_name)
      toast.success({ title: 'Success!', message: persist ? `${projectName.value} config for ${service.value.process_name} saved successfully` : `${projectName.value} config for ${service.value.process_name} applied to memory successfully` })
    } else {
      if (!serviceConfig.value || !configFormat.value) return
      await configService.updateServiceConfig(service.value.process_name, serviceConfig.value, configFormat.value)
      await getServiceConfig(service.value.process_name)
      toast.success({ title: 'Success!', message: `Service config for ${service.value.process_name} saved successfully` })
    }
  } catch (error) {
    toast.error({ title: 'Error!', message: 'Failed to update config' })
    console.error('Failed to update config:', error)
  } finally { isProcessing.value = false }
}

const handleServiceAction = async (action, skipIfStatus) => {
  if (serviceStatus.value === skipIfStatus) return
  isProcessing.value = true
  try { await performServiceAction(service.value.process_name, action, () => { getServiceStatus(service.value.process_name) }) }
  catch (error) { toast.error({ title: 'Error!', message: `Failed to ${action} service` }); console.error(`Failed to ${action} service:`, error) }
  finally { isProcessing.value = false }
}

const scrollToBottom = () => { if (logContainer.value) logContainer.value.scrollTo({ top: logContainer.value.scrollHeight, behavior: 'smooth' }) }
const setSelectedTab = (tabId) => { selectedTab.value = tabId; if (tabId === 2) nextTick(() => { scrollToBottom() }) }

// --- Logs auto-refresh state ---
const autoRefreshMs = ref(0)        // 0 = Off
const customRefreshMs = ref(0)      // when user selects "Custom"
const followTail = ref(true)        // auto-scroll when already near bottom
let logsTimer = null
const logsFetchInFlight = ref(false)

const refreshOptions = [
  { value: 0, label: 'Off' },
  { value: 5000, label: 'Every 5s' },
  { value: 10000, label: 'Every 10s' },
  { value: 30000, label: 'Every 30s' },
  { value: 60000, label: 'Every 60s' },
  { value: -1, label: 'Custom (ms)' }
]

const appendParsedLogs = (textChunk) => {
  if (!textChunk) return
  const serviceKey = service.value?.config_key ?? service.value?.process_name ?? process_name_param.value
  let parsed = serviceTypeLP({
    logsRaw: textChunk,
    serviceKey,
    processName: service.value?.process_name ?? process_name_param.value,
    projectName: projectName.value
  }) || []

  if (!parsed.length) {
    parsed = textChunk.split('\n').filter(Boolean).map(line => ({
      timestamp: Date.now(),
      level: 'INFO',
      process: service.value?.process_name ?? process_name_param.value,
      message: line
    }))
  }

  serviceLogs.value = (serviceLogs.value || []).concat(parsed)
  const max = parseInt(maxLength.value, 10)
  if (!isNaN(max) && max > 0 && serviceLogs.value.length > max) {
    serviceLogs.value = serviceLogs.value.slice(-max)
  }
}


function isNearBottom(el, threshold = 120) {
  if (!el) return false
  const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)
  return distance <= threshold
}

async function refreshLogsIfVisible() {
  if (selectedTab.value !== 2 || document.hidden || logsFetchInFlight.value) return
  logsFetchInFlight.value = true
  try {
    const shouldAutoScroll = followTail.value && isNearBottom(logContainer.value)
    await getLogs(process_name_param.value, /*initial=*/false)
    if (shouldAutoScroll) nextTick(() => scrollToBottom())
  } finally {
    logsFetchInFlight.value = false
  }
}

function startLogsTimer() {
  clearLogsTimer()
  const effective = autoRefreshMs.value === -1 ? Number(customRefreshMs.value) : Number(autoRefreshMs.value)
  if (!effective || isNaN(effective) || effective <= 0) return
  logsTimer = setInterval(refreshLogsIfVisible, effective)
}

function clearLogsTimer() {
  if (logsTimer) {
    clearInterval(logsTimer)
    logsTimer = null
  }
}

// Restart timer whenever tab/interval changes or land on Logs tab
watch([selectedTab, autoRefreshMs, customRefreshMs], () => {
  if (selectedTab.value === 2) startLogsTimer()
  else clearLogsTimer()
})

// Also pause/resume on page visibility changes
function onVisibilityChange() {
  if (document.hidden) clearLogsTimer()
  else if (selectedTab.value === 2) startLogsTimer()
}
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
onUnmounted(() => {
  clearLogsTimer()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

watch(selectedTab, async (t) => {
  if (t === 2) {
    await refreshLogsIfVisible()
  }
})

async function refreshNow() {
  await refreshLogsIfVisible()
}

onMounted(async () => {
  process_name_param.value = route.params.serviceId
  // Load service first; others can run in parallel afterwards
  await getConfig(process_name_param.value)
  await Promise.all([
    getProcessSchema(process_name_param.value),
    getServiceConfig(process_name_param.value),
    getLogs(process_name_param.value, /* initial */ true),
    getServiceStatus(process_name_param.value)
  ])
  loading.value = false
})
</script>

<template>
  <div class="h-full">
    <div v-if="loading" class="mx-auto flex gap-2 items-center mt-24">
      <span class="animate-spin material-symbols-rounded text-gray-400">progress_activity</span>
      <span class="text-center text-xl text-gray-400">Loading configuration...</span>
    </div>

    <div v-else class="h-full flex flex-col">
      <div class="flex items-center justify-between gap-2 w-full px-4 py-2">
        <div class="flex items-center gap-3">
          <p class="text-xl font-bold">{{ service?.process_name }}</p>
          <div :class="{ 'bg-green-400': serviceStatus === PROCESS_STATUS.RUNNING, 'bg-red-400': serviceStatus === PROCESS_STATUS.STOPPED, 'bg-yellow-400': serviceStatus === PROCESS_STATUS.UNKNOWN }" class="w-3 h-3 rounded-full" />
        </div>
      </div>

      <TabBar :selected-tab="selectedTab" :option-list="optionList" @selected-tab="setSelectedTab" class="mb-2" />

      <div v-if="selectedTab === 0 || selectedTab === 1">
        <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-2 py-2 px-4">
          <div class="flex items-center">
            <button @click="handleServiceAction(SERVICE_ACTIONS.START, PROCESS_STATUS.RUNNING)" :disabled="isProcessing || serviceStatus === PROCESS_STATUS.RUNNING" class="button-small border border-slate-50/20 hover:start !py-2 !pr-4 !gap-0.5 rounded-r-none">
              <span class="material-symbols-rounded !text-[20px] font-fill">play_arrow</span>
              Start
            </button>
            <button @click="handleServiceAction(SERVICE_ACTIONS.STOP, PROCESS_STATUS.STOPPED)" :disabled="isProcessing || serviceStatus === PROCESS_STATUS.STOPPED" class="button-small border-t border-b border-slate-50/20 hover:stop !py-2 !px-4 !gap-0.5 rounded-none">
              <span class="material-symbols-rounded !text-[20px] font-fill">stop</span>
              Stop
            </button>
            <button @click="handleServiceAction(SERVICE_ACTIONS.RESTART, null)" :disabled="isProcessing" class="button-small border border-slate-50/20 hover:restart !py-2 !gap-0.5 !pl-4 rounded-l-none">
              <span class="material-symbols-rounded !text-[20px] font-fill">refresh</span>
              Restart
            </button>
          </div>

          <div class="flex items-center">
            <button @click="updateConfig(false)" :disabled="isProcessing || (selectedTab === 0 && validationErrors.length > 0)" class="button-small border border-slate-50/20 hover:apply !py-2 !pr-4 !gap-0.5 rounded-r-none">
              <span class="material-symbols-rounded !text-[20px] font-fill">memory</span>
              <span>Apply in Memory</span>
            </button>
            <button @click="updateConfig(true)" :disabled="isProcessing || (selectedTab === 0 && validationErrors.length > 0)" class="button-small border border-l-0 border-slate-50/20 hover:start !py-2 !gap-0.5 !pl-4 rounded-l-none">
              <span class="material-symbols-rounded !text-[20px] font-fill">save_as</span>
              <span>Save to File</span>
            </button>
          </div>
        </div>
      </div>

      <!-- PROCESS CONFIG TAB (uses processSchema) -->
      <div v-if="selectedTab === 0" class="grow flex flex-col overflow-hidden gap-3 px-4">
        <div v-if="!processSchema" class="text-xs text-amber-300 bg-amber-900/30 border border-amber-700 rounded p-2">
          Live validation unavailable (no schema). The backend will still validate on save.
        </div>
        <JsonEditorVue v-model="Config" @change="onProcessChange" :schema="processSchema" class="jse-theme-dark grow overflow-auto" />
        <div v-if="validationErrors.length" class="mt-1 p-2 rounded bg-red-900/30 border border-red-700 text-red-200 text-xs space-y-1">
          <div v-for="(e, i) in validationErrors" :key="i" class="font-mono break-all">
            • {{ (e.instancePath || e.dataPath || '').replace(/^\//,'') || '(root)' }}: {{ e.message }}
          </div>
        </div>
      </div>

      <!-- SERVICE CONFIG TAB (no schema) -->
      <div v-if="selectedTab === 1" class="grow flex flex-col overflow-hidden gap-4">
        <JsonEditorVue v-model="serviceConfig" class="jse-theme-dark overflow-y-auto grow" />
      </div>

      <!-- LOGS TAB -->
      <div v-if="selectedTab === 2" class="grow flex flex-col overflow-hidden">
        <div class="flex flex-col md:flex-row md:items-center gap-2 py-2 px-4 w-full border-b border-slate-700">
          <div class="flex items-center justify-between grow gap-2">
            <div class="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 grow">
              <Input v-model="filterText" :placeholder="'Enter text to filter logs'" class="block" />
              <div class="grow flex items-center justify-between">
                <div class="flex items-center gap-2 md:gap-4 grow">
                  <Input v-model="maxLength" min="1" :placeholder="'Max Logs'" type="number" class="block" />
                  <SelectComponent v-model="selectedFilter" :items="items" />
                </div>

                <div class="flex items-center gap-2">
                  <!-- Follow tail -->
                  <label class="flex items-center gap-1 text-xs text-gray-300 select-none">
                    <input type="checkbox" v-model="followTail" class="accent-slate-400" />
                    Follow tail
                  </label>

                  <!-- Auto-refresh interval -->
                  <SelectComponent v-model="autoRefreshMs" :items="refreshOptions" class="min-w-[150px]" />

                  <!-- Custom interval input (shown only when 'Custom' is chosen) -->
                  <Input
                    v-if="autoRefreshMs === -1"
                    v-model="customRefreshMs"
                    type="number"
                    min="100"
                    :placeholder="'Custom ms'"
                    class="w-28"
                  />

                  <!-- Manual refresh -->
                  <button @click="refreshNow" class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1">
                    <span class="material-symbols-rounded !text-[18px]">refresh</span>
                    <span class="hidden md:inline">Refresh now</span>
                  </button>

                  <!-- Download -->
                  <button @click="downloadLogs" class="button-small download">
                    <span class="material-symbols-rounded !text-[18px]">download</span>
                    <span class="hidden md:inline">Download Logs</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

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
              <tr v-for="(log, index) in filteredLogs" :key="index" :class="getLogLevelClass(log.level)"
                class="whitespace-nowrap odd:bg-gray-900 even:bg-gray-800">
                <td class="text-xs px-2 py-0.1">{{ log.timestamp.toLocaleString() }}</td>
                <td class="text-xs px-2 py-0.1">{{ log.level }}</td>
                <td class="text-xs px-2 py-0.1">{{ log.process }}</td>
                <td class="text-xs px-2 py-0.1">{{ log.message }}</td>
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
    </div>
  </div>
</template>

<style scoped></style>
