const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

const isEnabled = (service) => (
  service?.enabled === true
  || service?.enabled === 'true'
  || service?.config?.enabled === true
  || service?.config?.enabled === 'true'
)

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
