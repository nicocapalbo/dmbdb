<script setup>
import JsonEditorVue from 'json-editor-vue'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'
import useService from "~/services/useService.js"
import { performServiceAction } from "@/composables/serviceActions"
import { PROCESS_STATUS, SERVICE_ACTIONS } from "~/constants/enums.js"
import SelectComponent from "~/components/SelectComponent.vue"
import { serviceTypeLP } from "~/helper/ServiceTypeLP.js"
import { extractRestartInfo } from "~/helper/restartInfo.js"
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
const serviceHealth = ref(null)
const serviceHealthReason = ref(null)
const restartInfo = ref(null)
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
const logSizeBytes = ref(null)
const hasLogs = ref(false)
const autoRestartSettingsOpen = ref(false)
const autoRestartLoading = ref(false)
const autoRestartError = ref('')
const autoRestartSaved = ref(false)
const serviceAutoRestartEnabled = ref(false)
const serviceAutoRestartOverridesEnabled = ref(false)

const emptyServiceOverrides = {
  restart_on_unhealthy: null,
  healthcheck_interval: null,
  unhealthy_threshold: null,
  max_restarts: null,
  window_seconds: null,
  backoff_seconds: null,
  grace_period_seconds: null,
}
const serviceAutoRestartDraft = reactive({ ...emptyServiceOverrides })
const serviceBackoffSecondsInput = ref('')

const autoRestartDefaults = {
  enabled: false,
  restart_on_unhealthy: true,
  healthcheck_interval: 30,
  unhealthy_threshold: 3,
  max_restarts: 3,
  window_seconds: 300,
  backoff_seconds: [5, 15, 45, 120],
  grace_period_seconds: 30,
}

