<script setup>
import { useLocalStorage, useSessionStorage } from '@vueuse/core'
import { configRepository } from '~/services/config.js'
const metricsStore = useMetricsStore()
const metrics = ref(null)
const history = ref([])
const historyTruncated = ref(false)
const connectionStatus = ref('disconnected')
const errorMessage = ref(null)
const lastUpdated = ref(null)
const reconnectAttempts = ref(0)
const intervalSeconds = 2
const historyEnabled = useLocalStorage('metrics.historyEnabled', true)
const historyHours = useLocalStorage('metrics.historyHours', 6)
const historyLimit = useLocalStorage('metrics.historyLimit', 5000)
const historyBucketSeconds = useLocalStorage('metrics.historyBucketSeconds', 5)
const historyMaxPoints = useLocalStorage('metrics.historyMaxPoints', 600)
const alertsEnabled = useLocalStorage('metrics.alertsEnabled', true)
const metricsSettingsOpen = ref(false)
const metricsConfigLoading = ref(false)
const metricsConfigError = ref('')
const metricsConfigSaved = ref(false)
const metricsConfig = reactive({
  history_enabled: true,
  history_interval_sec: 5,
  history_retention_days: 1,
  history_max_file_mb: 50,
  history_max_total_mb: 100,
  history_dir: '/config/metrics',
})
const metricsConfigDraft = reactive({ ...metricsConfig })
const historyCache = useSessionStorage('metrics.historyCache', {
  hours: null,
  limit: null,
  bucket_seconds: null,
  max_points: null,
  items: [],
  truncated: false,
  stats: null,
  bucket_seconds_effective: null,
  updated_at: null,
})
const historySource = ref('')
const selectedProcess = ref(null)
const selectedProcessKind = ref('managed')
const cpuMode = useLocalStorage('metrics.cpuMode', 'total')
const historyPresets = [1, 6, 12, 24, 72]
const historyPreset = useLocalStorage('metrics.historyPreset', '6')
const historySeriesOverride = ref(null)
const historyTimestampsOverride = ref([])
const historyStatsOverride = ref(null)
const historyBucketEffective = ref(null)
const effectiveBucketSeconds = computed(() => (
  historyBucketEffective.value
  || metricsStore.historyBucketSeconds
  || historyBucketSeconds.value
))
const headerTooltip = ref(null)
const headerTooltipPos = reactive({ x: 0, y: 0 })
const hoverState = reactive({
  cpu: null,
  mem: null,
  disk: null,
  diskIo: null,
  net: null,
  procCpu: null,
  procRss: null,
  procIo: null,
})
const zoomChart = ref(null)
const zoomHover = ref(null)
const managedSortKey = ref('name')
const managedSortDir = ref('asc')
const externalSortKey = ref('cpu_percent')
const externalSortDir = ref('desc')
const managedTopCount = useLocalStorage('metrics.managedTopCount', 0)
const externalTopCount = useLocalStorage('metrics.externalTopCount', 0)
const managedPinned = useLocalStorage('metrics.managedPinned', [])
const externalPinned = useLocalStorage('metrics.externalPinned', [])
const cpuWarnThreshold = useLocalStorage('metrics.cpuWarnThreshold', 85)
const memWarnThreshold = useLocalStorage('metrics.memWarnThreshold', 85)
const diskWarnThreshold = useLocalStorage('metrics.diskWarnThreshold', 90)
const managedTableRef = ref(null)
const externalTableRef = ref(null)
const managedScrollTop = ref(0)
const externalScrollTop = ref(0)
const rowHeight = 28
const visibleRowCount = 12
const overscanRows = 5

let isUnmounted = false
let pendingHistoryRefresh = false
let headerPressTimer = null
let headerTooltipTimer = null
let suppressHeaderClickOnce = false
let headerLongPressActive = false
let settingsSaveTimer = null

const metricsConfigKeys = [
  'history_enabled',
  'history_interval_sec',
  'history_retention_days',
  'history_max_file_mb',
  'history_max_total_mb',
  'history_dir',
]

function normalizeProcessCpu(value) {
  if (value == null || Number.isNaN(value)) return null
  if (cpuMode.value === 'per-core') return value
  const cores = system.value?.cpu_count || 0
  if (!cores) return value
  return value / cores
}

function lastValid(values) {
  if (!Array.isArray(values)) return null
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value != null && !Number.isNaN(value)) return value
  }
  return null
}

const applyPinned = (items, pinnedList) => {
  if (!pinnedList.length) return items
  const pinned = []
  const rest = []
  items.forEach((item) => {
    if (pinnedList.includes(item?.name)) pinned.push(item)
    else rest.push(item)
  })
  return [...pinned, ...rest]
}

const buildProcessHistoryMap = (items, kind, cpuCount, namesOverride = null) => {
  const snapshots = Array.isArray(items) ? items : []
  const names = new Set()
  if (Array.isArray(namesOverride) && namesOverride.length) {
    namesOverride.forEach((name) => {
      if (name) names.add(name)
    })
  } else {
    const latestList = kind === 'external' ? externalProcesses.value : managedProcesses.value
    latestList.forEach((proc) => names.add(proc.name))
  }
  const result = {}
  names.forEach((name) => {
    result[name] = { cpu: [], rss: [] }
  })
  if (!names.size || !snapshots.length) return result
  snapshots.forEach((snapshot) => {
    const list = kind === 'external' ? (snapshot.external || []) : (snapshot.dumb_managed || [])
    const lookup = new Map(list.map((proc) => [proc.name, proc]))
    names.forEach((name) => {
      const entry = lookup.get(name)
      const cpuValue = entry?.cpu_percent ?? null
      const normalized = cpuMode.value === 'per-core' || !cpuCount ? cpuValue : (cpuValue / cpuCount)
      result[name].cpu.push(normalized)
      result[name].rss.push(entry?.rss ?? null)
    })
  })
  return result
}

function isPinned(list, name) {
  return list.includes(name)
}

function togglePinned(listRef, name) {
  if (!name) return
  const next = listRef.value.slice()
  const index = next.indexOf(name)
  if (index >= 0) next.splice(index, 1)
  else next.unshift(name)
  listRef.value = next
}

const system = computed(() => metrics.value?.system || null)
const managedProcesses = computed(() => metrics.value?.dumb_managed || [])
const externalProcesses = computed(() => metrics.value?.external || [])
const sortedManagedProcesses = computed(() => {
  const sorted = sortRows(managedProcesses.value, managedSortKey.value, managedSortDir.value)
  return applyPinned(sorted, managedPinned.value)
})
const sortedExternalProcesses = computed(() => {
  const sorted = sortRows(externalProcesses.value, externalSortKey.value, externalSortDir.value)
  return applyPinned(sorted, externalPinned.value)
})
const visibleManagedProcesses = computed(() => {
  if (!managedTopCount.value) return sortedManagedProcesses.value
  return sortedManagedProcesses.value.slice(0, managedTopCount.value)
})
const visibleExternalProcesses = computed(() => {
  if (!externalTopCount.value) return sortedExternalProcesses.value
  return sortedExternalProcesses.value.slice(0, externalTopCount.value)
})
const managedVirtual = computed(() => {
  const items = visibleManagedProcesses.value
  const start = Math.max(0, Math.floor(managedScrollTop.value / rowHeight) - overscanRows)
  const end = Math.min(items.length, start + visibleRowCount + overscanRows * 2)
  return {
    items: items.slice(start, end),
    topPad: start * rowHeight,
    bottomPad: (items.length - end) * rowHeight,
    startIndex: start,
    total: items.length,
  }
})
const externalVirtual = computed(() => {
  const items = visibleExternalProcesses.value
  const start = Math.max(0, Math.floor(externalScrollTop.value / rowHeight) - overscanRows)
  const end = Math.min(items.length, start + visibleRowCount + overscanRows * 2)
  return {
    items: items.slice(start, end),
    topPad: start * rowHeight,
    bottomPad: (items.length - end) * rowHeight,
    startIndex: start,
    total: items.length,
  }
})
const rangeEnd = computed(() => (metrics.value?.timestamp ?? Date.now() / 1000))
const rangeStart = computed(() => rangeEnd.value - historyHours.value * 60 * 60)
const filteredHistory = computed(() => {
  if (!history.value.length) return []
  const start = rangeStart.value
  const end = rangeEnd.value
  return history.value
    .filter((item) => (item.timestamp || 0) >= start && (item.timestamp || 0) <= end)
})
const historySeriesPayload = computed(() => {
  const series = historySeriesOverride.value
  const timestamps = historyTimestampsOverride.value
  if (series && Array.isArray(timestamps) && timestamps.length) {
    const filtered = filterSeriesPayload(series, timestamps, rangeStart.value, rangeEnd.value)
    return insertGapMarkers(filtered.series, filtered.timestamps)
  }
  const built = {
    series: buildHistorySeries(filteredHistory.value),
    timestamps: filteredHistory.value.map((item) => item.timestamp),
  }
  return insertGapMarkers(built.series, built.timestamps)
})
const historySeries = computed(() => historySeriesPayload.value.series)
const historyTimestamps = computed(() => historySeriesPayload.value.timestamps)
const cpuChart = computed(() => padSeriesToRange(historySeries.value.cpu, historyTimestamps.value, rangeStart.value, rangeEnd.value, null))
const memChart = computed(() => padSeriesToRange(historySeries.value.mem, historyTimestamps.value, rangeStart.value, rangeEnd.value, null))
const diskIoRates = computed(() => {
  if (historySeries.value?.diskReadRate?.length || historySeries.value?.diskWriteRate?.length) {
    return {
      read: historySeries.value.diskReadRate || [],
      write: historySeries.value.diskWriteRate || [],
    }
  }
  if (!filteredHistory.value.length) {
    return { read: [], write: [] }
  }
  const readValues = filteredHistory.value.map((item) => item.system?.disk_io?.read_bytes ?? null)
  const writeValues = filteredHistory.value.map((item) => item.system?.disk_io?.write_bytes ?? null)
  const timestamps = historyTimestamps.value
  return {
    read: buildRateSeriesFromTimestamps(readValues, timestamps),
    write: buildRateSeriesFromTimestamps(writeValues, timestamps),
  }
})
const diskIoChart = computed(() => padSeriesPairToRange(
  diskIoRates.value.read,
  diskIoRates.value.write,
  historyTimestamps.value,
  rangeStart.value,
  rangeEnd.value,
  null
))
const diskIoStats = computed(() => {
  const combined = [...diskIoChart.value.seriesA, ...diskIoChart.value.seriesB].filter((value) => value != null)
  if (!combined.length) return null
  return {
    min: Math.min(...combined),
    max: Math.max(...combined),
  }
})
const netChart = computed(() => padSeriesPairToRange(
  historySeries.value.netSentRate,
  historySeries.value.netRecvRate,
  historyTimestamps.value,
  rangeStart.value,
  rangeEnd.value,
  null
))
const netRateStats = computed(() => {
  const combined = [...netChart.value.seriesA, ...netChart.value.seriesB].filter((value) => value != null)
  if (!combined.length) return null
  return {
    min: Math.min(...combined),
    max: Math.max(...combined),
  }
})
const netLatestRates = computed(() => ({
  sent: lastValid(netChart.value.seriesA),
  recv: lastValid(netChart.value.seriesB),
}))
const netIntervalTotals = computed(() => {
  const items = filteredHistory.value
  if (!items.length) return { sent: null, recv: null }
  let first = null
  let last = null
  items.forEach((item) => {
    if (item?.system?.net_io) {
      if (!first) first = item
      last = item
    }
  })
  const firstSent = first?.system?.net_io?.sent_bytes
  const firstRecv = first?.system?.net_io?.recv_bytes
  const lastSent = last?.system?.net_io?.sent_bytes
  const lastRecv = last?.system?.net_io?.recv_bytes
  if (firstSent == null || lastSent == null || firstRecv == null || lastRecv == null) {
    return { sent: null, recv: null }
  }
  const sent = lastSent - firstSent
  const recv = lastRecv - firstRecv
  return {
    sent: sent >= 0 ? sent : null,
    recv: recv >= 0 ? recv : null,
  }
})
const managedHistoryNames = computed(() => managedVirtual.value.items.map((proc) => proc.name))
const externalHistoryNames = computed(() => externalVirtual.value.items.map((proc) => proc.name))
const managedHistoryMap = computed(() => buildProcessHistoryMap(filteredHistory.value, 'managed', system.value?.cpu_count, managedHistoryNames.value))
const externalHistoryMap = computed(() => buildProcessHistoryMap(filteredHistory.value, 'external', system.value?.cpu_count, externalHistoryNames.value))
const alerts = computed(() => {
  if (!alertsEnabled.value) return []
  const list = []
  if (system.value?.cpu_percent != null && system.value.cpu_percent >= cpuWarnThreshold.value) {
    list.push(`CPU at ${formatPercent(system.value.cpu_percent)}`)
  }
  if (system.value?.mem?.percent != null && system.value.mem.percent >= memWarnThreshold.value) {
    list.push(`Memory at ${formatPercent(system.value.mem.percent)}`)
  }
  if (system.value?.disk?.percent != null && system.value.disk.percent >= diskWarnThreshold.value) {
    list.push(`Disk at ${formatPercent(system.value.disk.percent)}`)
  }
  return list
})
const selectedProcessHistory = computed(() => {
  if (!selectedProcess.value) return []
  return filteredHistory.value.map((item) => {
    const list = selectedProcessKind.value === 'external'
      ? (item.external || [])
      : (item.dumb_managed || [])
    const entry = list.find((proc) => proc.name === selectedProcess.value)
    return {
      timestamp: item.timestamp,
      cpu: normalizeProcessCpu(entry?.cpu_percent ?? null),
      rss: entry?.rss ?? null,
      ioRead: entry?.disk_io?.read_bytes ?? null,
      ioWrite: entry?.disk_io?.write_bytes ?? null,
    }
  })
})
const selectedProcessTimestamps = computed(() => selectedProcessHistory.value.map((item) => item.timestamp))
const selectedProcessIoRates = computed(() => {
  if (!selectedProcessHistory.value.length) {
    return { read: [], write: [] }
  }
  const readValues = selectedProcessHistory.value.map((item) => item.ioRead)
  const writeValues = selectedProcessHistory.value.map((item) => item.ioWrite)
  const timestamps = selectedProcessTimestamps.value
  return {
    read: buildRateSeriesFromTimestamps(readValues, timestamps),
    write: buildRateSeriesFromTimestamps(writeValues, timestamps),
  }
})
const selectedCpuChart = computed(() => padSeriesToRange(selectedProcessHistory.value.map((item) => item.cpu), selectedProcessTimestamps.value, rangeStart.value, rangeEnd.value, null))
const selectedRssChart = computed(() => padSeriesToRange(selectedProcessHistory.value.map((item) => item.rss), selectedProcessTimestamps.value, rangeStart.value, rangeEnd.value, null))
const selectedIoChart = computed(() => padSeriesPairToRange(
  selectedProcessIoRates.value.read,
  selectedProcessIoRates.value.write,
  selectedProcessTimestamps.value,
  rangeStart.value,
  rangeEnd.value,
  null
))

