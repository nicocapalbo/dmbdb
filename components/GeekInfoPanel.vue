<script setup>
import { computed } from 'vue'
import { useGeekMetrics } from '~/composables/useGeekMetrics.js'
import { formatBytes, formatPercent, formatUptime, resourceColorClass } from '~/helper/formatMetrics.js'

const props = defineProps({
  processName: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
  restartInfo: { type: Object, default: null },
})

const {
  metricsLoading,
  metricsError,
  metricsFetchMs,
  currentProcessMetrics,
  systemMetrics,
  refresh,
} = useGeekMetrics(() => props.processName, () => props.enabled)

const proc = computed(() => currentProcessMetrics.value)
const sys = computed(() => systemMetrics.value)

const cpuPercent = computed(() => proc.value?.cpu_percent ?? null)
const memRss = computed(() => proc.value?.rss ?? null)
const memPercent = computed(() => {
  if (memRss.value == null || !sys.value?.mem?.total) return null
  return (memRss.value / sys.value.mem.total) * 100
})
const threads = computed(() => proc.value?.threads ?? null)
const pid = computed(() => proc.value?.pid ?? null)
const uptime = computed(() => {
  const st = proc.value?.start_time
  if (!st || !Number.isFinite(st)) return null
  return Math.max(0, Math.floor(Date.now() / 1000 - st))
})

const diskIo = computed(() => proc.value?.disk_io ?? null)
const ports = computed(() => proc.value?.ports ?? [])
const netConnections = computed(() => proc.value?.net_connections ?? [])
const diskPaths = computed(() => proc.value?.disk_paths?.paths ?? [])

const containerSummary = computed(() => {
  if (!sys.value) return null
  const cpuCount = sys.value.cpu_count ?? null
  const mem = sys.value.mem
  if (!cpuCount && !mem) return null
  const parts = []
  if (cpuCount) parts.push(`${cpuCount} cores`)
  if (mem?.total) {
    const total = formatBytes(mem.total)
    const used = formatBytes(mem.used)
    const pct = formatPercent(mem.percent)
    parts.push(`${total} RAM (${used} used / ${pct})`)
  }
  return parts.join(' · ')
})

const restartStats = computed(() => {
  const info = props.restartInfo
  if (!info || typeof info !== 'object') return null
  return info.stats || info.restart_stats || info.counters || null
})

const pickStat = (stats, keys) => {
  if (!stats || typeof stats !== 'object') return null
  for (const key of keys) {
    if (stats[key] != null) return stats[key]
  }
  return null
}

const formatRestartTime = (value) => {
  if (value == null) return null
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : null
  if (Number.isFinite(numeric)) {
    const ts = numeric < 1e12 ? numeric * 1000 : numeric
    return new Date(ts).toLocaleString()
  }
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : null
}

const lastExitReason = computed(() =>
  pickStat(restartStats.value, ['last_exit_reason', 'last_failure_reason', 'last_reason', 'last_trigger'])
)

const lastRestartTime = computed(() => {
  const value = pickStat(restartStats.value, ['last_restart', 'last_restart_at', 'last_restart_ts', 'last_restart_time'])
  return formatRestartTime(value)
})

const restartTotal = computed(() => {
  const value = pickStat(restartStats.value, ['total_restarts', 'total', 'count', 'restarts', 'restart_attempts', 'restart_successes'])
  const num = Number(value)
  return Number.isFinite(num) ? num : null
})

const connectionCount = computed(() => netConnections.value.length)
</script>

