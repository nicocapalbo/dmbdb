export const POSTGRES_MIGRATION_ACTIVE_STATUSES = new Set([
  'queued',
  'running',
  'finalizing',
  'rolling_back',
])

const INFINIDYSK_POSTGRES_RECOVERY_STATUSES = new Set([
  'interrupted',
  'failed',
  'rollback_failed',
])

export const isActivePostgresMigrationJob = job => (
  POSTGRES_MIGRATION_ACTIVE_STATUSES.has(String(job?.status || ''))
)

export const isSuccessfulPostgresCutover = job => (
  String(job?.status || '') === 'completed'
  && String(job?.mode || '') === 'cutover'
  && job?.result?.validated === true
)

export const postgresMigrationStatusTone = (status) => {
  const normalized = String(status || '')
  if (normalized === 'pass' || normalized === 'completed') return 'success'
  if (normalized === 'warn' || normalized === 'failed_rolled_back' || normalized === 'rolled_back') return 'warning'
  if (normalized === 'fail' || INFINIDYSK_POSTGRES_RECOVERY_STATUSES.has(normalized)) return 'danger'
  return 'active'
}

export const resolveInfiniDyskPostgresRecovery = (job) => {
  if (String(job?.service_key || '') !== 'infinidysk') return null

  const status = String(job?.status || '')
  if (!INFINIDYSK_POSTGRES_RECOVERY_STATUSES.has(status)) return null

  if (status === 'rollback_failed') {
    if (job?.rollback?.retry_safe === true) {
      return {
        state: 'retry_safe',
        title: 'SQLite rollback can be retried',
        message: 'Rollback stopped before changing saved data. Open Database Migration and retry the guarded rollback; do not toggle the provider or restore files manually.',
      }
    }
    if (job?.rollback?.retry_safe === false) {
      return {
        state: 'manual_attention',
        title: 'PostgreSQL migration needs manual recovery',
        message: 'Rollback changed saved data but did not complete. DUMB keeps InfiniDysk lifecycle and provider changes frozen. Open Database Migration, inspect the private backup and failed recovery stage, and do not retry or restore the whole bundle blindly.',
      }
    }
    return {
      state: 'manual_attention',
      title: 'PostgreSQL rollback did not complete',
      message: 'Open Database Migration and inspect the persisted rollback result before changing InfiniDysk, PostgreSQL, or any saved files.',
    }
  }

  if (job?.rollback_available === true) {
    return {
      state: 'guarded_rollback',
      title: status === 'interrupted'
        ? 'PostgreSQL migration interrupted — rollback required'
        : 'PostgreSQL migration failed — restore SQLite',
      message: 'A preserved SQLite rollback is available. Open Database Migration and use its guarded rollback before retrying; do not toggle the provider or restore the job bundle manually.',
    }
  }

  return {
    state: 'review_required',
    title: status === 'interrupted'
      ? 'PostgreSQL migration interrupted'
      : 'PostgreSQL migration failed',
    message: 'Open Database Migration and review the persisted stage, error, and recovery state. The backend did not advertise a guarded rollback, so do not force a provider or file change.',
  }
}
