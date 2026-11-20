import { infinidyskV2ActivationExposed, infinidyskV2Support, isInfiniDyskV2CleanupActive } from './infinidyskV2.js'

export const infinidyskV2StageRetrySupported = capabilities => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_stage_retry === true
  && capabilities?.infinidysk_v2_stage_retry_protocol === 1

export const infinidyskV2StageRetry = job => {
  const value = job?.stage_retry
  const label = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 4000
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.protocol !== 1
    || !label(value.operation) || typeof value.stage !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(value.stage)
    || !label(value.label) || !label(value.message)
    || !Number.isSafeInteger(value.attempt) || value.attempt < 1
    || !Number.isSafeInteger(value.failed_at) || value.failed_at < 0
    || !['waiting', 'retrying', 'completed'].includes(value.state)) return null
  return value
}

// The backend owns the retry boundary, attempt and fresh confirmation phrase.
// Retained details never authorize a retry without current status and capability.
export const infinidyskV2StageRetryReady = ({ capabilities, confirmed, busy, job, confirmation }) => {
  const retry = infinidyskV2StageRetry(job)
  const phrase = job?.confirmation_texts?.retry_stage
  return infinidyskV2StageRetrySupported(capabilities) && confirmed === true && !busy
    && job?.status === 'stage_retry_required' && retry?.state === 'waiting' && retry.stage === job.stage
    && typeof job.job_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(job.job_id)
    && job.cancel_requested === false && !infinidyskV2ActivationExposed(job) && !isInfiniDyskV2CleanupActive(job)
    && job.can_retry_stage === true && job.actions?.retry_stage === true
    && typeof phrase === 'string' && phrase.length > 0 && phrase.length <= 4000 && confirmation === phrase
}
