<script setup>
const metrics = ref(null)
const history = ref([])
const historyTruncated = ref(false)
const connectionStatus = ref('disconnected')
const errorMessage = ref(null)
const lastUpdated = ref(null)
const reconnectAttempts = ref(0)
const intervalSeconds = 2
const historyEnabled = ref(true)
const historyHours = ref(6)
const historyLimit = ref(5000)
const selectedProcess = ref(null)
const historyPresets = [1, 6, 12, 24, 72]
const historyPreset = ref('6')
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

let socket = null
let reconnectTimer = null
let historyReloadTimer = null
let connectTimer = null
let isUnmounted = false
let pendingHistoryRefresh = false

const system = computed(() => metrics.value?.system || null)
const managedProcesses = computed(() => metrics.value?.dumb_managed || [])
const externalProcesses = computed(() => metrics.value?.external || [])
const sortedManagedProcesses = computed(() => sortRows(managedProcesses.value, managedSortKey.value, managedSortDir.value))
const sortedExternalProcesses = computed(() => sortRows(externalProcesses.value, externalSortKey.value, externalSortDir.value))
const rangeEnd = computed(() => (metrics.value?.timestamp ?? Date.now() / 1000))
const rangeStart = computed(() => rangeEnd.value - historyHours.value * 60 * 60)
const filteredHistory = computed(() => {
  if (!history.value.length) return []
  const start = rangeStart.value
  const end = rangeEnd.value
  return history.value
    .filter((item) => (item.timestamp || 0) >= start && (item.timestamp || 0) <= end)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
})
const historySeries = computed(() => buildHistorySeries(filteredHistory.value))
const historyTimestamps = computed(() => filteredHistory.value.map((item) => item.timestamp))
const cpuChart = computed(() => padSeriesToRange(historySeries.value.cpu, historyTimestamps.value, rangeStart.value, rangeEnd.value, null))
const memChart = computed(() => padSeriesToRange(historySeries.value.mem, historyTimestamps.value, rangeStart.value, rangeEnd.value, null))
const diskIoRates = computed(() => {
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
const selectedProcessHistory = computed(() => {
  if (!selectedProcess.value) return []
  return filteredHistory.value.map((item) => {
    const entry = (item.dumb_managed || []).find((proc) => proc.name === selectedProcess.value)
    return {
      timestamp: item.timestamp,
      cpu: entry?.cpu_percent ?? null,
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
const selectedIoReadStats = computed(() => seriesStats(selectedProcessHistory.value.map((item) => item.ioRead)))
const selectedIoWriteStats = computed(() => seriesStats(selectedProcessHistory.value.map((item) => item.ioWrite)))

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

const formatRate = (value) => {
  if (value == null || Number.isNaN(value)) return '-'
  return `${formatBytes(value)}/s`
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

const buildWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams()
  params.set('interval', `${intervalSeconds}`)
  params.set('history', historyEnabled.value ? 'true' : 'false')
  if (historyEnabled.value) {
    const since = Date.now() / 1000 - historyHours.value * 60 * 60
    params.set('history_since', `${since}`)
    params.set('history_limit', `${historyLimit.value}`)
  }
  return `${protocol}://${window.location.host}/ws/metrics?${params.toString()}`
}

const scheduleReconnect = () => {
  reconnectAttempts.value += 1
  const delay = Math.min(1000 * reconnectAttempts.value, 10000)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!isUnmounted) connect()
  }, delay)
}

const connect = () => {
  if (socket && socket.readyState === WebSocket.OPEN) return
  if (socket) socket.close()
  connectionStatus.value = 'connecting'
  errorMessage.value = null

  socket = new WebSocket(buildWebSocketUrl())

  if (connectTimer) clearTimeout(connectTimer)
  connectTimer = setTimeout(() => {
    if (socket && socket.readyState !== WebSocket.OPEN) {
      socket.close()
    }
  }, 8000)

  socket.addEventListener('open', () => {
    connectionStatus.value = 'connected'
    reconnectAttempts.value = 0
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
    if (pendingHistoryRefresh) {
      pendingHistoryRefresh = false
      manualReconnect()
    }
  })

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (payload?.type === 'history') {
        history.value = Array.isArray(payload.items) ? payload.items : []
        historyTruncated.value = Boolean(payload.truncated)
        if (history.value.length) {
          metrics.value = history.value[history.value.length - 1]
          lastUpdated.value = metrics.value?.timestamp ? metrics.value.timestamp * 1000 : Date.now()
        }
        return
      }
      if (payload?.type === 'snapshot') {
        const data = payload.data
        metrics.value = data
        lastUpdated.value = data?.timestamp ? data.timestamp * 1000 : Date.now()
        if (data) {
          history.value = [...history.value, data].slice(-historyLimit.value)
        }
      }
      if (!payload?.type && payload?.timestamp) {
        metrics.value = payload
        lastUpdated.value = payload?.timestamp ? payload.timestamp * 1000 : Date.now()
        history.value = [...history.value, payload].slice(-historyLimit.value)
      }
    } catch (error) {
      errorMessage.value = 'Unable to parse metrics payload.'
    }
  })

  socket.addEventListener('error', () => {
    errorMessage.value = 'WebSocket error. Reconnecting...'
    if (socket) socket.close()
  })

  socket.addEventListener('close', () => {
    connectionStatus.value = 'disconnected'
    if (isUnmounted) return
    scheduleReconnect()
  })
}

const disconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (connectTimer) {
    clearTimeout(connectTimer)
    connectTimer = null
  }
  if (socket) {
    socket.close()
    socket = null
  }
}

