import { infinidyskV2ActivationExposed, infinidyskV2ImportReport, infinidyskV2SkipReviewReady, infinidyskV2Support } from './infinidyskV2.js'

export const infinidyskV2PreparedActivationSupported = capabilities => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_prepared_activation === true

// A retained prepared session owns the stopped services. It is never an
// invitation to start another import, even if capabilities become unavailable.
export const infinidyskV2PreparedSession = job => job?.mode === 'prepare'
  && job.status === 'prepared' && job.stage === 'awaiting_activation'
  && job.recovery_required !== true && job.result?.validated === true
  && !infinidyskV2ActivationExposed(job)

export const infinidyskV2ActivateReady = ({ capabilities, confirmed, busy, job, confirmation, acknowledgeSkippedMedia = false }) => {
  if (!infinidyskV2PreparedActivationSupported(capabilities) || confirmed !== true || busy
    || !infinidyskV2PreparedSession(job) || job.can_activate !== true || job.recovery_required === true
    || !['fresh', 'migrate'].includes(job.prepare_mode) || job.cancel_requested === true
    || typeof job.job_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(job.job_id)) return false
  const phrase = `ACTIVATE INFINIDYSK V2 ${job.job_id}`
  const report = infinidyskV2ImportReport(job.import_report)
  const accepted = job.prepare_mode === 'fresh' && job.import_report == null
    || report?.valid === true && infinidyskV2SkipReviewReady(capabilities, report, acknowledgeSkippedMedia)
  return job.activate_confirmation === phrase && confirmation === phrase && accepted
}
