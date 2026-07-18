<script setup>
import axios from 'axios'
import createNotificationService from '~/services/notifications.js'

const notificationService = createNotificationService()
const supported = ref(false)
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const historyLoading = ref(false)
const history = ref([])
const managedServiceNames = ref([])
const serviceDiscoveryAvailable = ref(true)
const testState = reactive({})
const manual = reactive({ title: '', body: '', severity: 'info', destinationIds: [] })
const manualStatus = ref('')

const eventLabels = {
  manual: 'Manual messages',
  'dumb.startup.degraded': 'Degraded DUMB startup',
  'service.preinstall.failed': 'Service preinstall failure',
  'service.start.failed': 'Service start failure',
  'service.unhealthy': 'Service unhealthy',
  'service.stopped.unexpectedly': 'Unexpected service stop',
  'service.auto_restart.attempt': 'Automatic restart attempt',
  'service.auto_restart.succeeded': 'Automatic restart succeeded',
  'service.auto_restart.failed': 'Automatic restart failed',
  'service.auto_restart.suppressed': 'Automatic restart suppressed',
  'update.available': 'Update available',
  'update.succeeded': 'Update succeeded',
  'update.failed': 'Update failed',
  'symlink.job.succeeded': 'Symlink job succeeded',
  'symlink.job.failed': 'Symlink job failed',
  'resource.cpu.high': 'CPU pressure',
  'resource.memory.high': 'Memory pressure',
  'resource.disk.high': 'Disk pressure',
  'resource.inode.high': 'Inode pressure',
  'database.pressure': 'Database pressure',
  'database.collection.failed': 'Database collection failure',
  recovery: 'Recovery notices',
}

const severityLabels = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  critical: 'Critical',
}

const severityRank = {
  info: 0,
  success: 1,
  warning: 2,
  critical: 3,
}

const eventGuidance = {
  manual: {
    severityLabel: 'Selected when sent',
    description: 'Operator messages sent from this page. Manual messages bypass routing, severity, cooldown, and the global switch, but skip disabled destinations.',
  },
  'dumb.startup.degraded': {
    severity: 'critical',
    description: 'Sent when DUMB finishes startup with one or more failed service preinstalls while the API and frontend remain available.',
  },
  'service.preinstall.failed': {
    severity: 'critical',
    description: 'Sent for each service whose preinstall phase fails.',
  },
  'service.start.failed': {
    severity: 'critical',
    description: 'Sent when service setup fails, the process exits during startup, or DUMB otherwise cannot start it.',
  },
  'service.unhealthy': {
    severity: 'critical',
    description: 'Requires Auto-restart health monitoring for this service. Sent after the configured consecutive unhealthy-check threshold is reached.',
  },
  'service.stopped.unexpectedly': {
    severity: 'critical',
    description: 'Sent when a managed process exits unexpectedly. DUMB does not alert merely because a service card is Stopped.',
  },
  'service.auto_restart.attempt': {
    severity: 'warning',
    description: 'Requires Auto-restart for this service. Sent immediately before DUMB attempts the restart.',
  },
  'service.auto_restart.succeeded': {
    severity: 'success',
    description: 'Requires Auto-restart for this service. This is a separate Success event, not the threshold Recovery setting below.',
  },
  'service.auto_restart.failed': {
    severity: 'critical',
    description: 'Requires Auto-restart for this service. Sent when DUMB cannot restart the process.',
  },
  'service.auto_restart.suppressed': {
    severity: 'critical',
    description: 'Requires Auto-restart for this service. Sent when the restart limit is reached and manual intervention may be needed.',
  },
  'update.available': {
    severity: 'info',
    description: 'Sent when DUMB records an available service update.',
  },
  'update.succeeded': {
    severity: 'success',
    description: 'Sent after a service update completes successfully.',
  },
  'update.failed': {
    severity: 'critical',
    description: 'Sent when a service update operation fails.',
  },
  'symlink.job.succeeded': {
    severity: 'success',
    description: 'Sent when an asynchronous symlink repair, backup, or restore job completes.',
  },
  'symlink.job.failed': {
    severity: 'critical',
    description: 'Sent when an asynchronous symlink repair, backup, or restore job fails.',
  },
  'resource.cpu.high': {
    severity: 'warning',
    description: 'Sent after CPU usage remains above the configured threshold for the required duration.',
  },
  'resource.memory.high': {
    severity: 'warning',
    description: 'Sent after memory usage remains above the configured threshold for the required duration.',
  },
  'resource.disk.high': {
    severity: 'warning',
    description: 'Sent after disk usage remains above the configured threshold for the required duration.',
  },
  'resource.inode.high': {
    severity: 'warning',
    description: 'Sent after inode usage remains above the configured threshold for the required duration.',
  },
  'database.pressure': {
    severityLabel: 'Warning or Critical',
    description: 'Requires Database Health monitoring for the service. Severity is Critical only for critical pressure; otherwise it is Warning.',
  },
  'database.collection.failed': {
    severity: 'warning',
    description: 'Requires Database Health monitoring for the service. Sent when its bounded telemetry probe continues failing for the configured duration.',
  },
  recovery: {
    severityLabel: 'Success; threshold only',
    description: 'Sent when an active resource or Database Health threshold condition clears. Minimum severity does not filter recovery, but Recovery messages must be enabled.',
  },
}

