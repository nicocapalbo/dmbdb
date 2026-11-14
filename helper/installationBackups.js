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
    || !['queued', 'running', 'completed', 'failed', 'recovery_required', 'rolled_back', 'cancelled'].includes(value.status)) return null
  return value
}
export const installationBackupDirectSupported = capabilities => installationBackupSupported(capabilities) && capabilities?.installation_backup_direct_start === true
export const installationBackupDirectConsent = state => {
  const consent = state.status?.direct_start
  const keys = consent?.required_acknowledgements
  return installationBackupDirectSupported(state.capabilities) && consent?.confirmation_text === 'BACK UP DUMB INSTALLATION'
    && Array.isArray(keys) && keys.length === 3 && ['downtime', 'secrets', 'external_state'].every(key => keys.includes(key))
    ? consent : null
}
export const installationBackupDirectReady = ({ state, destination, compression = 'none', confirmation, acknowledgements }) => {
  const consent = installationBackupDirectConsent(state)
  return Boolean(consent) && !installationBlocked(state) && typeof destination === 'string'
    && (destination === '@default' || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(destination))
    && backupCompressionValid(state.capabilities, compression) && confirmation === consent.confirmation_text
    && consent.required_acknowledgements.every(key => acknowledgements?.[key] === true)
}
export const installationBackupCancellationSupported = capabilities => installationBackupSupported(capabilities) && capabilities?.installation_backup_cancellation === true
export const installationBackupCancelReady = state => installationBackupCancellationSupported(state.capabilities) && state.confirmed && !state.busy && !state.cancelPending
  && state.job?.job_type === 'installation_backup' && installationJobActive(state.job) && state.job.can_cancel === true && state.job.cancel_requested !== true
export const installationJobActive = job => ['queued', 'running'].includes(job?.status)
export const installationRestartAcknowledged = job => ['completed', 'rolled_back'].includes(job?.status) && job.restart_required === false && job.result?.restart_required === false
export const installationRestartRequired = job => job?.restart_required === true || job?.result?.restart_required === true
  || (job?.stage === 'restart_required' && ['completed', 'rolled_back'].includes(job.status) && !installationRestartAcknowledged(job))
export const installationVerifiedArchive = job => {
  if (job?.job_type !== 'installation_backup' || job.result?.complete !== true || (Object.hasOwn(job, 'archive_verified') && job.archive_verified !== true)) return null
  const archive = job.result.archive
  if (!archive || typeof archive !== 'object' || Array.isArray(archive) || archive.verified !== true) return null
  const match = typeof archive.reference === 'string' && /^dumb-backup:\/\/([a-z0-9][a-z0-9_-]{0,63})\/installation\/([0-9a-f]{32})$/.exec(archive.reference)
  if (!match || typeof archive.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(archive.sha256) || !Number.isSafeInteger(archive.size_bytes) || archive.size_bytes < 0) return null
  if (archive.namespace !== 'installation' || archive.artifact_kind !== 'installation_backup'
    || archive.artifact_id !== match[2] || archive.backup_destination_id !== match[1]
    || (archive.extension !== undefined && !['tar', 'tar.zst'].includes(archive.extension)) || (archive.compression !== undefined && !['none', 'zstd'].includes(archive.compression))
    || (archive.compression === 'zstd' && archive.extension === 'tar') || (archive.compression === 'none' && archive.extension === 'tar.zst')) return null
  return { reference: archive.reference, verified: true, sha256: archive.sha256, size_bytes: archive.size_bytes,
    created_at: Number.isFinite(archive.created_at) && archive.created_at > 0 ? archive.created_at : null,
    artifact_id: match[2], backup_destination_id: match[1], namespace: 'installation', artifact_kind: 'installation_backup',
    compression: archive.compression === 'zstd' || archive.extension === 'tar.zst' ? 'zstd' : 'none', extension: archive.extension || 'tar' }
}
export const installationArchivePublicationUncertain = job => job?.job_type === 'installation_backup' && !installationVerifiedArchive(job)
  && (job.archive_publication_uncertain === true || (!Object.hasOwn(job, 'archive_publication_uncertain') && job.stage === 'publishing' && ['failed', 'recovery_required'].includes(job.status)))
export const installationJobDisplay = job => {
  const backup = job?.job_type === 'installation_backup'
  const archive = installationVerifiedArchive(job)
  const publicationUncertain = installationArchivePublicationUncertain(job)
  const acknowledged = installationRestartAcknowledged(job)
  const staleRestartStage = job?.stage === 'restart_required' && acknowledged
  return {
    archive, publicationUncertain,
    statusLabel: archive ? (job.status === 'recovery_required' ? 'Backup saved; service recovery required' : installationRestartRequired(job) ? 'Backup saved; restart required' : installationJobActive(job) ? 'Backup saved; resuming services' : job.status === 'rolled_back' ? 'Backup saved; recovery complete' : 'Backup saved') : publicationUncertain ? 'Archive publication unconfirmed' : backup && job?.status === 'rolled_back' && acknowledged ? 'Recovery complete' : String(job?.status || 'unknown').replaceAll('_', ' '),
    stageLabel: archive && job.status === 'recovery_required' ? 'Service recovery required' : archive && installationJobActive(job) ? 'Service resumption' : staleRestartStage ? (backup ? 'Backup recovery complete' : 'Restart complete') : backupText(job?.stage).replaceAll('_', ' '),
    message: archive
      ? (job.status === 'recovery_required' ? 'The archive was verified and saved. Service resumption needs recovery; this does not require creating the backup again.'
        : installationRestartRequired(job) ? 'The verified archive remains saved. Restart DUMB to finish service recovery and resume applications; no archive was restored.'
          : job.status === 'rolled_back' ? 'The verified archive remains saved and service recovery is complete. Original application data remains in place.'
            : installationJobActive(job) ? 'The archive was verified and saved. DUMB is resuming applications; availability is not yet confirmed.'
              : 'The archive was verified and saved. Review its receipt and the service status separately.')
      : publicationUncertain ? 'Archive publication could not be confirmed. Inspect the backup catalog before deciding whether another backup is needed.'
        : backup && job?.status === 'rolled_back'
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
  downtime: 'I approve stopping the listed applications for the complete operation, which can take hours on large installations or slow storage.',
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
