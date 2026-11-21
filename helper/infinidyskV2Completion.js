import { infinidyskV2ConsumerRecovery, normalizeInfiniDyskV2Job } from './infinidyskV2.js'

export const INFINIDYSK_V2_COMPLETION_STORAGE_KEY = 'dumb.infinidyskV2.completedNotices.v1'
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const clearFlag = value => value === undefined || value === null || value === false

export const normalizeInfiniDyskV2CompletionPreference = value => ({
  major: object(value) && validId(value.major) ? value.major : null,
  postgres: object(value) && validId(value.postgres) ? value.postgres : null,
})

// Acknowledging a success notice never changes the retained job or recovery
// controls. Re-evaluate safety on every observation so later recovery resurfaces.
export const infinidyskV2CompletionDismissible = ({ job, confirmed, busy = false, mutation = null } = {}) => {
  if (confirmed !== true || busy || !normalizeInfiniDyskV2Job(job) || job.status !== 'completed'
    || (mutation !== null && mutation !== undefined && (!object(mutation) || !['confirmed', 'rejected'].includes(mutation.status)))) return false
  if (!['recovery_required', 'restart_required', 'staging_cleanup_required', 'cleanup_required'].every(key => clearFlag(job[key]))
    || !clearFlag(job.result?.restart_required)) return false
  if (job.cleanup !== undefined && job.cleanup !== null
    && (!object(job.cleanup) || !['not_requested', 'completed'].includes(job.cleanup.state))) return false
  const consumers = infinidyskV2ConsumerRecovery(job)
  if (job.recovery_kind != null || job.consumer_recovery != null) {
    if (!consumers?.valid || consumers.pending.length || consumers.failed.length) return false
  }
  return true
}

export const infinidyskV2CompletionDismissed = ({ preference, kind, ...options } = {}) =>
  ['major', 'postgres'].includes(kind) && infinidyskV2CompletionDismissible(options)
  && normalizeInfiniDyskV2CompletionPreference(preference)[kind] === options.job.job_id
