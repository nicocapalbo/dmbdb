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
  ['infinidysk', 'nzbdav'].includes(String(config?.key_type || '').trim().toLowerCase())
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

export const retainedTraceSummary = (result = {}) => {
  const traces = Array.isArray(result?.stream_traces) ? result.stream_traces : []
  const providers = [...new Set(
    traces.flatMap((trace) => Array.isArray(trace?.providers) ? trace.providers : [])
      .map((provider) => String(provider || '').trim())
      .filter(Boolean)
  )]
  return {
    available: traces.length > 0,
    matched: traces.length,
    providers: providers.join(', ') || (traces.length ? 'none recorded' : 'not available'),
    retries: traces.reduce((total, trace) => total + Number(trace?.retries || 0), 0),
    bytesServed: traces.reduce((total, trace) => total + Number(trace?.bytes_served || 0), 0),
    providerWaitMs: traces.reduce((total, trace) => total + Number(trace?.provider_wait_ms || 0), 0),
    connectionWaitMs: traces.reduce((total, trace) => total + Number(trace?.connection_wait_ms || 0), 0),
  }
}
