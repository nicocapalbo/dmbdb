const ioPhases = {
  source_fingerprint: { stage: 'snapshotting', unit: 'bytes', label: 'Fingerprinting the retained source data', countLabel: 'Source data read' },
  archive_inventory: { stage: 'archive_inventory', unit: 'entries', label: 'Measuring the recovery archive inputs', countLabel: 'Entries inspected' },
  archive_write: { stage: 'archiving', unit: 'bytes', label: 'Writing the migration recovery archive', countLabel: 'Archive data written' },
  archive_readback: { stage: 'verifying_archive', unit: 'bytes', label: 'Reading back and verifying the recovery archive', countLabel: 'Archive data read' },
  archive_recheck: { stage: 'verifying_archive', unit: 'bytes', label: 'Rechecking the retained recovery archive', countLabel: 'Archive data read' },
  archive_restore: { stage: 'restoring_archive', unit: 'bytes', label: 'Reading the recovery archive to restore v1', countLabel: 'Archive data read' },
  restore_metadata: { stage: 'restoring_metadata', unit: 'entries', label: 'Restoring source filesystem metadata', countLabel: 'Metadata entries processed' },
  restore_verify: { stage: 'verifying_restored_source', unit: 'bytes', label: 'Verifying the restored source data', countLabel: 'Data read for verification' },
  blob_copy: { stage: 'staging_blobs', unit: 'bytes', label: 'Copying v1 input to external storage', countLabel: 'Input data copied' },
  blob_metadata: { stage: 'preparing_blob_staging', unit: 'entries', label: 'Preparing access to the staged input', countLabel: 'Entries prepared' },
  blob_verify_staged: { stage: 'verifying_blob_staging', unit: 'bytes', label: 'Reading back and verifying the staged copy', countLabel: 'Staged data read' },
  blob_verify_source: { stage: 'verifying_blob_staging', unit: 'entries', label: 'Checking the retained v1 input', countLabel: 'Source entries checked' },
  blob_release: { stage: 'releasing_local_blobs', unit: 'entries', label: 'Removing only the verified local input', countLabel: 'Local entries removed' },
  blob_verify_input: { stage: 'verifying_blob_input', unit: 'bytes', label: 'Rechecking staged input for the importer', countLabel: 'Input data read' },
  blob_cleanup: { stage: 'cleaning_blob_staging', unit: 'entries', label: 'Removing owned temporary staging', countLabel: 'Staged entries removed' },
  import_source_media: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Reading original library records', countLabel: 'Library records read' },
  import_source_history: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Reading original download history', countLabel: 'History records read' },
  import_target_items: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Reading converted library records', countLabel: 'Library records read' },
  import_target_history: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Reading converted download history', countLabel: 'History records read' },
  import_history_check: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Comparing download history', countLabel: 'History records compared' },
  import_media_check: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Checking converted files', countLabel: 'File records checked' },
  import_media_census: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Verifying source file details', countLabel: 'File records checked' },
  import_history_census: { stage: 'validating', unit: 'entries', rateUnit: 'records', label: 'Verifying source history details', countLabel: 'History records checked' },
  import_source_blobs: { stage: 'validating', unit: 'bytes', label: 'Verifying original file metadata', countLabel: 'Metadata read' },
  import_target_integrity: { stage: 'validating', unit: 'entries', label: 'Checking converted database integrity', countLabel: null, indeterminate: true },
}
const count = value => Number.isSafeInteger(value) && value >= 0
export const formatInfiniDyskV2IORate = (value, unit) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  if (unit === 'entries' || unit === 'records') return value.toLocaleString('en-US', { maximumSignificantDigits: 2 }) + ' ' + unit + '/s'
  if (unit !== 'bytes') return ''
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const index = Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1))
  const amount = value / 1024 ** index
  const options = amount < 0.001 || amount >= 1e15
    ? { notation: 'scientific', maximumSignificantDigits: 3 }
    : amount < 1 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 }
  return amount.toLocaleString('en-US', options) + ' ' + units[index] + '/s'
}
export const infinidyskV2IOProgress = (value, { active = false, confirmed = false, stage = null, now = Date.now() } = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.phase_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.phase_id)
    || typeof value.phase !== 'string' || !Object.hasOwn(ioPhases, value.phase)
    || value.unit !== ioPhases[value.phase].unit || !count(value.processed)
    || !count(value.elapsed_seconds) || typeof value.complete !== 'boolean'
    || typeof value.total_is_estimate !== 'boolean') return null
  const result = { phaseId: value.phase_id, phase: value.phase, ...ioPhases[value.phase],
    processed: value.processed, elapsedSeconds: value.elapsed_seconds,
    totalIsEstimate: value.total_is_estimate, complete: value.complete }
  if (count(value.total)) result.total = value.total
  if (count(value.updated_at)) result.updatedAt = value.updated_at
  const age = result.updatedAt === undefined || !Number.isFinite(now) ? null : now / 1000 - result.updatedAt
  const fresh = age !== null && age >= -5 && age <= 30
  const overrun = result.total !== undefined && result.processed > result.total
  const atTotal = result.total !== undefined && result.processed === result.total
  const live = active && confirmed && stage === result.stage && !result.complete && fresh && !overrun && !atTotal && !result.indeterminate
  const warmed = result.elapsedSeconds >= 10 && result.processed > 0
  const rate = typeof value.rate_per_second === 'number' && Number.isFinite(value.rate_per_second)
    && value.rate_per_second > 0 ? value.rate_per_second : null
  if (live && warmed && rate !== null) result.rate = rate
  if (result.rate !== undefined && result.total > result.processed
    && count(value.estimated_remaining_seconds) && value.estimated_remaining_seconds > 0) {
    const seconds = value.estimated_remaining_seconds
    result.remainingSeconds = seconds >= 60 ? Math.ceil(seconds / 60) * 60 : Math.ceil(seconds / 5) * 5
  }
  result.estimateState = !active || stage !== result.stage ? 'inactive' : !confirmed ? 'unconfirmed'
    : result.complete ? 'complete' : !fresh ? 'stale' : result.indeterminate ? 'unknown_total' : overrun ? 'overrun' : atTotal ? 'at_total'
      : !warmed ? 'warming' : result.total === undefined ? 'unknown_total'
        : result.remainingSeconds === undefined ? 'unavailable' : 'ready'
  return result
}
export const infinidyskV2IOEstimateText = state => ({
  complete: 'The reported work for this phase finished. Later checks may continue.',
  unconfirmed: 'The current phase could not be reconfirmed. These are its last reported counters; the time estimate is paused.',
  stale: 'No recent progress measurements are available. The time estimate is paused.',
  overrun: 'The amount processed exceeded the earlier total. A remaining-time estimate is not available.',
  at_total: 'The reported total has been processed. Final checks for this phase may still continue.',
  warming: 'Measuring the current pace before estimating the remaining phase time.',
  unknown_total: 'The total for this phase is not known, so a remaining-time estimate is not available.',
  unavailable: 'A remaining-time estimate is not available for this phase yet.',
})[state] || ''

const changeLabels = {
  dev: 'Filesystem', inode: 'File identity', mode: 'Type or permissions', size: 'Size',
  mtime_ns: 'Modification time', ctime_ns: 'Filesystem change time', nlink: 'Hardlink count', sha256: 'Content hash',
}
const diagnosticCodes = {
  recorded_entry_changed: 'A recorded input entry changed',
  input_content_mismatch: 'Input content did not match its verified copy',
}
export const infinidyskV2InputIntegrity = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.code !== 'string' || !Object.hasOwn(diagnosticCodes, value.code)
    || !['source', 'staged'].includes(value.side)
    || !['file', 'directory', 'other'].includes(value.entry_type)
    || typeof value.path_digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.path_digest)
    || !Array.isArray(value.changed_fields) || !value.changed_fields.length || value.changed_fields.length > 8
    || !value.changed_fields.every(field => typeof field === 'string' && Object.hasOwn(changeLabels, field))) return null
  return { label: diagnosticCodes[value.code], side: value.side,
    sideLabel: value.side === 'source' ? 'Retained v1 input' : 'Staged working copy',
    entryType: value.entry_type, reference: value.path_digest,
    changes: [...new Set(value.changed_fields)].map(field => changeLabels[field]) }
}
