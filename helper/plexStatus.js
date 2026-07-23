export const plexStatusState = (status = {}) => {
  if (!status?.enabled) return 'disabled'
  if (status?.refreshing && !status?.available) return 'collecting'
  if (!status?.available) return 'unavailable'
  if (status?.stale) return 'stale'
  if (status?.operational) return 'operational'
  return 'incident'
}

export const plexStatusLabel = (status = {}) => ({
  disabled: 'Disabled',
  collecting: 'Collecting',
  unavailable: 'Unavailable',
  stale: 'Stale',
  operational: 'Operational',
  incident: status?.description || 'Plex incident',
}[plexStatusState(status)])

export const plexStatusToneClass = (status = {}) => ({
  disabled: 'border-slate-600/50 bg-slate-800/40 text-slate-300',
  collecting: 'border-sky-600/40 bg-sky-900/30 text-sky-200',
  unavailable: 'border-rose-600/40 bg-rose-900/30 text-rose-200',
  stale: 'border-amber-600/40 bg-amber-900/30 text-amber-200',
  operational: 'border-emerald-600/40 bg-emerald-900/30 text-emerald-200',
  incident: 'border-orange-600/40 bg-orange-900/30 text-orange-200',
}[plexStatusState(status)])

export const plexComponentCount = (status = {}) => Object.values(
  status?.component_status_counts || {},
).reduce((total, count) => total + (Number(count) || 0), 0)
