const runningBlockers = new Set([
  'A major migration is active or needs recovery review.',
  'An InfiniDysk 2 operation is already running. Its status is shown below.',
])
export const infinidyskV2RunningBlocker = value => runningBlockers.has(typeof value === 'string' ? value : value?.message)

// A transport failure is not proof that a mutation was rejected.
export const infinidyskV2AmbiguousRequest = error => {
  const status = error?.response?.status ?? error?.status
  return ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(error?.code)
    || (typeof status === 'number' && (status === 408 || (status >= 500 && status < 600)))
}

export const infinidyskV2PostgresRequestPending = request => request?.kind === 'postgres'
  && request.action === 'postgresStart' && ['pending', 'uncertain'].includes(request.status)

export const infinidyskV2MutationObserved = (request, job) => {
  if (!request || !job || !['pending', 'uncertain', 'confirmed'].includes(request.status)) return false
  if (request.kind === 'postgres' && request.action === 'postgresStart') return job.job_id !== request.previous_job_id
    && job.operation === 'infinidysk_v2_postgres' && typeof request.preview_id === 'string'
    && request.preview_id.length > 0 && job.preview_id === request.preview_id
  if (request.kind === 'postgres' && job.job_id === request.previous_job_id) {
    if (request.action === 'postgresCutover') return ['cutover', 'completed'].includes(job.status)
    if (request.action === 'postgresCancel') return job.cancel_requested === true || job.status === 'cancelled'
    if (request.action === 'postgresRollback') return ['rolling_back', 'rolled_back'].includes(job.status)
  }
  if (request.kind === 'major' && ['rehearse', 'start', 'prepare'].includes(request.action)) {
    return job.job_id !== request.previous_job_id && job.mode === (request.action === 'prepare' ? 'prepare' : request.action === 'rehearse' ? 'rehearsal' : 'cutover')
      && typeof request.plan_fingerprint === 'string' && request.plan_fingerprint.length > 0
      && job.plan_fingerprint === request.plan_fingerprint
  }
  if (request.kind === 'major' && job.job_id === request.previous_job_id) {
    if (request.action === 'retryStage') {
      const retry = job.stage_retry, previous = request.retry_stage_attempt
      if (retry?.protocol !== 1 || !Number.isSafeInteger(previous) || previous < 1
        || !Number.isSafeInteger(retry.attempt) || typeof retry.operation !== 'string' || !retry.operation.length) return false
      // A later pause in the same job proves that this decision was consumed,
      // even if the retried step failed again before its response arrived.
      // This confirms admission only; the latest paused outcome stays visible.
      return retry.attempt > previous ? ['waiting', 'retrying', 'completed'].includes(retry.state)
        : retry.attempt === previous && retry.operation === request.retry_stage_operation && ['retrying', 'completed'].includes(retry.state)
    }
    if (request.action === 'activate') return job.mode === 'prepare' && (job.stage === 'activating' || job.activation_exposed === true || job.activation_committed === true)
    if (request.action === 'rollback') return ['rolling_back', 'rolled_back'].includes(job.status)
    if (request.action === 'cancel') return job.cancel_requested === true || job.status === 'cancelled'
    if (request.action === 'finishConsumerRecovery') return job.status === 'completed'
  }
  return false
}

