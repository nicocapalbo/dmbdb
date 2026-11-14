import { installationJob, installationJobActive, installationRestartRequired } from './installationBackups.js'

export const installationActivityJob = (activity, panel) => {
  if (activity?.authorizationRejected) return null
  const current = installationJob(activity?.job) || installationJob(activity?.recoveryJob)
  const local = installationJob(panel?.job)
  if (!local) return current
  if (!current) return local
  if (local.job_id === current.job_id) return Number(local.updated_at || 0) > Number(current.updated_at || 0) ? local : current
  return Number(local.created_at || 0) > Number(current.created_at || 0) ? local : current
}

export const installationServicesHeld = job => Boolean(job && (job.status === 'recovery_required' || installationRestartRequired(job)
  || (installationJobActive(job) && job.status !== 'queued' && !['queued', 'checking_capacity'].includes(job.stage))))

export const installationControlService = service => {
  if (['dumb', 'api_service', 'frontend'].includes(service?.config_key)) return true
  const name = String(service?.process_name || service?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return ['dumbapi', 'dmbapi', 'dumbfrontend', 'dmbfrontend'].includes(name)
}

export const installationServiceStatus = (job, snapshot, service) => {
  if (!installationServicesHeld(job) || installationControlService(service)) return snapshot
  const name = service?.process_name || service?.name
  const stopped = job.services_stopped === true && Array.isArray(job.stopped_process_names) && job.stopped_process_names.includes(name)
  return { ...snapshot, installation_hold: true, status: stopped ? 'stopped' : 'unknown', healthy: null, health_status: null, health_details: null, restart: null,
    health_reason: stopped ? 'Stopped for the installation operation.' : 'Application status is being reconciled during the installation operation.' }
}