<template>
  <div v-if="enabled" class="space-y-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="material-symbols-rounded !text-[16px] text-slate-400">monitoring</span>
        <span class="text-xs font-semibold text-slate-200 uppercase tracking-wide">Process Metrics</span>
        <span
          v-if="metricsFetchMs != null"
          class="text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-slate-600/60 bg-slate-700/40 text-slate-300"
        >
          {{ metricsFetchMs }}ms
        </span>
      </div>
      <button
        class="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
        :disabled="metricsLoading"
        @click="refresh"
      >
        <span class="material-symbols-rounded !text-[14px]" :class="{ 'animate-spin': metricsLoading }">refresh</span>
        Refresh
      </button>
    </div>

    <div v-if="metricsError" class="text-[11px] text-amber-300">{{ metricsError }}</div>

    <div v-else-if="metricsLoading && !proc" class="text-[11px] text-slate-400">Loading metrics...</div>

    <div v-else-if="proc" class="grid grid-cols-1 gap-1.5">
      <!-- Process -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span class="text-slate-400 uppercase tracking-wide w-16 flex-none">Process</span>
        <span v-if="pid != null" class="font-mono text-slate-200">PID {{ pid }}</span>
        <span v-if="threads != null" class="font-mono text-slate-200">{{ threads }} threads</span>
        <span v-if="uptime != null" class="font-mono text-slate-200">{{ formatUptime(uptime) }}</span>
      </div>

      <!-- Resources -->
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span class="text-slate-400 uppercase tracking-wide w-16 flex-none">Resources</span>
        <span
          v-if="cpuPercent != null"
          class="font-mono px-1.5 py-0.5 rounded-full border"
          :class="resourceColorClass(cpuPercent)"
        >
          CPU {{ formatPercent(cpuPercent) }}
        </span>
        <span
          v-if="memRss != null"
          class="font-mono px-1.5 py-0.5 rounded-full border"
          :class="resourceColorClass(memPercent)"
        >
          RSS {{ formatBytes(memRss) }}
        </span>
        <template v-if="diskIo">
          <span class="font-mono text-slate-300">
            <span class="text-slate-500">R</span> {{ formatBytes(diskIo.read_bytes) }}
          </span>
          <span class="font-mono text-slate-300">
            <span class="text-slate-500">W</span> {{ formatBytes(diskIo.write_bytes) }}
          </span>
        </template>
      </div>

      <!-- Network -->
      <div v-if="ports.length || connectionCount" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span class="text-slate-400 uppercase tracking-wide w-16 flex-none">Network</span>
        <template v-if="ports.length">
          <span
            v-for="port in ports"
            :key="port"
            class="font-mono px-1.5 py-0.5 rounded border border-sky-600/40 bg-sky-900/30 text-sky-200"
          >
            :{{ port }}
          </span>
        </template>
        <span v-if="connectionCount" class="font-mono text-slate-300">
          {{ connectionCount }} conn{{ connectionCount !== 1 ? 's' : '' }}
        </span>
      </div>

      <!-- Disk Paths -->
      <div v-if="diskPaths.length" class="text-[11px]">
        <div class="flex items-center gap-x-2 mb-1">
          <span class="text-slate-400 uppercase tracking-wide w-16 flex-none">Disk</span>
        </div>
        <div class="ml-[72px] space-y-0.5">
          <div
            v-for="(dp, idx) in diskPaths"
            :key="idx"
            class="flex items-center gap-2 font-mono"
          >
            <span
              class="w-2 h-2 rounded-full flex-none"
              :class="dp.exists ? 'bg-emerald-400' : 'bg-red-400'"
              :title="dp.exists ? 'Path exists' : 'Path missing'"
            />
            <span class="text-slate-300 truncate max-w-[200px]" :title="dp.path">{{ dp.path }}</span>
            <template v-if="dp.usage">
              <span class="text-slate-500">{{ formatBytes(dp.usage.used) }}/{{ formatBytes(dp.usage.total) }}</span>
              <span
                class="px-1 py-0.5 rounded border"
                :class="resourceColorClass(dp.usage.percent)"
              >
                {{ formatPercent(dp.usage.percent) }}
              </span>
            </template>
          </div>
        </div>
      </div>

      <!-- Container -->
      <div v-if="containerSummary" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span class="text-slate-400 uppercase tracking-wide w-16 flex-none">Container</span>
        <span class="font-mono text-slate-300">{{ containerSummary }}</span>
      </div>

      <!-- Restart History -->
      <div v-if="restartStats" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span class="text-slate-400 uppercase tracking-wide w-16 flex-none">Restarts</span>
        <span v-if="restartTotal != null" class="font-mono text-slate-200">{{ restartTotal }} total</span>
        <span v-if="lastExitReason" class="font-mono text-amber-300 truncate max-w-[200px]" :title="lastExitReason">
          {{ lastExitReason }}
        </span>
        <span v-if="lastRestartTime" class="font-mono text-slate-400">{{ lastRestartTime }}</span>
      </div>
    </div>

    <div v-else class="text-[11px] text-slate-500">No metrics available for this process.</div>
  </div>
</template>
