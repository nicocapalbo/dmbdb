const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

const isEnabled = (service) => (
  service?.enabled === true
  || service?.enabled === 'true'
  || service?.config?.enabled === true
  || service?.config?.enabled === 'true'
)

export const installCacheLimitGibFromStatus = (status, fallback = 25) => {
  const bytes = Number(status?.max_size_bytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return fallback
  return Math.round((bytes / (1024 ** 3)) * 100) / 100
}

export const normalizeInstallCacheLimitGib = (value) => {
  const limit = Number(value)
  if (!Number.isFinite(limit) || limit < 1 || limit > 1024) return null
  return Math.round(limit * 100) / 100
}

export const createDashboardUpdateRows = (services = []) => (
  (Array.isArray(services) ? services : [])
    .filter((service) => isEnabled(service) && service?.supports_manual_update === true)
    .map((service) => ({
      process_name: String(service?.process_name || '').trim(),
      display_name: String(service?.name || service?.process_name || '').trim(),
      config_key: String(service?.config_key || service?.key || '').trim(),
      current_version: service?.version || service?.update_status?.current_version || null,
      update_status: service?.update_status && typeof service.update_status === 'object'
        ? { ...service.update_status }
        : null,
      operation: 'idle',
      error: '',
    }))
    .filter((service) => service.process_name)
)

export const reconcileDashboardUpdateRows = (
  services = [],
  currentRows = [],
  preserveOperations = false,
) => {
  const refreshedRows = createDashboardUpdateRows(services)
  if (!preserveOperations) return refreshedRows

  const currentByName = new Map(
    (Array.isArray(currentRows) ? currentRows : [])
      .map((row) => [row?.process_name, row]),
  )
  return refreshedRows.map((row) => {
    const current = currentByName.get(row.process_name)
    if (!current || current.operation === 'idle') return row
    return {
      ...row,
      update_status: current.update_status || row.update_status,
      operation: current.operation,
      error: current.error || '',
    }
  })
}

export const mergeDashboardUpdateResult = (
  rows,
  processName,
  updateStatus,
  operation = 'idle',
  error = '',
) => (
  (Array.isArray(rows) ? rows : []).map((row) => (
    row.process_name === processName
      ? {
          ...row,
          update_status: updateStatus && typeof updateStatus === 'object'
            ? { ...updateStatus }
            : row.update_status,
          operation,
          error,
        }
      : row
  ))
)

export const serviceUpdateOperationFor = (operations, processName) => {
  const name = String(processName || '').trim()
  if (!name || !operations || typeof operations !== 'object') return null
  const operation = operations[name]
  return operation && typeof operation === 'object' ? operation : null
}

export const mergeServiceUpdateOperation = (operations, processName, patch = {}) => {
  const name = String(processName || '').trim()
  const current = serviceUpdateOperationFor(operations, name)
  if (!name) return operations && typeof operations === 'object' ? { ...operations } : {}
  return {
    ...(operations && typeof operations === 'object' ? operations : {}),
    [name]: {
      process_name: name,
      operation: 'idle',
      progress: '',
      update_status: null,
      error: '',
      started_at: null,
      completed_at: null,
      ...(current || {}),
      ...(patch && typeof patch === 'object' ? patch : {}),
    },
  }
}

export const serviceUpdateOperationBusy = (operation) => (
  operation?.operation === 'checking' || operation?.operation === 'installing'
)

export const dashboardUpdateStatus = (row) => String(
  row?.update_status?.status || 'not_checked'
).trim().toLowerCase()

export const dashboardInstallableNames = (rows) => (
  (Array.isArray(rows) ? rows : [])
    .filter((row) => dashboardUpdateStatus(row) === 'update_available')
    .map((row) => row.process_name)
)

const installPriority = (row) => {
  const key = normalizeName(row?.config_key)
  const name = normalizeName(row?.process_name)
  if (key === 'dumb' || name === 'dumbapi' || name === 'dmbapi') return 2
  if (key === 'dumbfrontend' || name === 'dumbfrontend' || name === 'dmbfrontend') return 1
  return 0
}

export const orderDashboardInstallNames = (names, rows) => {
  const requested = new Set(Array.isArray(names) ? names : [])
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => requested.has(row.process_name))
    .sort((left, right) => installPriority(left) - installPriority(right))
    .map((row) => row.process_name)
}

export const formatDashboardUpdateStatus = (row) => {
  const status = dashboardUpdateStatus(row)
  if (row?.operation === 'checking') return 'Checking'
  if (row?.operation === 'installing') return 'Installing'
  if (row?.operation === 'error') return 'Error'
  if (row?.operation === 'deferred') return 'Protected · deferred'
  return {
    not_checked: 'Not checked',
    update_available: 'Update available',
    up_to_date: 'Up to date',
    no_update: 'No update',
    updated: 'Updated',
    blocked: 'Review source',
    unsupported: 'Unsupported',
    error: 'Error',
  }[status] || status.replaceAll('_', ' ')
}

export const formatUpdateDuration = (value) => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds > 0 && seconds < 1) return '<1s'
  const rounded = Math.round(seconds)
  if (rounded < 60) return `${rounded}s`
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainingSeconds = rounded % 60
  return [
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    remainingSeconds || (!hours && !minutes) ? `${remainingSeconds}s` : '',
  ].filter(Boolean).join(' ')
}

export const formatUpdateTiming = (updateStatus) => {
  const install = formatUpdateDuration(updateStatus?.install_duration_seconds)
  if (!install) return ''

  const parts = [`Install ${install}`]
  const downtimeStatus = String(updateStatus?.downtime_status || '').toLowerCase()
  const downtime = formatUpdateDuration(updateStatus?.downtime_seconds)
  if (downtimeStatus === 'completed' && downtime) {
    parts.push(`Downtime ${downtime}`)
  } else if (downtimeStatus === 'ongoing' && downtime) {
    parts.push(`Downtime at least ${downtime} · readiness not confirmed`)
  } else if (downtimeStatus === 'not_observed') {
    parts.push('Downtime not observed')
  }
  return parts.join(' · ')
}

export const formatDashboardUpdateTiming = formatUpdateTiming

export const mergeUpdateTiming = (updateStatus, installResult) => {
  const merged = updateStatus && typeof updateStatus === 'object'
    ? { ...updateStatus }
    : {}
  if (!installResult || typeof installResult !== 'object') return merged
  for (const key of [
    'install_duration_seconds',
    'downtime_seconds',
    'downtime_status',
    'timing_completed_at',
  ]) {
    if (Object.prototype.hasOwnProperty.call(installResult, key)) {
      merged[key] = installResult[key]
    }
  }
  return merged
}