const manualReconnect = () => {
  disconnect()
  pendingHistoryRefresh = false
  reconnectAttempts.value = 0
  connect()
}

const applyHistorySettings = () => {
  if (connectionStatus.value === 'connecting') {
    pendingHistoryRefresh = true
    return
  }
  manualReconnect()
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

const handleHover = (key, event, series, timestamps, start, end) => {
  if (!series?.length) {
    hoverState[key] = null
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const rawX = event.clientX - rect.left
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
  const rawX = event.clientX - rect.left
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
  const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
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
  return {
    cpu: items.map((item) => item.system?.cpu_percent ?? null),
    mem: items.map((item) => item.system?.mem?.percent ?? null),
    disk: items.map((item) => item.system?.disk?.percent ?? null),
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
  if (key === 'cpu_percent') return toNumber(row?.cpu_percent)
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
  connect()
})

onActivated(() => {
  if (socket?.readyState !== WebSocket.OPEN) {
    connect()
  }
})

onBeforeUnmount(() => {
  isUnmounted = true
  disconnect()
})

onDeactivated(() => {
  disconnect()
})

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
  <div class="relative h-full text-white overflow-auto bg-gray-900 flex flex-col gap-6 px-4 py-4 md:px-8 pb-12">
    <InfoBar />

    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-4xl font-bold">Metrics</h1>
        <span class="px-2.5 py-1 rounded-full border text-xs uppercase tracking-wide" :class="statusClass">
          {{ connectionStatus }}
        </span>
        <span class="text-xs text-slate-300" v-if="lastUpdated">
          Updated {{ formatTimestamp(lastUpdated) }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 text-xs text-slate-300">
          <label class="flex items-center gap-1">
            <input type="checkbox" v-model="historyEnabled" class="accent-emerald-400" />
            History
          </label>
          <label class="flex items-center gap-1">
            <span>Preset</span>
            <select
              v-model="historyPreset"
              :disabled="!historyEnabled"
              class="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs disabled:opacity-60"
            >
              <option v-for="preset in historyPresets" :key="preset" :value="`${preset}`">
                {{ preset }}h
              </option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label class="flex items-center gap-1">
            <span>Hours</span>
            <input
              type="number"
              min="0.5"
              step="0.5"
              v-model.lazy.number="historyHours"
              :disabled="!historyEnabled"
              class="w-20 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs disabled:opacity-60"
            />
          </label>
          <label class="flex items-center gap-1">
            <span>Limit</span>
            <input
              type="number"
              min="100"
              step="100"
              v-model.lazy.number="historyLimit"
              :disabled="!historyEnabled"
              class="w-24 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-xs disabled:opacity-60"
            />
          </label>
        </div>
        <span v-if="errorMessage" class="text-xs text-rose-300">{{ errorMessage }}</span>
        <button
          class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium"
          @click="applyHistorySettings"
        >
          Apply
        </button>
        <button
          class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium"
          @click="manualReconnect"
        >
          Reconnect
        </button>
      </div>
    </div>

    <div v-if="!metrics" class="text-slate-300 text-sm">
      Waiting for metrics stream...
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div class="bg-slate-800/60 border border-slate-700 rounded-lg p-4 flex flex-col gap-3 h-full">
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <p class="text-lg font-semibold">CPU</p>
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
          <p class="text-lg font-semibold">Memory</p>
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
          <p class="text-lg font-semibold">Disk</p>
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
          <p class="text-lg font-semibold">Network</p>
          <div class="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <span>Sent {{ formatBytes(system?.net_io?.sent_bytes) }}</span>
            <span>Recv {{ formatBytes(system?.net_io?.recv_bytes) }}</span>
          </div>
        </div>
        <div class="mt-auto flex flex-col gap-3">
          <div
            class="relative cursor-pointer"
            @mousemove="handleHoverDual('net', $event, netChart.seriesA, netChart.seriesB, netChart.timestamps, rangeStart, rangeEnd)"
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
        <div class="max-h-[360px] overflow-auto">
          <table class="min-w-full text-xs">
            <thead class="text-slate-400 text-left">
              <tr>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleManagedSort('name')"
                  >
                    Name <span>{{ sortIndicator('name', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleManagedSort('pid')"
                  >
                    PID <span>{{ sortIndicator('pid', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleManagedSort('cpu_percent')"
                  >
                    CPU <span>{{ sortIndicator('cpu_percent', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleManagedSort('rss')"
                  >
                    RSS <span>{{ sortIndicator('rss', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleManagedSort('threads')"
                  >
                    Threads <span>{{ sortIndicator('threads', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleManagedSort('ports')"
                  >
                    Ports <span>{{ sortIndicator('ports', managedSortKey, managedSortDir) }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="proc in sortedManagedProcesses"
                :key="proc.pid || proc.name"
                class="border-t border-slate-700/50 cursor-pointer hover:bg-slate-800/60"
                :class="selectedProcess === proc.name ? 'bg-slate-800/80' : ''"
                @click="updateSelectedProcess(proc.name)"
              >
                <td class="py-2 pr-2 font-medium">{{ proc.name }}</td>
                <td class="py-2 pr-2">{{ proc.pid ?? '-' }}</td>
                <td class="py-2 pr-2">{{ formatPercent(proc.cpu_percent) }}</td>
                <td class="py-2 pr-2">{{ formatBytes(proc.rss) }}</td>
                <td class="py-2 pr-2">{{ proc.threads ?? '-' }}</td>
                <td class="py-2">{{ displayPorts(proc) }}</td>
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
        <div class="max-h-[360px] overflow-auto">
          <table class="min-w-full text-xs">
            <thead class="text-slate-400 text-left">
              <tr>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleExternalSort('name')"
                  >
                    Name <span>{{ sortIndicator('name', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleExternalSort('pid')"
                  >
                    PID <span>{{ sortIndicator('pid', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleExternalSort('cpu_percent')"
                  >
                    CPU <span>{{ sortIndicator('cpu_percent', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2 pr-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleExternalSort('rss')"
                  >
                    RSS <span>{{ sortIndicator('rss', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
                <th class="py-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 cursor-pointer select-none"
                    @click="toggleExternalSort('container_id')"
                  >
                    Container <span>{{ sortIndicator('container_id', externalSortKey, externalSortDir) }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="proc in sortedExternalProcesses" :key="proc.pid || proc.name" class="border-t border-slate-700/50">
                <td class="py-2 pr-2 font-medium">{{ proc.name }}</td>
                <td class="py-2 pr-2">{{ proc.pid ?? '-' }}</td>
                <td class="py-2 pr-2">{{ formatPercent(proc.cpu_percent) }}</td>
                <td class="py-2 pr-2">{{ formatBytes(proc.rss) }}</td>
                <td class="py-2">{{ proc.container_id || '-' }}</td>
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
          @mouseleave="clearHover('procIo')"
          @click="openZoom({ title: `${selectedProcess} Disk IO (Rate)`, series: selectedIoChart.seriesA, seriesB: selectedIoChart.seriesB, timestamps: selectedIoChart.timestamps, color: 'text-emerald-400', colorB: 'text-amber-400', format: formatRate, dual: true })"
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

      <div class="relative" @mousemove="handleZoomHover" @mouseleave="clearZoomHover">
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
  </div>
</template>

<style scoped>
.chart-line {
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
</style>
