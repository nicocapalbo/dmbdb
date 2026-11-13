import { backupCompressionValid } from './installationBackupCompression.js'
import { backupStorageText } from './backupStorage.js'
import { formatInfiniDyskV2Bytes, infinidyskV2Capacity } from './infinidyskV2.js'

export const installationBackupSupported = capabilities => capabilities?.installation_backup === true && capabilities?.installation_backup_protocol === 1
export const installationRestoreInput = ({ capabilities, mode, reference, archivePath, allowSharedPermissions }) => mode === 'catalog'
  ? { reference }
  : { archive_path: archivePath.trim(), ...(capabilities?.installation_backup_shared_permissions === true ? { allow_shared_permissions: allowSharedPermissions === true } : {}) }
export const backupBytes = formatInfiniDyskV2Bytes
export const backupCapacity = infinidyskV2Capacity
export const backupText = value => backupStorageText(typeof value === 'string' ? value : value?.message || value?.reason || '')
export const backupTime = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Not recorded'
  const date = new Date(value * 1000)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not recorded'
}
export const backupError = error => {
  const detail = error?.response?.data?.detail ?? error?.data?.detail
  if (Array.isArray(detail)) return detail.map(item => [Array.isArray(item?.loc) ? item.loc.filter(value => typeof value === 'string').map(backupStorageText).join('.') : '', backupStorageText(item?.msg || '')].filter(Boolean).join(': ')).filter(Boolean).join(' ') || 'The request was rejected. Review the required fields.'
  const message = backupText(detail) || backupText(error?.message) || 'The backup request could not be confirmed. Refresh status before retrying.'
  const code = typeof detail?.code === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(detail.code) ? detail.code : ''
  const blockers = Array.isArray(detail?.blockers) ? detail.blockers.map(backupText).filter(Boolean) : []
  return [code ? `${code}: ${message}` : message, ...blockers].join(' ')
}
export const installationJob = value => {
  if (!value || typeof value.job_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.job_id)
    || !['installation_backup', 'installation_restore'].includes(value.job_type)
    || !['queued', 'running', 'completed', 'failed', 'recovery_required', 'rolled_back'].includes(value.status)) return null
  return value
}
export const installationJobActive = job => ['queued', 'running'].includes(job?.status)
export const installationRestartAcknowledged = job => ['completed', 'rolled_back'].includes(job?.status) && job.restart_required === false && job.result?.restart_required === false
export const installationRestartRequired = job => job?.restart_required === true || job?.result?.restart_required === true
  || (job?.stage === 'restart_required' && ['completed', 'rolled_back'].includes(job.status) && !installationRestartAcknowledged(job))
export const installationJobDisplay = job => {
  const backup = job?.job_type === 'installation_backup'
  const acknowledged = installationRestartAcknowledged(job)
  const staleRestartStage = job?.stage === 'restart_required' && acknowledged
  return {
    statusLabel: backup && job?.status === 'rolled_back' && acknowledged ? 'Recovery complete' : String(job?.status || 'unknown').replaceAll('_', ' '),
    stageLabel: staleRestartStage ? (backup ? 'Backup recovery complete' : 'Restart complete') : backupText(job?.stage).replaceAll('_', ' '),
    message: backup && job?.status === 'rolled_back'
      ? (acknowledged ? 'Original application data remains in place; backup recovery is complete.'
        : installationRestartRequired(job) ? 'Original application data remains in place. Restart DUMB to finish backup recovery and resume applications.'
          : 'Original application data remains in place. Review the backup recovery status before continuing.')
      : backupText(job?.message),
    historicalErrors: backup && (job?.status === 'rolled_back' || (job?.status === 'completed' && staleRestartStage)),
  }
}
export const installationBlocked = state => !installationBackupSupported(state.capabilities) || !state.confirmed || state.busy || state.previewUncertain || state.startUncertain || ['running', 'cancelling'].includes(state.previewOperation?.status)
  || installationJobActive(state.job) || installationJobActive(state.status?.job) || Boolean(state.status?.preparation) || state.status?.recovery_required === true || state.job?.status === 'recovery_required' || installationRestartRequired(state.job)

const acknowledgements = {
  backup: ['downtime', 'secrets', 'external_state'],
  restore: ['downtime', 'replace_state', 'external_state'],
}
export const backupAcknowledgementLabels = {
  downtime: 'I approve stopping the listed applications for a consistent snapshot or restore.',
  secrets: 'I understand this archive contains configuration, authentication and private keys, and will protect access to it.',
  external_state: 'I reviewed exclusions and will back up or restore external services, databases, media and container configuration separately.',
  replace_state: 'I approve replacing the reviewed managed state and understand that restored authentication takes effect after restarting DUMB.',
}
export const installationPreviewReady = ({ state, preview, mode, confirmation, acknowledgements: accepted, now = Date.now() }) => {
  const required = Object.hasOwn(acknowledgements, mode) ? acknowledgements[mode] : null
  return !installationBlocked(state) && Boolean(required) && preview?.protocol === 1 && preview.ready === true
    && (mode !== 'backup' || backupCompressionValid(state.capabilities, preview.compression))
    && typeof preview.preview_token === 'string' && preview.preview_token.length > 0
    && typeof preview.expires_at === 'number' && Number.isFinite(preview.expires_at) && preview.expires_at * 1000 > now
    && typeof preview.confirmation_text === 'string' && preview.confirmation_text.length > 0 && confirmation === preview.confirmation_text
    && Array.isArray(preview.blockers) && preview.blockers.length === 0
    && Array.isArray(preview.inventory?.roots) && preview.inventory.roots.length > 0
    && Array.isArray(preview.inventory?.excluded)
    && (mode !== 'restore' || (preview.backup?.verified === true && Number.isInteger(preview.backup.schema_version) && preview.backup.schema_version > 0
      && typeof preview.backup.sha256 === 'string' && preview.backup.sha256.length === 64 && /^[0-9a-f]{64}$/.test(preview.backup.sha256)
      && ((typeof preview.backup.reference === 'string' && preview.backup.reference.startsWith('dumb-backup://'))
        || (typeof preview.backup.archive_path === 'string' && preview.backup.archive_path.startsWith('/') && !preview.backup.archive_path.startsWith('//')))))
    && backupCapacity(preview.capacity)?.status === 'sufficient'
    && Array.isArray(preview.required_acknowledgements) && preview.required_acknowledgements.length === required.length
    && required.every(key => preview.required_acknowledgements.includes(key) && accepted?.[key] === true)
}
export const installationRollbackAvailable = job => job?.can_rollback === true && ['completed', 'failed', 'recovery_required'].includes(job.status)
export const installationRollbackReady = (state, confirmation) => installationBackupSupported(state.capabilities) && state.confirmed && !state.busy
  && !installationJobActive(state.job) && !installationJobActive(state.status?.job) && installationRollbackAvailable(state.job)
  && state.status?.job?.job_id === state.job?.job_id
  && typeof state.job.rollback_confirmation_text === 'string' && state.job.rollback_confirmation_text.length > 0
  && confirmation === state.job.rollback_confirmation_text
