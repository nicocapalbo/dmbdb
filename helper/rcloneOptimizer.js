export const RCLONE_OPTIMIZER_ACTIVE_STATUSES = new Set([
  'queued',
  'preflight',
  'benchmarking',
  'reporting',
  'applying',
  'rolling_back'
])

export const isNzbDavRcloneConfig = (configKey, config = {}) => (
  String(configKey || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'rclone' &&
  String(config?.key_type || '').trim().toLowerCase() === 'nzbdav'
)

export const rcloneOptimizerNotificationKind = (previousStatus, nextStatus) => {
  if (!previousStatus || previousStatus === nextStatus) return null
  if (nextStatus === 'completed') return 'success'
  if (nextStatus === 'failed') return 'warning'
  return null
}

export const warmColdStartupAverages = (samples = []) => {
  const average = (bucket) => {
    const values = samples
      .filter((sample) => sample?.scored && sample?.age_bucket === bucket)
      .map((sample) => Number(sample.startup_ms))
      .filter(Number.isFinite)
    if (!values.length) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  return { recent: average('recent'), older: average('older') }
}
