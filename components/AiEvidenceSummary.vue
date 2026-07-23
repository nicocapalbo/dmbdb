<script setup>
const props = defineProps({
  bundle: { type: Object, default: null },
})

const formatBytes = (value) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return 'unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}

const windowLabel = computed(() => {
  const window = props.bundle?.diagnostic_window?.current
  if (!window?.start || !window?.end) return ''
  return `${new Date(window.start).toLocaleString()} to ${new Date(window.end).toLocaleString()}`
})

const coverageItems = computed(() => {
  const coverage = props.bundle?.diagnostic_coverage || {}
  if (props.bundle?.scope === 'stack') {
    return [
      { label: 'Confidence hint', value: coverage.confidence_hint || 'low', ok: coverage.confidence_hint !== 'low' },
      { label: 'Services', value: coverage.processes ?? 0, ok: Number(coverage.processes) > 0 },
      { label: 'Deep log scans', value: coverage.retained_log_services ?? 0, ok: Number(coverage.retained_log_services) > 0 },
      { label: 'Metrics history', value: coverage.metrics_history ? 'available' : 'unavailable', ok: coverage.metrics_history },
      { label: 'Change history', value: coverage.change_history ? 'included' : 'not included', ok: coverage.change_history },
      { label: 'Native collectors', value: coverage.native_collectors ?? 0, ok: Number(coverage.native_collectors) > 0 },
      { label: 'Docs', value: coverage.docs ? 'included' : 'unavailable', ok: coverage.docs },
    ]
  }
  const logCoverage = props.bundle?.log_analysis?.coverage || {}
  return [
    { label: 'Confidence hint', value: coverage.confidence_hint || 'low', ok: coverage.confidence_hint !== 'low' },
    { label: 'Service status', value: coverage.status ? 'included' : 'unavailable', ok: coverage.status },
    { label: 'Retained logs', value: coverage.retained_logs ? `${logCoverage.files_scanned || 0} files · ${formatBytes(logCoverage.bytes_scanned)}` : 'unavailable', ok: coverage.retained_logs },
    { label: 'Metrics history', value: coverage.metrics_history ? 'available' : 'unavailable', ok: coverage.metrics_history },
    { label: 'Database health', value: coverage.database_health ? 'included' : 'unavailable', ok: coverage.database_health },
    { label: 'Change history', value: coverage.change_history ? 'included' : 'not included', ok: coverage.change_history },
    { label: 'Native telemetry', value: coverage.native_collector ? 'available' : 'generic only', ok: coverage.native_collector },
    { label: 'Docs', value: coverage.docs ? 'included' : 'unavailable', ok: coverage.docs },
  ]
})

const recommendations = computed(() => props.bundle?.recommendations || [])
</script>

<template>
  <section v-if="bundle" class="border border-slate-700/70 bg-slate-900/30">
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 px-3 py-2">
      <div class="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <span class="material-symbols-rounded !text-[18px] text-sky-300">fact_check</span>
        <span>Evidence coverage</span>
      </div>
      <div class="text-xs text-slate-400">{{ windowLabel }}</div>
    </header>
    <div class="grid gap-px bg-slate-800 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="item in coverageItems" :key="item.label" class="min-w-0 bg-slate-950/70 px-3 py-2">
        <div class="flex items-center gap-1 text-xs text-slate-400">
          <span class="material-symbols-rounded !text-[15px]" :class="item.ok ? 'text-emerald-300' : 'text-amber-300'">
            {{ item.ok ? 'check_circle' : 'info' }}
          </span>
          <span>{{ item.label }}</span>
        </div>
        <div class="mt-1 break-words text-sm text-slate-100">{{ item.value }}</div>
      </div>
    </div>
    <div v-if="recommendations.length" class="border-t border-slate-700/60">
      <div class="px-3 pt-2 text-xs font-semibold uppercase text-slate-400">Reviewable next actions</div>
      <div v-for="item in recommendations" :key="item.id" class="flex gap-2 border-t border-slate-800 px-3 py-2 first:border-t-0">
        <span class="material-symbols-rounded !text-[18px] text-amber-300">lightbulb</span>
        <div class="min-w-0">
          <div class="text-sm font-medium text-slate-100">{{ item.title }}</div>
          <div class="text-xs text-slate-400">{{ item.reason }}</div>
          <div class="mt-1 text-[11px] text-slate-500">
            Risk: {{ item.risk }} · Restart: {{ item.restart_required ? 'required' : 'not required' }} · Review only
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
