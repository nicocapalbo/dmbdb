export const INFINIDYSK_V2_PROTOCOL = 1
export const INFINIDYSK_V2_MIN_API_VERSION = '2.24.0'
export const infinidyskCompatibilityAuthRequired = side => side?.compatibility_auth_policy?.enforced === true
  && side.compatibility_auth_policy.mode === 'required'
  && side.compatibility_auth_policy.reason === 'legacy_compatibility_listener'
export const INFINIDYSK_V2_ACKNOWLEDGEMENTS = Object.freeze(['backup', 'downtime', 'beta', 'oidc_policy', 'downstream', 'archive_recovery', 'external_blob_staging', 'skipped_media'])
const terminalStatuses = new Set(['completed', 'rehearsed', 'failed_restored', 'failed', 'error', 'cancelled', 'canceled', 'rolled_back', 'failed_rolled_back'])
const cleanupActiveStates = new Set(['queued', 'verifying', 'retiring', 'deleting'])
export const isInfiniDyskV2CleanupActive = job => cleanupActiveStates.has(job?.cleanup?.state)

// Reject coercions, partial versions and invalid SemVer rather than guessing
// support from the frontend version or the backend process environment marker.
export const apiVersionSupportsInfiniDyskV2 = (value) => {
  if (typeof value !== 'string') return false
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
  if (!match) return false
  const parts = match.slice(1, 4).map(BigInt)
  const floor = [2n, 24n, 0n]
  for (let index = 0; index < 3; index++) {
    if (parts[index] !== floor[index]) return parts[index] > floor[index]
  }
  return !match[4]
}

export const infinidyskV2Support = (capabilities) => {
  const runtime = apiVersionSupportsInfiniDyskV2(capabilities?.api_version)
    && capabilities?.infinidysk_v2 === true
    && capabilities?.infinidysk_v2_migration_protocol === INFINIDYSK_V2_PROTOCOL
  return {
    runtime,
    migration: runtime && capabilities?.infinidysk_v2_migration === true,
    postgres: runtime && capabilities?.infinidysk_v2_postgres === true,
  }
}

// Native v2 has a different browser/auth contract from the v1 frontend. Do not
// enable its embedded route based on the generic runtime capability alone.
export const infinidyskV2EmbeddedSupported = capabilities => infinidyskV2Support(capabilities).runtime
  && capabilities?.infinidysk_v2_embedded_ui_adapter === true
  && capabilities?.infinidysk_v2_embedded_ui_protocol === 1

export const infinidyskV2PostgresPreparationSupported = capabilities => infinidyskV2Support(capabilities).postgres
  && capabilities?.infinidysk_v2_postgres_prepare_target === true
  && capabilities?.infinidysk_v2_postgres_prepare_target_protocol === 1

export const infinidyskV2LowSpaceSupported = (capabilities, status) => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_low_space_migration === true
  && capabilities?.infinidysk_v2_migration_backup_storage === true
  && capabilities?.backup_storage_selection === true && capabilities?.backup_storage_protocol === 1
  && Array.isArray(capabilities?.backup_storage_kinds) && capabilities.backup_storage_kinds.includes('infinidysk_v2_archive')
  && status?.mode === 'migrate' && status?.runtime_generation === '1'

export const infinidyskV2ExternalBlobStagingSupported = (capabilities, status) => infinidyskV2LowSpaceSupported(capabilities, status)
  && capabilities?.infinidysk_v2_external_blob_staging === true
  && (status?.capabilities?.external_blob_staging === undefined || status.capabilities.external_blob_staging === true)

// A selected recovery policy must be echoed by the reviewed plan. Never accept
// a backend response that silently falls back to keeping the original locally.
export const infinidyskV2SourceStorageMatches = (preview, reclaimSourceSpace = false, offloadLegacyBlobs = false) => {
  if (typeof reclaimSourceSpace !== 'boolean' || typeof offloadLegacyBlobs !== 'boolean' || (offloadLegacyBlobs && !reclaimSourceSpace)) return false
  const storage = preview?.source_storage
  const externalInputMatches = offloadLegacyBlobs
    ? storage?.offload_legacy_blobs === true && Array.isArray(preview?.required_acknowledgements) && preview.required_acknowledgements.includes('external_blob_staging')
    : storage?.offload_legacy_blobs === undefined || storage.offload_legacy_blobs === false
  if (!externalInputMatches) return false
  if (reclaimSourceSpace) return storage?.mode === 'archive_recovery'
    && storage.reclaim_source_space === true && storage.rollback_requires_archive === true
    && preview?.backup_storage?.mode === 'cold_archive'
    && Array.isArray(preview?.required_acknowledgements) && preview.required_acknowledgements.includes('archive_recovery')
  return !storage || (storage.mode === 'retain_local' && storage.reclaim_source_space === false && storage.rollback_requires_archive === false)
}

