import { backupError, installationBackupSupported, installationJob, installationJobActive, installationJobDisplay, installationRestartRequired } from './installationBackups.js'
import { backupPreviewDuration } from './installationBackupProgress.js'

export const initialInstallationBackupActivity = () => ({ capabilities: null, resolved: false, job: null, preparation: null, recoveryJob: null, error: '', loading: false, confirmed: false, notifiedKey: null, authorizationRejected: false })
export const installationBackupActivityView = (state, now = Date.now()) => {
  const job = state.job
  const displayJob = job || state.recoveryJob
  const active = job?.job_type === 'installation_backup' && installationJobActive(job)
  const preparing = Boolean(state.preparation) && !installationJobActive(job)
  const recovery = job?.status === 'recovery_required' || state.recoveryJob?.status === 'recovery_required'
  const restart = !recovery && ['completed', 'rolled_back'].includes(displayJob?.status) && installationRestartRequired(displayJob)
  const uncertain = Boolean(state.error) && (active || preparing)
  const started = preparing ? state.preparation.started_at : displayJob?.started_at || displayJob?.created_at
  const elapsed = Number.isFinite(started) && started > 0 ? backupPreviewDuration(Math.max(0, now / 1000 - started)) : null
  return { visible: preparing || active || recovery || restart, preparing, active, recovery, restart, uncertain, elapsed, displayJob, displayMessage: installationJobDisplay(displayJob).message, progress: installationBackupJobProgress(displayJob),
    title: uncertain ? 'Backup status unavailable — backup may still be running' : preparing ? 'Preparing installation backup' : active ? (job.status === 'queued' ? 'Installation backup queued' : 'Installation backup running') : recovery ? 'Installation recovery requires attention' : displayJob?.job_type === 'installation_backup' ? 'Backup recovery complete; restart required' : 'Installation restore completed; restart required' }
}
export const createInstallationBackupActivity = ({ state, repository, notify = () => {} }) => {
  let generation = 0
  const update = patch => { state.value = { ...state.value, ...patch } }
  const protocol = payload => { if (payload?.protocol !== 1) throw new Error('DUMB did not confirm backup activity status.'); return payload }
  const reset = () => { generation++; update(initialInstallationBackupActivity()) }
  const notifyTerminal = job => {
    const key = job.job_id + ':' + job.status
    if (key === state.value.notifiedKey) return
    update({ notifiedKey: key })
    if (job.status === 'completed') notify({ type: 'success', title: 'Installation backup complete', message: 'DUMB finished the backup job. Review its verified archive details in Backup and restore.' })
    else notify({ type: 'error', title: job.status === 'recovery_required' ? 'Installation recovery requires attention' : 'Installation backup failed', message: 'Review the retained job and recovery details in Backup and restore before continuing.' })
  }
  const refresh = async () => {
    if (state.value.loading || state.value.authorizationRejected) return
    const current = generation
    update({ loading: true })
    try {
      const capabilities = state.value.resolved ? state.value.capabilities : await repository.capabilities()
      if (current !== generation) return
      update({ capabilities, resolved: true })
      if (!installationBackupSupported(capabilities)) { update({ job: null, preparation: null, error: '', confirmed: true }); return }
      const response = protocol(await repository.status())
      if (current !== generation) return
      if (!Object.hasOwn(response, 'job')) throw new Error('DUMB did not confirm the current installation job.')
      const preparation = response.preparation ?? null
      if (preparation && (preparation.stage !== 'checking_capacity' || !Number.isFinite(preparation.started_at) || preparation.started_at <= 0)) throw new Error('DUMB returned an unknown backup preparation state. Keep the last known state and retry status.')
      const previous = state.value.job
      let job = response.job ? installationJob(response.job) : null
      if (response.job && !job) throw new Error('DUMB returned an unknown backup job state. Keep the last known job and review Backup and restore.')
      let terminal = null, recoveryJob = state.value.recoveryJob
      if (installationJobActive(previous) && previous.job_id !== job?.job_id) {
        const exact = installationJob(protocol(await repository.job(previous.job_id)).job)
        if (current !== generation) return
        if (!exact || exact.job_id !== previous.job_id || installationJobActive(exact)) throw new Error('The previous backup has not been confirmed finished. Keep the container and host running and retry status.')
        terminal = exact
        if (!job || (!installationJobActive(job) && (exact.status === 'recovery_required' || installationRestartRequired(exact)))) job = exact
        if (exact.status === 'recovery_required' || installationRestartRequired(exact)) recoveryJob = exact
      } else if (installationJobActive(previous) && job && !installationJobActive(job)) terminal = job
      if (job?.status === 'recovery_required' || installationRestartRequired(job)) recoveryJob = job
      if (recoveryJob && recoveryJob.job_id === job?.job_id && job.status !== 'recovery_required' && !installationRestartRequired(job)) recoveryJob = null
      if (recoveryJob && recoveryJob.job_id !== job?.job_id) {
        const attention = installationJob(protocol(await repository.job(recoveryJob.job_id)).job)
        if (current !== generation) return
        if (!attention || attention.job_id !== recoveryJob.job_id) throw new Error('The retained recovery job could not be confirmed. Preserve its state and retry status.')
        recoveryJob = attention.status === 'recovery_required' || installationRestartRequired(attention) ? attention : null
      }
      update({ job, preparation, recoveryJob, error: '', confirmed: true })
      if (terminal?.job_type === 'installation_backup') notifyTerminal(terminal)
    } catch (error) {
      if (current !== generation) return
      if ([401, 403].includes(Number(error?.response?.status))) { reset(); update({ authorizationRejected: true }); return }
      update({ error: backupError(error), confirmed: false })
    } finally { if (current === generation) update({ loading: false }) }
  }
  return { refresh, reset }
}

export const installationBackupJobProgress = job => {
  const progress = job?.progress
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null
  const number = key => Number.isSafeInteger(progress[key]) && progress[key] >= 0 ? progress[key] : null
  const values = { entries: number('entries'), logical_bytes: number('logical_bytes'), bytes_processed: number('bytes_processed') }
  if (Object.values(values).every(value => value === null)) return null
  const phase = job.stage === 'inventorying' ? 'inventory' : job.stage === 'verifying' ? 'verification' : job.stage === 'checking_source' ? 'source' : job.stage === 'archiving' ? 'archive' : null
  return { ...values, entries_label: phase === 'inventory' ? 'Entries inspected' : phase === 'verification' ? 'Entries checked' : phase === 'source' ? 'Entries rechecked' : phase === 'archive' ? 'Entries archived' : 'Entries processed',
    logical_label: phase === 'inventory' ? 'Logical size inspected' : phase === 'verification' ? 'Logical size checked' : phase === 'source' ? 'Source logical size rechecked' : phase === 'archive' ? 'Logical size archived' : 'Logical size processed',
    bytes_label: phase === 'source' ? 'Source file data hashed' : phase === 'verification' ? 'Archive stream read' : phase === 'archive' ? 'Archive stream written' : 'Bytes processed' }
}