const snapshotPhases = {
  source_connection: 'Connecting to the v1 database', source_inventory: 'Reading the v1 database inventory',
  snapshot_export: 'Opening a consistent database snapshot', backup_tool: 'Checking PostgreSQL backup tools',
  native_staging: 'Preparing the native import database', dump_storage: 'Checking recovery dump storage',
  database_dump: 'Writing the PostgreSQL recovery dump', source_cleanup: 'Closing the source snapshot',
  restore_verification: 'Testing recovery from the PostgreSQL dump', snapshot_receipt: 'Recording the verified snapshot',
}
const restorePhases = {
  copying_dump: 'Copying the recovery dump', initializing_database: 'Preparing the isolated verification database',
  starting_database: 'Starting the verification database', creating_database: 'Creating its restore target',
  restoring_database: 'Restoring the dump into the verification database',
  verifying_database: 'Comparing the restored database with the snapshot', verified: 'Recovery verification finished',
}
export const infinidyskV2SnapshotProgress = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.phase !== 'string' || !Object.hasOwn(snapshotPhases, value.phase)) return null
  const result = { phase: value.phase, label: snapshotPhases[value.phase] }
  if (value.phase === 'restore_verification' && typeof value.restore_phase === 'string' && Object.hasOwn(restorePhases, value.restore_phase)) result.restoreLabel = restorePhases[value.restore_phase]
  const tablePhase = ['source_inventory', 'native_staging'].includes(value.phase)
  if (tablePhase && typeof value.table === 'string' && /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/.test(value.table)) result.table = value.table
  for (const key of tablePhase ? ['table_index', 'table_count', 'rows', 'elapsed_seconds', 'idle_seconds'] : ['elapsed_seconds', 'idle_seconds']) {
    if (typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key]
  }
  result.stall_warning = value.stall_warning === true
  return result
}
export const infinidyskV2SnapshotStage = stage => ['postgres_snapshot', 'postgres_dump', 'postgres_restore_verification'].includes(stage)
const scanPhases = {
  reuse_eligibility: 'Checking whether the v1 files can be reused',
  source_data: 'Measuring the retained v1 data',
  source_runtime: 'Measuring the retained v1 application files',
  legacy_blob_allocation: 'Measuring local space used by v1 blobs',
}
const count = value => Number.isSafeInteger(value) && value >= 0
export const infinidyskV2ScanProgress = (value, { active = false, confirmed = false, stage = null, now = Date.now() } = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.scan_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.scan_id)
    || typeof value.phase !== 'string' || !Object.hasOwn(scanPhases, value.phase)
    || value.estimate_scope !== 'current_scan' || !count(value.entries_processed)
    || !count(value.elapsed_seconds) || typeof value.complete !== 'boolean'
    || typeof value.total_is_estimate !== 'boolean') return null
  const result = {
    scanId: value.scan_id, phase: value.phase, label: scanPhases[value.phase],
    entries: value.entries_processed, elapsedSeconds: value.elapsed_seconds, complete: value.complete,
    totalIsEstimate: value.total_is_estimate,
  }
  if (count(value.logical_bytes_processed)) result.logicalBytes = value.logical_bytes_processed
  if (count(value.entries_total)) result.totalEntries = value.entries_total
  const overrun = result.totalEntries !== undefined && result.entries > result.totalEntries
  const observed = typeof value.updated_at === 'number' && Number.isFinite(value.updated_at) ? value.updated_at : null
  const age = observed === null || !Number.isFinite(now) ? null : now / 1000 - observed
  const fresh = age !== null && age >= -5 && age <= 30
  const live = active && confirmed && stage === 'revalidating' && !result.complete && fresh && !overrun
  const warmed = result.elapsedSeconds >= 10 && result.entries > 0
  const rate = typeof value.rate_entries_per_second === 'number' && Number.isFinite(value.rate_entries_per_second)
    && value.rate_entries_per_second > 0 ? value.rate_entries_per_second : null
  if (live && warmed && rate !== null) result.rate = rate
  if (result.rate !== undefined && result.totalEntries > result.entries
    && count(value.estimated_remaining_seconds) && value.estimated_remaining_seconds > 0) {
    const seconds = value.estimated_remaining_seconds
    result.remainingSeconds = seconds >= 60 ? Math.ceil(seconds / 60) * 60 : Math.ceil(seconds / 5) * 5
  }
  result.estimateState = result.complete ? 'complete' : !active || stage !== 'revalidating' ? 'inactive'
    : !confirmed ? 'unconfirmed' : !fresh ? 'stale' : overrun ? 'overrun' : !warmed ? 'warming'
      : result.totalEntries === undefined ? 'unknown_total' : result.remainingSeconds === undefined ? 'unavailable' : 'ready'
  return result
}
export const infinidyskV2ScanEstimateText = state => ({
  complete: 'This scan finished. The operation still has later checks.',
  unconfirmed: 'The current scan status is unconfirmed. Its time estimate is paused.',
  stale: 'No recent scan measurements are available. Its time estimate is paused.',
  overrun: 'The file count has grown beyond the earlier estimate. A remaining-time estimate is not available.',
  warming: 'Measuring the current pace before estimating the remaining scan time.',
  unknown_total: 'The total file count is not known yet, so a remaining-time estimate is not available.',
  unavailable: 'A remaining-time estimate is not available for this scan yet.',
})[state] || ''

export const infinidyskV2StatusDuration = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const value = Math.floor(seconds)
  return value >= 3600 ? Math.floor(value / 3600) + 'h ' + Math.floor(value % 3600 / 60) + 'm'
    : value >= 60 ? Math.floor(value / 60) + 'm ' + value % 60 + 's' : value + 's'
}
