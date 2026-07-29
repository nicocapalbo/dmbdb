const VALID_HEALTH_STATES = new Set(['healthy', 'degraded', 'starting', 'unhealthy'])

export const normalizeServiceHealthStatus = (status, healthy = null) => {
  const normalized = String(status || '').trim().toLowerCase()
  if (VALID_HEALTH_STATES.has(normalized)) return normalized
  if (healthy === true) return 'healthy'
  if (healthy === false) return 'unhealthy'
  return null
}

export const serviceHealthLabel = (status) => ({
  healthy: 'Healthy',
  degraded: 'Degraded',
  starting: 'Starting',
  unhealthy: 'Unhealthy',
}[status] || 'Unknown')

export const serviceHealthBadgeClass = (status) => ({
  healthy: 'border-emerald-600/40 bg-emerald-900/30 text-emerald-300',
  degraded: 'border-amber-600/40 bg-amber-900/30 text-amber-300',
  starting: 'border-sky-600/40 bg-sky-900/30 text-sky-300',
  unhealthy: 'border-red-600/40 bg-red-900/30 text-red-300',
}[status] || 'border-slate-600/40 bg-slate-900/30 text-slate-300')

export const serviceHealthDotClass = (status) => ({
  healthy: 'bg-green-400',
  degraded: 'bg-amber-400',
  starting: 'bg-sky-400',
  unhealthy: 'bg-rose-500',
}[status] || 'bg-yellow-400')

export const serviceHealthTitle = (status, reason, details) => {
  const parts = [reason || serviceHealthLabel(status)]
  const components = Array.isArray(details?.components) ? details.components : []
  if (components.length) {
    parts.push(components
      .map((component) => `${component?.name || 'component'}: ${component?.status || 'unknown'}`)
      .join(', '))
  }
  if (details?.probe) parts.push(`Probe: ${details.probe}`)
  return parts.filter(Boolean).join(' • ')
}