const eventSeverityLabel = (eventType) => {
  const guidance = eventGuidance[eventType] || {}
  return guidance.severityLabel || severityLabels[guidance.severity] || 'Varies'
}

const filteredEventsForDestination = (destination) => {
  const minimum = severityRank[destination.minimum_severity] ?? severityRank.warning
  const selected = destination.event_types.length ? destination.event_types : eventTypes.value
  return selected.filter((eventType) => {
    const severity = eventGuidance[eventType]?.severity
    return severity != null && (severityRank[severity] ?? 0) < minimum
  })
}

const filteredEventSummary = (destination) => filteredEventsForDestination(destination)
  .map((eventType) => eventLabels[eventType] || eventType)
  .join(', ')

const serviceOptionsForDestination = () => managedServiceNames.value

const serviceFilterLabel = (destination) => {
  const selected = destination.service_names || []
  if (!selected.length) return 'All services'
  if (selected.length === 1) return selected[0]
  return `${selected.length} services selected`
}

const toggleService = (destination, serviceName) => {
  const selected = new Set(destination.service_names || [])
  if (selected.has(serviceName)) selected.delete(serviceName)
  else selected.add(serviceName)
  destination.service_names = [...selected].sort((left, right) => left.localeCompare(right))
}

const config = reactive({
  enabled: false,
  monitor_interval_sec: 30,
  history_retention_days: 30,
  max_attempts: 3,
  retry_base_sec: 30,
  destinations: [],
  thresholds: {
    cpu_percent: 85,
    memory_percent: 85,
    disk_percent: 90,
    inode_percent: 90,
    database_pressure: 'high',
    duration_sec: 60,
  },
})

const eventTypes = ref(Object.keys(eventLabels))

const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '')
  return `${Date.now()}${Math.random().toString(16).slice(2)}`
}

const normalizeDestination = (destination = {}) => ({
  id: destination.id || uuid(),
  name: destination.name || 'Notification destination',
  enabled: destination.enabled ?? true,
  provider: destination.provider || 'apprise',
  url: destination.url || '',
  url_configured: destination.url_configured ?? false,
  verify_tls: destination.verify_tls ?? true,
  headers: destination.headers || {},
  headers_configured: destination.headers_configured ?? false,
  headersText: '',
  minimum_severity: destination.minimum_severity || 'warning',
  event_types: Array.isArray(destination.event_types) ? destination.event_types : [],
  service_names: Array.isArray(destination.service_names)
    ? [...new Set(destination.service_names
      .map((name) => String(name).trim())
      .filter((name) => name && managedServiceNames.value.includes(name)))]
    : [],
  cooldown_sec: destination.cooldown_sec ?? 300,
  send_recovery: destination.send_recovery ?? true,
})

