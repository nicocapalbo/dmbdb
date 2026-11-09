export const INFINIDYSK_V2_PROTOCOL = 1
export const INFINIDYSK_V2_MIN_API_VERSION = '2.24.0'
export const INFINIDYSK_V2_ACKNOWLEDGEMENTS = Object.freeze(['backup', 'downtime', 'beta', 'oidc_policy', 'downstream'])
const terminalStatuses = new Set(['completed', 'failed', 'error', 'cancelled', 'canceled', 'rolled_back', 'failed_rolled_back'])

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

export const isInfiniDyskV2JobActive = (job) => Boolean(job && !terminalStatuses.has(job.status))
export const infinidyskV2NeedsAttention = (job) => Boolean(job && (
  isInfiniDyskV2JobActive(job) || job.recovery_required === true || job.rollback_available === true || job.can_rollback === true
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
  const detail = error?.response?.data?.detail ?? error?.data?.detail
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

export const infinidyskV2AcknowledgementsReady = (preview, acknowledgements) => {
  const required = preview?.required_acknowledgements
  return Array.isArray(required) && required.length > 0
    && required.every(key => INFINIDYSK_V2_ACKNOWLEDGEMENTS.includes(key) && acknowledgements?.[key] === true)
}

export const infinidyskV2MajorReady = ({ preview, confirmation, acknowledgements, job, rehearsalJob, now }) => (
  infinidyskV2PreviewFresh(preview, now)
  && confirmation === preview.confirmation_text
  && infinidyskV2AcknowledgementsReady(preview, acknowledgements)
  && !infinidyskV2NeedsAttention(job)
  && (preview.rehearsal_required !== true || (
    rehearsalJob?.status === 'completed' && rehearsalJob?.mode === 'rehearsal'
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
