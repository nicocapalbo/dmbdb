import { infinidyskV2ErrorText, infinidyskV2NeedsAttention, infinidyskV2Support, safeInfiniDyskV2Text as text } from './infinidyskV2.js'

const activeStatuses = new Set(['queued', 'running'])
const statuses = new Set(['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled'])
const taskIdentity = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
export const infinidyskV2ClientError = message => Object.assign(new Error(message), { data: { detail: message } })
export const infinidyskV2AsyncPreviewSupported = capabilities => infinidyskV2Support(capabilities).migration && capabilities?.infinidysk_v2_async_preview === true
export const infinidyskV2PreviewTaskActive = task => Boolean(task && activeStatuses.has(task.status))
export const infinidyskV2PreviewBlocked = state => state.majorPreviewPending || state.majorPreviewUncertain || infinidyskV2PreviewTaskActive(state.majorPreviewTask)

export const infinidyskV2PreviewOptions = value => {
  if (!value || !['fresh', 'migrate'].includes(value.mode) || !['rclone', 'fuse'].includes(value.mount_backend)
    || ![undefined, 'preserve'].includes(value.import_strategy)) return null
  const destination = value.backup_destination_id ?? ''
  if (typeof destination !== 'string' || (destination && destination !== '@default' && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(destination))) return null
  if (['reclaim_source_space', 'offload_legacy_blobs', 'use_default_backup_destination'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) return null
  const defaultDestination = value.use_default_backup_destination === true || destination === '@default'
  if (value.use_default_backup_destination === true && destination && destination !== '@default') return null
  const reclaim = value.reclaim_source_space === true, offload = value.offload_legacy_blobs === true
  if ((offload && !reclaim) || (reclaim && (value.mode !== 'migrate' || !(destination || defaultDestination)))) return null
  return { mode: value.mode, mount_backend: value.mount_backend, import_strategy: 'preserve',
    backup_destination_id: defaultDestination ? '@default' : destination, reclaim_source_space: reclaim, offload_legacy_blobs: offload }
}
export const infinidyskV2PreviewOptionsMatch = (left, right) => {
  const a = infinidyskV2PreviewOptions(left), b = infinidyskV2PreviewOptions(right)
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b))
}
export const normalizeInfiniDyskV2PreviewTask = value => {
  const options = infinidyskV2PreviewOptions(value?.options)
  if (!value || !taskIdentity(value.task_id) || !statuses.has(value.status) || !options
    || typeof value.options_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.options_fingerprint)
    || ![value.created_at, value.updated_at].every(time => typeof time === 'number' && Number.isFinite(time) && time > 0)
    || (value.request_id !== undefined && value.request_id !== null && (typeof value.request_id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.request_id)))) return null
  const available = value.status === 'completed' && value.preview_available === true
  if (available && (!value.preview || value.preview.protocol !== 1)) return null
  const progress = Object.fromEntries(['entries', 'processed', 'logical_bytes', 'blobs'].filter(key => Number.isSafeInteger(value.progress?.[key]) && value.progress[key] >= 0).map(key => [key, value.progress[key]]))
  return { task_id: value.task_id, status: value.status, options, options_fingerprint: value.options_fingerprint,
    request_id: value.request_id || null, created_at: value.created_at, updated_at: value.updated_at,
    stage: text(value.stage), message: text(value.message), error: text(value.error), progress,
    can_cancel: activeStatuses.has(value.status) && value.can_cancel === true && value.cancel_requested !== true,
    cancel_requested: value.cancel_requested === true, preview_available: available,
    preview_unavailable_reason: ['expired', 'consumed'].includes(value.preview_unavailable_reason) ? value.preview_unavailable_reason : null,
    preview: available ? value.preview : null }
}
export const initialInfiniDyskV2PreviewState = () => ({
  majorPreviewTask: null, majorPreviewConfirmed: false, majorPreviewPending: false, majorPreviewUncertain: false,
  majorPreviewRequest: null, majorPreviewError: '', majorPreviewCancelPending: false,
})

