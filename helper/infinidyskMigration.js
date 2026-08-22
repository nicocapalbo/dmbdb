const ACTIVE_MIGRATION_JOB_STATUSES = new Set(['queued', 'running', 'rolling_back'])
const RECOVERY_PENDING_MIGRATION_JOB_STATUSES = new Set([
  'interrupted',
  'rollback_attention_required',
])
const POSTGRES_ALLOWED_NAMESPACE_STATUSES = new Set([
  'not_needed',
  'compatibility_completed',
  'completed',
])

export const INFINIDYSK_MIGRATION_CLEANUP_CONFIRMATION = 'REMOVE INFINIDYSK MIGRATION DATA'

export const normalizeInfiniDyskMigrationJob = (job) => {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null
  if (!String(job.job_id || '').trim() || !String(job.status || '').trim()) return null
  return job
}

export const isActiveInfiniDyskMigrationJob = job => (
  ACTIVE_MIGRATION_JOB_STATUSES.has(String(job?.status || ''))
)

export const resolveInfiniDyskPostgresMigrationGate = ({
  migrationCapability = null,
  migrationJobsCapability = null,
  statusResolved = false,
  jobResolved = false,
  migration = null,
  job = null,
  error = '',
} = {}) => {
  if (migrationCapability !== true || migrationJobsCapability !== true) {
    return {
      allowed: false,
      state: 'unsupported',
      reason: 'Upgrade DUMB before migrating InfiniDysk to PostgreSQL; this backend cannot verify namespace migration ordering.',
    }
  }

  if (!statusResolved || !jobResolved || !migration) {
    return {
      allowed: false,
      state: error ? 'unavailable' : 'checking',
      reason: error
        ? 'DUMB could not verify InfiniDysk namespace migration state. Resolve the status error and refresh before continuing.'
        : 'Checking InfiniDysk namespace migration state before PostgreSQL can be enabled…',
    }
  }

  if (isActiveInfiniDyskMigrationJob(job)) {
    return {
      allowed: false,
      state: 'active',
      reason: 'Wait for the active InfiniDysk namespace migration to finish before starting a PostgreSQL migration.',
    }
  }

  if (RECOVERY_PENDING_MIGRATION_JOB_STATUSES.has(String(job?.status || ''))) {
    return {
      allowed: false,
      state: 'recovery',
      reason: 'Resolve the latest InfiniDysk namespace migration recovery state before starting a PostgreSQL migration.',
    }
  }

  const status = String(migration.status || '')
  if (POSTGRES_ALLOWED_NAMESPACE_STATUSES.has(status)) {
    return { allowed: true, state: 'ready', reason: '' }
  }

  return {
    allowed: false,
    state: status === 'pending' || migration.eligible === true ? 'namespace_required' : 'unresolved',
    reason: status === 'pending' || migration.eligible === true
      ? 'Complete the InfiniDysk identity or namespace migration before starting a PostgreSQL migration.'
      : 'DUMB cannot confirm that InfiniDysk namespace migration is complete. Refresh the migration status before continuing.',
  }
}

export const isInfiniDyskMigrationCleanupAvailable = (
  migration,
  capabilityEnabled = false,
  job = null,
) => (
  capabilityEnabled === true
  && migration?.cleanup_available === true
  && migration?.cleanup_finalized !== true
  && !isActiveInfiniDyskMigrationJob(job)
)

export const isInfiniDyskMigrationCleanupReady = ({
  preview,
  confirmation,
  acknowledgeValidation = false,
  acknowledgeRollbackLoss = false,
} = {}) => (
  preview?.available === true
  && Boolean(String(preview?.preview_token || '').trim())
  && confirmation === INFINIDYSK_MIGRATION_CLEANUP_CONFIRMATION
  && acknowledgeValidation === true
  && acknowledgeRollbackLoss === true
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
