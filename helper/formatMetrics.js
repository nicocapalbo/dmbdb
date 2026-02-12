/**
 * Shared metric formatting utilities.
 *
 * Extracted from pages/metrics.vue so that GeekInfoPanel,
 * ServiceCard badges, and other geek-mode features can reuse them.
 */

export const formatBytes = (value) => {
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

export const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '-'
  return `${Number(value).toFixed(1)}%`
}

export const formatUptime = (seconds) => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '-'
  const s = Math.floor(seconds)
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export const resourceColorClass = (percent) => {
  if (percent == null || !Number.isFinite(percent)) {
    return 'border-slate-600/60 bg-slate-700/40 text-slate-200'
  }
  if (percent >= 80) return 'border-red-600/40 bg-red-900/30 text-red-200'
  if (percent >= 50) return 'border-amber-600/40 bg-amber-900/30 text-amber-200'
  return 'border-emerald-600/40 bg-emerald-900/30 text-emerald-200'
}
