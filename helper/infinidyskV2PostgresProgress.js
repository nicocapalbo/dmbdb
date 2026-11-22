const phases = {
  starting: 'Preparing the database conversion', queued: 'Waiting to prepare the recovery snapshot', target_check: 'Checking the destination database',
  backup: 'Saving the SQLite recovery snapshot', backup_validation: 'Checking the recovery snapshot',
  backup_fingerprint: 'Verifying the recovery snapshot fingerprint', native_admission: 'Starting the native database copy',
  copying: 'Copying records to PostgreSQL', syncing: 'Synchronizing recent changes',
  cutover: 'Switching to PostgreSQL', rolling_back: 'Restoring the SQLite snapshot',
}
const count = value => Number.isSafeInteger(value) && value >= 0
const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

// Totals belong to the current snapshot pass or native table, never the whole
// conversion. A missing/null native counter is unknown rather than zero.
export const infinidyskV2PostgresProgress = (job, { confirmed = false, now = Date.now() } = {}) => {
  if (!job || !['starting', 'copying', 'syncing', 'cutover', 'rolling_back'].includes(job.status)) return null
  const stage = job.stage || job.status
  const progress = job.progress && typeof job.progress === 'object' && !Array.isArray(job.progress) ? job.progress : {}
  const native = ['copying', 'syncing'].includes(job.status) && !['backup', 'backup_validation', 'backup_fingerprint', 'target_check', 'native_admission', 'queued'].includes(stage)
  const unit = native && (progress.unit === 'rows' || progress.unit == null && (count(progress.done) || count(progress.total))) ? 'rows'
    : stage === 'backup' && progress.unit === 'pages' ? 'pages'
      : stage === 'backup_fingerprint' && progress.unit === 'bytes' ? 'bytes' : null
  const result = { label: phases[stage] || phases[job.status], unit, native }
  if (unit && count(progress.done)) result.done = progress.done
  if (unit && count(progress.total)) result.total = progress.total
  if (native && typeof progress.table === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(progress.table)) result.table = progress.table
  if (native && count(progress.pending_changes)) result.pendingChanges = progress.pending_changes
  if (seconds(progress.elapsed_seconds)) result.elapsedSeconds = Math.floor(progress.elapsed_seconds)
  if (result.done !== undefined && result.total > 0 && result.done <= result.total) result.percent = Math.floor(result.done / result.total * 100)
  const age = seconds(job.updated_at) && Number.isFinite(now) ? now / 1000 - job.updated_at : null
  const fresh = confirmed && age !== null && age >= -5 && age <= 30
  const rate = progress.rate_per_second ?? (unit === 'bytes' ? progress.bytes_per_second : null)
  if (fresh && unit && result.elapsedSeconds >= 10 && seconds(rate) && rate > 0 && result.done > 0 && result.done <= result.total) result.rate = rate
  if (result.rate && result.done < result.total && seconds(progress.eta_seconds)) result.remainingSeconds = Math.ceil(progress.eta_seconds / 5) * 5
  return result
}
