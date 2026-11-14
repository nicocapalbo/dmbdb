import { backupCompressionFields, backupCompressionMode, backupCompressionValid } from './installationBackupCompression.js'
import { backupPreviewActive, backupPreviewEnvelope, backupPreviewStatusSupported } from './installationBackupProgress.js'
import { backupError, installationBackupCancelReady, installationBackupDirectReady, installationBackupSupported, installationBlocked, installationJob, installationPreviewReady, installationRollbackReady } from './installationBackups.js'

export const initialInstallationBackupState = () => ({ capabilities: null, resolved: false, confirmed: false, busy: false, operation: null, loading: false, error: '', status: null, job: null, artifacts: [], catalogError: '', backupPreview: null, restorePreview: null, reviewGeneration: 0, previewOperation: null, previewControllerSession: null, previewUncertain: false, previewStatusError: '', previewSubmittedAt: null, previewRequestPending: false, previewRequestGeneration: null, backupPreviewSequence: 0, previewRequestedCompression: null, previewIgnoredId: null, previewNotifiedKey: null, previewCancelPending: false, operationStartedAt: null, startUncertain: false, startAttempt: null, cancelPending: false, cancelUncertain: false, identityGeneration: 0 })

export const createInstallationBackupController = ({ state, repository, notify = () => {} }) => {
  let refreshing = null
  let catalogGeneration = 0
  let polling = false
  let statusPolling = false
  const update = changes => { state.value = { ...state.value, ...changes } }
  const observeRead = () => ({ identity: state.value.identityGeneration, job: state.value.job, status: state.value.status,
    attempt: state.value.startAttempt?.attempt_id, proof: state.value.startAttempt?.confirmed_job_id })
  const readIsCurrent = observed => observed.identity === state.value.identityGeneration && observed.job === state.value.job
    && observed.status === state.value.status && observed.attempt === state.value.startAttempt?.attempt_id
    && observed.proof === state.value.startAttempt?.confirmed_job_id
  const previewContextRetired = () => Boolean(state.value.startAttempt?.confirmed_job_id)
    && (state.value.backupPreviewSequence || 0) === state.value.startAttempt.preview_sequence
  const previewPredatesJob = operation => {
    const job = state.value.status?.job || state.value.job
    return Boolean(job) && Number.isFinite(job.created_at) && Number.isFinite(operation?.started_at) && operation.started_at < job.created_at
  }
  const invalidate = () => {
    update({ reviewGeneration: state.value.reviewGeneration + 1, backupPreview: null, restorePreview: null,
      previewIgnoredId: state.value.previewOperation?.preview_id || state.value.previewIgnoredId,
      previewOperation: backupPreviewActive(state.value.previewOperation) ? state.value.previewOperation : null })
  }
  const previewBusy = () => backupPreviewActive(state.value.previewOperation) || state.value.previewUncertain
    || (!state.value.previewOperation && state.value.previewRequestPending)
  const settlePreviewBusy = () => {
    if (state.value.operation && state.value.operation !== 'preview_backup') return
    const busy = previewBusy()
    update({ busy, operation: busy ? 'preview_backup' : null })
  }
  const notifyPreview = operation => {
    if (backupPreviewActive(operation)) return
    if (operation.status === 'completed' && operation.result) {
      const codec = backupCompressionMode(operation.result.compression)
      if (!backupCompressionValid(state.value.capabilities, codec) || (operation.compression !== undefined && backupCompressionMode(operation.compression) !== codec) || (state.value.previewRequestGeneration === state.value.reviewGeneration && state.value.previewRequestedCompression !== null && codec !== state.value.previewRequestedCompression)) return
    }
    const key = state.value.previewControllerSession + ':' + operation.preview_id + ':' + operation.status
    if (key === state.value.previewNotifiedKey) return
    update({ previewNotifiedKey: key })
    if (operation.status === 'completed' && operation.result) notify({ type: operation.result.ready === true ? 'success' : 'warning', title: operation.result.ready === true ? 'Backup preview complete' : 'Backup preview needs attention', message: 'Review the scope and space estimate before starting a backup. No backup has started.' })
    else if (operation.status === 'cancelled') notify({ type: 'warning', title: 'Backup preview cancelled', message: 'The preview scan stopped and its temporary inventory was cleaned up. No backup was started.' })
    else if (operation.status === 'failed') notify({ type: 'error', title: 'Backup preview failed', message: backupError({ message: operation.message }) })
  }
  const applyPreviewStatus = payload => {
    if (previewContextRetired()) return
    const response = backupPreviewEnvelope(payload)
    if (previewPredatesJob(response.preview)) {
      update({ previewControllerSession: response.controller_session, previewIgnoredId: response.preview.preview_id })
      return
    }
    const previous = state.value.previewOperation
    const realOperation = ['start_backup', 'start_restore'].includes(state.value.operation) || state.value.startUncertain
      || ['queued', 'running', 'recovery_required'].includes(state.value.job?.status)
      || ['queued', 'running', 'recovery_required'].includes(state.value.status?.job?.status) || Boolean(state.value.status?.preparation)
    if (realOperation) {
      update({ previewControllerSession: response.controller_session, previewOperation: null, backupPreview: null })
      return
    }
    const changedSession = state.value.previewControllerSession && response.controller_session !== state.value.previewControllerSession
    if (changedSession) {
      update({ reviewGeneration: state.value.reviewGeneration + 1, backupPreview: null, restorePreview: null, previewOperation: null,
        previewRequestPending: false, previewUncertain: false, previewStatusError: '', previewIgnoredId: null,
        ...(state.value.operation === 'preview_backup' ? { busy: false, operation: null } : {}) })
    }
    update({ previewControllerSession: response.controller_session })
    let operation = response.preview
    if (!operation) {
      if (changedSession) update({ error: 'The previous preview was interrupted when DUMB restarted. No preview review was retained; generate a fresh preview before continuing.' })
      else if (previous && !backupPreviewActive(previous)) update({ previewOperation: null, backupPreview: null, previewUncertain: false, previewStatusError: '', error: 'The retained preview expired or is no longer available. Generate a fresh preview before continuing.' })
      else if (previous || (state.value.previewUncertain && !state.value.previewRequestPending)) update({ previewUncertain: true, previewStatusError: 'The previous preview could not be confirmed. DUMB may still be inspecting state; refresh preview status before retrying.' })
      settlePreviewBusy()
      return
    }
    if (!previous && state.value.previewRequestPending && operation.preview_id === state.value.previewIgnoredId) return
    const reviewSuppressed = operation.preview_id === state.value.previewIgnoredId
      || (state.value.previewRequestPending && state.value.previewRequestGeneration !== state.value.reviewGeneration)
    if (previous?.preview_id === operation.preview_id) {
      if (!changedSession && Number.isFinite(previous.updated_at) && Number.isFinite(operation.updated_at) && operation.updated_at < previous.updated_at) return
      if (!backupPreviewActive(previous) && backupPreviewActive(operation)) return
      if (previous.cancel_requested && backupPreviewActive(operation)) operation = { ...operation, status: 'cancelling', cancel_requested: true }
    } else if (previous && !changedSession) {
      update({ reviewGeneration: state.value.reviewGeneration + 1, backupPreview: null, previewRequestPending: false })
    }
    update({ previewOperation: operation, previewUncertain: false, previewStatusError: '', confirmed: state.value.status != null })
    if (!installationJob(state.value.job) || !['queued', 'running', 'recovery_required'].includes(state.value.job.status)) {
      const codec = backupCompressionMode(operation.result?.compression)
      const requestedCodecMatches = state.value.previewRequestGeneration !== state.value.reviewGeneration || state.value.previewRequestedCompression === null || codec === state.value.previewRequestedCompression
      const compressionConfirmed = requestedCodecMatches && backupCompressionValid(state.value.capabilities, codec) && (operation.compression === undefined || codec === backupCompressionMode(operation.compression))
      const usable = compressionConfirmed && !reviewSuppressed && operation.status === 'completed' && operation.result?.protocol === 1 && Number.isFinite(operation.expires_at) && operation.expires_at * 1000 > Date.now()
      update({ backupPreview: usable ? operation.result : null })
      if (operation.status === 'failed') update({ error: backupError({ message: operation.message }) })
      else if (operation.status === 'completed' && operation.result && !compressionConfirmed) update({ error: 'DUMB did not confirm a supported archive format for this preview. Refresh support and generate a fresh preview.' })
      else if (operation.status === 'completed' && !usable) update({ error: reviewSuppressed ? 'The preview finished for a previous selection. Generate a fresh preview for the current selection.' : 'This preview has expired or its review was already consumed. Generate a fresh preview before continuing.' })
      else update({ error: '' })
    } else update({ backupPreview: null })
    settlePreviewBusy()
    if (!reviewSuppressed && !['queued', 'running', 'recovery_required'].includes(state.value.job?.status)) notifyPreview(operation)
  }
  let previewPolling = false
  const pollPreview = async () => {
    if (previewPolling || previewContextRetired() || !backupPreviewStatusSupported(state.value.capabilities)) return
    previewPolling = true
    const expectedId = state.value.previewOperation?.preview_id
    const expectedSession = state.value.previewControllerSession
    const expectedStatus = state.value.previewOperation?.status
    const identity = state.value.identityGeneration
    try {
      let response
      try { response = await repository.previewStatus(expectedId) }
      catch (error) {
        if (Number(error?.response?.status) !== 409 || !expectedId) throw error
        response = await repository.previewStatus()
      }
      if (identity !== state.value.identityGeneration || previewContextRetired()) return
      if (expectedSession !== state.value.previewControllerSession && response?.controller_session !== state.value.previewControllerSession) return
      const currentId = state.value.previewOperation?.preview_id
      if (currentId && currentId !== expectedId && response?.preview?.preview_id !== currentId) return
      applyPreviewStatus(response)
    } catch (error) {
      if (identity !== state.value.identityGeneration || previewContextRetired() || ['start_backup', 'start_restore'].includes(state.value.operation) || state.value.startUncertain || ['queued', 'running', 'recovery_required'].includes(state.value.job?.status) || Boolean(state.value.status?.preparation)) return
      if (state.value.previewOperation && state.value.previewOperation.preview_id === expectedId && !backupPreviewActive(state.value.previewOperation) && state.value.previewOperation.status !== expectedStatus) return
      update({ previewUncertain: true, confirmed: false, previewStatusError: backupError(error) + ' Preview status is unconfirmed. DUMB may still be scanning; reconnect or refresh status before starting another operation.' })
      settlePreviewBusy()
    } finally { previewPolling = false }
  }
  const cancelPreview = async () => {
    const operation = state.value.previewOperation
    if (!backupPreviewStatusSupported(state.value.capabilities) || !backupPreviewActive(operation) || operation.cancel_requested || state.value.previewCancelPending) return false
    const identity = state.value.identityGeneration
    const reviewGeneration = state.value.reviewGeneration
    update({ previewCancelPending: true })
    try { const response = await repository.cancelPreview(operation.preview_id); if (identity !== state.value.identityGeneration || (state.value.previewOperation?.preview_id !== operation.preview_id && reviewGeneration !== state.value.reviewGeneration)) return false; applyPreviewStatus(response); return true }
    catch (error) { if (identity !== state.value.identityGeneration) return false; update({ previewUncertain: true, previewStatusError: backupError(error) + ' The cancellation could not be confirmed. Keep monitoring preview status; do not repeat the preview.' }); return false }
    finally { if (identity === state.value.identityGeneration) { update({ previewCancelPending: false }); settlePreviewBusy() } }
  }
  const protocol = result => { if (result?.protocol !== 1) throw new Error('Unsupported installation backup response. Refresh backend capabilities before retrying.'); return result }
  const reconcileJob = job => {
    const previous = state.value.job
    if (previous?.job_id !== job?.job_id) return job
    if (Number.isFinite(previous.updated_at) && Number.isFinite(job.updated_at) && job.updated_at < previous.updated_at) return previous
    if (previous.status === 'cancelled' && ['queued', 'running'].includes(job.status)) return previous
    return previous.cancel_requested === true && ['queued', 'running'].includes(job.status) ? { ...job, cancel_requested: true, can_cancel: false } : job
  }
  const requestIdentity = () => {
    const bytes = new Uint8Array(16)
    if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('This browser cannot create a backup request identity. Use a supported browser before starting.')
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  }
  const pendingStart = () => state.value.startAttempt && !state.value.startAttempt.confirmed_job_id
    && (state.value.startUncertain || ['start_backup', 'start_restore'].includes(state.value.operation))
  const matchesStart = (job, attempt, authoritative = false) => {
    if (!attempt || !job || job.job_type !== (attempt.mode === 'restore' ? 'installation_restore' : 'installation_backup')) return false
    if (attempt.direct) return job.request_id === attempt.request_id
    return authoritative || (job.job_id !== attempt.prior_job_id && Number.isFinite(job.created_at) && job.created_at >= attempt.submitted_at - 5)
  }
  const confirmStart = (job, attempt) => {
    if (attempt && state.value.startAttempt?.attempt_id === attempt.attempt_id) update({ startAttempt: { ...state.value.startAttempt, confirmed_job_id: job.job_id }, busy: false, operation: null })
  }
  const applyJob = (response, attempt = null, { mirrorStatus = true } = {}) => {
    const job = installationJob(protocol(response).job)
    if (!job) throw new Error('The backend did not confirm a valid backup job. Refresh status before retrying.')
    const pending = pendingStart() ? state.value.startAttempt : null
    if ((attempt && !matchesStart(job, attempt, true)) || (pending && !matchesStart(job, pending, Boolean(attempt)))) throw new Error('The returned job did not match the submitted installation request. Refresh status before retrying.')
    const reconciled = reconcileJob(job)
    confirmStart(reconciled, attempt || pending)
    update({ job: reconciled, ...(mirrorStatus ? { status: { ...state.value.status, protocol: response.protocol, job: reconciled } } : {}), startUncertain: false, cancelUncertain: false }); return reconciled
  }
  const applyStatus = (status, expectedJobId) => {
    if (!Object.hasOwn(status, 'job') || (status.job && !installationJob(status.job))) throw new Error('The backend returned an unknown job state. Keep recovery evidence and refresh status.')
    if (state.value.job?.job_id !== expectedJobId && status.job?.job_id !== state.value.job?.job_id) return false
    const attempt = pendingStart() ? state.value.startAttempt : null
    if (attempt && !matchesStart(status.job, attempt)) {
      update({ status, confirmed: false })
      return false
    }
    if (!status.job && ['queued', 'running', 'recovery_required'].includes(state.value.job?.status)) throw new Error('The previously recorded job could not be confirmed. Keep recovery evidence and refresh status.')
    const job = status.job ? reconcileJob(installationJob(status.job)) : null
    if (attempt) confirmStart(job, attempt)
    const confirmed = !state.value.startUncertain || Boolean(attempt && job)
    update({ status: { ...status, job }, job, confirmed, ...(confirmed ? { error: '' } : {}),
      ...(attempt && job ? { startUncertain: false, cancelUncertain: false } : {}) })
    return confirmed
  }
  const pollStatus = async () => {
    if (statusPolling || !installationBackupSupported(state.value.capabilities)) return
    statusPolling = true
    const observed = observeRead()
    const expectedJobId = state.value.job?.job_id
    try {
      const status = protocol(await repository.status())
      if (!readIsCurrent(observed)) return
      applyStatus(status, expectedJobId)
    } catch (error) {
      if (readIsCurrent(observed)) update({ confirmed: false, error: backupError(error) + ' The submitted operation is not confirmed; keep monitoring backup status before retrying.' })
    } finally { statusPolling = false }
  }
  const refresh = () => {
    if (refreshing) return refreshing
    if (state.value.busy && state.value.operation !== 'preview_backup') return Promise.resolve()
    const identity = state.value.identityGeneration
    const observed = observeRead()
    const expectedJobId = state.value.job?.job_id
    refreshing = (async () => {
      update({ loading: true, ...(state.value.startUncertain ? {} : { error: '' }) })
      try {
        const capabilities = await repository.capabilities()
        if (!readIsCurrent(observed)) return
        update({ capabilities, resolved: true })
        if (!installationBackupSupported(capabilities)) { update({ confirmed: false, status: null, job: null }); invalidate(); return }
        const status = protocol(await repository.status())
        if (!readIsCurrent(observed)) return
        applyStatus(status, expectedJobId)
        if (backupPreviewStatusSupported(capabilities)) await pollPreview()
      } catch (error) { if (readIsCurrent(observed)) { update({ resolved: true, confirmed: false, error: backupError(error) }); invalidate() } }
      finally { if (identity === state.value.identityGeneration) update({ loading: false }); refreshing = null }
    })()
    return refreshing
  }
  const catalog = async destination => {
    const current = ++catalogGeneration
    const identity = state.value.identityGeneration
    update({ artifacts: [], catalogError: '' })
    if (!installationBackupSupported(state.value.capabilities) || !destination) return
    try {
      const result = protocol(await repository.catalog(destination))
      if (identity !== state.value.identityGeneration || current !== catalogGeneration || !installationBackupSupported(state.value.capabilities)) return
      if (!Array.isArray(result.artifacts)) throw new Error('The backend did not confirm an archive catalog.')
      update({ artifacts: result.artifacts.filter(item => item?.artifact_kind === 'installation_backup' && typeof item.reference === 'string' && item.reference.startsWith('dumb-backup://')) })
    } catch (error) { if (identity === state.value.identityGeneration && current === catalogGeneration) update({ catalogError: backupError(error) }) }
  }
  const preview = async (mode, payload) => {
    if (installationBlocked(state.value)) return false
    const validDestination = value => typeof value === 'string' && (value === '@default' || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    const validReference = typeof payload?.reference === 'string' && payload.reference.startsWith('dumb-backup://') && !payload.archive_path
    const validPath = typeof payload?.archive_path === 'string' && payload.archive_path.startsWith('/') && !payload.archive_path.startsWith('//') && !/[\x00-\x1f\x7f]/.test(payload.archive_path) && !payload.reference
    if ((mode === 'backup' && !validDestination(payload?.destination_id)) || (mode === 'restore' && !validReference && !validPath) || !['backup', 'restore'].includes(mode)) { update({ error: 'Choose an explicit backup destination or one existing archive reference/container path before previewing.' }); return false }
    let request = payload
    if (mode === 'backup') {
      try { request = { destination_id: payload.destination_id, ...backupCompressionFields(state.value.capabilities, payload.compression) } }
      catch (error) { update({ error: backupError(error) }); return false }
    }
    if (mode === 'backup') update({ backupPreviewSequence: (state.value.backupPreviewSequence || 0) + 1 })
    invalidate()
    const current = state.value.reviewGeneration
    const identity = state.value.identityGeneration
    const tracked = mode === 'backup' && backupPreviewStatusSupported(state.value.capabilities)
    update({ busy: true, operation: mode === 'restore' ? 'verify_restore' : 'preview_backup', operationStartedAt: Date.now() / 1000, previewSubmittedAt: Date.now() / 1000, previewRequestGeneration: current, previewRequestedCompression: mode === 'backup' ? backupCompressionMode(request.compression) : null, previewRequestPending: tracked, previewUncertain: false, previewStatusError: '', error: '' })
    try {
      const result = protocol(await (mode === 'backup' ? repository.preview(request) : repository.restorePreview(payload)))
      if (current !== state.value.reviewGeneration || (mode === 'backup' && previewContextRetired())) return false
      if (mode === 'backup' && backupCompressionMode(result.compression) !== backupCompressionMode(request.compression)) throw new Error('DUMB did not confirm the selected archive format. Generate a fresh preview before continuing.')
      update({ [mode === 'backup' ? 'backupPreview' : 'restorePreview']: result })
      if (tracked) await pollPreview()
      else if (mode === 'backup') notify({ type: result.ready === true ? 'success' : 'warning', title: result.ready === true ? 'Backup preview complete' : 'Backup preview needs attention', message: 'Review the scope and disk estimate before starting a backup. No backup has started.' })
      return true
    } catch (error) {
      if (current !== state.value.reviewGeneration || (mode === 'backup' && previewContextRetired())) return false
      if (tracked) {
        const observed = state.value.previewOperation
        if (observed && !backupPreviewActive(observed) && !state.value.previewUncertain && observed.preview_id !== state.value.previewIgnoredId && observed.destination_id === payload.destination_id) return false
        update({ previewUncertain: true, confirmed: false, previewStatusError: backupError(error) + ' The preview may still be running. Reconnecting to its status; do not repeat the request.' })
        await pollPreview()
      } else update({ error: backupError(error) })
      return false
    } finally {
      if (identity !== state.value.identityGeneration) return
      if (current === state.value.reviewGeneration) {
        update({ previewRequestPending: false })
        if (tracked) settlePreviewBusy()
        else update({ busy: false, operation: null })
      } else if (state.value.previewRequestGeneration === current && state.value.operation === 'preview_backup' && !backupPreviewActive(state.value.previewOperation) && !state.value.previewUncertain) update({ previewRequestPending: false, busy: false, operation: null })
    }
  }
  const submitStart = async (mode, request, direct = false) => {
    const identity = state.value.identityGeneration
    let identifier
    try { identifier = direct ? request.request_id : requestIdentity() }
    catch (error) { update({ error: backupError(error) }); return false }
    const attempt = { attempt_id: identifier, request_id: direct ? identifier : null, direct, mode, submitted_at: Date.now() / 1000,
      prior_job_id: state.value.job?.job_id || state.value.status?.job?.job_id || null, confirmed_job_id: null, preview_sequence: state.value.backupPreviewSequence || 0 }
    invalidate()
    update({ busy: true, operation: mode === 'backup' ? 'start_backup' : 'start_restore', operationStartedAt: attempt.submitted_at, startAttempt: attempt, startUncertain: false,
      previewIgnoredId: state.value.previewOperation?.preview_id || state.value.previewIgnoredId, previewOperation: null, previewRequestPending: false, error: '' })
    try {
      const response = await (direct ? repository.startDirect : mode === 'backup' ? repository.start : repository.restoreStart)(request)
      if (identity !== state.value.identityGeneration || state.value.startAttempt?.attempt_id !== identifier) return false
      applyJob(response, attempt)
      invalidate(); return true
    } catch (error) {
      if (identity !== state.value.identityGeneration || state.value.startAttempt?.attempt_id !== identifier) return false
      if (state.value.startAttempt?.confirmed_job_id === state.value.job?.job_id && state.value.startAttempt?.confirmed_job_id) {
        // A matching durable job observed through polling settles an older lost POST response.
        invalidate(); update({ startUncertain: false, ...(state.value.confirmed ? { error: '' } : {}) }); return true
      }
      invalidate()
      const status = Number(error?.response?.status)
      const uncertain = !Number.isInteger(status) || status >= 500 || status === 408
      update({ confirmed: false, startUncertain: uncertain, ...(uncertain ? {} : { startAttempt: null }),
        error: backupError(error) + (uncertain ? ' The request may have reached DUMB. Reconnect through direct frontend/API access and refresh backup status before retrying; do not submit another operation until its job is confirmed.' : '') })
      return false
    } finally {
      if (identity === state.value.identityGeneration && state.value.startAttempt?.attempt_id === identifier) update({ busy: false, operation: null })
      else if (identity === state.value.identityGeneration && !state.value.startAttempt) update({ busy: false, operation: null })
    }
  }
  const start = async (mode, confirmation, acknowledgements) => {
    const selected = state.value[mode === 'backup' ? 'backupPreview' : 'restorePreview']
    if (!installationPreviewReady({ state: state.value, preview: selected, mode, confirmation, acknowledgements })) return false
    return submitStart(mode, { preview_token: selected.preview_token, confirmation, acknowledgements })
  }
  const startDirect = async ({ destination_id, compression = 'none', confirmation, acknowledgements }) => {
    if (!installationBackupDirectReady({ state: state.value, destination: destination_id, compression, confirmation, acknowledgements })) return false
    let request_id
    try { request_id = requestIdentity() }
    catch (error) { update({ error: backupError(error) }); return false }
    return submitStart('backup', { request_id, destination_id, compression, confirmation, acknowledgements: Object.fromEntries(['downtime', 'secrets', 'external_state'].map(key => [key, true])) }, true)
  }
  const poll = async () => {
    if (polling || !state.value.job?.job_id || state.value.busy || !installationBackupSupported(state.value.capabilities)) return
    polling = true
    const observed = observeRead()
    const id = state.value.job.job_id
    try { const result = await repository.job(id); if (readIsCurrent(observed)) { applyJob(result); update({ confirmed: true, error: '' }) } }
    catch (error) { if (readIsCurrent(observed)) update({ confirmed: false, error: backupError(error) }) }
    finally { polling = false }
  }
  const cancel = async () => {
    if (!installationBackupCancelReady(state.value)) return false
    const identity = state.value.identityGeneration
    const identifier = state.value.job.job_id
    update({ cancelPending: true, cancelUncertain: false, error: '' })
    try {
      const response = protocol(await repository.cancel(identifier))
      if (identity !== state.value.identityGeneration || state.value.job?.job_id !== identifier) return false
      if (response.job?.job_id !== identifier) throw new Error('The backup cancellation response did not match the selected job.')
      const job = applyJob(response)
      if (['queued', 'running'].includes(job.status) && job.cancel_requested !== true) throw new Error('DUMB did not confirm the cancellation request.')
      notify({ type: 'warning', title: 'Backup cancellation requested', message: 'Wait while DUMB stops archive work, removes its unpublished partial archive and resumes applications. Keep the container and host running.' })
      return true
    } catch (error) {
      if (identity === state.value.identityGeneration && state.value.job?.job_id === identifier) {
        const observed = state.value.job
        if (state.value.confirmed && (observed.cancel_requested === true || !['queued', 'running'].includes(observed.status))) {
          // A newer poll is authoritative even if this older POST later loses its response.
          update({ cancelUncertain: false })
          return observed.cancel_requested === true || observed.status === 'cancelled'
        }
        update({ cancelUncertain: true, confirmed: false, error: backupError(error) + ' Cancellation is unconfirmed; the backup may still be running. Keep monitoring this job before retrying.' })
      }
      return false
    } finally { if (identity === state.value.identityGeneration) update({ cancelPending: false }) }
  }
  const saveSchedule = async schedule => {
    if (installationBlocked(state.value)) return false
    if (typeof schedule?.enabled !== 'boolean' || !Number.isInteger(schedule.interval_hours) || schedule.interval_hours < 1 || schedule.interval_hours > 8760 || !Number.isInteger(schedule.keep_last) || schedule.keep_last < 1 || schedule.keep_last > 100 || typeof schedule.destination_id !== 'string' || (schedule.enabled && !schedule.destination_id)) { update({ error: 'Review the explicit schedule destination, interval (1–8760 hours) and retention (1–100).' }); return false }
    let request
    try {
      const { compression, ...fields } = schedule
      request = { ...fields, ...(Object.hasOwn(schedule, 'compression') ? backupCompressionFields(state.value.capabilities, compression) : {}) }
    } catch (error) { update({ error: backupError(error) }); return false }
    update({ busy: true, error: '' })
    try {
      const result = protocol(await repository.saveSchedule(request))
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
    const observed = observeRead()
    try { const response = await repository.job(id); if (!readIsCurrent(observed)) return false; applyJob(response, null, { mirrorStatus: false }); return true }
    catch (error) { if (readIsCurrent(observed)) update({ error: backupError(error) }); return false }
  }
  return { refresh, pollStatus, catalog, invalidate, preview, pollPreview, cancelPreview, start, startDirect, poll, cancel, saveSchedule, rollback, loadJob }
}