const autoRestartKeys = Object.keys(autoRestartDefaults)
const autoRestartConfig = reactive({ ...autoRestartDefaults })
const autoRestartDraft = reactive({ ...autoRestartDefaults })
const backoffSecondsInput = ref(autoRestartDefaults.backoff_seconds.join(', '))
const optionList = computed(() => [
  { icon: 'settings', text: `${projectName.value} Config` },
  { icon: 'stacks', text: 'Service Config', disabled: !serviceConfig.value },
  { icon: 'data_object', text: 'Service Logs', disabled: !hasLogs.value }
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

const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

const matchesName = (candidate, target) => {
  const a = normalizeName(candidate)
  const b = normalizeName(target)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

const serviceStatusDotClass = computed(() => {
  if (serviceStatus.value === PROCESS_STATUS.RUNNING) {
    return serviceHealth.value === false ? 'bg-amber-400' : 'bg-green-400'
  }
  if (serviceStatus.value === PROCESS_STATUS.STOPPED) return 'bg-red-400'
  return 'bg-yellow-400'
})

const serviceStatusTitle = computed(() => {
  if (serviceHealth.value === false && serviceHealthReason.value) return serviceHealthReason.value
  if (serviceHealth.value === true) return 'Healthy'
  return `Status: ${serviceStatus.value}`
})

const currentServiceName = computed(() => service.value?.process_name || process_name_param.value || '')

const pickRestartStat = (stats, keys) => {
  if (!stats || typeof stats !== 'object') return null
  for (const key of keys) {
    if (stats[key] != null) return stats[key]
  }
  return null
}

const toNumber = (value) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const formatRestartTime = (value) => {
  if (value == null) return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : null
  if (Number.isFinite(numeric)) {
    const ts = numeric < 1e12 ? numeric * 1000 : numeric
    return new Date(ts).toLocaleString()
  }
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString()
  return null
}

const restartStats = computed(() => {
  const info = restartInfo.value
  if (!info || typeof info !== 'object') return null
  return info.stats || info.restart_stats || info.counters || null
})

const restartEnabled = computed(() => {
  if (!restartInfo.value || typeof restartInfo.value !== 'object') return null
  return typeof restartInfo.value.enabled === 'boolean' ? restartInfo.value.enabled : null
})

const restartTotal = computed(() => {
  const value = pickRestartStat(restartStats.value, [
    'total_restarts',
    'total',
    'count',
    'restarts',
    'restart_attempts',
    'restart_successes',
  ])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const restartWindow = computed(() => {
  const value = pickRestartStat(restartStats.value, [
    'window_restarts',
    'window',
    'recent',
    'window_count',
    'recent_restart_attempts',
  ])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const unhealthyCount = computed(() => {
  const value = pickRestartStat(restartStats.value, ['unhealthy_count', 'unhealthy'])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const unhealthyThreshold = computed(() => {
  const value = pickRestartStat(restartStats.value, ['unhealthy_threshold', 'unhealthy_limit', 'unhealthy_max'])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const lastRestartDisplay = computed(() => {
  const value = pickRestartStat(
    restartStats.value,
    ['last_restart', 'last_restart_at', 'last_restart_ts', 'last_restart_time']
  )
  return formatRestartTime(value)
})

const lastRestartReason = computed(() =>
  pickRestartStat(restartStats.value, [
    'last_exit_reason',
    'last_failure_reason',
    'last_reason',
    'last_trigger',
  ])
)

const getLogLevelClass = (level) => {
  const l = String(level || '').toUpperCase()
  if (l.includes('ERROR')) return 'text-red-500'
  if (l.includes('WARN')) return 'text-yellow-400'
  if (l.includes('NOTICE')) return 'text-green-400'
  if (l.includes('INFO')) return 'text-green-400'
  if (l.includes('DEBUG')) return 'text-blue-400'
  return 'text-gray-400'
}

const getServiceStatus = async (processName, options = {}) => {
  try {
    const data = await processService.fetchProcessStatusDetails(processName, options)
    serviceStatus.value = data.status ?? 'Unknown'
    serviceHealth.value = data.healthy
    serviceHealthReason.value = data.health_reason
    restartInfo.value = extractRestartInfo(data)
  } catch (error) {
    console.error('Failed to fetch service status:', error)
    serviceStatus.value = 'Unknown'
    serviceHealth.value = null
    serviceHealthReason.value = null
    restartInfo.value = null
  }
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

let statusSocket = null
let statusReconnectTimer = null
let statusReconnectAttempts = 0
let statusConnectTimer = null
let statusShouldReconnect = true

const buildStatusSocketUrl = ({ interval = 2, health = false } = {}) => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams()
  params.set('interval', String(interval))
  if (health) params.set('health', 'true')
  return `${protocol}://${window.location.host}/ws/status?${params.toString()}`
}

const clearStatusTimers = () => {
  if (statusReconnectTimer) {
    clearTimeout(statusReconnectTimer)
    statusReconnectTimer = null
  }
  if (statusConnectTimer) {
    clearTimeout(statusConnectTimer)
    statusConnectTimer = null
  }
}

const applyStatusPayload = (payload) => {
  if (!payload || payload.type !== 'status') return
  const processName = process_name_param.value
  if (!processName) return
  const displayName = service.value?.name || service.value?.display_name

  if (Array.isArray(payload.processes)) {
    const match = payload.processes.find(p => p?.process_name === processName)
    if (!match) return
    serviceStatus.value = match.status ?? 'Unknown'
    serviceHealth.value = typeof match.healthy === 'boolean' ? match.healthy : null
    serviceHealthReason.value = typeof match.health_reason === 'string' ? match.health_reason : null
    restartInfo.value = extractRestartInfo(match)
    return
  }

  if (Array.isArray(payload.running)) {
    const isRunning = payload.running.some((name) => (
      matchesName(processName, name) || (displayName && matchesName(displayName, name))
    ))
    serviceStatus.value = isRunning ? PROCESS_STATUS.RUNNING : PROCESS_STATUS.STOPPED
    serviceHealth.value = null
    serviceHealthReason.value = null
  }
}

const scheduleStatusReconnect = (connectFn) => {
  statusReconnectAttempts += 1
  const delay = Math.min(1000 * statusReconnectAttempts, 10000)
  statusReconnectTimer = setTimeout(() => {
    statusReconnectTimer = null
    connectFn()
  }, delay)
}

const connectStatusSocket = () => {
  if (!process.client) return
  if (!statusShouldReconnect) return
  if (statusSocket && (statusSocket.readyState === WebSocket.OPEN || statusSocket.readyState === WebSocket.CONNECTING)) {
    return
  }

  statusSocket = new WebSocket(buildStatusSocketUrl({ interval: 2, health: true }))

  clearStatusTimers()
  statusConnectTimer = setTimeout(() => {
    if (statusSocket && statusSocket.readyState !== WebSocket.OPEN) {
      statusSocket.close()
      scheduleStatusReconnect(connectStatusSocket)
    }
  }, 8000)

  statusSocket.addEventListener('open', () => {
    statusReconnectAttempts = 0
    clearStatusTimers()
  })

  statusSocket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data)
      applyStatusPayload(payload)
    } catch (e) {
      console.warn('Unable to parse status payload', e)
    }
  })

  statusSocket.addEventListener('error', () => {
    if (statusSocket) statusSocket.close()
  })

  statusSocket.addEventListener('close', () => {
    clearStatusTimers()
    if (statusShouldReconnect) {
      scheduleStatusReconnect(connectStatusSocket)
    }
  })
}

const disconnectStatusSocket = () => {
  statusShouldReconnect = false
  clearStatusTimers()
  if (statusSocket) {
    statusSocket.close()
    statusSocket = null
  }
  statusReconnectAttempts = 0
}

const getLogs = async (processName, initial = false) => {
  try {
    const { logsService } = useService()
    const params = {
      tail_bytes: Math.max(1_000_000, (parseInt(maxLength.value, 10) || 1000) * 400),
      ...(initial ? {} : (typeof logCursor.value === 'number' ? { cursor: logCursor.value } : {}))
    }

    const resp = await logsService.fetchServiceLogs(processName, params)

    // --- Legacy backend: raw string OR legacy object { log: "..." } ---
    if (
      typeof resp === 'string' ||
      (resp && typeof resp.log === 'string' && !('chunk' in resp) && !('cursor' in resp))
    ) {
      const text = typeof resp === 'string' ? resp : resp.log
      if (!hasLogs.value && text.trim().length) hasLogs.value = true
      logSizeBytes.value = null
      serviceLogs.value = []
      appendParsedLogs(text)
      return
    }

    // --- New backend: { cursor, chunk, reset[, log] } ---
    if (!resp) return

    if (typeof resp.size === 'number') logSizeBytes.value = resp.size
    if (typeof resp.cursor === 'number') logCursor.value = resp.cursor

    const text = (resp.chunk || resp.log || '')
    if (!hasLogs.value && text.trim().length) hasLogs.value = true

    if (resp.reset) {
      serviceLogs.value = []
      appendParsedLogs(text)
    } else {
      if (resp.chunk) appendParsedLogs(resp.chunk)
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

      if (persist) {
        await configService.updateConfig(service.value.process_name, data, false)
      }
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

const syncAutoRestartDraft = (values) => {
  autoRestartKeys.forEach((key) => {
    const value = values && values[key] != null ? values[key] : autoRestartDefaults[key]
    autoRestartConfig[key] = value
    autoRestartDraft[key] = value
  })
  if (!Array.isArray(autoRestartDraft.backoff_seconds)) {
    autoRestartDraft.backoff_seconds = [...autoRestartDefaults.backoff_seconds]
  }
  backoffSecondsInput.value = Array.isArray(autoRestartDraft.backoff_seconds)
    ? autoRestartDraft.backoff_seconds.join(', ')
    : ''
}

const findServiceOverride = (services, name) => {
  if (!Array.isArray(services) || !name) return null
  return services.find((entry) => entry?.process_name === name) || null
}

const syncServiceAutoRestartDraft = (services) => {
  const entry = findServiceOverride(services, currentServiceName.value)
  serviceAutoRestartEnabled.value = !!entry
  serviceAutoRestartOverridesEnabled.value = false

  Object.keys(emptyServiceOverrides).forEach((key) => {
    serviceAutoRestartDraft[key] = entry && entry[key] != null ? entry[key] : null
  })

  const hasOverrides = entry && Object.keys(emptyServiceOverrides).some((key) => entry[key] != null)
  serviceAutoRestartOverridesEnabled.value = !!hasOverrides

  const backoff = Array.isArray(serviceAutoRestartDraft.backoff_seconds)
    ? serviceAutoRestartDraft.backoff_seconds
    : []
  serviceBackoffSecondsInput.value = backoff.join(', ')
}

const loadAutoRestartSettings = async () => {
  autoRestartLoading.value = true
  autoRestartError.value = ''
  autoRestartSaved.value = false
  try {
    const config = await configService.getConfig()
    const autoRestart = config?.dumb?.auto_restart || {}
    syncAutoRestartDraft(autoRestart)
    syncServiceAutoRestartDraft(autoRestart?.services || [])
  } catch (error) {
    console.error('Failed to load auto-restart settings:', error)
    autoRestartError.value = 'Failed to load auto-restart settings.'
  } finally {
    autoRestartLoading.value = false
  }
}

const parseBackoffInput = () => {
  if (!backoffSecondsInput.value.trim()) return []
  const values = backoffSecondsInput.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const parsed = values.map((value) => Number(value))
  if (parsed.some((value) => !Number.isFinite(value) || value < 0)) {
    return null
  }
  return parsed
}

const parseServiceBackoffInput = () => {
  if (!serviceBackoffSecondsInput.value.trim()) return []
  const values = serviceBackoffSecondsInput.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const parsed = values.map((value) => Number(value))
  if (parsed.some((value) => !Number.isFinite(value) || value < 0)) {
    return null
  }
  return parsed
}

const buildServiceOverrides = (base) => {
  if (!serviceAutoRestartOverridesEnabled.value) return {}
  const overrides = {}
  Object.keys(emptyServiceOverrides).forEach((key) => {
    if (key === 'backoff_seconds') return
    if (serviceAutoRestartDraft[key] == null) return
    if (serviceAutoRestartDraft[key] !== base[key]) {
      overrides[key] = serviceAutoRestartDraft[key]
    }
  })

  const backoff = parseServiceBackoffInput()
  if (backoff == null) return null
  if (backoff.length && JSON.stringify(backoff) !== JSON.stringify(base.backoff_seconds)) {
    overrides.backoff_seconds = backoff
  }
  return overrides
}

const saveAutoRestartSettings = async (persist) => {
  autoRestartLoading.value = true
  autoRestartError.value = ''
  autoRestartSaved.value = false

  const backoffSeconds = parseBackoffInput()
  if (!backoffSeconds) {
    autoRestartLoading.value = false
    autoRestartError.value = 'Backoff seconds must be a comma-separated list of non-negative numbers.'
    return
  }

  const updates = {
    ...autoRestartDraft,
    backoff_seconds: backoffSeconds,
  }

  try {
    const config = await configService.getConfig()
    const existing = config?.dumb?.auto_restart || {}
    const services = Array.isArray(existing.services) ? [...existing.services] : []
    const serviceName = currentServiceName.value

    if (serviceName) {
      const existingIndex = services.findIndex((entry) => entry?.process_name === serviceName)
      if (serviceAutoRestartEnabled.value) {
        const overrides = buildServiceOverrides(updates)
        if (overrides === null) {
          autoRestartLoading.value = false
          autoRestartError.value = 'Service backoff seconds must be a comma-separated list of non-negative numbers.'
          return
        }
        const entry = { process_name: serviceName, ...overrides }
        if (existingIndex >= 0) {
          services.splice(existingIndex, 1, entry)
        } else {
          services.push(entry)
        }
      } else if (existingIndex >= 0) {
        services.splice(existingIndex, 1)
      }
    }

    if (persist) {
      await configService.updateConfig(null, { dumb: { auto_restart: { ...updates, services } } }, false)
    }
    await configService.updateConfig(null, { dumb: { auto_restart: { ...updates, services } } }, persist)
    syncAutoRestartDraft(updates)
    syncServiceAutoRestartDraft(services)
    autoRestartSaved.value = true
    setTimeout(() => {
      autoRestartSaved.value = false
    }, 2000)
  } catch (error) {
    console.error('Failed to save auto-restart settings:', error)
    autoRestartError.value = 'Failed to save auto-restart settings.'
  } finally {
    autoRestartLoading.value = false
  }
}

const openAutoRestartSettings = async () => {
  autoRestartSettingsOpen.value = true
  await loadAutoRestartSettings()
}

const handleServiceAction = async (action, skipIfStatus) => {
  if (serviceStatus.value === skipIfStatus) return
  isProcessing.value = true
  try { await performServiceAction(service.value.process_name, action, () => { getServiceStatus(service.value.process_name, { includeHealth: true }) }) }
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

const normalizeEntry = (e, fallbackProcess) => ({
  timestamp: e?.timestamp ?? Date.now(),
  level: e?.level ?? 'INFO',
  process: e?.process ?? fallbackProcess ?? '',
  message: e?.message ?? ''
})

const appendParsedLogs = (textChunk) => {
  if (!textChunk) return

  const fallbackProcess = service.value?.process_name ?? process_name_param.value
  const serviceKey = service.value?.config_key ?? fallbackProcess

  // Try the service-specific parser
  let parsed = serviceTypeLP({
    logsRaw: textChunk,
    serviceKey,
    processName: fallbackProcess,
    projectName: projectName.value
  }) || []

  // If the parser yields nothing, still show *something*:
  // either 1 row with the whole chunk, or split by lines if that looks better.
  if (!parsed.length) {
    const lines = textChunk.includes('\n')
      ? textChunk.split('\n').filter(Boolean)
      : [textChunk]

    parsed = lines.map(line =>
      ({ timestamp: Date.now(), level: 'INFO', process: fallbackProcess, message: line })
    )
  }

  // Normalize (defensive, keeps table happy even if any field is missing)
  parsed = parsed.map(e => normalizeEntry(e, fallbackProcess))

  serviceLogs.value = (serviceLogs.value || []).concat(parsed)
  const max = parseInt(maxLength.value, 10)
  if (!isNaN(max) && max > 0 && serviceLogs.value.length > max) {
    serviceLogs.value = serviceLogs.value.slice(-max)
  }
}

const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || isNaN(bytes)) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  if (bytes < 1024) return `${bytes} ${units[0]}`
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
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
  disconnectStatusSocket()
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
    getServiceStatus(process_name_param.value, { includeHealth: true })
  ])
  connectStatusSocket()
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
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-3">
            <p class="text-xl font-bold">{{ service?.process_name }}</p>
            <div :class="serviceStatusDotClass" :title="serviceStatusTitle" class="w-3 h-3 rounded-full" />
            <span
              v-if="serviceHealth !== null"
              class="text-xs px-2 py-0.5 rounded-full border"
              :class="serviceHealth ? 'border-emerald-600/40 bg-emerald-900/30 text-emerald-300' : 'border-red-600/40 bg-red-900/30 text-red-300'"
              :title="serviceHealthReason || ''"
            >
              {{ serviceHealth ? 'Healthy' : 'Unhealthy' }}
            </span>
          </div>
          <div v-if="restartStats || restartEnabled !== null" class="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span
              v-if="restartEnabled !== null"
              class="px-2 py-0.5 rounded-full border border-slate-600/60 bg-slate-800/60 text-slate-200"
            >
              Auto-restart: {{ restartEnabled ? 'On' : 'Off' }}
            </span>
            <span
              v-if="restartTotal !== null"
              class="px-2 py-0.5 rounded-full border border-slate-600/60 bg-slate-800/60 text-slate-200"
            >
              Restarts: {{ restartTotal }}
            </span>
            <span
              v-if="restartWindow !== null"
              class="px-2 py-0.5 rounded-full border border-slate-600/60 bg-slate-800/60 text-slate-200"
            >
              Window: {{ restartWindow }}
            </span>
            <span v-if="unhealthyCount !== null && unhealthyThreshold !== null" class="text-slate-400">
              Unhealthy: {{ unhealthyCount }}/{{ unhealthyThreshold }}
            </span>
            <span v-if="lastRestartDisplay" class="text-slate-400">
              Last: {{ lastRestartDisplay }}
            </span>
            <span v-if="lastRestartReason" class="text-slate-400">
              Reason: {{ lastRestartReason }}
            </span>
          </div>
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

          <div class="flex flex-wrap items-center gap-2">
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
            <button @click="openAutoRestartSettings" class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1">
              <span class="material-symbols-rounded !text-[18px]">settings</span>
              <span>Auto-restart</span>
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
        <div class="flex flex-col gap-2 py-2 px-4 w-full border-b border-slate-700">
          <div class="flex flex-wrap items-center gap-2">
            <Input v-model="filterText" :placeholder="'Enter text to filter logs'" class="w-full sm:w-64" />
            <Input v-model="maxLength" min="1" :placeholder="'Max Logs'" type="number" class="w-24" />
            <SelectComponent v-model="selectedFilter" :items="items" class="min-w-[140px]" />

            <div v-if="logSizeBytes !== null" class="text-xs text-gray-300 whitespace-nowrap shrink-0">
              Log size: {{ formatBytes(logSizeBytes) }}
            </div>

            <!-- Follow tail -->
            <label class="flex items-center gap-1 text-xs text-gray-300 select-none whitespace-nowrap shrink-0">
              <input type="checkbox" v-model="followTail" class="accent-slate-400" />
              Follow tail
            </label>

            <!-- Auto-refresh interval -->
            <SelectComponent v-model="autoRefreshMs" :items="refreshOptions" class="min-w-[140px]" />

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
            <button @click="refreshNow" class="button-small border border-slate-50/20 hover:apply !py-2 !px-3 !gap-1 w-full sm:w-auto">
              <span class="material-symbols-rounded !text-[18px]">refresh</span>
              <span class="hidden md:inline">Refresh now</span>
            </button>

            <!-- Download -->
            <button @click="downloadLogs" class="button-small download w-full sm:w-auto">
              <span class="material-symbols-rounded !text-[18px]">download</span>
              <span class="hidden md:inline">Download Logs</span>
            </button>
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

    <div v-if="autoRestartSettingsOpen" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/80">
      <div class="bg-slate-900 border border-slate-700 rounded-lg shadow-lg w-full max-w-xl mx-4">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h3 class="text-lg font-semibold">Auto-restart Settings</h3>
          <button class="material-symbols-rounded text-slate-300 hover:text-white" @click="autoRestartSettingsOpen = false">close</button>
        </div>
        <div class="p-4 space-y-4 text-sm text-slate-200">
          <label class="flex items-center gap-2" title="Global toggle for the auto-restart supervisor.">
            <input type="checkbox" v-model="autoRestartDraft.enabled" class="accent-slate-400" />
            Enable auto-restart
          </label>
          <label class="flex items-center gap-2" title="Default behavior for unhealthy checks (can be overridden per service).">
            <input type="checkbox" v-model="autoRestartDraft.restart_on_unhealthy" class="accent-slate-400" />
            Restart on unhealthy checks
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-slate-400" title="Default healthcheck interval (can be overridden per service).">Healthcheck interval (sec)</span>
              <Input v-model.number="autoRestartDraft.healthcheck_interval" type="number" min="1" placeholder="30" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-slate-400" title="Default consecutive unhealthy checks required before restart.">Healthcheck threshold</span>
              <Input v-model.number="autoRestartDraft.unhealthy_threshold" type="number" min="1" placeholder="3" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-slate-400" title="Default grace period before health restarts (can be overridden per service).">Grace period (sec)</span>
              <Input v-model.number="autoRestartDraft.grace_period_seconds" type="number" min="0" placeholder="30" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-slate-400" title="Default max restarts per window (can be overridden per service).">Max restarts (window)</span>
              <Input v-model.number="autoRestartDraft.max_restarts" type="number" min="0" placeholder="3" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-slate-400" title="Default rolling window (can be overridden per service).">Window seconds</span>
              <Input v-model.number="autoRestartDraft.window_seconds" type="number" min="0" placeholder="300" />
            </label>
          </div>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-400" title="Default backoff delays between restarts (comma separated).">Backoff seconds (comma separated)</span>
            <Input v-model="backoffSecondsInput" placeholder="5, 15, 45, 120" />
          </label>
          <div class="border-t border-slate-700/60 pt-4 space-y-3">
            <div class="text-xs uppercase tracking-wider text-slate-400">This Service</div>
            <label
              class="flex items-center gap-2"
              :title="serviceAutoRestartEnabled ? 'Remove this service from the allowlist.' : 'Add this service to the allowlist.'"
            >
              <input type="checkbox" v-model="serviceAutoRestartEnabled" class="accent-slate-400" />
              Enable auto-restart for {{ currentServiceName || 'this service' }}
            </label>
            <label
              class="flex items-center gap-2"
              title="Override global defaults for this service."
            >
              <input
                type="checkbox"
                v-model="serviceAutoRestartOverridesEnabled"
                :disabled="!serviceAutoRestartEnabled"
                class="accent-slate-400"
              />
              Override defaults
            </label>
            <div v-if="serviceAutoRestartEnabled && serviceAutoRestartOverridesEnabled" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-xs text-slate-400" title="Override restart-on-unhealthy for this service.">Restart on unhealthy</span>
                <SelectComponent
                  v-model="serviceAutoRestartDraft.restart_on_unhealthy"
                  :items="[
                    { value: true, label: 'true' },
                    { value: false, label: 'false' }
                  ]"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-slate-400" title="Override healthcheck interval for this service.">Healthcheck interval (sec)</span>
                <Input v-model.number="serviceAutoRestartDraft.healthcheck_interval" type="number" min="1" placeholder="30" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-slate-400" title="Override consecutive unhealthy checks required before restart.">Healthcheck threshold</span>
                <Input v-model.number="serviceAutoRestartDraft.unhealthy_threshold" type="number" min="1" placeholder="3" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-slate-400" title="Override grace period for this service.">Grace period (sec)</span>
                <Input v-model.number="serviceAutoRestartDraft.grace_period_seconds" type="number" min="0" placeholder="30" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-slate-400" title="Override max restarts for this service.">Max restarts (window)</span>
                <Input v-model.number="serviceAutoRestartDraft.max_restarts" type="number" min="0" placeholder="3" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-slate-400" title="Override window seconds for this service.">Window seconds</span>
                <Input v-model.number="serviceAutoRestartDraft.window_seconds" type="number" min="0" placeholder="300" />
              </label>
              <label class="flex flex-col gap-1 sm:col-span-2">
                <span class="text-xs text-slate-400" title="Override backoff seconds for this service.">Backoff seconds (comma separated)</span>
                <Input v-model="serviceBackoffSecondsInput" placeholder="5, 15, 45, 120" />
              </label>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between px-4 py-3 border-t border-slate-700 text-xs text-slate-300">
          <span v-if="autoRestartLoading">Saving...</span>
          <span v-else-if="autoRestartSaved" class="text-emerald-300">Saved</span>
          <span v-else-if="autoRestartError" class="text-rose-300">{{ autoRestartError }}</span>
          <span v-else class="text-slate-400">Apply in memory (temporary), or apply + save to file (persisted).</span>
          <div class="flex items-center gap-2">
            <button
              @click="saveAutoRestartSettings(false)"
              :disabled="autoRestartLoading"
              class="button-small border border-slate-50/20 hover:apply !py-2 !px-3"
            >
              Apply in Memory
            </button>
            <button
              @click="saveAutoRestartSettings(true)"
              :disabled="autoRestartLoading"
              class="button-small border border-slate-50/20 hover:start !py-2 !px-3"
            >
              Save to File
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
