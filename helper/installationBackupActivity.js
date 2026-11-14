import { backupError, installationBackupSupported, installationJob, installationJobActive, installationJobDisplay, installationRestartRequired, installationVerifiedArchive, installationArchivePublicationUncertain } from './installationBackups.js'
import { backupPreviewDuration } from './installationBackupProgress.js'

export const initialInstallationBackupActivity = () => ({ capabilities: null, resolved: false, job: null, preparation: null, recoveryJob: null, error: '', loading: false, confirmed: false, notifiedKey: null, authorizationRejected: false })
export const installationBackupActivityView = (state, now = Date.now()) => {
  const job = state.job
  const displayJob = job || state.recoveryJob
  const active = installationJobActive(job)
  const archive = installationVerifiedArchive(displayJob)
  const publicationUncertain = installationArchivePublicationUncertain(displayJob)
  const preparing = Boolean(state.preparation) && !installationJobActive(job)
  const recovery = job?.status === 'recovery_required' || state.recoveryJob?.status === 'recovery_required'
  const restart = !recovery && ['completed', 'rolled_back'].includes(displayJob?.status) && installationRestartRequired(displayJob)
  const uncertain = Boolean(state.error) && (active || preparing)
  const started = preparing ? state.preparation.started_at : displayJob?.started_at || displayJob?.created_at
  const elapsed = Number.isFinite(started) && started > 0 ? backupPreviewDuration(Math.max(0, now / 1000 - started)) : null
  let title
  if (uncertain) title = archive ? 'Backup saved; service status unavailable' : job?.job_type === 'installation_restore' ? 'Restore status unavailable — restore may still be running' : 'Backup status unavailable — backup may still be running'
  else if (preparing) title = 'Preparing installation backup'
  else if (archive) title = recovery ? 'Backup saved; service recovery required' : restart ? 'Backup saved; restart required' : 'Backup saved; resuming services'
  else if (publicationUncertain) title = 'Archive publication unconfirmed; recovery requires attention'
  else if (active) title = job.job_type === 'installation_restore' ? (job.status === 'queued' ? 'Installation restore queued' : 'Installation restore running') : job.cancel_requested ? 'Cancelling installation backup' : job.status === 'queued' ? 'Installation backup queued' : 'Installation backup running'
  else title = recovery ? 'Installation recovery requires attention' : displayJob?.job_type === 'installation_backup' ? 'Backup recovery complete; restart required' : 'Installation restore completed; restart required'
  return { visible: preparing || active || recovery || restart, preparing, active, recovery, restart, uncertain, elapsed, archive, publicationUncertain, displayJob, displayMessage: installationJobDisplay(displayJob).message, progress: installationBackupJobProgress(displayJob, state.capabilities), title }
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
    const archive = installationVerifiedArchive(job)
    if (archive && job.status !== 'completed') notify({ type: 'warning', title: 'Backup saved; service recovery requires attention', message: 'The archive was verified and saved. Keep it at the registered destination; service recovery does not require creating the backup again.' })
    else if (installationArchivePublicationUncertain(job)) notify({ type: 'warning', title: 'Archive publication unconfirmed', message: 'Inspect the backup catalog and retained recovery details before deciding whether another backup is needed.' })
    else if (job.status === 'completed' && archive) notify({ type: 'success', title: 'Installation backup complete', message: 'The archive was verified and saved, and DUMB finished service resumption. Review the saved receipt in Backup and restore.' })
    else if (job.status === 'completed') notify({ type: 'warning', title: 'Backup job finished; archive receipt unavailable', message: 'DUMB reports the job finished, but no verified saved receipt is available. Inspect the backup catalog before deciding whether another backup is needed.' })
    else if (job.status === 'cancelled') notify({ type: 'warning', title: 'Installation backup cancelled', message: 'DUMB stopped the backup and resumed the retained applications. No archive was restored.' })
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

export const installationBackupJobProgress = (job, capabilities) => {
  const progress = job?.progress
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null
  const number = key => Number.isSafeInteger(progress[key]) && progress[key] >= 0 ? progress[key] : null
  const values = { entries: number('entries'), logical_bytes: number('logical_bytes'), bytes_processed: number('bytes_processed') }
  if (Object.values(values).every(value => value === null)) return null
  const phase = job.stage === 'inventorying' ? 'inventory' : job.stage === 'verifying' ? 'verification' : job.stage === 'checking_source' ? 'source' : job.stage === 'archiving' ? 'archive' : null
  const basis = progress.percent_basis === 'entries' ? 'entries' : progress.percent_basis === 'bytes' ? 'bytes' : null
  const total = basis === 'entries' ? number('total_entries') : basis === 'bytes' ? number('total_bytes') ?? number('total_logical_bytes') : null
  const measured = capabilities?.installation_backup_phase_progress === true && progress.percent_scope === 'phase' && ['inventorying', 'archiving', 'checking_source', 'verifying'].includes(job?.stage) && progress.stage === job.stage && typeof progress.percent === 'number' && Number.isFinite(progress.percent) && progress.percent >= 0 && progress.percent <= 100 && total !== null && total > 0
  return { ...values, percent: measured ? progress.percent : null, percent_basis: measured ? basis : null, total_entries: number('total_entries'), total_logical_bytes: number('total_logical_bytes'), total_bytes: number('total_bytes'), entries_label: phase === 'inventory' ? 'Entries inspected' : phase === 'verification' ? 'Entries checked' : phase === 'source' ? 'Entries rechecked' : phase === 'archive' ? 'Entries archived' : 'Entries processed',
    logical_label: phase === 'inventory' ? 'Logical size inspected' : phase === 'verification' ? 'Logical size checked' : phase === 'source' ? 'Source logical size rechecked' : phase === 'archive' ? 'Logical size archived' : 'Logical size processed',
    bytes_label: phase === 'source' ? 'Source file data hashed' : phase === 'verification' ? 'Archive stream read' : phase === 'archive' ? 'Archive stream written' : 'Bytes processed' }
}