export const infinidyskV2ImportReport = value => {
  if (value === undefined || value === null) return null
  const count = number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0
  const label = text => typeof text === 'string' && text.length > 0 && text.length <= 4000
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const reasons = Array.isArray(object.reasons) ? object.reasons : []
  const skipped = Array.isArray(object.skipped) ? object.skipped : []
  const blockers = Array.isArray(object.blocking_reasons) ? object.blocking_reasons : []
  const valid = ['accepted', 'review_required', 'blocked'].includes(object.status)
    && count(object.imported_files) && count(object.skipped_files)
    && typeof object.review_required === 'boolean'
    && reasons.length <= 100 && reasons.every(row => label(row?.reason) && count(row?.count) && row.count > 0)
    && skipped.length <= 200 && skipped.every(row => label(row?.path) && label(row?.reason))
    && count(object.reason_count) && count(object.skipped_details_count)
    && object.skipped_details_count === object.skipped_files
    && skipped.length === Math.min(200, object.skipped_files) && reasons.length === Math.min(100, object.reason_count)
    && typeof object.reasons_truncated === 'boolean' && typeof object.skipped_details_truncated === 'boolean'
    && (object.reasons_truncated ? object.reason_count > reasons.length : object.reason_count === reasons.length)
    && (object.skipped_details_truncated ? object.skipped_files > skipped.length : object.skipped_files === skipped.length)
    && (object.reasons_truncated ? reasons.reduce((total, row) => total + row.count, 0) < object.skipped_files : reasons.reduce((total, row) => total + row.count, 0) === object.skipped_files)
    && blockers.every(label)
    && (object.status === 'review_required' ? object.review_required === true && object.skipped_files > 0 && blockers.length === 0 && typeof object.review_digest === 'string' && /^[0-9a-f]{64}$/.test(object.review_digest)
      : object.review_required === false && (object.status !== 'accepted' || (object.skipped_files === 0 && blockers.length === 0)))
  return {
    valid,
    status: valid ? object.status : 'unavailable',
    imported_files: count(object.imported_files) ? object.imported_files : null,
    skipped_files: count(object.skipped_files) ? object.skipped_files : null,
    reasons: reasons.filter(row => label(row?.reason) && count(row?.count)).slice(0, 100),
    skipped: skipped.filter(row => label(row?.path) && label(row?.reason)).slice(0, 200),
    review_required: object.review_required === true,
    review_digest: valid && object.status === 'review_required' ? object.review_digest : null,
    blocking_reasons: blockers.filter(label),
    truncated: object.reasons_truncated === true || object.skipped_details_truncated === true,
  }
}

export const infinidyskV2SkipReviewReady = (capabilities, report, acknowledged) => (!report && capabilities?.infinidysk_v2_reviewed_skips !== true) || (report?.valid === true && (
  report.status === 'accepted' || (report.status === 'review_required'
    && capabilities?.infinidysk_v2_reviewed_skips === true && acknowledged === true)
))

export const infinidyskRcloneOptimizerAllowed = (capabilities, status, confirmed = false) => {
  const legacy = capabilities?.rclone_optimizer_infinidysk === true || capabilities?.rclone_optimizer_nzbdav === true
  if (status?.runtime_generation === '2') return confirmed
    && infinidyskV2Support(capabilities).runtime
    && capabilities?.infinidysk_v2_rclone_optimizer === true
    && status?.current?.mount_backend === 'rclone'
  if (status?.runtime_generation === '1') return confirmed && legacy
  // Older APIs only support the v1 provider contract. A new API must first
  // resolve the actual provider instead of presenting v1 SQL/trace controls.
  return !apiVersionSupportsInfiniDyskV2(capabilities?.api_version) && legacy
}

