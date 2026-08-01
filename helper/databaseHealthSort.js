const DATABASE_PRESSURE_RANK = {
  healthy: 0,
  observing: 0,
  collecting: 0,
  moderate: 1,
  high: 2,
  critical: 3,
}

const TEXT_SORT_KEYS = new Set(['service', 'provider', 'recommendation'])

const sumDatabaseValues = (service, key) => {
  const values = (service?.databases || [])
    .filter((database) => database?.[key] != null)
    .map((database) => Number(database[key]))
    .filter(Number.isFinite)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

export const databaseSize = (service) => sumDatabaseValues(service, 'size_bytes')

export const databaseWalSize = (service) => sumDatabaseValues(service, 'wal_size_bytes')

export const databaseSignalCount = (service) => {
  const signals = service?.log_signals || {}
  return ['locked', 'busy', 'timeout', 'io_error', 'deadlock']
    .reduce((total, key) => total + Number(signals[key] || 0), 0)
}

export const databaseProbeLatency = (service) => {
  const values = (service?.databases || [])
    .filter((database) => database?.probe_ms != null)
    .map((database) => Number(database?.probe_ms))
    .filter(Number.isFinite)
  return values.length ? Math.max(...values) : null
}

const pressureSortValue = (service) => {
  const rank = DATABASE_PRESSURE_RANK[service?.pressure]
  if (rank == null) return null
  const score = Number(service?.score)
  return (rank * 1000) + (Number.isFinite(score) ? score : 0)
}

const databaseSortValue = (service, key) => {
  if (key === 'service') return service?.process_name || service?.id || null
  if (key === 'provider') return service?.provider || null
  if (key === 'pressure') return pressureSortValue(service)
  if (key === 'store_size') return databaseSize(service)
  if (key === 'wal') return databaseWalSize(service)
  if (key === 'signals') return databaseSignalCount(service)
  if (key === 'probe') return databaseProbeLatency(service)
  if (key === 'recommendation') return service?.recommendation || null
  return null
}

const comparePresentValues = (left, right) => {
  if (typeof left === 'string' || typeof right === 'string') {
    return String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  }
  return left - right
}

export const sortDatabaseHealthServices = (services, key, direction = 'asc') => {
  const directionMultiplier = direction === 'desc' ? -1 : 1
  return [...services].sort((leftService, rightService) => {
    const left = databaseSortValue(leftService, key)
    const right = databaseSortValue(rightService, key)

    // Unknown values stay at the bottom in both directions.
    if (left == null && right == null) return comparePresentValues(
      leftService?.process_name || leftService?.id || '',
      rightService?.process_name || rightService?.id || '',
    )
    if (left == null) return 1
    if (right == null) return -1

    const compared = comparePresentValues(left, right)
    if (compared !== 0) return compared * directionMultiplier
    return comparePresentValues(
      leftService?.process_name || leftService?.id || '',
      rightService?.process_name || rightService?.id || '',
    )
  })
}

export const nextDatabaseHealthSort = (currentKey, currentDirection, nextKey) => {
  if (currentKey === nextKey) {
    return {
      key: nextKey,
      direction: currentDirection === 'asc' ? 'desc' : 'asc',
    }
  }
  return {
    key: nextKey,
    direction: TEXT_SORT_KEYS.has(nextKey) ? 'asc' : 'desc',
  }
}