const cpuStats = computed(() => seriesStats(historySeries.value.cpu))
const memStats = computed(() => seriesStats(historySeries.value.mem))
const selectedCpuStats = computed(() => seriesStats(selectedProcessHistory.value.map((item) => item.cpu)))
const selectedRssStats = computed(() => seriesStats(selectedProcessHistory.value.map((item) => item.rss)))
const selectedIoReadStats = computed(() => seriesStats(selectedProcessIoRates.value.read))
const selectedIoWriteStats = computed(() => seriesStats(selectedProcessIoRates.value.write))

const statusClass = computed(() => {
  if (connectionStatus.value === 'connected') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  if (connectionStatus.value === 'connecting') return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
  return 'bg-rose-500/20 text-rose-300 border-rose-500/40'
})

const formatBytes = (value) => {
  if (value == null || Number.isNaN(value)) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Number(value)
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const precision = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

const formatBits = (value) => {
  if (value == null || Number.isNaN(value)) return '-'
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb']
  let size = Number(value)
  let unitIndex = 0
  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000
    unitIndex += 1
  }
  const precision = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

const formatRate = (value) => {
  if (value == null || Number.isNaN(value)) return '-'
  return `${formatBits(value * 8)}/s`
}

const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '-'
  return `${Number(value).toFixed(1)}%`
}

const formatTimestamp = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return date.toLocaleTimeString()
}

const formatTooltipTime = (timestamp) => {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString()
}

const formatDateShort = (timestamp) => {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleTimeString()
}

const formatBucketRange = (timestamps, index) => {
  if (!timestamps?.length || index == null) return ''
  const current = timestamps[index]
  if (!current) return ''
  const prev = timestamps[index - 1] ?? current
  const next = timestamps[index + 1] ?? current
  const start = (prev + current) / 2
  const end = (current + next) / 2
  return `${formatTooltipTime(start)} → ${formatTooltipTime(end)}`
}

const rangeLabel = computed(() => {
  if (!historyEnabled.value) return 'History disabled'
  const start = rangeStart.value
  const end = rangeEnd.value
  if (!start || !end) return 'No history range'
  return `${formatTooltipTime(start)} → ${formatTooltipTime(end)}`
})

const connect = () => {
  connectionStatus.value = metricsStore.status
  errorMessage.value = metricsStore.error
  metricsStore.connect()
}

const disconnect = () => {}

const normalizeSeriesPayload = (series) => {
  if (!series || typeof series !== 'object') return null
  return {
    cpu: Array.isArray(series.cpu) ? series.cpu : [],
    mem: Array.isArray(series.mem) ? series.mem : [],
    disk: Array.isArray(series.disk) ? series.disk : [],
    netSentRate: Array.isArray(series.net_sent_rate) ? series.net_sent_rate : [],
    netRecvRate: Array.isArray(series.net_recv_rate) ? series.net_recv_rate : [],
    diskReadRate: Array.isArray(series.disk_read_rate) ? series.disk_read_rate : [],
    diskWriteRate: Array.isArray(series.disk_write_rate) ? series.disk_write_rate : [],
  }
}

const normalizeStatsPayload = (stats) => {
  if (!stats || typeof stats !== 'object') return null
  const toStats = (value) => {
    if (!value || typeof value !== 'object') return null
    const min = value.min
    const max = value.max
    if (min == null || max == null) return null
    return { min, max }
  }
  return {
    cpu: toStats(stats.cpu),
    mem: toStats(stats.mem),
    disk: toStats(stats.disk),
    diskReadRate: toStats(stats.disk_read_rate),
    diskWriteRate: toStats(stats.disk_write_rate),
    netSentRate: toStats(stats.net_sent_rate),
    netRecvRate: toStats(stats.net_recv_rate),
  }
}

const applyHistoryPayload = (payload, source) => {
  history.value = Array.isArray(payload.items) ? payload.items : []
  historyTruncated.value = Boolean(payload.truncated)
  historySource.value = source
  const normalizedSeries = normalizeSeriesPayload(payload.series)
  historySeriesOverride.value = normalizedSeries
  historyTimestampsOverride.value = normalizedSeries && Array.isArray(payload.timestamps)
    ? payload.timestamps
    : history.value.map((item) => item.timestamp)
  historyStatsOverride.value = normalizeStatsPayload(payload.stats)
  historyBucketEffective.value = payload.bucket_seconds ?? null
  if (history.value.length) {
    metrics.value = history.value[history.value.length - 1]
    lastUpdated.value = metrics.value?.timestamp ? metrics.value.timestamp * 1000 : Date.now()
  }
}

const manualReconnect = () => {
  pendingHistoryRefresh = false
  reconnectAttempts.value = 0
  metricsStore.connect()
}

const loadSnapshot = async () => {
  try {
    const response = await fetch('/api/metrics')
    if (!response.ok) return
    const payload = await response.json()
    if (payload) {
      metrics.value = payload
      lastUpdated.value = payload?.timestamp ? payload.timestamp * 1000 : Date.now()
    }
  } catch (error) {
    return
  }
}

const loadHistory = async (force = false) => {
  if (!historyEnabled.value) {
    history.value = []
    historyTruncated.value = false
    historySeriesOverride.value = null
    historyTimestampsOverride.value = []
    historyStatsOverride.value = null
    historyBucketEffective.value = null
    return
  }
  if (!force && metricsStore.historyItems?.length) {
    applyHistoryPayload(
      {
        items: metricsStore.historyItems,
        series: metricsStore.historySeries,
        timestamps: metricsStore.historyTimestamps,
        truncated: metricsStore.historyTruncated,
        stats: metricsStore.historyStats,
        bucket_seconds: metricsStore.historyBucketSeconds,
      },
      'bootstrap'
    )
    return
  }
  const params = new URLSearchParams()
  const since = Date.now() / 1000 - historyHours.value * 60 * 60
  params.set('since', `${since}`)
  params.set('limit', `${historyLimit.value}`)
  params.set('max_points', `${historyMaxPoints.value}`)
  params.set('bucket_seconds', `${historyBucketSeconds.value}`)
  const cacheIsValid = historyCache.value
    && historyCache.value.hours === historyHours.value
    && historyCache.value.limit === historyLimit.value
    && historyCache.value.bucket_seconds === historyBucketSeconds.value
    && historyCache.value.max_points === historyMaxPoints.value
    && Array.isArray(historyCache.value.items)
    && historyCache.value.items.length
    && historyCache.value.updated_at
    && (Date.now() - historyCache.value.updated_at) < 5 * 60 * 1000
  if (cacheIsValid) {
    applyHistoryPayload(
      {
        items: historyCache.value.items,
        truncated: historyCache.value.truncated,
        stats: historyCache.value.stats,
        bucket_seconds: historyCache.value.bucket_seconds_effective,
      },
      'cache'
    )
    if ((Date.now() - historyCache.value.updated_at) < 60 * 1000) {
      return
    }
  }
  try {
    const response = await fetch(`/api/metrics/history_series?${params.toString()}`)
    if (!response.ok) throw new Error('Failed to load history')
    const payload = await response.json()
    applyHistoryPayload(payload, 'server')
    try {
      historyCache.value = {
        hours: historyHours.value,
        limit: historyLimit.value,
        bucket_seconds: historyBucketSeconds.value,
        max_points: historyMaxPoints.value,
        items: compactHistoryItems(history.value, Math.min(historyLimit.value || 600, 600)),
        truncated: historyTruncated.value,
        stats: historyStatsOverride.value,
        bucket_seconds_effective: historyBucketEffective.value,
        updated_at: Date.now(),
      }
    } catch (error) {
      historyCache.value = {
        hours: null,
        limit: null,
        bucket_seconds: null,
        max_points: null,
        items: [],
        truncated: false,
        stats: null,
        updated_at: null,
      }
    }
  } catch (error) {
    errorMessage.value = 'Failed to load history.'
  }
}