export const normalizeInfiniDyskV2Job = (response) => {
  const job = response?.job ?? response
  return job && typeof job === 'object' && !Array.isArray(job)
    && typeof job.job_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(job.job_id)
    && typeof job.status === 'string' && job.status.length > 0 ? job : null
}

export const infinidyskV2ActivationExposed = job => job?.activation_exposed === true
  || job?.activation_committed === true
  || (typeof job?.recovery_kind === 'string' && job.recovery_kind.startsWith('v2_'))

export const infinidyskV2ConsumerRecoverySupported = capabilities => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_consumer_recovery === true
  && capabilities?.infinidysk_v2_consumer_recovery_protocol === 1

export const infinidyskV2ConsumerRecovery = job => {
  if (!['v2_activation', 'v2_consumers'].includes(job?.recovery_kind)
    || ['rolled_back', 'failed_rolled_back', 'failed_restored', 'cancelled'].includes(job?.status)) return null
  const value = job?.consumer_recovery
  const label = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 4000
  const names = values => Array.isArray(values) && values.every(label) && new Set(values).size === values.length
  const valid = value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.ready === 'boolean' && names(value.pending) && names(value.resumed)
    && Array.isArray(value.failed) && value.failed.every(row => row && typeof row === 'object'
      && label(row.process_name) && label(row.reason_code) && label(row.message))
  return {
    valid: Boolean(valid), ready: valid && value.ready === true,
    failed: valid ? value.failed : [], pending: valid ? value.pending : [], resumed: valid ? value.resumed : [],
  }
}

export const infinidyskV2ConsumerActionReady = ({ capabilities, confirmed, busy, job, action, confirmation, acknowledgePendingConsumers = false }) => {
  if (!infinidyskV2ConsumerRecoverySupported(capabilities) || confirmed !== true || busy
    || !['v2_activation', 'v2_consumers'].includes(job?.recovery_kind)
    || !['recovery_required', 'interrupted'].includes(job?.status) || isInfiniDyskV2CleanupActive(job)
    || typeof job?.job_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(job.job_id)) return false
  const retry = action === 'retry_consumers'
  if (!retry && action !== 'finish_consumer_recovery') return false
  const phrase = job.confirmation_texts?.[action]
  return typeof phrase === 'string' && phrase.length > 0 && phrase.length <= 4000 && confirmation === phrase
    && (retry ? job.can_retry_consumers === true
      : job.can_finish_consumer_recovery === true && infinidyskV2ConsumerRecovery(job)?.valid === true && job.consumer_recovery?.ready === true && acknowledgePendingConsumers === true)
}

export const infinidyskV2RollbackReady = ({ capabilities, confirmed, busy, job, confirmation, confirmationText, acknowledgeDiscardV2Writes = false }) => {
  const phrase = job?.rollback_confirmation_text || confirmationText
  const exposed = infinidyskV2ActivationExposed(job)
  return infinidyskV2Support(capabilities).migration && confirmed === true && !busy
    && !isInfiniDyskV2CleanupActive(job) && (job?.can_rollback === true || job?.actions?.rollback === true)
    && typeof phrase === 'string' && phrase.length > 0 && confirmation === phrase
    && (!exposed || (job.status === 'completed' && job.rollback_requires_discard_ack === true))
    && (job?.rollback_requires_discard_ack !== true || acknowledgeDiscardV2Writes === true)
}

export const isInfiniDyskV2JobActive = (job) => Boolean(job && (isInfiniDyskV2CleanupActive(job) || !terminalStatuses.has(job.status)))
export const infinidyskV2NeedsAttention = (job) => Boolean(job && (
  isInfiniDyskV2JobActive(job) || job.cleanup?.state === 'failed' || job.recovery_required === true || job.rollback_available === true || job.can_rollback === true
  || (infinidyskV2ConsumerRecovery(job)?.pending.length > 0)
))
export const infinidyskV2NoticeVisible = job => infinidyskV2NeedsAttention(job) || job?.cleanup_required === true
export const infinidyskV2ActionAllowed = (value, action) => value?.actions?.[action] === true
export const infinidyskV2CancelSupported = capabilities => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_cancel === true
export const infinidyskV2CancelReady = ({ capabilities, confirmed, busy, job, confirmation }) => infinidyskV2CancelSupported(capabilities)
  && confirmed === true && !busy && !isInfiniDyskV2CleanupActive(job)
  && !infinidyskV2ActivationExposed(job)
  && isInfiniDyskV2JobActive(job) && job?.cancel_requested === false && (job?.can_cancel === true || job?.actions?.cancel === true)
  && typeof job?.job_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(job.job_id)
  && job.cancel_confirmation_text === `CANCEL INFINIDYSK V2 ${job.job_id}`
  && confirmation === job.cancel_confirmation_text
