import { backupCompressionMode } from './installationBackupCompression.js'

export const backupPreviewStatusSupported = capabilities => capabilities?.installation_backup_preview_status === true
export const backupPreviewActive = operation => ['running', 'cancelling'].includes(operation?.status)
export const backupPreviewIdentity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
const destinationIdentity = value => typeof value === 'string' && (value === '@default' || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
export const backupPreviewEnvelope = payload => {
  if (payload?.protocol !== 1 || !backupPreviewIdentity(payload.controller_session) || !Object.hasOwn(payload, 'preview')) throw new Error('DUMB did not confirm a valid preview status. Keep the current request and refresh status before retrying.')
  if (payload.preview === null) return payload
  const value = payload.preview
  if ((value?.compression !== undefined && backupCompressionMode(value.compression) === null) || !backupPreviewIdentity(value?.preview_id) || value.kind !== 'backup' || !destinationIdentity(value.destination_id)
    || !['running', 'cancelling', 'completed', 'failed', 'cancelled'].includes(value.status)) throw new Error('DUMB returned an unknown preview operation. Keep the current request and refresh status before retrying.')
  return payload
}
export const backupPreviewElapsed = (state, now = Date.now()) => {
  const operation = state.previewOperation
  const started = operation?.started_at ?? state.previewSubmittedAt
  const recorded = Number.isFinite(operation?.elapsed_seconds) && operation.elapsed_seconds >= 0 ? operation.elapsed_seconds : 0
  if (operation && !backupPreviewActive(operation)) return recorded
  return Number.isFinite(started) && started > 0 ? Math.max(recorded, Math.max(0, now / 1000 - started)) : recorded
}
export const backupPreviewDuration = seconds => {
  const value = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0))
  if (value >= 3600) return Math.floor(value / 3600) + 'h ' + Math.floor(value % 3600 / 60) + 'm ' + value % 60 + 's'
  if (value >= 60) return Math.floor(value / 60) + 'm ' + value % 60 + 's'
  return value + 's'
}