const applyConfig = (payload) => {
  config.enabled = payload.enabled ?? false
  config.monitor_interval_sec = payload.monitor_interval_sec ?? 30
  config.history_retention_days = payload.history_retention_days ?? 30
  config.max_attempts = payload.max_attempts ?? 3
  config.retry_base_sec = payload.retry_base_sec ?? 30
  config.destinations = (payload.destinations || []).map(normalizeDestination)
  Object.assign(config.thresholds, payload.thresholds || {})
  manual.destinationIds = manual.destinationIds.filter((id) =>
    config.destinations.some((destination) => destination.id === id),
  )
}

const loadHistory = async () => {
  if (!supported.value) return
  historyLoading.value = true
  try {
    const result = await notificationService.getHistory({ limit: 100 })
    history.value = result.items || []
  } catch (cause) {
    error.value = cause?.response?.data?.detail || 'Failed to load notification history.'
  } finally {
    historyLoading.value = false
  }
}

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const { data: capabilities } = await axios.get('/api/process/capabilities')
    supported.value = capabilities?.notifications === true
    if (!supported.value) return
    const [payload, events, processesResponse] = await Promise.all([
      notificationService.getConfig(),
      notificationService.getEvents(),
      axios.get('/api/process/processes').catch(() => null),
    ])
    serviceDiscoveryAvailable.value = processesResponse != null
    managedServiceNames.value = [...new Set(
      (processesResponse?.data?.processes || [])
        .filter((process) => process?.enabled === true || process?.enabled === 'true')
        .map((process) => String(process?.process_name || '').trim())
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right))
    applyConfig(payload)
    if (Array.isArray(events?.event_types) && events.event_types.length) {
      eventTypes.value = events.event_types
    }
    await loadHistory()
  } catch (cause) {
    supported.value = false
    error.value = cause?.response?.data?.detail || 'Notifications are unavailable on this backend.'
  } finally {
    loading.value = false
  }
}

const addDestination = () => {
  config.destinations.push(normalizeDestination())
}

const removeDestination = (index) => {
  config.destinations.splice(index, 1)
}

const toggleEvent = (destination, eventType) => {
  const current = new Set(destination.event_types)
  if (current.has(eventType)) current.delete(eventType)
  else current.add(eventType)
  destination.event_types = [...current]
}

const buildPayload = () => ({
  enabled: !!config.enabled,
  monitor_interval_sec: Number(config.monitor_interval_sec),
  history_retention_days: Number(config.history_retention_days),
  max_attempts: Number(config.max_attempts),
  retry_base_sec: Number(config.retry_base_sec),
  thresholds: {
    cpu_percent: Number(config.thresholds.cpu_percent),
    memory_percent: Number(config.thresholds.memory_percent),
    disk_percent: Number(config.thresholds.disk_percent),
    inode_percent: Number(config.thresholds.inode_percent),
    database_pressure: config.thresholds.database_pressure,
    duration_sec: Number(config.thresholds.duration_sec),
  },
  destinations: config.destinations.map((destination) => {
    let headers = {}
    if (destination.headersText.trim()) {
      try {
        headers = JSON.parse(destination.headersText)
      } catch {
        throw new Error(`Headers for ${destination.name} must be a valid JSON object.`)
      }
      if (!headers || Array.isArray(headers) || typeof headers !== 'object') {
        throw new Error(`Headers for ${destination.name} must be a JSON object.`)
      }
    }
    return {
      id: destination.id,
      name: destination.name.trim() || 'Notification destination',
      enabled: !!destination.enabled,
      provider: destination.provider,
      url: destination.url.trim(),
      url_configured: !!destination.url_configured,
      verify_tls: !!destination.verify_tls,
      headers,
      headers_configured: !!destination.headers_configured,
      minimum_severity: destination.minimum_severity,
      event_types: [...destination.event_types],
      service_names: destination.service_names.filter((name) => managedServiceNames.value.includes(name)),
      cooldown_sec: Number(destination.cooldown_sec),
      send_recovery: !!destination.send_recovery,
    }
  }),
})

