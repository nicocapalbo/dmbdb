const ACTIVE_MIGRATION_JOB_STATUSES = new Set(['queued', 'running', 'rolling_back'])

export const normalizeInfiniDyskMigrationJob = (job) => {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null
  if (!String(job.job_id || '').trim() || !String(job.status || '').trim()) return null
  return job
}

export const isActiveInfiniDyskMigrationJob = job => (
  ACTIVE_MIGRATION_JOB_STATUSES.has(String(job?.status || ''))
)

export const reconcileInfiniDyskTerminalJob = (
  job,
  { announcementsEnabled = true, acknowledgedJobId = null } = {},
) => {
  const jobId = String(job?.job_id || '').trim()
  if (!jobId || isActiveInfiniDyskMigrationJob(job)) {
    return {
      acknowledgedJobId,
      announce: false,
    }
  }

  return {
    acknowledgedJobId: jobId,
    announce: announcementsEnabled && acknowledgedJobId !== jobId,
  }
}