export const createInfiniDyskV2PreviewController = ({ state, repository, generation = () => 0 }) => {
  const update = values => { state.value = { ...state.value, ...values } }
  let polling = null
  let observationRevision = 0
  const observe = (raw, { expectedId = null, admitted = false } = {}) => {
    const previous = state.value.majorPreviewTask, request = state.value.majorPreviewRequest
    if (raw === null) {
      if (previous && infinidyskV2PreviewTaskActive(previous)) {
        update({ majorPreviewConfirmed: false, majorPreviewUncertain: true, majorPreviewError: 'The active preview could not be confirmed. Check preview status before starting another scan.' })
      } else if ((!request || previous) && !state.value.majorPreviewPending) {
        observationRevision++
        update({ majorPreviewTask: null, majorPreviewRequest: null, majorPreviewConfirmed: true, majorPreviewUncertain: false,
          majorPreviewError: previous ? 'The retained preview is no longer available. Generate a fresh preview before continuing.' : '' })
      }
      return false
    }
    const task = normalizeInfiniDyskV2PreviewTask(raw)
    if (!task) throw infinidyskV2ClientError('DUMB returned an unsupported preview task. Refresh status before starting another preview.')
    if (expectedId && task.task_id !== expectedId) throw infinidyskV2ClientError('The preview response did not match the requested task. Refresh status before retrying.')
    if (request && !admitted && state.value.majorPreviewUncertain && !previous
      && (task.request_id !== request.request_id || !infinidyskV2PreviewOptionsMatch(task.options, request.options))) return false
    if (admitted && request && !infinidyskV2PreviewOptionsMatch(task.options, request.options)) throw infinidyskV2ClientError('DUMB did not confirm the selected preview options. Refresh status before retrying.')
    if (previous?.task_id === task.task_id) {
      if (task.options_fingerprint !== previous.options_fingerprint || !infinidyskV2PreviewOptionsMatch(task.options, previous.options)
        || task.request_id !== previous.request_id) throw infinidyskV2ClientError('The retained preview identity changed. Refresh status before continuing.')
      if (task.updated_at < previous.updated_at || (!infinidyskV2PreviewTaskActive(previous) && infinidyskV2PreviewTaskActive(task))) return false
      if (previous.cancel_requested && infinidyskV2PreviewTaskActive(task)) { task.cancel_requested = true; task.can_cancel = false }
    }
    observationRevision++
    update({ majorPreviewTask: task, majorPreviewConfirmed: true, majorPreviewUncertain: false,
      ...(admitted ? { majorPreviewRequest: task.request_id ? { request_id: task.request_id, options: task.options } : null } : {}),
      majorPreviewError: ['failed', 'interrupted'].includes(task.status) ? task.error || task.message || 'The preview did not finish. No migration was started.' : '' })
    return true
  }
  const refresh = () => {
    if (polling) return polling
    if (!infinidyskV2AsyncPreviewSupported(state.value.capabilities)) return Promise.resolve(false)
    const current = generation(), expectedId = state.value.majorPreviewTask?.task_id
    const observedRevision = observationRevision, observedRequest = state.value.majorPreviewRequest
    polling = (async () => {
      try {
        let response, latest = false
        try { response = await repository.previewTask(expectedId) }
        catch (error) {
          if (!expectedId || ![404, 409].includes(error?.response?.status)) throw error
          response = await repository.previewTask()
          latest = true
        }
        if (current !== generation() || state.value.majorPreviewTask?.task_id !== expectedId || state.value.majorPreviewRequest !== observedRequest) return false
        if (response?.protocol !== 1 || !Object.hasOwn(response, 'task')) throw infinidyskV2ClientError('DUMB did not confirm preview status. Refresh status before retrying.')
        return observe(response.task, { expectedId: latest ? null : expectedId })
      } catch (error) {
        if (current !== generation() || state.value.majorPreviewTask?.task_id !== expectedId
          || state.value.majorPreviewRequest !== observedRequest || observationRevision !== observedRevision) return false
        update({ majorPreviewConfirmed: false, majorPreviewUncertain: true, majorPreviewError: infinidyskV2ErrorText(error) + ' The preview may still be running. Check status before starting another scan.' })
        return false
      } finally { polling = null }
    })()
    return polling
  }
  const prepare = async (options, { retry = false } = {}) => {
    if (!infinidyskV2AsyncPreviewSupported(state.value.capabilities) || !state.value.majorStatusConfirmed) throw infinidyskV2ClientError('Refresh current preview support and migration status before continuing.')
    // Once a task is known, reconnect only through its read endpoint. An
    // acknowledged deduplicated task may belong to another request nonce.
    if (retry && state.value.majorPreviewTask) {
      await refresh()
      return state.value.majorPreviewTask
    }
    if (state.value.busy || state.value.majorPreviewPending || infinidyskV2PreviewTaskActive(state.value.majorPreviewTask)
      || infinidyskV2NeedsAttention(state.value.majorJob)) throw infinidyskV2ClientError('An InfiniDysk operation is already running. Check its status before starting another preview.')
    const normalized = infinidyskV2PreviewOptions(options)
    if (!normalized) throw infinidyskV2ClientError('The selected preview options could not be confirmed.')
    let request = state.value.majorPreviewRequest
    if (retry) {
      if (!state.value.majorPreviewUncertain || !request || !infinidyskV2PreviewOptionsMatch(normalized, request.options)) throw infinidyskV2ClientError('The previous preview request must be reconciled before changing its options.')
    } else {
      if (state.value.majorPreviewUncertain) throw infinidyskV2ClientError('Check the uncertain preview before starting another scan.')
      const random = new Uint8Array(16)
      if (typeof globalThis.crypto?.getRandomValues !== 'function') throw infinidyskV2ClientError('This browser cannot create a safe preview request identity.')
      globalThis.crypto.getRandomValues(random)
      request = { request_id: Array.from(random, value => value.toString(16).padStart(2, '0')).join(''), options: normalized }
    }
    const current = generation()
    observationRevision++
    update({ busy: true, majorPreviewCancelPending: false, majorPreviewPending: true, majorPreviewUncertain: true, majorPreviewConfirmed: false,
      majorPreviewRequest: request, majorPreviewTask: null, majorPreviewError: '' })
    try {
      const response = await repository.previewStart({ ...request.options, request_id: request.request_id })
      if (current !== generation()) return null
      if (response?.protocol !== 1) throw infinidyskV2ClientError('Unsupported preview task protocol. Refresh backend capabilities before retrying.')
      observe(response.task, { admitted: true })
      return state.value.majorPreviewTask
    } catch (error) {
      if (current !== generation()) return null
      update({ majorPreviewError: infinidyskV2ErrorText(error) + ' Checking whether DUMB accepted the preview; no request will be repeated automatically.' })
      await refresh()
      if (state.value.majorPreviewConfirmed && state.value.majorPreviewTask) return state.value.majorPreviewTask
      return null
    } finally {
      if (current === generation()) update({ busy: false, majorPreviewPending: false })
    }
  }
  const cancel = async () => {
    const task = state.value.majorPreviewTask
    if (!infinidyskV2AsyncPreviewSupported(state.value.capabilities) || !state.value.majorPreviewConfirmed
      || !infinidyskV2PreviewTaskActive(task) || task.can_cancel !== true || state.value.majorPreviewCancelPending) return false
    const current = generation()
    update({ majorPreviewCancelPending: true })
    try {
      const response = await repository.cancelPreview(task.task_id)
      if (current !== generation() || state.value.majorPreviewTask?.task_id !== task.task_id) return false
      if (response?.protocol !== 1) throw infinidyskV2ClientError('DUMB did not confirm preview cancellation. Refresh status.')
      return observe(response.task, { expectedId: task.task_id })
    } catch (error) {
      if (current === generation() && state.value.majorPreviewTask?.task_id === task.task_id
        && infinidyskV2PreviewTaskActive(state.value.majorPreviewTask) && state.value.majorPreviewTask.cancel_requested !== true) update({ majorPreviewConfirmed: false, majorPreviewUncertain: true, majorPreviewError: infinidyskV2ErrorText(error) + ' Cancellation is unconfirmed. Keep monitoring preview status.' })
      return false
    } finally { if (current === generation() && state.value.majorPreviewTask?.task_id === task.task_id) update({ majorPreviewCancelPending: false }) }
  }
  return { observeMajorPreview: observe, pollMajorPreview: refresh, prepareMajorPreview: prepare, cancelMajorPreview: cancel }
}