const save = async (silent = false) => {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    if (!serviceDiscoveryAvailable.value) {
      throw new Error('Enabled services could not be verified. Refresh Settings before saving notification destinations.')
    }
    const payload = buildPayload()
    const result = await notificationService.updateConfig(payload)
    applyConfig(result)
    saved.value = true
    if (!silent) setTimeout(() => { saved.value = false }, 2500)
    return true
  } catch (cause) {
    error.value = cause?.response?.data?.detail || cause?.message || 'Failed to save notification settings.'
    return false
  } finally {
    saving.value = false
  }
}

const testDestination = async (destination) => {
  testState[destination.id] = 'saving'
  if (!(await save(true))) {
    testState[destination.id] = 'failed'
    return
  }
  testState[destination.id] = 'sending'
  try {
    const result = await notificationService.testDestination(destination.id)
    testState[destination.id] = result?.status === 'sent' ? 'sent' : (result?.status || 'failed')
    await loadHistory()
  } catch (cause) {
    testState[destination.id] = 'failed'
    error.value = cause?.response?.data?.detail || 'Test notification failed.'
  }
}

const sendManual = async () => {
  manualStatus.value = 'sending'
  error.value = ''
  try {
    await notificationService.sendManual({
      title: manual.title,
      body: manual.body,
      severity: manual.severity,
      destination_ids: manual.destinationIds.length ? manual.destinationIds : null,
    })
    manualStatus.value = 'queued'
    manual.title = ''
    manual.body = ''
    setTimeout(loadHistory, 1000)
  } catch (cause) {
    manualStatus.value = 'failed'
    error.value = cause?.response?.data?.detail || 'Failed to queue the notification.'
  }
}

const clearHistory = async () => {
  if (!globalThis.confirm?.('Clear completed notification delivery history?')) return
  try {
    await notificationService.clearHistory()
    await loadHistory()
  } catch (cause) {
    error.value = cause?.response?.data?.detail || 'Failed to clear notification history.'
  }
}

const timestamp = (value) => value ? new Date(value * 1000).toLocaleString() : '—'
const statusClass = (status) => ({
  sent: 'text-emerald-300 border-emerald-600/50 bg-emerald-500/10',
  failed: 'text-red-300 border-red-600/50 bg-red-500/10',
  retrying: 'text-amber-300 border-amber-600/50 bg-amber-500/10',
  queued: 'text-blue-300 border-blue-600/50 bg-blue-500/10',
  suppressed: 'text-slate-300 border-slate-600 bg-slate-700/30',
}[status] || 'text-slate-300 border-slate-600')

onMounted(load)
</script>