export const infinidyskV2JobExplanation = job => {
  if (!job) return ''
  if (job.status === 'stage_retry_required' && job.cancel_requested !== true && !infinidyskV2ActivationExposed(job)) return 'DUMB paused at a failed migration step and retained the completed work. Resolve the reported problem, then retry this step or restore ' + (job.mode === 'fresh' || (job.mode === 'prepare' && job.prepare_mode === 'fresh') ? 'the previous setup' : 'v1') + '. Affected apps remain stopped while you decide; nothing retries automatically.'
  const recovery = infinidyskV2ConsumerRecovery(job)
  if (recovery) {
    if (job.status === 'completed') return recovery.pending.length > 0
      ? 'The InfiniDysk 2 cutover is retained. You accepted that the listed pending services remain stopped. Review their individual errors before starting them later.'
      : 'The InfiniDysk 2 cutover is retained and the retained consumers resumed. Verify their application health and playback separately.'
    if (job.activation_committed === true) return 'The InfiniDysk 2 cutover is retained. Some managed services still need recovery. Retry verifies the v2 runtime and mount before resuming only the retained pending services; it does not restore v1.'
    return 'The v2 runtime was exposed and may contain new writes. Keep its data and the retained v1 recovery evidence. Verify or restart the owned v2 runtime before retrying its pending services; DUMB will not automatically restore v1.'
  }
  if (infinidyskV2ActivationExposed(job) && !['completed', 'rolled_back', 'failed_rolled_back', 'failed_restored', 'cancelled'].includes(job.status)) return 'The v2 target may contain new writes. Keep both v2 data and retained v1 recovery evidence. Follow only the current backend-authorized recovery actions; cancellation must not silently restore v1.'
  if (job.status === 'cancelled' && job.result?.source_restored === true) return 'Migration cancellation finished and the original service was restored. Retained recovery evidence remains available; this cancelled test migration cannot authorize an upgrade.'
  if (job.status === 'failed_restored' && job.result?.source_restored === true) return 'The migration did not pass acceptance, and the original service was restored. Retained recovery evidence remains available; this failed attempt cannot authorize a cutover.'
  if (job.status === 'interrupted' || job.status === 'recovery_required' || job.recovery_required === true) return 'The migration needs recovery review. Keep the retained state and archives. Use the backend-authorized recovery action; deleting job files can remove the evidence needed to restore the source.'
  if (job.mode === 'prepare' && job.status === 'prepared' && job.stage === 'awaiting_activation') return job.prepare_mode === 'fresh' ? 'The fresh installation is prepared. Affected services remain stopped until you activate this candidate or restore the previous setup. Keep DUMB and recovery storage running.' : 'Preparation has finished. The converted v2 candidate is retained, and v1 and affected services remain stopped. Review the import report, then activate this candidate or restore v1. Keep DUMB and recovery storage running while you decide.'
  if (job.cancel_requested === true) return 'Cancellation was requested. DUMB must stop the native worker and finish restoring the previous service and consumers before this job releases migration admission.'
  if (job.stage === 'rolling_back' || job.stage === 'restoring_source' || job.status === 'rolling_back') return 'DUMB is stopping native writers and restoring the retained source and consumers. Recovery checks can take time for a large library; this job remains active until restoration is verified.'
  if (job.stage === 'validating') return 'The native import has reached validation. DUMB is checking the report and retained identities before accepting the migration or restoring the original service.'
  if (job.stage === 'importing' && job.message === 'Contained native stage: done') return 'The native importer has finished its conversion. DUMB has not yet completed acceptance or recovery, so the migration remains active.'
  return ''
}
export const infinidyskV2ImportProgress = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const labels = { processed: 'Processed records', total: 'Reported total', elapsed_seconds: 'Observed elapsed (seconds)', provider_connections: 'Provider connections', provider_requests: 'Provider requests' }
  const rows = Object.entries(labels).filter(([key]) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0)
    .map(([key, label]) => ({ key, label, value: value[key] }))
  const stage = typeof value.stage === 'string' && /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(value.stage) ? value.stage : ''
  return rows.length || stage ? { stage, rows } : null
}
export const infinidyskV2JobPercent = (job) => {
  const value = Number(job?.progress?.percent ?? job?.progress ?? 0)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

export const safeInfiniDyskV2Text = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).replace(/(?:https?|postgres(?:ql)?):\/\/[^\s<>"']+/gi, '[URL omitted]')
    .replace(/\/\.ids\/[^\s<>"']+/gi, '[signed path omitted]')
    .replace(/\b(password|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 1600)
}

const infiniDyskErrorEndpoint = value => {
  if (typeof value !== 'string' || value.length > 4000) return ''
  let path
  try { path = new URL(value, 'https://example.invalid').pathname } catch { return '' }
  if (path.startsWith('/process/')) path = '/api' + path
  if (path === '/api/process/capabilities') return path
  const base = '/api/process/infinidysk-v2'
  if (!path.startsWith(base + '/')) return ''
  const suffix = path.slice(base.length)
  if (new Set(['/status', '/preview', '/preview/start', '/preview/task', '/rehearse', '/start', '/prepare', '/activate', '/rollback', '/cancel', '/retry-stage', '/retry-consumers', '/finish-consumer-recovery', '/cleanup', '/cleanup/preview', '/postgres/status', '/postgres/prepare-target', '/postgres/preview', '/postgres/start', '/postgres/cutover', '/postgres/cancel', '/postgres/rollback']).has(suffix)) return base + suffix
  const task = /^\/preview\/task\/[A-Za-z0-9_-]{1,160}(\/cancel)?$/.exec(suffix)
  if (task) return base + '/preview/task/{task_id}' + (task[1] || '')
  const job = /^\/jobs\/[A-Za-z0-9_-]{1,160}(\/report)?$/.exec(suffix)
  return job ? base + '/jobs/{job_id}' + (job[1] || '') : ''
}

const infiniDyskAuthoredError = value => {
  if (typeof value !== 'string' || value.length > 16000 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return ''
  const text = value
    .replace(/(?:[A-Za-z][A-Za-z0-9+.-]{0,31}:)?\/\/[^\s<>"']+/g, '[URL omitted]')
    .replace(/\b((?:[a-z0-9]+[_-])*(?:password|passwd|token|secret|authorization|api[_-]?key|cookie))["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^,;\r\n]+)/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
  return safeInfiniDyskV2Text(text).replace(/\s+/g, ' ').trim()
}

const infiniDyskValidationFields = new Set(['body', 'query', 'path', 'options', 'mode', 'mount_backend', 'import_strategy', 'backup_destination_id', 'reclaim_source_space', 'offload_legacy_blobs', 'omit_queued_downloads', 'request_id', 'task_id', 'job_id', 'preview_token', 'confirmation', 'acknowledgements', 'backup', 'downtime', 'beta', 'oidc_policy', 'downstream', 'archive_recovery', 'external_blob_staging', 'skipped_media', 'rehearsal_job_id', 'acknowledge_discard_v2_writes', 'acknowledge_pending_consumers', 'managed', 'host', 'port', 'database', 'user', 'password', 'sslmode', 'schema'])
const infiniDyskValidationText = detail => {
  if (!Array.isArray(detail)) return ''
  const reasons = { missing: 'required', bool_type: 'must be true or false', bool_parsing: 'must be true or false', literal_error: 'invalid choice', string_type: 'must be text', string_too_short: 'too short', string_too_long: 'too long', int_type: 'must be an integer', int_parsing: 'must be an integer', greater_than: 'outside the allowed range', greater_than_equal: 'outside the allowed range', less_than: 'outside the allowed range', less_than_equal: 'outside the allowed range', extra_forbidden: 'not supported', json_invalid: 'invalid JSON' }
  const rows = detail.slice(0, 3).map(row => {
    const location = row?.loc
    const field = Array.isArray(location) && location.length <= 8
      && location.every(part => (typeof part === 'string' && infiniDyskValidationFields.has(part)) || (Number.isSafeInteger(part) && part >= 0 && part <= 9999))
      ? location.filter(part => typeof part === 'string' && !['body', 'query', 'path'].includes(part)).join('.')
      : ''
    const reason = typeof row?.type === 'string' && Object.hasOwn(reasons, row.type) ? reasons[row.type] : 'invalid value'
    return (field || 'request field') + ': ' + reason
  })
  return rows.length ? 'Request validation failed: ' + [...new Set(rows)].join('; ') + '.' : ''
}

export const infinidyskV2ErrorText = (error) => {
  let data = error?.response?.data ?? error?.data
  // Text report requests also receive JSON API errors as text. Interpret only
  // bounded JSON objects; never display a proxy body or arbitrary Error.message.
  if (typeof data === 'string') {
    if (data.length > 16000) data = null
    else { try { data = JSON.parse(data) } catch { data = null } }
  }
  const rawStatus = error?.response?.status
  const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null
  const endpoint = infiniDyskErrorEndpoint(error?.config?.url ?? error?.response?.config?.url)
  const detail = data && typeof data === 'object' && !Array.isArray(data) ? data.detail : null
  let message = infiniDyskAuthoredError(typeof detail === 'string' ? detail : detail?.message)
    || (status === 422 ? infiniDyskValidationText(detail) : '')
  if (!message) {
    if (!status && (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) || error?.name === 'TimeoutError')) {
      message = 'The request timed out before a response was received. DUMB may still be working. Refresh status before trying again.'
    } else if (!status && (error?.code === 'ERR_NETWORK' || error?.request)) {
      message = 'The DUMB API could not be reached. Check the API and frontend proxy connection, then refresh status before trying again.'
    } else if (status === 401) {
      message = 'Sign in again to access the InfiniDysk tools.'
    } else if (status === 403) {
      message = 'The DUMB API refused this request. Check your access, then refresh status.'
    } else if (status === 404) {
      message = 'The request could not be confirmed. The DUMB API could not find the requested InfiniDysk resource.'
    } else if (status === 409) {
      message = 'The DUMB API reported a conflict. Refresh status and review any active operation before trying again.'
    } else if (status === 422) {
      message = 'The DUMB API could not validate this request. Review the selected options.'
    } else if (status === 429) {
      message = 'The DUMB API is limiting requests. Wait, then refresh status.'
    } else if (status && status >= 500) {
      message = 'The DUMB API could not complete this request. Review DUMB logs and refresh status before trying again.'
    } else {
      message = 'The request could not be confirmed. Refresh status before trying again.'
    }
  }
  const context = [status ? 'HTTP ' + status : '', endpoint].filter(Boolean).join(' · ')
  return context ? message + ' (' + context + ')' : message
}

export const infinidyskV2PreviewFresh = (preview, now = Date.now()) => {
  if (preview?.protocol !== INFINIDYSK_V2_PROTOCOL || preview?.ready !== true
    || typeof preview.preview_token !== 'string' || !preview.preview_token
    || typeof preview.confirmation_text !== 'string' || !preview.confirmation_text) return false
  const raw = preview.expires_at
  const expiry = typeof raw === 'number' ? raw * 1000 : Date.parse(raw)
  return Number.isFinite(expiry) && expiry > now
}

export const infinidyskV2RenewedPreview = (preview, job, now = Date.now()) => {
  const expiry = job?.preview_expires_at
  const previous = typeof preview?.expires_at === 'number' ? preview.expires_at : Date.parse(preview?.expires_at) / 1000
  if (preview?.protocol !== INFINIDYSK_V2_PROTOCOL || preview.ready !== true || typeof preview.preview_token !== 'string' || !preview.preview_token
    || typeof preview.plan_fingerprint !== 'string' || !preview.plan_fingerprint || job?.plan_fingerprint !== preview.plan_fingerprint
    || job?.mode !== 'rehearsal' || job.status !== 'rehearsed' || job.result?.validated !== true
    || typeof expiry !== 'number' || !Number.isSafeInteger(expiry) || !Number.isFinite(previous)
    || expiry * 1000 <= now || expiry <= previous) return preview
  return { ...preview, expires_at: expiry }
}

export const infinidyskV2AcknowledgementKeys = preview => {
  const required = preview?.required_acknowledgements
  return Array.isArray(required) && required.length > 0 && new Set(required).size === required.length
    && required.every(key => INFINIDYSK_V2_ACKNOWLEDGEMENTS.includes(key)) ? required : []
}

export const infinidyskV2AcknowledgementsReady = (preview, acknowledgements) => {
  const required = infinidyskV2AcknowledgementKeys(preview)
  return required.length > 0 && required.every(key => acknowledgements?.[key] === true)
}

export const infinidyskV2MajorReady = ({ preview, confirmation, acknowledgements, job, rehearsalJob, now }) => (
  infinidyskV2PreviewFresh(preview, now)
  && confirmation === preview.confirmation_text
  && infinidyskV2AcknowledgementsReady(preview, acknowledgements)
  && !infinidyskV2NeedsAttention(job)
  && (preview.rehearsal_required !== true || (
    rehearsalJob?.status === 'rehearsed' && rehearsalJob?.mode === 'rehearsal'
    && rehearsalJob?.result?.validated === true
    && typeof preview.plan_fingerprint === 'string' && preview.plan_fingerprint.length > 0
    && rehearsalJob?.plan_fingerprint === preview.plan_fingerprint
  ))
)

export const infinidyskV2Selection = (status, mountBackend = null) => ({
  mode: status?.mode === 'fresh' ? 'fresh' : 'migrate',
  mount_backend: mountBackend || (status?.current?.mount_backend === 'fuse' ? 'fuse' : 'rclone'),
  import_strategy: 'preserve',
})

export const infinidyskV2ConfigChangeReason = (baseline, candidate) => (
  String(baseline?.runtime_generation || '1') !== String(candidate?.runtime_generation || '1')
    ? 'Use Service tools → InfiniDysk 2 migration. Its backend preview checks for existing data and preserves recovery state before changing generation.'
    : ''
)

export const infinidyskV2InventoryRows = (inventory) => {
  if (!inventory || typeof inventory !== 'object') return []
  return Object.entries(inventory).filter(([key]) => !/password|token|secret|credential|url/i.test(key))
    .map(([key, value]) => ({
      label: key.replaceAll('_', ' '),
      value: Array.isArray(value) ? `${value.length} recorded` : (typeof value === 'number' ? String(value) : safeInfiniDyskV2Text(value?.summary ?? value?.count ?? 'Recorded in backend preview')),
    }))
}

const capacityNumber = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const capacityRoles = {
  retained_backup: 'Retained backups', candidate: 'Candidate installation', postgres_temporary: 'PostgreSQL temporary data',
  cold_archive: 'Cold backup archive', local_verification: 'Local verification files',
  external_blob_staging: 'Temporary v1 import files on migration storage', external_blob_manifest: 'Local import-file verification', native_import_growth: 'Local space for the v2 import',
}

export const formatInfiniDyskV2Bytes = value => {
  if (!capacityNumber(value)) return 'Unknown'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const unit = value === 0 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** unit).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${units[unit]}`
}

// Capacity is optional on protocol 1. It explains backend admission; it never
// authorizes a migration or substitutes missing/partial estimates with zero.
const capacityPhases = { before_blob_release: 'Before moving legacy files', after_blob_release: 'After freeing local space' }
export const infinidyskV2Capacity = value => {
  if (value === undefined) return null
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rows = Array.isArray(object.filesystems) ? object.filesystems : []
  const source = object.source
  // Phase rows have distinct IDs, but may describe the same physical device.
  // Label that device consistently without exposing its backend identity.
  const filesystemLabels = new Map()
  const filesystemLabel = (row, index) => {
    const candidate = row?.filesystem_id ?? row?.id
    const identity = typeof candidate === 'string' && candidate ? candidate : index
    if (!filesystemLabels.has(identity)) filesystemLabels.set(identity, filesystemLabels.size + 1)
    return `Filesystem ${filesystemLabels.get(identity)}`
  }
  const projected = object.release_is_projected === true
  const projectionFields = rows.some(row => row?.projected_released_bytes !== undefined || row?.projected_available_bytes !== undefined)
  const validProjection = (!projectionFields && !projected) || (projected
    && ['before_blob_release', 'after_blob_release'].every(phase => rows.some(row => row?.phase === phase))
    && rows.every(row => Object.hasOwn(capacityPhases, row?.phase)
      && capacityNumber(row.projected_released_bytes) && capacityNumber(row.projected_available_bytes)
      && capacityNumber(row.free_bytes + row.projected_released_bytes)
      && row.projected_available_bytes === row.free_bytes + row.projected_released_bytes
      && (row.phase !== 'before_blob_release' || row.projected_released_bytes === 0)))
  const available = row => projected ? row.projected_available_bytes : row.free_bytes
  const validSource = source && ['entries', 'logical_bytes', 'root_count'].every(key => capacityNumber(source[key]))
  const validRows = validProjection && rows.length > 0 && rows.every(row => row && typeof row === 'object'
    && ['base_required_bytes', 'safety_margin_bytes', 'required_bytes', 'free_bytes', 'shortfall_bytes'].every(key => capacityNumber(row[key]))
    && row.required_bytes === row.base_required_bytes + row.safety_margin_bytes
    && row.shortfall_bytes === Math.max(0, row.required_bytes - available(row))
    && row.sufficient === (row.shortfall_bytes === 0))
  const expectedStatus = rows.every(row => row?.sufficient === true) ? 'sufficient' : 'insufficient'
  const complete = object.complete === true && object.estimated === true && object.reserved === false
    && Boolean(validSource) && validRows && object.status === expectedStatus
  return {
    status: complete ? object.status : 'unavailable',
    source: complete ? { entries: source.entries, logical_bytes: source.logical_bytes, root_count: source.root_count } : null,
    ...(projected ? { release_is_projected: true } : {}),
    filesystems: rows.map((row, index) => ({
      label: filesystemLabel(row, index),
      roles: [...new Set(Array.isArray(row?.roles) ? row.roles.filter(role => typeof role === 'string' && Object.hasOwn(capacityRoles, role)).map(role => capacityRoles[role]) : [])],
      ...(Object.hasOwn(capacityPhases, row?.phase) ? { phase: row.phase, phase_label: capacityPhases[row.phase] } : {}),
      ...(projected ? { projected_released_bytes: complete ? row.projected_released_bytes : null, projected_available_bytes: complete ? row.projected_available_bytes : null } : {}),
      status: complete ? (row.sufficient ? 'sufficient' : 'insufficient') : 'unavailable',
      required_bytes: complete ? row.required_bytes : null,
      safety_margin_bytes: complete ? row.safety_margin_bytes : null,
      free_bytes: complete ? row.free_bytes : null,
      shortfall_bytes: complete ? row.shortfall_bytes : null,
    })),
  }
}

export const infinidyskV2CleanupSupported = capabilities => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_cleanup === true && capabilities?.infinidysk_v2_cleanup_protocol === 1

export const infinidyskV2CleanupReady = ({ capabilities, status, job, preview, confirmation, acknowledgements, now = Date.now() }) => (
  infinidyskV2CleanupSupported(capabilities) && status?.runtime_generation === '2'
  && job?.status === 'completed' && !isInfiniDyskV2CleanupActive(job)
  && (job?.can_cleanup === true || job?.actions?.cleanup === true)
  && preview?.job_id === job?.job_id && infinidyskV2PreviewFresh(preview, now)
  && Array.isArray(preview.targets) && preview.targets.length > 0
  && preview.targets.every(target => typeof target?.path === 'string' && target.path.startsWith('/')
    && ['entries', 'logical_bytes', 'reclaim_estimate_bytes'].every(key => capacityNumber(target[key])))
  && Array.isArray(preview.kept_backups) && preview.kept_backups.length > 0
  && preview.kept_backups.every(backup => backup?.kept === true && typeof backup.role === 'string' && backup.role.trim()
    && ((typeof backup.path === 'string' && backup.path.startsWith('/') && !backup.path.startsWith('//'))
      || (typeof backup.reference === 'string' && backup.reference.startsWith('dumb-backup://') && backup.reference.length > 'dumb-backup://'.length)))
  && Array.isArray(preview.blockers) && preview.blockers.length === 0
  && preview.rollback_will_be_retired === true
  && confirmation === preview.confirmation_text
  && Array.isArray(preview.acknowledgements_required) && preview.acknowledgements_required.length === 3
  && ['playback', 'test_import', 'rollback_retirement'].every(key => preview.acknowledgements_required.includes(key) && acknowledgements?.[key] === true)
)