const loadMetricsConfig = async () => {
  metricsConfigLoading.value = true
  metricsConfigError.value = ''
  try {
    const repo = configRepository()
    const config = await repo.getConfig()
    const metrics = config?.dumb?.metrics || {}
    metricsConfigKeys.forEach((key) => {
      if (metrics[key] != null) {
        metricsConfig[key] = metrics[key]
        metricsConfigDraft[key] = metrics[key]
      }
    })
  } catch (error) {
    metricsConfigError.value = 'Failed to load metrics settings.'
  } finally {
    metricsConfigLoading.value = false
  }
}

const saveMetricsConfig = async (updates) => {
  metricsConfigLoading.value = true
  metricsConfigError.value = ''
  metricsConfigSaved.value = false
  try {
    const repo = configRepository()
    await repo.updateGlobalConfig({ dumb: { metrics: updates } })
    metricsConfigKeys.forEach((key) => {
      if (updates[key] != null) {
        metricsConfig[key] = updates[key]
      }
    })
    metricsConfigSaved.value = true
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer)
    settingsSaveTimer = setTimeout(() => {
      metricsConfigSaved.value = false
    }, 2000)
  } catch (error) {
    metricsConfigError.value = 'Failed to save metrics settings.'
  } finally {
    metricsConfigLoading.value = false
  }
}

const applyMetricsConfig = async () => {
  const updates = {}
  metricsConfigKeys.forEach((key) => {
    updates[key] = metricsConfigDraft[key]
  })
  await saveMetricsConfig(updates)
}

const resetMetricsConfigDraft = () => {
  metricsConfigKeys.forEach((key) => {
    metricsConfigDraft[key] = metricsConfig[key]
  })
}

const applyHistorySettings = () => {
  if (connectionStatus.value === 'connecting') {
    pendingHistoryRefresh = true
    return
  }
  loadHistory(true)
}

const handleTableScroll = (kind, event) => {
  const value = event.target.scrollTop || 0
  if (kind === 'managed') managedScrollTop.value = value
  else externalScrollTop.value = value
}

const isVisibleSparkline = (index, kind) => {
  const scrollTop = kind === 'managed' ? managedScrollTop.value : externalScrollTop.value
  const start = Math.floor(scrollTop / rowHeight)
  const end = start + visibleRowCount
  return index >= start && index <= end
}

const selectProcess = (name, kind = 'managed') => {
  selectedProcess.value = selectedProcess.value === name && selectedProcessKind.value === kind ? null : name
  selectedProcessKind.value = kind
}

const downloadFile = (content, filename, type) => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const exportHistory = (format) => {
  const items = filteredHistory.value
  if (!items.length) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (format === 'json') {
    const payload = {
      range_start: rangeStart.value,
      range_end: rangeEnd.value,
      items,
    }
    downloadFile(JSON.stringify(payload, null, 2), `metrics-history-${stamp}.json`, 'application/json')
    return
  }
  const rows = [
    [
      'timestamp',
      'cpu_percent',
      'mem_percent',
      'disk_percent',
      'net_sent_bits_per_sec',
      'net_recv_bits_per_sec',
    ],
  ]
  items.forEach((item, index) => {
    rows.push([
      item.timestamp ?? '',
      item.system?.cpu_percent ?? '',
      item.system?.mem?.percent ?? '',
      item.system?.disk?.percent ?? '',
      historySeries.value.netSentRate?.[index] != null ? historySeries.value.netSentRate[index] * 8 : '',
      historySeries.value.netRecvRate?.[index] != null ? historySeries.value.netRecvRate[index] * 8 : '',
    ])
  })
  const csv = rows.map((row) => row.map((value) => `${value}`).join(',')).join('\n')
  downloadFile(csv, `metrics-history-${stamp}.csv`, 'text/csv')
}

const compactHistoryItems = (items, limit = 600) => {
  const trimmed = items.slice(-limit)
  return trimmed.map((item) => ({
    timestamp: item.timestamp,
    system: {
      cpu_percent: item.system?.cpu_percent ?? null,
      cpu_count: item.system?.cpu_count ?? null,
      mem: item.system?.mem ? { percent: item.system.mem.percent } : null,
      disk: item.system?.disk ? { percent: item.system.disk.percent } : null,
      disk_io: item.system?.disk_io
        ? {
            read_bytes: item.system.disk_io.read_bytes,
            write_bytes: item.system.disk_io.write_bytes,
          }
        : null,
      net_io: item.system?.net_io
        ? {
            sent_bytes: item.system.net_io.sent_bytes,
            recv_bytes: item.system.net_io.recv_bytes,
          }
        : null,
    },
    dumb_managed: Array.isArray(item.dumb_managed)
      ? item.dumb_managed.map((proc) => ({
          name: proc.name,
          pid: proc.pid,
          cpu_percent: proc.cpu_percent ?? null,
          rss: proc.rss ?? null,
          disk_io: proc.disk_io
            ? {
                read_bytes: proc.disk_io.read_bytes,
                write_bytes: proc.disk_io.write_bytes,
              }
            : null,
        }))
      : [],
    external: Array.isArray(item.external)
      ? item.external.map((proc) => ({
          name: proc.name,
          pid: proc.pid,
          cpu_percent: proc.cpu_percent ?? null,
          rss: proc.rss ?? null,
          disk_io: proc.disk_io
            ? {
                read_bytes: proc.disk_io.read_bytes,
                write_bytes: proc.disk_io.write_bytes,
              }
            : null,
        }))
      : [],
  }))
}

const scheduleHistoryReload = () => {
  if (historyReloadTimer) clearTimeout(historyReloadTimer)
  historyReloadTimer = setTimeout(() => {
    historyReloadTimer = null
    if (isUnmounted) return
    if (connectionStatus.value === 'connecting') {
      pendingHistoryRefresh = true
      return
    }
    manualReconnect()
  }, 800)
}

const updateSelectedProcess = (name) => {
  selectedProcess.value = selectedProcess.value === name ? null : name
}

const findClosestIndex = (timestamps, target) => {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    if (ts == null) continue
    const distance = Math.abs(ts - target)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }
  return bestIndex
}

const readClientX = (event) => {
  if (event?.touches?.length) return event.touches[0].clientX
  if (event?.changedTouches?.length) return event.changedTouches[0].clientX
  return event?.clientX
}

const handleHover = (key, event, series, timestamps, start, end) => {
  if (!series?.length) {
    hoverState[key] = null
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const clientX = readClientX(event)
  const rawX = clientX == null ? 0 : (clientX - rect.left)
  const x = Math.max(0, Math.min(rawX, rect.width))
  let index = 0
  if (timestamps?.length && start != null && end != null) {
    const target = start + (end - start) * (rect.width ? x / rect.width : 0)
    index = findClosestIndex(timestamps, target)
  } else {
    index = rect.width ? Math.round((x / rect.width) * (series.length - 1)) : 0
  }
  const value = series[index]
  const timestamp = timestamps?.[index]
  hoverState[key] = { index, x, value, timestamp, xRatio: rect.width ? x / rect.width : 0 }
}

const handleHoverDual = (key, event, seriesA, seriesB, timestamps, start, end) => {
  if (!seriesA?.length) {
    hoverState[key] = null
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const clientX = readClientX(event)
  const rawX = clientX == null ? 0 : (clientX - rect.left)
  const x = Math.max(0, Math.min(rawX, rect.width))
  let index = 0
  if (timestamps?.length && start != null && end != null) {
    const target = start + (end - start) * (rect.width ? x / rect.width : 0)
    index = findClosestIndex(timestamps, target)
  } else {
    index = rect.width ? Math.round((x / rect.width) * (seriesA.length - 1)) : 0
  }
  hoverState[key] = {
    index,
    x,
    valueA: seriesA[index],
    valueB: seriesB?.[index],
    timestamp: timestamps?.[index],
    xRatio: rect.width ? x / rect.width : 0,
  }
}

const clearHover = (key) => {
  hoverState[key] = null
}

const handleHeaderClick = (action) => {
  if (suppressHeaderClickOnce) {
    suppressHeaderClickOnce = false
    return
  }
  action()
}

const onHeaderTouchStart = (event, text) => {
  if (headerPressTimer) clearTimeout(headerPressTimer)
  if (headerTooltipTimer) clearTimeout(headerTooltipTimer)
  headerLongPressActive = false
  headerPressTimer = setTimeout(() => {
    headerLongPressActive = true
    suppressHeaderClickOnce = true
    const touch = event?.touches?.[0] || event?.changedTouches?.[0]
    headerTooltipPos.x = touch?.clientX ?? 0
    headerTooltipPos.y = touch?.clientY ?? 0
    headerTooltip.value = text
  }, 500)
}

const onHeaderTouchEnd = () => {
  if (headerPressTimer) {
    clearTimeout(headerPressTimer)
    headerPressTimer = null
  }
  if (!headerLongPressActive) return
  if (headerTooltipTimer) clearTimeout(headerTooltipTimer)
  headerTooltipTimer = setTimeout(() => {
    headerTooltip.value = null
    headerTooltipTimer = null
  }, 1500)
}

const openZoom = (payload) => {
  zoomChart.value = payload
}

const closeZoom = () => {
  zoomChart.value = null
}

const buildChartSegments = (series, timestamps, start, end, dims) => {
  if (!series?.length || !timestamps?.length) return []
  const values = series.filter((value) => value != null && !Number.isNaN(value))
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const span = end - start || 1
  const segments = []
  let current = []
  series.forEach((value, index) => {
    if (value == null || Number.isNaN(Number(value))) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      return
    }
    const ts = timestamps[index]
    const normalized = Number(value)
    const x = dims.left + ((ts - start) / span) * dims.width
    const y = dims.top + (1 - (normalized - min) / range) * dims.height
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))
  return segments
}

const buildAxisTicks = (min, max) => {
  if (min == null || max == null) return []
  const mid = (min + max) / 2
  return [max, mid, min]
}

const zoomDims = {
  width: 640,
  height: 260,
  left: 56,
  right: 20,
  top: 20,
  bottom: 32,
}

const zoomPlot = computed(() => ({
  left: zoomDims.left,
  top: zoomDims.top,
  width: zoomDims.width - zoomDims.left - zoomDims.right,
  height: zoomDims.height - zoomDims.top - zoomDims.bottom,
  bottom: zoomDims.height - zoomDims.bottom,
  right: zoomDims.width - zoomDims.right,
}))

const zoomStart = computed(() => rangeStart.value)
const zoomEnd = computed(() => rangeEnd.value)
const zoomTicks = computed(() => {
  if (!zoomChart.value) return []
  const series = zoomChart.value.series ?? []
  const values = series.filter((value) => value != null && !Number.isNaN(value))
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  return buildAxisTicks(min, max)
})

const handleZoomKey = (event) => {
  if (event.key === 'Escape') closeZoom()
}

const handleZoomHover = (event) => {
  if (!zoomChart.value?.series?.length) {
    zoomHover.value = null
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const clientX = readClientX(event)
  const rawX = clientX == null ? 0 : (clientX - rect.left)
  const x = Math.max(0, Math.min(rawX, rect.width))
  const ratio = rect.width ? x / rect.width : 0
  const target = zoomStart.value + (zoomEnd.value - zoomStart.value) * ratio
  const index = findClosestIndex(zoomChart.value.timestamps || [], target)
  zoomHover.value = {
    x,
    xRatio: ratio,
    index,
    value: zoomChart.value.series[index],
    valueB: zoomChart.value.seriesB ? zoomChart.value.seriesB[index] : null,
    timestamp: zoomChart.value.timestamps?.[index],
  }
}

const clearZoomHover = () => {
  zoomHover.value = null
}

watch(zoomChart, (value) => {
  if (!process.client) return
  if (value) window.addEventListener('keydown', handleZoomKey)
  else window.removeEventListener('keydown', handleZoomKey)
})
const buildPolylineSegments = (series, timestamps = null, start = null, end = null, width = 100, height = 32) => {
  if (!series?.length) return []
  const values = series.map((value) => (value == null ? null : Number(value))).filter((value) => value != null)
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const hasTimestamps = Array.isArray(timestamps) && timestamps.length === series.length
  const startTs = hasTimestamps ? (start ?? timestamps[0]) : null
  const endTs = hasTimestamps ? (end ?? (timestamps[timestamps.length - 1] || startTs)) : null
  const span = hasTimestamps ? (endTs - startTs || 1) : null
  const step = width / Math.max(series.length - 1, 1)
  const segments = []
  let current = []
  series.forEach((value, index) => {
    if (value == null || Number.isNaN(Number(value))) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      return
    }
    const normalized = Number(value)
    const xRaw = hasTimestamps ? ((timestamps[index] - startTs) / span) * width : index * step
    const x = Math.min(width, Math.max(0, xRaw))
    const y = height - ((normalized - min) / range) * height
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))
  return segments
}

const buildHistorySeries = (items) => {
  if (!Array.isArray(items)) return { cpu: [], mem: [], disk: [] }
  const netSent = items.map((item) => item.system?.net_io?.sent_bytes ?? null)
  const netRecv = items.map((item) => item.system?.net_io?.recv_bytes ?? null)
  const diskRead = items.map((item) => item.system?.disk_io?.read_bytes ?? null)
  const diskWrite = items.map((item) => item.system?.disk_io?.write_bytes ?? null)
  return {
    cpu: items.map((item) => item.system?.cpu_percent ?? null),
    mem: items.map((item) => item.system?.mem?.percent ?? null),
    disk: items.map((item) => item.system?.disk?.percent ?? null),
    diskReadRate: buildRateSeries(diskRead, items),
    diskWriteRate: buildRateSeries(diskWrite, items),
    netSentRate: buildRateSeries(netSent, items),
    netRecvRate: buildRateSeries(netRecv, items),
  }
}

const buildRateSeries = (values, items) => {
  let prevValue = null
  let prevTs = null
  return items.map((item, index) => {
    const ts = item.timestamp
    const value = values[index]
    if (prevValue == null || value == null || ts == null || prevTs == null) {
      prevValue = value
      prevTs = ts
      return null
    }
    const delta = value - prevValue
    const dt = ts - prevTs
    prevValue = value
    prevTs = ts
    if (dt <= 0 || delta < 0) return null
    return delta / dt
  })
}

const buildRateSeriesFromTimestamps = (values, timestamps) => {
  let prevValue = null
  let prevTs = null
  return values.map((value, index) => {
    const ts = timestamps[index]
    if (prevValue == null || value == null || ts == null || prevTs == null) {
      prevValue = value
      prevTs = ts
      return null
    }
    const delta = value - prevValue
    const dt = ts - prevTs
    prevValue = value
    prevTs = ts
    if (dt <= 0 || delta < 0) return null
    return delta / dt
  })
}

const insertGapMarkers = (series, timestamps) => {
  if (!Array.isArray(timestamps) || !timestamps.length || !series || typeof series !== 'object') {
    return { series, timestamps }
  }
  const deltas = []
  for (let i = 1; i < timestamps.length; i += 1) {
    const prev = timestamps[i - 1]
    const next = timestamps[i]
    if (prev != null && next != null && next > prev) deltas.push(next - prev)
  }
  if (!deltas.length) return { series, timestamps }
  deltas.sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)] || 0
  const baseBucket = Number(historyBucketSeconds.value) || 0
  const threshold = Math.max(baseBucket * 2, median * 2)
  if (!threshold) return { series, timestamps }
  const keys = Object.keys(series)
  if (!keys.length) return { series, timestamps }
  const outSeries = {}
  keys.forEach((key) => {
    outSeries[key] = []
  })
  const outTimestamps = []
  let prevTs = null
  timestamps.forEach((ts, index) => {
    if (prevTs != null && ts != null && (ts - prevTs) > threshold) {
      const gapTs = prevTs + 0.0001
      outTimestamps.push(gapTs)
      keys.forEach((key) => outSeries[key].push(null))
    }
    outTimestamps.push(ts)
    keys.forEach((key) => {
      const values = Array.isArray(series[key]) ? series[key] : []
      outSeries[key].push(values[index] ?? null)
    })
    prevTs = ts
  })
  return { series: outSeries, timestamps: outTimestamps }
}