<template>
  <div v-if="loading" class="text-sm text-slate-400">Checking notification support...</div>
  <SettingsSection v-else-if="supported" section-id="notifications" title="Notifications">
    <div class="flex flex-col gap-6 px-2">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <p class="text-lg font-semibold">Backend notification delivery</p>
            <span
              class="material-symbols-rounded !text-[18px] text-slate-400"
              title="Backend-owned notifications continue working when no browser is open. Browser-local Metrics banners remain independent."
            >info</span>
          </div>
          <p class="mt-2 max-w-4xl text-sm text-slate-400">
            Route DUMB health and operational events to Apprise services or generic JSON webhooks. Delivery is queued, retried, deduplicated, and recorded locally.
          </p>
          <a
            href="https://dumbarr.com/features/notifications/"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 inline-block text-xs text-blue-400 underline"
          >Notification documentation</a>
        </div>
        <label
          class="flex items-center gap-2 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
          title="Global delivery switch. Save & test can still test one destination while this is off."
        >
          <input v-model="config.enabled" type="checkbox" class="h-4 w-4 accent-emerald-400" />
          Enable outbound notifications
        </label>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <h3 class="font-semibold">Monitoring and delivery</h3>
        <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
          <label class="flex flex-col gap-1" title="How often backend resource and database conditions are evaluated.">
            <span>Monitor interval (seconds)</span>
            <input v-model.number="config.monitor_interval_sec" type="number" min="15" max="3600" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5" />
          </label>
          <label class="flex flex-col gap-1" title="How long completed delivery records remain in the local notification database.">
            <span>History retention (days)</span>
            <input v-model.number="config.history_retention_days" type="number" min="1" max="3650" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5" />
          </label>
          <label class="flex flex-col gap-1" title="Maximum delivery attempts before a notification is marked failed.">
            <span>Maximum attempts</span>
            <input v-model.number="config.max_attempts" type="number" min="1" max="10" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5" />
          </label>
          <label class="flex flex-col gap-1" title="Initial retry delay. Later retries use exponential backoff.">
            <span>Retry base (seconds)</span>
            <input v-model.number="config.retry_base_sec" type="number" min="1" max="3600" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5" />
          </label>
        </div>
      </div>

      <div class="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <h3 class="font-semibold">Persistent-condition thresholds</h3>
        <p class="mt-1 text-xs text-slate-400">A condition must remain active for the configured duration before it is sent.</p>
        <div class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <label v-for="field in ['cpu_percent', 'memory_percent', 'disk_percent', 'inode_percent']" :key="field" class="flex flex-col gap-1">
            <span>{{ field.replace('_percent', '').replace('_', ' ') }} (%)</span>
            <input v-model.number="config.thresholds[field]" type="number" min="1" max="100" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5" />
          </label>
          <label class="flex flex-col gap-1">
            <span>Database pressure</span>
            <select v-model="config.thresholds.database_pressure" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5">
              <option value="moderate">Moderate</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span>Duration (seconds)</span>
            <input v-model.number="config.thresholds.duration_sec" type="number" min="0" max="86400" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5" />
          </label>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-xl font-semibold">Destinations and routing</h3>
          <p class="text-xs text-slate-400">An empty event list means all events. Service filters use exact process names and are optional.</p>
        </div>
        <button type="button" class="rounded bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500" @click="addDestination">Add destination</button>
      </div>

      <div class="rounded-lg border border-blue-500/40 bg-blue-500/10 p-4 text-sm text-slate-200">
        <div class="flex items-start gap-2">
          <span class="material-symbols-rounded !text-[20px] text-blue-300">info</span>
          <div class="space-y-1">
            <p class="font-semibold">Service-down and Auto-restart behavior</p>
            <p class="text-xs text-slate-300">
              Unexpected managed-process exits notify immediately. Unhealthy and Auto-restart events require Auto-restart health monitoring to be enabled for the exact service, and unhealthy fires only after its consecutive-check threshold. DUMB does not send an alert solely because a service card shows Stopped; intentionally stopped or disabled services are not generic down events.
            </p>
            <a
              href="https://dumbarr.com/features/auto-restart/"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-block text-xs text-blue-300 underline"
            >Configure and understand Auto-restart</a>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-slate-200">
        <div class="flex items-start gap-2">
          <span class="material-symbols-rounded !text-[20px] text-emerald-300">hub</span>
          <div class="space-y-1">
            <p class="font-semibold">Apprise runs inside DUMB</p>
            <p class="text-xs text-slate-300">
              DUMB's embedded Apprise library connects directly from this container to Discord, ntfy, Telegram, email, or the provider in your URL. Messages are not relayed through appriseit.com and no third-party Apprise account or server is required. Only an intentional <code>apprise://</code> or <code>apprises://</code> URL sends through the Apprise API server named in that URL.
            </p>
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              <a
                href="https://appriseit.com/url-builder/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs text-emerald-300 underline"
              >Open the official Apprise URL Builder</a>
              <a
                href="https://appriseit.com/services/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs text-emerald-300 underline"
              >Browse supported services</a>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!config.destinations.length" class="rounded border border-dashed border-slate-600 p-6 text-center text-sm text-slate-400">
        Add an Apprise URL or generic webhook to begin routing notifications.
      </div>

      <div v-for="(destination, index) in config.destinations" :key="destination.id" class="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <input
              v-model="destination.enabled"
              type="checkbox"
              class="h-4 w-4 accent-emerald-400"
              title="Enable this destination. Disabling it pauses queued deliveries without consuming retry attempts; Save & test can still test it."
            />
            <input v-model="destination.name" class="min-w-52 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-semibold" aria-label="Destination name" />
          </div>
          <div class="flex items-center gap-2">
            <span v-if="testState[destination.id]" class="text-xs text-slate-300">Test: {{ testState[destination.id] }}</span>
            <button
              type="button"
              class="rounded bg-emerald-700 px-3 py-1.5 text-xs hover:bg-emerald-600"
              title="Saves settings, then tests this destination even if global delivery or this destination is disabled. The test bypasses severity, event, service, and cooldown filters."
              @click="testDestination(destination)"
              :disabled="!serviceDiscoveryAvailable"
            >Save & test</button>
            <button type="button" class="rounded bg-red-700 px-3 py-1.5 text-xs hover:bg-red-600" @click="removeDestination(index)">Remove</button>
          </div>
        </div>

        <div class="mt-4 grid gap-3 lg:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm">
            <span>Provider</span>
            <select v-model="destination.provider" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5">
              <option value="apprise">Apprise URL</option>
              <option value="webhook">Generic JSON webhook</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span>{{ destination.provider === 'apprise' ? 'Apprise notification URL' : 'Webhook URL' }}</span>
            <input
              v-model="destination.url"
              type="password"
              autocomplete="new-password"
              class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5"
              :placeholder="destination.url_configured ? 'Configured — leave blank to keep' : (destination.provider === 'apprise' ? 'discord://, ntfy://, tgram://, mailto://…' : 'https://example.invalid/webhook')"
            />
          </label>
          <div v-if="destination.provider === 'apprise'" class="text-xs text-slate-400 lg:col-span-2">
            Need help constructing this URL?
            <a href="https://appriseit.com/url-builder/" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">Use the official URL Builder</a>.
            Treat the finished URL like a password because it normally contains provider credentials.
          </div>
          <label
            class="flex flex-col gap-1 text-sm"
            title="Filtering happens before event selection. Warning, the default, excludes Info and Success events. Recovery notices bypass this minimum."
          >
            <span>Minimum severity</span>
            <select v-model="destination.minimum_severity" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5">
              <option v-for="(label, value) in severityLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <div
            v-if="filteredEventsForDestination(destination).length"
            class="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 lg:col-span-2"
          >
            <span class="font-semibold">Filtered by {{ severityLabels[destination.minimum_severity] }}:</span>
            {{ filteredEventSummary(destination) }}.
            Choose a lower minimum if you want these events. Recovery notices and manual messages use their own routing rules.
          </div>
          <label class="flex flex-col gap-1 text-sm">
            <span>Cooldown (seconds)</span>
            <input v-model.number="destination.cooldown_sec" type="number" min="0" max="604800" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5" />
          </label>
          <div class="flex flex-col gap-1 text-sm lg:col-span-2">
            <span>Service filters (optional)</span>
            <details class="relative">
              <summary
                class="flex cursor-pointer list-none items-center justify-between gap-3 rounded border border-slate-600 bg-slate-900 px-3 py-2"
                title="Select from services currently enabled in DUMB. Leave every service unchecked to match all services."
              >
                <span class="truncate">{{ serviceFilterLabel(destination) }}</span>
                <span class="material-symbols-rounded !text-[18px] text-slate-400">expand_more</span>
              </summary>
              <div class="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded border border-slate-600 bg-slate-900 p-2 shadow-xl">
                <p class="px-2 pb-2 text-xs text-slate-400">Only currently enabled services are listed. No selection matches all services.</p>
                <p v-if="!serviceDiscoveryAvailable" class="px-2 pb-2 text-xs text-amber-300">
                  Enabled-service discovery is temporarily unavailable. Refresh Settings before configuring or saving notification destinations.
                </p>
                <label
                  v-for="serviceName in serviceOptionsForDestination(destination)"
                  :key="serviceName"
                  class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    class="accent-emerald-400"
                    :checked="destination.service_names.includes(serviceName)"
                    @change="toggleService(destination, serviceName)"
                  />
                  <span>{{ serviceName }}</span>
                </label>
                <p v-if="!serviceOptionsForDestination(destination).length" class="px-2 py-3 text-xs text-amber-300">
                  {{ serviceDiscoveryAvailable
                    ? 'No enabled services are available. Enable a service or refresh Settings and try again.'
                    : 'Unable to load enabled services. Refresh Settings and try again.' }}
                </p>
                <button
                  v-if="destination.service_names.length"
                  type="button"
                  class="mt-2 px-2 text-xs text-blue-400 underline"
                  @click="destination.service_names = []"
                >Match all services</button>
              </div>
            </details>
            <div v-if="destination.service_names.length" class="flex flex-wrap gap-1.5 pt-1">
              <button
                v-for="serviceName in destination.service_names"
                :key="serviceName"
                type="button"
                class="flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-red-400"
                :title="`Remove ${serviceName} from this destination`"
                @click="toggleService(destination, serviceName)"
              >
                {{ serviceName }}
                <span class="material-symbols-rounded !text-[14px]">close</span>
              </button>
            </div>
          </div>
          <label v-if="destination.provider === 'webhook'" class="flex flex-col gap-1 text-sm lg:col-span-2">
            <span>Request headers as JSON (optional)</span>
            <textarea
              v-model="destination.headersText"
              rows="2"
              class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs"
              :placeholder="destination.headers_configured ? 'Configured — leave blank to keep' : '{&quot;Authorization&quot;: &quot;Bearer …&quot;}'"
            />
          </label>
        </div>

        <div class="mt-3 flex flex-wrap gap-4 text-sm">
          <label class="flex items-center gap-2" title="Send a Success recovery when an active CPU, memory, disk, inode, database-pressure, or database-collection threshold clears. Auto-restart success is a separate event.">
            <input v-model="destination.send_recovery" type="checkbox" class="accent-emerald-400" /> Recovery messages
          </label>
          <label v-if="destination.provider === 'webhook'" class="flex items-center gap-2" title="Disable only for a deliberately trusted endpoint using a private or self-signed certificate.">
            <input v-model="destination.verify_tls" type="checkbox" class="accent-emerald-400" /> Verify TLS certificates
          </label>
        </div>

        <details class="mt-4 rounded border border-slate-700 bg-slate-900/40 p-3">
          <summary class="cursor-pointer text-sm font-semibold">Event routing ({{ destination.event_types.length ? `${destination.event_types.length} selected` : 'all events' }})</summary>
          <p class="mt-2 text-xs text-slate-400">
            Severity filtering is applied first. An empty event list matches every event; unchecked boxes below do not mean disabled while the list is empty.
          </p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label
              v-for="eventType in eventTypes"
              :key="eventType"
              class="flex items-start gap-2 rounded border border-slate-700/70 bg-slate-800/40 p-2 text-xs text-slate-300"
              :title="`${eventType}: ${eventGuidance[eventType]?.description || 'Backend-provided notification event.'}`"
            >
              <input
                type="checkbox"
                class="mt-0.5 accent-emerald-400"
                :checked="destination.event_types.includes(eventType)"
                @change="toggleEvent(destination, eventType)"
              />
              <span class="min-w-0">
                <span class="flex flex-wrap items-center gap-1.5 font-medium text-slate-200">
                  {{ eventLabels[eventType] || eventType }}
                  <span class="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {{ eventSeverityLabel(eventType) }}
                  </span>
                </span>
                <span class="mt-1 block leading-relaxed text-slate-400">
                  {{ eventGuidance[eventType]?.description || 'Backend-provided notification event.' }}
                </span>
              </span>
            </label>
          </div>
          <button v-if="destination.event_types.length" type="button" class="mt-3 text-xs text-blue-400 underline" @click="destination.event_types = []">Match all events</button>
        </details>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button type="button" :disabled="saving || !serviceDiscoveryAvailable" class="rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500 disabled:opacity-50" @click="save(false)">{{ saving ? 'Saving…' : 'Save notification settings' }}</button>
      <span v-if="saved" class="text-sm text-emerald-300">Saved</span>
      <span v-if="error" class="text-sm text-red-300">{{ error }}</span>
    </div>

    <div class="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <h3 class="text-lg font-semibold">Send a manual notification</h3>
      <p class="mt-1 text-xs text-slate-400">Useful for sending an operator message without generating a health event. Manual messages bypass the global switch, severity/event/service routing, and cooldowns, but disabled destinations are skipped. Use Save & test to validate a disabled destination.</p>
      <div class="mt-3 grid gap-3 lg:grid-cols-4">
        <input v-model="manual.title" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm lg:col-span-2" placeholder="Title" />
        <select v-model="manual.severity" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm">
          <option v-for="(label, value) in severityLabels" :key="value" :value="value">{{ label }}</option>
        </select>
        <button type="button" :disabled="!manual.title || !manual.body || manualStatus === 'sending'" class="rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50" @click="sendManual">{{ manualStatus === 'sending' ? 'Sending…' : 'Send' }}</button>
        <textarea v-model="manual.body" rows="3" class="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm lg:col-span-4" placeholder="Message" />
      </div>
      <div v-if="config.destinations.length" class="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
        <span>Destinations (none selected sends to all):</span>
        <label v-for="destination in config.destinations" :key="destination.id" class="flex items-center gap-1">
          <input v-model="manual.destinationIds" type="checkbox" :value="destination.id" class="accent-emerald-400" /> {{ destination.name }}
        </label>
        <span v-if="manualStatus === 'queued'" class="text-emerald-300">Queued</span>
      </div>
    </div>

    <div class="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-lg font-semibold">Delivery history</h3>
          <p class="text-xs text-slate-400">URLs, headers, and credentials are never included in history records.</p>
        </div>
        <div class="flex gap-2">
          <button type="button" class="rounded bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600" @click="loadHistory">Refresh</button>
          <button type="button" class="rounded bg-red-800 px-3 py-1.5 text-xs hover:bg-red-700" @click="clearHistory">Clear completed</button>
        </div>
      </div>
      <div class="mt-3 max-h-96 overflow-auto">
        <table class="w-full min-w-[900px] text-left text-xs">
          <thead class="sticky top-0 bg-slate-800 text-slate-400">
            <tr>
              <th class="px-2 py-2">Time</th><th class="px-2 py-2">Destination</th><th class="px-2 py-2">Event</th><th class="px-2 py-2">Service</th><th class="px-2 py-2">Severity</th><th class="px-2 py-2">Status</th><th class="px-2 py-2">Attempts</th><th class="px-2 py-2">Message</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-700">
            <tr v-for="item in history" :key="item.id">
              <td class="whitespace-nowrap px-2 py-2">{{ timestamp(item.created_at) }}</td>
              <td class="px-2 py-2">{{ item.destination_name }}</td>
              <td class="px-2 py-2" :title="item.event_type">{{ eventLabels[item.event_type] || item.event_type }}</td>
              <td class="px-2 py-2">{{ item.service_name || '—' }}</td>
              <td class="px-2 py-2">{{ item.severity }}</td>
              <td class="px-2 py-2"><span class="rounded border px-1.5 py-0.5" :class="statusClass(item.status)">{{ item.status }}</span></td>
              <td class="px-2 py-2">{{ item.attempts }}</td>
              <td class="max-w-sm truncate px-2 py-2" :title="item.error || item.body">{{ item.error || item.title }}</td>
            </tr>
            <tr v-if="!history.length"><td colspan="8" class="px-2 py-6 text-center text-slate-400">{{ historyLoading ? 'Loading…' : 'No notification deliveries yet.' }}</td></tr>
          </tbody>
        </table>
      </div>
      </div>
    </div>
  </SettingsSection>
</template>
