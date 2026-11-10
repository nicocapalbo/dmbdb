import { backupError, installationBackupSupported, installationBlocked, installationJob, installationPreviewReady, installationRollbackReady } from './installationBackups.js'

export const initialInstallationBackupState = () => ({ capabilities: null, resolved: false, confirmed: false, busy: false, operation: null, loading: false, error: '', status: null, job: null, artifacts: [], catalogError: '', backupPreview: null, restorePreview: null })

export const createInstallationBackupController = ({ state, repository }) => {
  let generation = 0
  let refreshing = null
  let catalogGeneration = 0
  let polling = false
  const update = changes => { state.value = { ...state.value, ...changes } }
  const invalidate = () => { generation++; update({ backupPreview: null, restorePreview: null }) }
  const protocol = result => { if (result?.protocol !== 1) throw new Error('Unsupported installation backup response. Refresh backend capabilities before retrying.'); return result }
  const applyJob = response => {
    const job = installationJob(protocol(response).job)
    if (!job) throw new Error('The backend did not confirm a valid backup job. Refresh status before retrying.')
    update({ job }); return job
  }
  const refresh = () => {
    if (refreshing) return refreshing
    if (state.value.busy) return Promise.resolve()
    refreshing = (async () => {
      update({ loading: true, error: '' })
      try {
        const capabilities = await repository.capabilities()
        update({ capabilities, resolved: true })
        if (!installationBackupSupported(capabilities)) { update({ confirmed: false, status: null, job: null }); invalidate(); return }
        const status = protocol(await repository.status())
        if (status.job && !installationJob(status.job)) throw new Error('The backend returned an unknown job state. Keep recovery evidence and refresh status.')
        if (!status.job && (['queued', 'running', 'recovery_required'].includes(state.value.job?.status))) throw new Error('The previously recorded job could not be confirmed. Keep recovery evidence and refresh status.')
        update({ status, job: status.job || null, confirmed: true })
      } catch (error) { update({ resolved: true, confirmed: false, error: backupError(error) }); invalidate() }
      finally { update({ loading: false }); refreshing = null }
    })()
    return refreshing
  }
  const catalog = async destination => {
    const current = ++catalogGeneration
    update({ artifacts: [], catalogError: '' })
    if (!installationBackupSupported(state.value.capabilities) || !destination) return
    try {
      const result = protocol(await repository.catalog(destination))
      if (current !== catalogGeneration || !installationBackupSupported(state.value.capabilities)) return
      if (!Array.isArray(result.artifacts)) throw new Error('The backend did not confirm an archive catalog.')
      update({ artifacts: result.artifacts.filter(item => item?.artifact_kind === 'installation_backup' && typeof item.reference === 'string' && item.reference.startsWith('dumb-backup://')) })
    } catch (error) { if (current === catalogGeneration) update({ catalogError: backupError(error) }) }
  }
  const preview = async (mode, payload) => {
    if (installationBlocked(state.value)) return false
    const validDestination = value => typeof value === 'string' && (value === '@default' || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    const validReference = typeof payload?.reference === 'string' && payload.reference.startsWith('dumb-backup://') && !payload.archive_path
    const validPath = typeof payload?.archive_path === 'string' && payload.archive_path.startsWith('/') && !payload.archive_path.startsWith('//') && !/[\x00-\x1f\x7f]/.test(payload.archive_path) && !payload.reference
    if ((mode === 'backup' && !validDestination(payload?.destination_id)) || (mode === 'restore' && !validReference && !validPath) || !['backup', 'restore'].includes(mode)) { update({ error: 'Choose an explicit backup destination or one existing archive reference/container path before previewing.' }); return false }
    invalidate(); const current = generation; update({ busy: true, operation: mode === 'restore' ? 'verify_restore' : 'preview_backup', error: '' })
    try {
      const result = protocol(await (mode === 'backup' ? repository.preview(payload) : repository.restorePreview(payload)))
      if (current !== generation) return false
      update({ [mode === 'backup' ? 'backupPreview' : 'restorePreview']: result }); return true
    } catch (error) { update({ error: backupError(error) }); return false }
    finally { update({ busy: false, operation: null }) }
  }
  const start = async (mode, confirmation, acknowledgements) => {
    const selected = state.value[mode === 'backup' ? 'backupPreview' : 'restorePreview']
    if (!installationPreviewReady({ state: state.value, preview: selected, mode, confirmation, acknowledgements })) return false
    update({ busy: true, error: '' })
    try {
      applyJob(await (mode === 'backup' ? repository.start : repository.restoreStart)({ preview_token: selected.preview_token, confirmation, acknowledgements }))
      invalidate(); return true
    } catch (error) {
      invalidate()
      const status = Number(error?.response?.status)
      const uncertain = !Number.isInteger(status) || status >= 500
      update({ confirmed: false, error: backupError(error) + (uncertain ? ' The request may have reached DUMB. Reconnect through direct frontend/API access and refresh backup status before retrying; do not submit another operation until its job is confirmed.' : '') })
      return false
    }
    finally { update({ busy: false }) }
  }
  const poll = async () => {
    if (polling || !state.value.job?.job_id || state.value.busy || !installationBackupSupported(state.value.capabilities)) return
    polling = true
    const id = state.value.job.job_id
    try { const result = await repository.job(id); if (state.value.job?.job_id === id) { applyJob(result); update({ confirmed: true }) } }
    catch (error) { update({ confirmed: false, error: backupError(error) }) }
    finally { polling = false }
  }
  const saveSchedule = async schedule => {
    if (installationBlocked(state.value)) return false
    if (typeof schedule?.enabled !== 'boolean' || !Number.isInteger(schedule.interval_hours) || schedule.interval_hours < 1 || schedule.interval_hours > 8760 || !Number.isInteger(schedule.keep_last) || schedule.keep_last < 1 || schedule.keep_last > 100 || typeof schedule.destination_id !== 'string' || (schedule.enabled && !schedule.destination_id)) { update({ error: 'Review the explicit schedule destination, interval (1–8760 hours) and retention (1–100).' }); return false }
    update({ busy: true, error: '' })
    try {
      const result = protocol(await repository.saveSchedule(schedule))
      if (!result.schedule) throw new Error('The backup schedule was not confirmed.')
      update({ status: { ...state.value.status, schedule: result.schedule } }); return true
    } catch (error) { update({ error: backupError(error) }); return false }
    finally { update({ busy: false }) }
  }
  const rollback = async confirmation => {
    if (!installationRollbackReady(state.value, confirmation)) return false
    update({ busy: true, error: '' })
    try { applyJob(await repository.rollback(state.value.job.job_id, confirmation)); invalidate(); return true }
    catch (error) { update({ confirmed: false, error: backupError(error) }); return false }
    finally { update({ busy: false }) }
  }
  const loadJob = async id => {
    if (!installationBackupSupported(state.value.capabilities) || state.value.busy) return false
    try { applyJob(await repository.job(id)); return true }
    catch (error) { update({ error: backupError(error) }); return false }
  }
  return { refresh, catalog, invalidate, preview, start, poll, saveSchedule, rollback, loadJob }
}