const filterSeriesPayload = (series, timestamps, start, end) => {
  if (!Array.isArray(timestamps) || !timestamps.length) {
    return { series, timestamps: [] }
  }
  if (start == null || end == null) {
    return { series, timestamps }
  }
  const indexes = []
  timestamps.forEach((ts, index) => {
    if (ts == null) return
    if (ts >= start && ts <= end) indexes.push(index)
  })
  if (indexes.length === timestamps.length) {
    return { series, timestamps }
  }
  const pick = (values) => (Array.isArray(values) ? indexes.map((i) => values[i]) : [])
  return {
    series: {
      cpu: pick(series?.cpu),
      mem: pick(series?.mem),
      disk: pick(series?.disk),
      diskReadRate: pick(series?.diskReadRate),
      diskWriteRate: pick(series?.diskWriteRate),
      netSentRate: pick(series?.netSentRate),
      netRecvRate: pick(series?.netRecvRate),
    },
    timestamps: indexes.map((i) => timestamps[i]),
  }
}

const seriesStats = (series) => {
  if (!Array.isArray(series)) return null
  const values = series.filter((value) => value != null && !Number.isNaN(value))
  if (!values.length) return null
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

const displayPorts = (proc) => {
  const detected = Array.isArray(proc?.ports) ? proc.ports : []
  const configured = Array.isArray(proc?.ports_config) ? proc.ports_config : []
  if (!detected.length && !configured.length) return '-'
  if (detected.length && configured.length) {
    return `${detected.join(', ')} (cfg ${configured.join(', ')})`
  }
  return detected.length ? detected.join(', ') : `cfg ${configured.join(', ')}`
}

const sortRows = (rows, key, direction) => {
  const dir = direction === 'desc' ? -1 : 1
  return rows.slice().sort((a, b) => {
    const aVal = getSortValue(a, key)
    const bVal = getSortValue(b, key)
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1
    if (typeof aVal === 'string' || typeof bVal === 'string') {
      return aVal.toString().localeCompare(bVal.toString()) * dir
    }
    return (aVal - bVal) * dir
  })
}

const getSortValue = (row, key) => {
  const toNumber = (value) => {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (key === 'name') return row?.name ?? ''
  if (key === 'pid') return toNumber(row?.pid)
  if (key === 'cpu_percent') return toNumber(normalizeProcessCpu(row?.cpu_percent))
  if (key === 'rss') return toNumber(row?.rss)
  if (key === 'threads') return toNumber(row?.threads)
  if (key === 'container_id') return row?.container_id ?? ''
  if (key === 'ports') {
    const detected = Array.isArray(row?.ports) ? row.ports : []
    const configured = Array.isArray(row?.ports_config) ? row.ports_config : []
    const combined = [...detected, ...configured]
    return combined.length ? toNumber(combined[0]) : null
  }
  return row?.[key] ?? null
}

const toggleManagedSort = (key) => {
  if (managedSortKey.value === key) {
    managedSortDir.value = managedSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    managedSortKey.value = key
    managedSortDir.value = key === 'name' ? 'asc' : 'desc'
  }
}

const toggleExternalSort = (key) => {
  if (externalSortKey.value === key) {
    externalSortDir.value = externalSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    externalSortKey.value = key
    externalSortDir.value = key === 'name' ? 'asc' : 'desc'
  }
}

const setManagedSort = (key, dir = 'desc') => {
  managedSortKey.value = key
  managedSortDir.value = dir
}

const setExternalSort = (key, dir = 'desc') => {
  externalSortKey.value = key
  externalSortDir.value = dir
}

const sortIndicator = (key, sortKey, sortDir) => {
  if (sortKey !== key) return ''
  return sortDir === 'asc' ? '↑' : '↓'
}

const padSeriesToRange = (series, timestamps, start, end, fillValue = null) => {
  if (!Array.isArray(series) || !Array.isArray(timestamps) || series.length !== timestamps.length) {
    return { series, timestamps }
  }
  if (start == null || end == null || start >= end) {
    return { series, timestamps }
  }
  const paddedSeries = series.slice()
  const paddedTimestamps = timestamps.slice()
  if (paddedTimestamps.length && paddedTimestamps[0] > start) {
    paddedSeries.unshift(fillValue)
    paddedTimestamps.unshift(start)
  }
  if (paddedTimestamps.length && paddedTimestamps[paddedTimestamps.length - 1] < end) {
    paddedSeries.push(fillValue)
    paddedTimestamps.push(end)
  }
  return { series: paddedSeries, timestamps: paddedTimestamps }
}

const padSeriesPairToRange = (seriesA, seriesB, timestamps, start, end, fillValue = null) => {
  const padded = padSeriesToRange(seriesA, timestamps, start, end, fillValue)
  const paddedB = padSeriesToRange(seriesB, timestamps, start, end, fillValue)
  return {
    seriesA: padded.series,
    seriesB: paddedB.series,
    timestamps: padded.timestamps,
  }
}

onMounted(() => {
  if (!metrics.value && metricsStore.latestSnapshot) {
    metrics.value = metricsStore.latestSnapshot
  } else if (!metrics.value) {
    loadSnapshot()
  }
  connect()
  loadHistory()
  loadMetricsConfig()
})

onActivated(() => {
  connect()
})

onBeforeUnmount(() => {
  isUnmounted = true
  disconnect()
})

onDeactivated(() => {
  disconnect()
})

watch(
  () => metricsStore.latestSnapshot,
  (snapshot) => {
    if (snapshot) {
      metrics.value = snapshot
      lastUpdated.value = snapshot?.timestamp ? snapshot.timestamp * 1000 : Date.now()
      if (historyEnabled.value) {
        history.value = [...history.value, snapshot].slice(-historyLimit.value)
        if (historySeriesOverride.value && historyTimestampsOverride.value) {
          const limit = historyLimit.value || 0
          const prev = history.value.length > 1 ? history.value[history.value.length - 2] : null
          const ts = snapshot?.timestamp ?? null
          historyTimestampsOverride.value = [...historyTimestampsOverride.value, ts]
          if (limit > 0) {
            historyTimestampsOverride.value = historyTimestampsOverride.value.slice(-limit)
          }
          const series = historySeriesOverride.value
          series.cpu = [...(series.cpu || []), snapshot?.system?.cpu_percent ?? null]
          series.mem = [...(series.mem || []), snapshot?.system?.mem?.percent ?? null]
          series.disk = [...(series.disk || []), snapshot?.system?.disk?.percent ?? null]
          if (limit > 0) {
            series.cpu = series.cpu.slice(-limit)
            series.mem = series.mem.slice(-limit)
            series.disk = series.disk.slice(-limit)
          }
          const prevTs = prev?.timestamp ?? null
          const diskReadPrev = prev?.system?.disk_io?.read_bytes ?? null
          const diskWritePrev = prev?.system?.disk_io?.write_bytes ?? null
          const netSentPrev = prev?.system?.net_io?.sent_bytes ?? null
          const netRecvPrev = prev?.system?.net_io?.recv_bytes ?? null
          const diskRead = snapshot?.system?.disk_io?.read_bytes ?? null
          const diskWrite = snapshot?.system?.disk_io?.write_bytes ?? null
          const netSent = snapshot?.system?.net_io?.sent_bytes ?? null
          const netRecv = snapshot?.system?.net_io?.recv_bytes ?? null
          const rateFor = (value, prevValue) => {
            if (value == null || prevValue == null || ts == null || prevTs == null) return null
            const delta = value - prevValue
            const dt = ts - prevTs
            if (dt <= 0 || delta < 0) return null
            return delta / dt
          }
          series.diskReadRate = [...(series.diskReadRate || []), rateFor(diskRead, diskReadPrev)]
          series.diskWriteRate = [...(series.diskWriteRate || []), rateFor(diskWrite, diskWritePrev)]
          series.netSentRate = [...(series.netSentRate || []), rateFor(netSent, netSentPrev)]
          series.netRecvRate = [...(series.netRecvRate || []), rateFor(netRecv, netRecvPrev)]
          if (limit > 0) {
            series.diskReadRate = series.diskReadRate.slice(-limit)
            series.diskWriteRate = series.diskWriteRate.slice(-limit)
            series.netSentRate = series.netSentRate.slice(-limit)
            series.netRecvRate = series.netRecvRate.slice(-limit)
          }
          historySeriesOverride.value = { ...series }
        }
      }
    }
  }
)

watch(
  () => metricsStore.status,
  (status) => {
    connectionStatus.value = status
  }
)

watch(
  () => metricsStore.error,
  (error) => {
    errorMessage.value = error
  }
)

watch(historyPreset, (value) => {
  if (value === 'custom') return
  const parsed = Number(value)
  if (!Number.isNaN(parsed)) historyHours.value = parsed
})

watch(historyHours, (value) => {
  const presetMatch = historyPresets.find((preset) => preset === value)
  historyPreset.value = presetMatch ? `${presetMatch}` : 'custom'
})
</script>

<template>
  <div class="relative h-full text-white bg-gray-900 flex flex-col gap-6 px-4 py-4 md:px-8 pb-12">
    <InfoBar />

    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-4xl font-bold">Metrics</h1>
        <span class="px-2.5 py-1 rounded-full border text-xs uppercase tracking-wide" :class="statusClass">
          {{ connectionStatus }}
        </span>
        <span
          v-if="system?.scope"
          class="px-2 py-1 rounded-full border border-slate-700 text-[10px] uppercase tracking-wide text-slate-300"
          title="Metrics scope (set in dumb.metrics.system_scope). host=host totals, cgroup=container limits, auto=use cgroup if available."
          @touchstart.prevent="onHeaderTouchStart($event, 'Metrics scope (set in dumb.metrics.system_scope). host=host totals, cgroup=container limits, auto=use cgroup if available.')"
          @touchend="onHeaderTouchEnd"
          @touchcancel="onHeaderTouchEnd"
        >
          {{ system.scope }}
        </span>
        <span class="text-xs text-slate-300" v-if="lastUpdated">
          Updated {{ formatTimestamp(lastUpdated) }}
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 w-full lg:w-auto lg:justify-end">
        <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
          <label class="flex items-center gap-1" title="Toggle history usage (historical range for charts)">
            <input type="checkbox" v-model="historyEnabled" class="accent-emerald-400" />
            History
          </label>
          <span v-if="historySource" class="text-[11px] text-slate-400">
            {{ historySource === 'cache' ? 'cached' : 'live' }}
          </span>
          <label class="flex items-center gap-1" title="CPU display mode for process percentages">
            <span>CPU</span>
            <select v-model="cpuMode" class="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px]">
              <option value="total">Total</option>
              <option value="per-core">Per-core</option>
            </select>
          </label>
          <label class="flex items-center gap-1" title="Toggle alert banners">
            <input type="checkbox" v-model="alertsEnabled" class="accent-emerald-400" />
            Alerts
          </label>
          <div class="flex items-center gap-1" title="Alert thresholds for CPU, memory, and disk (%)">
            <span>Warn</span>
            <input
              type="number"
              min="1"
              max="100"
              v-model.number="cpuWarnThreshold"
              class="w-11 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px]"
              title="CPU warning threshold (%)"
              aria-label="CPU warning threshold"
              placeholder="CPU"
            />
            <input
              type="number"
              min="1"
              max="100"
              v-model.number="memWarnThreshold"
              class="w-11 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px]"
              title="Memory warning threshold (%)"
              aria-label="Memory warning threshold"
              placeholder="Mem"
            />
            <input
              type="number"
              min="1"
              max="100"
              v-model.number="diskWarnThreshold"
              class="w-11 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px]"
              title="Disk warning threshold (%)"
              aria-label="Disk warning threshold"
              placeholder="Disk"
            />
          </div>
          <label class="flex items-center gap-1" title="Quick presets for history range">
            <span>Preset</span>
            <select
              v-model="historyPreset"
              :disabled="!historyEnabled"
              class="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] disabled:opacity-60"
            >
              <option v-for="preset in historyPresets" :key="preset" :value="`${preset}`">
                {{ preset }}h
              </option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label class="flex items-center gap-1" title="History range in hours">
            <span>Hours</span>
            <input
              type="number"
              min="0.5"
              step="0.5"
              v-model.lazy.number="historyHours"
              :disabled="!historyEnabled"
              class="w-16 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px] disabled:opacity-60"
            />
          </label>
          <label class="flex items-center gap-1" title="History resolution (bucket size in seconds)">
            <span>Resolution</span>
            <select
              v-model.number="historyBucketSeconds"
              :disabled="!historyEnabled"
              class="w-20 rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] disabled:opacity-60"
            >
              <option :value="1">1s</option>
              <option :value="2">2s</option>
              <option :value="5">5s</option>
              <option :value="10">10s</option>
              <option :value="30">30s</option>
              <option :value="60">60s</option>
            </select>
            <span class="text-[10px] text-slate-400" title="Effective bucket after backend clamping to keep total points under the limit.">
              Effective {{ effectiveBucketSeconds }}s
            </span>
          </label>
        </div>
        <span v-if="errorMessage" class="text-xs text-rose-300 basis-full lg:basis-auto">{{ errorMessage }}</span>
        <button
          class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-medium"
          title="Apply history range and limit"
          @click="applyHistorySettings"
        >
          Apply
        </button>
        <button
          class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-medium"
          title="Export history as JSON"
          @click="exportHistory('json')"
        >
          Export JSON
        </button>
        <button
          class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-medium"
          title="Export history as CSV"
          @click="exportHistory('csv')"
        >
          Export CSV
        </button>
        <button
          class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-medium"
          title="Reconnect metrics websocket"
          @click="manualReconnect"
        >
          Reconnect
        </button>
        <button
          class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-medium"
          title="Configure backend metrics retention and history settings"
          @click="metricsSettingsOpen = true"
        >
          Settings
        </button>
      </div>
    </div>

    <div v-if="metricsSettingsOpen" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/80">
      <div class="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Metrics Settings</h2>
          <button
            class="text-slate-400 hover:text-slate-200"
            title="Close"
            @click="metricsSettingsOpen = false"
          >
            ✕
          </button>
        </div>
        <div class="mt-4 grid gap-3 text-sm">
          <label class="flex items-center gap-2">
            <input type="checkbox" v-model="metricsConfigDraft.history_enabled" />
            <span>Enable history logging</span>
          </label>
          <label class="flex items-center justify-between gap-2">
            <span>History interval (seconds)</span>
            <input
              type="number"
              min="0.5"
              step="0.5"
              class="w-24 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs"
              v-model.number="metricsConfigDraft.history_interval_sec"
            />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span>Retention days</span>
            <input
              type="number"
              min="0"
              step="1"
              class="w-24 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs"
              v-model.number="metricsConfigDraft.history_retention_days"
            />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span>Max file size (MB)</span>
            <input
              type="number"
              min="1"
              step="1"
              class="w-24 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs"
              v-model.number="metricsConfigDraft.history_max_file_mb"
            />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span>Max total size (MB)</span>
            <input
              type="number"
              min="10"
              step="10"
              class="w-24 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs"
              v-model.number="metricsConfigDraft.history_max_total_mb"
            />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span>History directory</span>
            <input
              type="text"
              class="flex-1 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs"
              v-model="metricsConfigDraft.history_dir"
            />
          </label>
        </div>
        <div class="mt-4 flex items-center justify-between">
          <div class="text-xs text-slate-400">
            <span v-if="metricsConfigLoading">Saving...</span>
            <span v-else-if="metricsConfigSaved" class="text-emerald-300">Saved</span>
            <span v-else-if="metricsConfigError" class="text-rose-300">{{ metricsConfigError }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs"
              @click="resetMetricsConfigDraft"
            >
              Reset
            </button>
            <button
              class="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs text-white"
              @click="applyMetricsConfig"
            >
              Apply
            </button>
          </div>
        </div>
        <p class="mt-3 text-[11px] text-slate-400">
          Changes apply immediately to history retention and logging; existing files may still exceed limits until new snapshots are written.
        </p>
      </div>
    </div>

    <div v-if="alerts.length" class="rounded border border-amber-600/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <span class="font-semibold">Alerts:</span>
      <span>{{ alerts.join(' · ') }}</span>
    </div>

    <div v-if="!metrics" class="text-slate-300 text-sm">
      Waiting for metrics stream...
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div class="bg-slate-800/60 border border-slate-700 rounded-lg p-4 flex flex-col gap-3 h-full">
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <p
              class="text-lg font-semibold"
              title="CPU usage from the selected scope. In cgroup mode, values reflect container CPU limits."
              @touchstart.prevent="onHeaderTouchStart($event, 'CPU usage from the selected scope. In cgroup mode, values reflect container CPU limits.')"
              @touchend="onHeaderTouchEnd"
              @touchcancel="onHeaderTouchEnd"
            >
              CPU
            </p>
            <span class="text-xs text-slate-400" v-if="historyTruncated">History truncated</span>
          </div>
          <div class="text-3xl font-bold">{{ formatPercent(system?.cpu_percent) }}</div>
          <div class="text-xs text-slate-300">Cores: {{ system?.cpu_count ?? '-' }}</div>
          <div class="text-xs text-slate-300">
            Load Avg: {{ system?.load_avg ? system.load_avg.map((n) => n.toFixed(2)).join(' / ') : '-' }}
          </div>
        </div>
        <div class="mt-auto flex flex-col gap-3">
          <div
            class="relative cursor-pointer"
            @mousemove="handleHover('cpu', $event, cpuChart.series, cpuChart.timestamps, rangeStart, rangeEnd)"
            @touchstart.prevent="handleHover('cpu', $event, cpuChart.series, cpuChart.timestamps, rangeStart, rangeEnd)"
            @touchend="clearHover('cpu')"
            @mouseleave="clearHover('cpu')"
            @click="openZoom({ title: 'CPU %', series: cpuChart.series, timestamps: cpuChart.timestamps, color: 'text-emerald-400', format: formatPercent })"
          >
            <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="w-full h-12">
              <polyline
                v-for="(segment, index) in buildPolylineSegments(cpuChart.series, cpuChart.timestamps, rangeStart, rangeEnd)"
                :key="`cpu-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-emerald-400 chart-line"
              />
              <line
                v-if="hoverState.cpu"
                :x1="(hoverState.cpu.xRatio || 0) * 100"
                :x2="(hoverState.cpu.xRatio || 0) * 100"
                y1="0"
                y2="32"
                stroke="currentColor"
                stroke-width="1"
                class="text-emerald-200/60"
              />
            </svg>
            <div
              v-if="hoverState.cpu"
              class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
              :style="{ left: `${hoverState.cpu.x}px` }"
            >
              <div>{{ formatPercent(hoverState.cpu.value) }}</div>
              <div class="text-slate-400">{{ formatTooltipTime(hoverState.cpu.timestamp) }}</div>
              <div class="text-slate-400">{{ formatBucketRange(cpuChart.timestamps, hoverState.cpu.index) }}</div>
            </div>
          </div>
          <div class="flex justify-between text-xs text-slate-400">
            <span>Min {{ cpuStats ? formatPercent(cpuStats.min) : '-' }}</span>
            <span>Max {{ cpuStats ? formatPercent(cpuStats.max) : '-' }}</span>
          </div>
          <div class="text-[11px] text-slate-500">{{ rangeLabel }}</div>
        </div>
      </div>

      <div class="bg-slate-800/60 border border-slate-700 rounded-lg p-4 flex flex-col gap-3 h-full">
        <div class="flex flex-col gap-3">
          <p
            class="text-lg font-semibold"
            title="Memory usage from the selected scope. If the container has no memory limit, totals may reflect the host."
            @touchstart.prevent="onHeaderTouchStart($event, 'Memory usage from the selected scope. If the container has no memory limit, totals may reflect the host.')"
            @touchend="onHeaderTouchEnd"
            @touchcancel="onHeaderTouchEnd"
          >
            Memory
          </p>
          <div class="text-3xl font-bold">{{ formatPercent(system?.mem?.percent) }}</div>
          <div class="text-xs text-slate-300">
            {{ formatBytes(system?.mem?.used) }} / {{ formatBytes(system?.mem?.total) }}
          </div>
          <div class="text-xs text-slate-300">
            Swap: {{ formatPercent(system?.swap?.percent) }} ({{ formatBytes(system?.swap?.used) }})
          </div>
        </div>
        <div class="mt-auto flex flex-col gap-3">
          <div
            class="relative cursor-pointer"
            @mousemove="handleHover('mem', $event, memChart.series, memChart.timestamps, rangeStart, rangeEnd)"
            @touchstart.prevent="handleHover('mem', $event, memChart.series, memChart.timestamps, rangeStart, rangeEnd)"
            @touchend="clearHover('mem')"
            @mouseleave="clearHover('mem')"
            @click="openZoom({ title: 'Memory %', series: memChart.series, timestamps: memChart.timestamps, color: 'text-sky-400', format: formatPercent })"
          >
            <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="w-full h-12">
              <polyline
                v-for="(segment, index) in buildPolylineSegments(memChart.series, memChart.timestamps, rangeStart, rangeEnd)"
                :key="`mem-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-sky-400 chart-line"
              />
              <line
                v-if="hoverState.mem"
                :x1="(hoverState.mem.xRatio || 0) * 100"
                :x2="(hoverState.mem.xRatio || 0) * 100"
                y1="0"
                y2="32"
                stroke="currentColor"
                stroke-width="1"
                class="text-sky-200/60"
              />
            </svg>
            <div
              v-if="hoverState.mem"
              class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
              :style="{ left: `${hoverState.mem.x}px` }"
            >
              <div>{{ formatPercent(hoverState.mem.value) }}</div>
              <div class="text-slate-400">{{ formatTooltipTime(hoverState.mem.timestamp) }}</div>
              <div class="text-slate-400">{{ formatBucketRange(memChart.timestamps, hoverState.mem.index) }}</div>
            </div>
          </div>
          <div class="flex justify-between text-xs text-slate-400">
            <span>Min {{ memStats ? formatPercent(memStats.min) : '-' }}</span>
            <span>Max {{ memStats ? formatPercent(memStats.max) : '-' }}</span>
          </div>
          <div class="text-[11px] text-slate-500">{{ rangeLabel }}</div>
        </div>
      </div>

      <div class="bg-slate-800/60 border border-slate-700 rounded-lg p-4 flex flex-col gap-3 h-full">
        <div class="flex flex-col gap-3">
          <p
            class="text-lg font-semibold"
            title="Disk usage is based on the container filesystem path '/' (host-like if host mounts are used)."
            @touchstart.prevent="onHeaderTouchStart($event, 'Disk usage is based on the container filesystem path / (host-like if host mounts are used).')"
            @touchend="onHeaderTouchEnd"
            @touchcancel="onHeaderTouchEnd"
          >
            Disk
          </p>
          <div class="text-3xl font-bold">{{ formatPercent(system?.disk?.percent) }}</div>
          <div class="text-xs text-slate-300">
            {{ formatBytes(system?.disk?.used) }} / {{ formatBytes(system?.disk?.total) }}
          </div>
          <div class="text-xs text-slate-300">
            IO: {{ formatRate(diskIoRates.read[diskIoRates.read.length - 1]) }} read / {{ formatRate(diskIoRates.write[diskIoRates.write.length - 1]) }} write
          </div>
        </div>
        <div class="mt-auto flex flex-col gap-3">
          <div
            class="relative cursor-pointer"
            @mousemove="handleHoverDual('diskIo', $event, diskIoChart.seriesA, diskIoChart.seriesB, diskIoChart.timestamps, rangeStart, rangeEnd)"
            @touchstart.prevent="handleHoverDual('diskIo', $event, diskIoChart.seriesA, diskIoChart.seriesB, diskIoChart.timestamps, rangeStart, rangeEnd)"
            @touchend="clearHover('diskIo')"
            @mouseleave="clearHover('diskIo')"
            @click="openZoom({ title: 'Disk IO (Rate)', series: diskIoChart.seriesA, seriesB: diskIoChart.seriesB, timestamps: diskIoChart.timestamps, color: 'text-emerald-400', colorB: 'text-amber-400', format: formatRate, dual: true, labelA: 'Read', labelB: 'Write' })"
          >
            <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="w-full h-12">
              <polyline
                v-for="(segment, index) in buildPolylineSegments(diskIoChart.seriesA, diskIoChart.timestamps, rangeStart, rangeEnd)"
                :key="`disk-io-read-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-emerald-400 chart-line"
              />
              <polyline
                v-for="(segment, index) in buildPolylineSegments(diskIoChart.seriesB, diskIoChart.timestamps, rangeStart, rangeEnd)"
                :key="`disk-io-write-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-amber-400 chart-line"
              />
              <line
                v-if="hoverState.diskIo"
                :x1="(hoverState.diskIo.xRatio || 0) * 100"
                :x2="(hoverState.diskIo.xRatio || 0) * 100"
                y1="0"
                y2="32"
                stroke="currentColor"
                stroke-width="1"
                class="text-slate-200/60"
              />
            </svg>
            <div
              v-if="hoverState.diskIo"
              class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
              :style="{ left: `${hoverState.diskIo.x}px` }"
            >
              <div>Read {{ formatRate(hoverState.diskIo.valueA) }}</div>
              <div>Write {{ formatRate(hoverState.diskIo.valueB) }}</div>
              <div class="text-slate-400">{{ formatTooltipTime(hoverState.diskIo.timestamp) }}</div>
            </div>
          </div>
          <div class="flex justify-between text-xs text-slate-400">
            <span>Min {{ diskIoStats ? formatRate(diskIoStats.min) : '-' }}</span>
            <span>Max {{ diskIoStats ? formatRate(diskIoStats.max) : '-' }}</span>
          </div>
          <div class="text-[11px] text-slate-500">{{ rangeLabel }}</div>
        </div>
      </div>

      <div class="bg-slate-800/60 border border-slate-700 rounded-lg p-4 flex flex-col gap-3 h-full">
        <div class="flex flex-col gap-3">
          <p
            class="text-lg font-semibold"
            title="Network IO reflects the container network namespace. If the container shares the host namespace, totals may look host-wide."
            @touchstart.prevent="onHeaderTouchStart($event, 'Network IO reflects the container network namespace. If the container shares the host namespace, totals may look host-wide.')"
            @touchend="onHeaderTouchEnd"
            @touchcancel="onHeaderTouchEnd"
          >
            Network
          </p>
        <div class="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <span>Sent {{ formatBytes(netIntervalTotals.sent) }}</span>
          <span>Recv {{ formatBytes(netIntervalTotals.recv) }}</span>
        </div>
        <div class="text-xs text-slate-300">
          Now {{ formatRate(netLatestRates.sent) }} sent · {{ formatRate(netLatestRates.recv) }} recv
        </div>
      </div>
        <div class="mt-auto flex flex-col gap-3">
          <div
            class="relative cursor-pointer"
            @mousemove="handleHoverDual('net', $event, netChart.seriesA, netChart.seriesB, netChart.timestamps, rangeStart, rangeEnd)"
            @touchstart.prevent="handleHoverDual('net', $event, netChart.seriesA, netChart.seriesB, netChart.timestamps, rangeStart, rangeEnd)"
            @touchend="clearHover('net')"
            @mouseleave="clearHover('net')"
            @click="openZoom({ title: 'Network IO (Rate)', series: netChart.seriesA, seriesB: netChart.seriesB, timestamps: netChart.timestamps, color: 'text-emerald-400', colorB: 'text-sky-400', format: formatRate, dual: true, labelA: 'Sent', labelB: 'Recv' })"
          >
            <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="w-full h-12">
              <polyline
                v-for="(segment, index) in buildPolylineSegments(netChart.seriesA, netChart.timestamps, rangeStart, rangeEnd)"
                :key="`net-sent-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-emerald-400 chart-line"
              />
              <polyline
                v-for="(segment, index) in buildPolylineSegments(netChart.seriesB, netChart.timestamps, rangeStart, rangeEnd)"
                :key="`net-recv-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-sky-400 chart-line"
              />
              <line
                v-if="hoverState.net"
                :x1="(hoverState.net.xRatio || 0) * 100"
                :x2="(hoverState.net.xRatio || 0) * 100"
                y1="0"
                y2="32"
                stroke="currentColor"
                stroke-width="1"
                class="text-slate-200/60"
              />
            </svg>
            <div
              v-if="hoverState.net"
              class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
              :style="{ left: `${hoverState.net.x}px` }"
            >
              <div>Sent {{ formatRate(hoverState.net.valueA) }}</div>
              <div>Recv {{ formatRate(hoverState.net.valueB) }}</div>
              <div class="text-slate-400">{{ formatTooltipTime(hoverState.net.timestamp) }}</div>
            </div>
          </div>
          <div class="flex justify-between text-xs text-slate-400">
            <span>Min {{ netRateStats ? formatRate(netRateStats.min) : '-' }}</span>
            <span>Max {{ netRateStats ? formatRate(netRateStats.max) : '-' }}</span>
          </div>
          <div class="text-[11px] text-slate-500">{{ rangeLabel }}</div>
        </div>
      </div>
    </div>

    <div v-if="metrics" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-slate-800/40 border border-slate-700 rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <p class="text-lg font-semibold">Managed Processes</p>
          <span class="text-xs text-slate-400">{{ managedProcesses.length }} total</span>
        </div>
        <p class="text-[11px] text-slate-500 mb-2 lg:hidden">Tip: long‑press column headers for help.</p>
        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-300 mb-3">
          <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" @click="setManagedSort('cpu_percent', 'desc')">
            Top CPU
          </button>
          <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" @click="setManagedSort('rss', 'desc')">
            Top RSS
          </button>
          <label class="flex items-center gap-1">
            <span>Top</span>
            <select v-model.number="managedTopCount" class="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs">
              <option :value="0">All</option>
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="20">20</option>
            </select>
          </label>
        </div>
        <div class="max-h-[360px] overflow-auto" ref="managedTableRef" @scroll="handleTableScroll('managed', $event)">
          <table class="min-w-full text-xs">
            <thead class="text-slate-400 text-left">
              <tr>
                <th class="py-2 pr-2">
                  <span title="Pin to keep at top.">★</span>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Process name. Click to sort."
                    @click="handleHeaderClick(() => toggleManagedSort('name'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Process name. Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    Name <span>{{ sortIndicator('name', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Process ID. Click to sort."
                    @click="handleHeaderClick(() => toggleManagedSort('pid'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Process ID. Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    PID <span>{{ sortIndicator('pid', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    :title="cpuMode === 'total' ? 'CPU usage (% of total CPU). Click to sort.' : 'CPU usage (% per core). Click to sort.'"
                    @click="handleHeaderClick(() => toggleManagedSort('cpu_percent'))"
                    @touchstart.prevent="onHeaderTouchStart($event, cpuMode === 'total' ? 'CPU usage (% of total CPU). Click to sort.' : 'CPU usage (% per core). Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    CPU <span>{{ sortIndicator('cpu_percent', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Resident Set Size (memory in RAM). Click to sort."
                    @click="handleHeaderClick(() => toggleManagedSort('rss'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Resident Set Size (memory in RAM). Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    RSS <span>{{ sortIndicator('rss', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Thread count. Click to sort."
                    @click="handleHeaderClick(() => toggleManagedSort('threads'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Thread count. Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    Threads <span>{{ sortIndicator('threads', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Detected/configured ports. Click to sort."
                    @click="handleHeaderClick(() => toggleManagedSort('ports'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Detected/configured ports. Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    Ports <span>{{ sortIndicator('ports', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="managedVirtual.topPad" :style="{ height: `${managedVirtual.topPad}px` }">
                <td :colspan="7"></td>
              </tr>
              <tr
                v-for="(proc, rowIndex) in managedVirtual.items"
                :key="proc.pid || proc.name"
                class="border-t border-slate-700/50 cursor-pointer hover:bg-slate-800/60"
                :class="selectedProcess === proc.name && selectedProcessKind === 'managed' ? 'bg-slate-800/80' : ''"
                @click="selectProcess(proc.name, 'managed')"
              >
                <td class="py-2 pr-2">
                  <button
                    type="button"
                    class="text-slate-400 hover:text-amber-300"
                    :title="isPinned(managedPinned, proc.name) ? 'Unpin' : 'Pin'"
                    @click.stop="togglePinned(managedPinned, proc.name)"
                  >
                    {{ isPinned(managedPinned, proc.name) ? '★' : '☆' }}
                  </button>
                </td>
                <td class="py-2 pr-2 font-medium">{{ proc.name }}</td>
                <td class="py-2 pr-2">{{ proc.pid ?? '-' }}</td>
                <td class="py-2 pr-2">
                  <div>{{ formatPercent(normalizeProcessCpu(proc.cpu_percent)) }}</div>
                  <svg v-if="isVisibleSparkline(rowIndex + managedVirtual.startIndex, 'managed')" viewBox="0 0 100 20" preserveAspectRatio="none" class="w-20 h-4 mt-1">
                    <polyline
                      v-for="(segment, index) in buildPolylineSegments(managedHistoryMap[proc.name]?.cpu, historyTimestamps, rangeStart, rangeEnd, 100, 20)"
                      :key="`m-cpu-${proc.name}-${index}`"
                      :points="segment"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      class="text-emerald-400 chart-line"
                    />
                  </svg>
                </td>
                <td class="py-2 pr-2">
                  <div>{{ formatBytes(proc.rss) }}</div>
                  <svg v-if="isVisibleSparkline(rowIndex + managedVirtual.startIndex, 'managed')" viewBox="0 0 100 20" preserveAspectRatio="none" class="w-20 h-4 mt-1">
                    <polyline
                      v-for="(segment, index) in buildPolylineSegments(managedHistoryMap[proc.name]?.rss, historyTimestamps, rangeStart, rangeEnd, 100, 20)"
                      :key="`m-rss-${proc.name}-${index}`"
                      :points="segment"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      class="text-sky-400 chart-line"
                    />
                  </svg>
                </td>
                <td class="py-2 pr-2">{{ proc.threads ?? '-' }}</td>
                <td class="py-2">{{ displayPorts(proc) }}</td>
              </tr>
              <tr v-if="managedVirtual.bottomPad" :style="{ height: `${managedVirtual.bottomPad}px` }">
                <td :colspan="7"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-slate-800/40 border border-slate-700 rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <p class="text-lg font-semibold">External Processes</p>
          <span class="text-xs text-slate-400">{{ externalProcesses.length }} shown</span>
        </div>
        <p class="text-[11px] text-slate-500 mb-2 lg:hidden">Tip: long‑press column headers for help.</p>
        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-300 mb-3">
          <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" @click="setExternalSort('cpu_percent', 'desc')">
            Top CPU
          </button>
          <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" @click="setExternalSort('rss', 'desc')">
            Top RSS
          </button>
          <label class="flex items-center gap-1">
            <span>Top</span>
            <select v-model.number="externalTopCount" class="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs">
              <option :value="0">All</option>
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="20">20</option>
            </select>
          </label>
        </div>
        <div class="max-h-[360px] overflow-auto" ref="externalTableRef" @scroll="handleTableScroll('external', $event)">
          <table class="min-w-full text-xs">
            <thead class="text-slate-400 text-left">
              <tr>
                <th class="py-2 pr-2">
                  <span title="Pin to keep at top.">★</span>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Process name. Click to sort."
                    @click="handleHeaderClick(() => toggleExternalSort('name'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Process name. Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    Name <span>{{ sortIndicator('name', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Process ID. Click to sort."
                    @click="handleHeaderClick(() => toggleExternalSort('pid'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Process ID. Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    PID <span>{{ sortIndicator('pid', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    :title="cpuMode === 'total' ? 'CPU usage (% of total CPU). Click to sort.' : 'CPU usage (% per core). Click to sort.'"
                    @click="handleHeaderClick(() => toggleExternalSort('cpu_percent'))"
                    @touchstart.prevent="onHeaderTouchStart($event, cpuMode === 'total' ? 'CPU usage (% of total CPU). Click to sort.' : 'CPU usage (% per core). Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    CPU <span>{{ sortIndicator('cpu_percent', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Resident Set Size (memory in RAM). Click to sort."
                    @click="handleHeaderClick(() => toggleExternalSort('rss'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Resident Set Size (memory in RAM). Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    RSS <span>{{ sortIndicator('rss', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    title="Container ID (if detected). Click to sort."
                    @click="handleHeaderClick(() => toggleExternalSort('container_id'))"
                    @touchstart.prevent="onHeaderTouchStart($event, 'Container ID (if detected). Click to sort.')"
                    @touchend="onHeaderTouchEnd"
                    @touchcancel="onHeaderTouchEnd"
                  >
                    Container <span>{{ sortIndicator('container_id', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="externalVirtual.topPad" :style="{ height: `${externalVirtual.topPad}px` }">
                <td :colspan="6"></td>
              </tr>
              <tr
                v-for="(proc, rowIndex) in externalVirtual.items"
                :key="proc.pid || proc.name"
                class="border-t border-slate-700/50 cursor-pointer hover:bg-slate-800/60"
                :class="selectedProcess === proc.name && selectedProcessKind === 'external' ? 'bg-slate-800/80' : ''"
                @click="selectProcess(proc.name, 'external')"
              >
                <td class="py-2 pr-2">
                  <button
                    type="button"
                    class="text-slate-400 hover:text-amber-300"
                    :title="isPinned(externalPinned, proc.name) ? 'Unpin' : 'Pin'"
                    @click.stop="togglePinned(externalPinned, proc.name)"
                  >
                    {{ isPinned(externalPinned, proc.name) ? '★' : '☆' }}
                  </button>
                </td>
                <td class="py-2 pr-2 font-medium">{{ proc.name }}</td>
                <td class="py-2 pr-2">{{ proc.pid ?? '-' }}</td>
                <td class="py-2 pr-2">
                  <div>{{ formatPercent(normalizeProcessCpu(proc.cpu_percent)) }}</div>
                  <svg v-if="isVisibleSparkline(rowIndex + externalVirtual.startIndex, 'external')" viewBox="0 0 100 20" preserveAspectRatio="none" class="w-20 h-4 mt-1">
                    <polyline
                      v-for="(segment, index) in buildPolylineSegments(externalHistoryMap[proc.name]?.cpu, historyTimestamps, rangeStart, rangeEnd, 100, 20)"
                      :key="`e-cpu-${proc.name}-${index}`"
                      :points="segment"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      class="text-emerald-400 chart-line"
                    />
                  </svg>
                </td>
                <td class="py-2 pr-2">
                  <div>{{ formatBytes(proc.rss) }}</div>
                  <svg v-if="isVisibleSparkline(rowIndex + externalVirtual.startIndex, 'external')" viewBox="0 0 100 20" preserveAspectRatio="none" class="w-20 h-4 mt-1">
                    <polyline
                      v-for="(segment, index) in buildPolylineSegments(externalHistoryMap[proc.name]?.rss, historyTimestamps, rangeStart, rangeEnd, 100, 20)"
                      :key="`e-rss-${proc.name}-${index}`"
                      :points="segment"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      class="text-sky-400 chart-line"
                    />
                  </svg>
                </td>
                <td class="py-2">{{ proc.container_id || '-' }}</td>
              </tr>
              <tr v-if="externalVirtual.bottomPad" :style="{ height: `${externalVirtual.bottomPad}px` }">
                <td :colspan="6"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="metrics && selectedProcess" class="bg-slate-800/40 border border-slate-700 rounded-lg p-4">
      <div class="flex items-center justify-between mb-4">
        <p class="text-lg font-semibold">Process History: {{ selectedProcess }}</p>
        <button
          class="text-xs text-slate-300 hover:text-white"
          @click="selectedProcess = null"
        >
          Clear
        </button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-slate-900/60 rounded-lg p-3">
          <p class="text-xs text-slate-400 mb-2">CPU %</p>
          <div class="text-lg font-semibold mb-2">
            {{ formatPercent(selectedProcessHistory[selectedProcessHistory.length - 1]?.cpu) }}
          </div>
            <div
              class="relative cursor-pointer"
              @mousemove="handleHover('procCpu', $event, selectedCpuChart.series, selectedCpuChart.timestamps, rangeStart, rangeEnd)"
              @touchstart.prevent="handleHover('procCpu', $event, selectedCpuChart.series, selectedCpuChart.timestamps, rangeStart, rangeEnd)"
              @touchend="clearHover('procCpu')"
              @mouseleave="clearHover('procCpu')"
              @click="openZoom({ title: `${selectedProcess} CPU %`, series: selectedCpuChart.series, timestamps: selectedCpuChart.timestamps, color: 'text-emerald-400', format: formatPercent })"
            >
            <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="w-full h-14">
              <polyline
                v-for="(segment, index) in buildPolylineSegments(selectedCpuChart.series, selectedCpuChart.timestamps, rangeStart, rangeEnd)"
                :key="`proc-cpu-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-emerald-400 chart-line"
              />
              <line
                v-if="hoverState.procCpu"
                :x1="(hoverState.procCpu.xRatio || 0) * 100"
                :x2="(hoverState.procCpu.xRatio || 0) * 100"
                y1="0"
                y2="32"
                stroke="currentColor"
                stroke-width="1"
                class="text-emerald-200/60"
              />
            </svg>
            <div
              v-if="hoverState.procCpu"
              class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
              :style="{ left: `${hoverState.procCpu.x}px` }"
            >
              <div>{{ formatPercent(hoverState.procCpu.value) }}</div>
              <div class="text-slate-400">{{ formatTooltipTime(hoverState.procCpu.timestamp) }}</div>
              <div class="text-slate-400">{{ formatBucketRange(selectedCpuChart.timestamps, hoverState.procCpu.index) }}</div>
            </div>
          </div>
          <div class="flex justify-between text-xs text-slate-400 mt-1">
            <span>Min {{ selectedCpuStats ? formatPercent(selectedCpuStats.min) : '-' }}</span>
            <span>Max {{ selectedCpuStats ? formatPercent(selectedCpuStats.max) : '-' }}</span>
          </div>
          <div class="text-[11px] text-slate-500">{{ rangeLabel }}</div>
        </div>
        <div class="bg-slate-900/60 rounded-lg p-3">
          <p class="text-xs text-slate-400 mb-2">RSS</p>
          <div class="text-lg font-semibold mb-2">
            {{ formatBytes(selectedProcessHistory[selectedProcessHistory.length - 1]?.rss) }}
          </div>
            <div
              class="relative cursor-pointer"
              @mousemove="handleHover('procRss', $event, selectedRssChart.series, selectedRssChart.timestamps, rangeStart, rangeEnd)"
              @touchstart.prevent="handleHover('procRss', $event, selectedRssChart.series, selectedRssChart.timestamps, rangeStart, rangeEnd)"
              @touchend="clearHover('procRss')"
              @mouseleave="clearHover('procRss')"
              @click="openZoom({ title: `${selectedProcess} RSS`, series: selectedRssChart.series, timestamps: selectedRssChart.timestamps, color: 'text-sky-400', format: formatBytes })"
            >
            <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="w-full h-14">
              <polyline
                v-for="(segment, index) in buildPolylineSegments(selectedRssChart.series, selectedRssChart.timestamps, rangeStart, rangeEnd)"
                :key="`proc-rss-${index}`"
                :points="segment"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-sky-400 chart-line"
              />
              <line
                v-if="hoverState.procRss"
                :x1="(hoverState.procRss.xRatio || 0) * 100"
                :x2="(hoverState.procRss.xRatio || 0) * 100"
                y1="0"
                y2="32"
                stroke="currentColor"
                stroke-width="1"
                class="text-sky-200/60"
              />
            </svg>
            <div
              v-if="hoverState.procRss"
              class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
              :style="{ left: `${hoverState.procRss.x}px` }"
            >
              <div>{{ formatBytes(hoverState.procRss.value) }}</div>
              <div class="text-slate-400">{{ formatTooltipTime(hoverState.procRss.timestamp) }}</div>
              <div class="text-slate-400">{{ formatBucketRange(selectedRssChart.timestamps, hoverState.procRss.index) }}</div>
            </div>
          </div>
          <div class="flex justify-between text-xs text-slate-400 mt-1">
            <span>Min {{ selectedRssStats ? formatBytes(selectedRssStats.min) : '-' }}</span>
            <span>Max {{ selectedRssStats ? formatBytes(selectedRssStats.max) : '-' }}</span>
          </div>
          <div class="text-[11px] text-slate-500">{{ rangeLabel }}</div>
        </div>
      </div>

      <div class="mt-4 bg-slate-900/60 rounded-lg p-3">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs text-slate-400">Disk IO</p>
          <div class="text-[11px] text-slate-500">{{ rangeLabel }}</div>
        </div>
            <div
              class="relative cursor-pointer"
              @mousemove="handleHoverDual('procIo', $event, selectedIoChart.seriesA, selectedIoChart.seriesB, selectedIoChart.timestamps, rangeStart, rangeEnd)"
              @touchstart.prevent="handleHoverDual('procIo', $event, selectedIoChart.seriesA, selectedIoChart.seriesB, selectedIoChart.timestamps, rangeStart, rangeEnd)"
              @touchend="clearHover('procIo')"
              @mouseleave="clearHover('procIo')"
              @click="openZoom({ title: `${selectedProcess} Disk IO (Rate)`, series: selectedIoChart.seriesA, seriesB: selectedIoChart.seriesB, timestamps: selectedIoChart.timestamps, color: 'text-emerald-400', colorB: 'text-amber-400', format: formatRate, dual: true, labelA: 'Read', labelB: 'Write' })"
            >
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="w-full h-14">
            <polyline
              v-for="(segment, index) in buildPolylineSegments(selectedIoChart.seriesA, selectedIoChart.timestamps, rangeStart, rangeEnd)"
              :key="`proc-io-read-${index}`"
              :points="segment"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="text-emerald-400 chart-line"
            />
            <polyline
              v-for="(segment, index) in buildPolylineSegments(selectedIoChart.seriesB, selectedIoChart.timestamps, rangeStart, rangeEnd)"
              :key="`proc-io-write-${index}`"
              :points="segment"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="text-amber-400 chart-line"
            />
            <line
              v-if="hoverState.procIo"
              :x1="(hoverState.procIo.xRatio || 0) * 100"
              :x2="(hoverState.procIo.xRatio || 0) * 100"
              y1="0"
              y2="32"
              stroke="currentColor"
              stroke-width="1"
              class="text-slate-200/60"
            />
          </svg>
          <div
            v-if="hoverState.procIo"
            class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
            :style="{ left: `${hoverState.procIo.x}px` }"
          >
            <div>Read {{ formatRate(hoverState.procIo.valueA) }}</div>
            <div>Write {{ formatRate(hoverState.procIo.valueB) }}</div>
            <div class="text-slate-400">{{ formatTooltipTime(hoverState.procIo.timestamp) }}</div>
            <div class="text-slate-400">{{ formatBucketRange(selectedIoChart.timestamps, hoverState.procIo.index) }}</div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-xs text-slate-400 mt-2">
          <span>Read min {{ selectedIoReadStats ? formatRate(selectedIoReadStats.min) : '-' }}</span>
          <span>Read max {{ selectedIoReadStats ? formatRate(selectedIoReadStats.max) : '-' }}</span>
          <span>Write min {{ selectedIoWriteStats ? formatRate(selectedIoWriteStats.min) : '-' }}</span>
          <span>Write max {{ selectedIoWriteStats ? formatRate(selectedIoWriteStats.max) : '-' }}</span>
        </div>
      </div>
    </div>

    <div v-if="metrics" class="bg-slate-800/40 border border-slate-700 rounded-lg p-4">
      <p class="text-lg font-semibold mb-3">System</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-300">
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-400">Boot Time</p>
          <p class="text-base font-semibold">
            {{ system?.boot_time ? new Date(system.boot_time * 1000).toLocaleString() : '-' }}
          </p>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-400">Container Start</p>
          <p class="text-base font-semibold">
            {{ system?.container_start_time ? new Date(system.container_start_time * 1000).toLocaleString() : '-' }}
          </p>
        </div>
      </div>
    </div>
  </div>

  <div
    v-if="zoomChart"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70"
    @click.self="closeZoom"
  >
    <div class="w-full max-w-5xl mx-4 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <p class="text-lg font-semibold text-white">{{ zoomChart.title }}</p>
          <p class="text-xs text-slate-400">{{ rangeLabel }}</p>
        </div>
        <button class="text-xs text-slate-300 hover:text-white" @click="closeZoom">Close</button>
      </div>

      <div class="relative" @mousemove="handleZoomHover" @touchstart.prevent="handleZoomHover" @touchend="clearZoomHover" @mouseleave="clearZoomHover">
        <svg :viewBox="`0 0 ${zoomDims.width} ${zoomDims.height}`" preserveAspectRatio="none" class="w-full h-80">
          <line
            :x1="zoomPlot.left"
            :x2="zoomPlot.left"
            :y1="zoomPlot.top"
            :y2="zoomPlot.bottom"
            stroke="currentColor"
            class="text-slate-600"
          />
          <line
            :x1="zoomPlot.left"
            :x2="zoomPlot.right"
            :y1="zoomPlot.bottom"
            :y2="zoomPlot.bottom"
            stroke="currentColor"
            class="text-slate-600"
          />

          <line
            v-if="zoomTicks[1] != null"
            :x1="zoomPlot.left"
            :x2="zoomPlot.right"
            :y1="zoomPlot.top + zoomPlot.height / 2"
            :y2="zoomPlot.top + zoomPlot.height / 2"
            stroke="currentColor"
            class="text-slate-800"
          />

          <polyline
            v-for="(segment, index) in buildChartSegments(zoomChart.series, zoomChart.timestamps, zoomStart, zoomEnd, zoomPlot)"
            :key="`zoom-a-${index}`"
            :points="segment"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            :class="`${zoomChart.color} chart-line`"
          />
          <polyline
            v-for="(segment, index) in buildChartSegments(zoomChart.seriesB, zoomChart.timestamps, zoomStart, zoomEnd, zoomPlot)"
            :key="`zoom-b-${index}`"
            :points="segment"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            :class="`${zoomChart.colorB} chart-line`"
          />

          <line
            v-if="zoomHover"
            :x1="(zoomHover.xRatio || 0) * zoomDims.width"
            :x2="(zoomHover.xRatio || 0) * zoomDims.width"
            :y1="zoomPlot.top"
            :y2="zoomPlot.bottom"
            stroke="currentColor"
            class="text-slate-400/70"
          />

          <text
            v-for="(tick, index) in zoomTicks"
            :key="`y-${index}`"
            :x="zoomPlot.left - 8"
            :y="zoomPlot.top + (zoomPlot.height / (zoomTicks.length - 1)) * index"
            text-anchor="end"
            dominant-baseline="middle"
            class="fill-slate-300 text-[10px]"
          >
            {{ zoomChart.format ? zoomChart.format(tick) : tick }}
          </text>

          <text
            :x="zoomPlot.left"
            :y="zoomPlot.bottom + 20"
            text-anchor="start"
            class="fill-slate-400 text-[10px]"
          >
            {{ formatDateShort(zoomStart) }}
          </text>
          <text
            :x="zoomPlot.left + zoomPlot.width / 2"
            :y="zoomPlot.bottom + 20"
            text-anchor="middle"
            class="fill-slate-400 text-[10px]"
          >
            {{ formatDateShort((zoomStart + zoomEnd) / 2) }}
          </text>
          <text
            :x="zoomPlot.right"
            :y="zoomPlot.bottom + 20"
            text-anchor="end"
            class="fill-slate-400 text-[10px]"
          >
            {{ formatDateShort(zoomEnd) }}
          </text>
        </svg>

        <div
          v-if="zoomHover"
          class="absolute top-0 -translate-y-full -translate-x-1/2 text-xs bg-slate-900/90 border border-slate-700 rounded px-2 py-1 pointer-events-none whitespace-nowrap"
          :style="{ left: `${zoomHover.x}px` }"
        >
          <div v-if="zoomChart.seriesB">
            {{ zoomChart.labelA || 'A' }} {{ zoomChart.format ? zoomChart.format(zoomHover.value) : zoomHover.value }}
          </div>
          <div v-if="zoomChart.seriesB">
            {{ zoomChart.labelB || 'B' }} {{ zoomChart.format ? zoomChart.format(zoomHover.valueB) : zoomHover.valueB }}
          </div>
          <div v-if="!zoomChart.seriesB">
            {{ zoomChart.format ? zoomChart.format(zoomHover.value) : zoomHover.value }}
          </div>
          <div class="text-slate-400">{{ formatTooltipTime(zoomHover.timestamp) }}</div>
        </div>
      </div>
    </div>
    <div
      v-if="headerTooltip"
      class="fixed z-50 max-w-[220px] text-[11px] bg-slate-900/95 border border-slate-700 rounded px-2 py-1 text-slate-100 shadow-lg pointer-events-none -translate-x-1/2 -translate-y-full"
      :style="{ left: `${headerTooltipPos.x}px`, top: `${headerTooltipPos.y}px` }"
    >
      {{ headerTooltip }}
    </div>
  </div>
</template>

<style scoped>
.chart-line {
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
</style>
