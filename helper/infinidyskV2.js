export const INFINIDYSK_V2_PROTOCOL = 1
export const INFINIDYSK_V2_MIN_API_VERSION = '2.24.0'
export const infinidyskCompatibilityAuthRequired = side => side?.compatibility_auth_policy?.enforced === true
  && side.compatibility_auth_policy.mode === 'required'
  && side.compatibility_auth_policy.reason === 'legacy_compatibility_listener'
export const INFINIDYSK_V2_ACKNOWLEDGEMENTS = Object.freeze(['backup', 'downtime', 'beta', 'oidc_policy', 'downstream', 'archive_recovery', 'skipped_media'])
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

export const infinidyskV2LowSpaceSupported = (capabilities, status) => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_low_space_migration === true
  && capabilities?.infinidysk_v2_migration_backup_storage === true
  && capabilities?.backup_storage_selection === true && capabilities?.backup_storage_protocol === 1
  && Array.isArray(capabilities?.backup_storage_kinds) && capabilities.backup_storage_kinds.includes('infinidysk_v2_archive')
  && status?.mode === 'migrate' && status?.runtime_generation === '1'

// A selected recovery policy must be echoed by the reviewed plan. Never accept
// a backend response that silently falls back to keeping the original locally.
export const infinidyskV2SourceStorageMatches = (preview, reclaimSourceSpace) => {
  const storage = preview?.source_storage
  if (reclaimSourceSpace === true) return storage?.mode === 'archive_recovery'
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

export const isInfiniDyskV2JobActive = (job) => Boolean(job && (isInfiniDyskV2CleanupActive(job) || !terminalStatuses.has(job.status)))
export const infinidyskV2NeedsAttention = (job) => Boolean(job && (
  isInfiniDyskV2JobActive(job) || job.cleanup?.state === 'failed' || job.recovery_required === true || job.rollback_available === true || job.can_rollback === true
))
export const infinidyskV2NoticeVisible = job => infinidyskV2NeedsAttention(job) || job?.cleanup_required === true
export const infinidyskV2ActionAllowed = (value, action) => value?.actions?.[action] === true
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

export const infinidyskV2ErrorText = (error) => {
  let data = error?.response?.data ?? error?.data
  // Text report requests also receive JSON API errors as text. Interpret only
  // bounded JSON objects; never display an arbitrary response body as an error.
  if (typeof data === 'string' && data.length <= 16000) {
    try { data = JSON.parse(data) } catch { data = null }
  }
  const detail = data?.detail
  return safeInfiniDyskV2Text(typeof detail === 'string' ? detail : detail?.message)
    || 'The request could not be confirmed. Refresh status before trying again.'
}

export const infinidyskV2PreviewFresh = (preview, now = Date.now()) => {
  if (preview?.protocol !== INFINIDYSK_V2_PROTOCOL || preview?.ready !== true
    || typeof preview.preview_token !== 'string' || !preview.preview_token
    || typeof preview.confirmation_text !== 'string' || !preview.confirmation_text) return false
  const raw = preview.expires_at
  const expiry = typeof raw === 'number' ? raw * 1000 : Date.parse(raw)
  return Number.isFinite(expiry) && expiry > now
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
}

export const formatInfiniDyskV2Bytes = value => {
  if (!capacityNumber(value)) return 'Unknown'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const unit = value === 0 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** unit).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${units[unit]}`
}

// Capacity is optional on protocol 1. It explains backend admission; it never
// authorizes a migration or substitutes missing/partial estimates with zero.
export const infinidyskV2Capacity = value => {
  if (value === undefined) return null
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rows = Array.isArray(object.filesystems) ? object.filesystems : []
  const source = object.source
  const validSource = source && ['entries', 'logical_bytes', 'root_count'].every(key => capacityNumber(source[key]))
  const validRows = rows.length > 0 && rows.every(row => row && typeof row === 'object'
    && ['base_required_bytes', 'safety_margin_bytes', 'required_bytes', 'free_bytes', 'shortfall_bytes'].every(key => capacityNumber(row[key]))
    && row.required_bytes === row.base_required_bytes + row.safety_margin_bytes
    && row.shortfall_bytes === Math.max(0, row.required_bytes - row.free_bytes)
    && row.sufficient === (row.shortfall_bytes === 0))
  const expectedStatus = rows.every(row => row?.sufficient === true) ? 'sufficient' : 'insufficient'
  const complete = object.complete === true && object.estimated === true && object.reserved === false
    && Boolean(validSource) && validRows && object.status === expectedStatus
  return {
    status: complete ? object.status : 'unavailable',
    source: complete ? { entries: source.entries, logical_bytes: source.logical_bytes, root_count: source.root_count } : null,
    filesystems: rows.map((row, index) => ({
      label: `Filesystem ${index + 1}`,
      roles: [...new Set(Array.isArray(row?.roles) ? row.roles.filter(role => typeof role === 'string' && Object.hasOwn(capacityRoles, role)).map(role => capacityRoles[role]) : [])],
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
