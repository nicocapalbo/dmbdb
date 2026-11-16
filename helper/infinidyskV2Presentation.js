import { infinidyskV2ActivationExposed, infinidyskV2ConsumerRecovery, infinidyskCompatibilityAuthRequired, safeInfiniDyskV2Text as text } from './infinidyskV2.js'

const knownNotes = new Map([
  ['The retained rclone owner will use --links and --dir-cache-time=20s because generation 2 does not send the old directory-refresh notifications.', { key: 'rclone', message: 'DUMB updates rclone’s link support and directory refresh settings for InfiniDysk 2.' }],
  ['The native beta import can read NNTP and requires a real contained rehearsal.', { key: 'native_test', message: 'The test migration runs the real importer and may contact your Usenet providers.' }],
  ['Keep independent backups. Rollback returns to retained v1 data and never merges later v2 writes.', { key: 'rollback', important: true, message: 'Keep an independent backup. Restoring v1 returns it to the saved state and discards later v2 changes.' }],
  ['Timezone, existing library paths and outputs are preserved; OIDC must be explicitly verified.', { key: 'paths', message: 'Your timezone, library paths and import outputs are preserved. Check your sign-in or OIDC setup before continuing.' }],
  ['Rehearsal can temporarily stop all affected managed consumers and the v1 source.', { key: 'downtime', important: true, message: 'The test migration temporarily stops v1 and the managed apps that depend on it, then restores v1.' }],
  ['Verify external media/Arr mount paths, remote mappings and existing symlink/STRM origins, and stop external writers and scanners during the upgrade. Managed mount readiness does not qualify external playback.', { key: 'external_apps', message: 'Pause external writers and scanners. Check media and Arr paths, remote mappings, symlinks and STRM links yourself; a ready mount does not prove playback works.' }],
])
const compatibilityNote = 'The retained backend compatibility listener requires native admin authentication mode Required, locked by DUMB for each launch. Saved native authentication settings are unchanged; disable compatibility by using the same backend and frontend port to retain native Local/Disabled mode.'

// Only exact, established backend notices are rewritten. A new or altered
// backend message always remains visible rather than being filtered by regex.
export const infinidyskV2ReviewNotes = preview => {
  const notes = [], additional = [], seen = new Set()
  for (const item of Array.isArray(preview?.warnings) ? preview.warnings : []) {
    const raw = typeof item === 'string' ? item : item?.message || item?.label || item?.code
    if (raw === compatibilityNote && infinidyskCompatibilityAuthRequired(preview?.target)) continue
    const known = knownNotes.get(raw)
    if (known) {
      if (!seen.has(known.key)) notes.push({ ...known })
      seen.add(known.key)
    } else {
      const message = text(raw)
      additional.push(message || 'DUMB returned an additional migration notice that could not be displayed. Refresh status and review the backend logs.')
    }
  }
  if (preview?.rehearsal_required === true && !seen.has('downtime')) notes.push({ key: 'downtime', important: true, message: 'The test migration temporarily stops v1 and affected apps, then restores v1 before finishing.' })
  if (Array.isArray(preview?.required_acknowledgements) && preview.required_acknowledgements.includes('backup') && !seen.has('rollback')) notes.push({ key: 'rollback', important: true, message: 'Keep an independent backup. Restoring v1 returns it to the saved state and discards later v2 changes.' })
  return { notes: notes.filter(note => !note.important), important: notes.filter(note => note.important), additional }
}

const summaryLabels = { runtime_generation: 'InfiniDysk version', mount_backend: 'Mount method', mount_path: 'Library mount path', database_provider: 'Database', provider: 'Database', import_strategy: 'Library links', host: 'Server', port: 'Port', database: 'Database name', user: 'Database user', runtime_dir: 'Application location', data_dir: 'Working data location' }
export const infinidyskV2SummaryLabel = field => summaryLabels[field] || text(field).replaceAll('_', ' ')
export const infinidyskV2SummaryValue = (field, value) => {
  if (field === 'runtime_generation' && ['1', '2'].includes(String(value))) return 'InfiniDysk ' + value
  const values = field === 'mount_backend' ? { rclone: 'rclone over WebDAV', fuse: 'Native FUSE' } : ['database_provider', 'provider'].includes(field) ? { postgres: 'PostgreSQL', postgresql: 'PostgreSQL', sqlite: 'SQLite' } : null
  if (values) return Object.hasOwn(values, value) ? values[value] : text(value)
  if (field === 'import_strategy' && value === 'preserve') return 'Keep existing links and paths'
  return text(value)
}

export const infinidyskV2CheckText = value => {
  if (value?.passed !== false && value?.ready !== false && value?.name === 'source_schema' && value.status === 'verified_at_snapshot') return 'The v1 database schema will be verified from its migration snapshot.'
  if (value?.passed !== false && value?.ready !== false && value?.name === 'source_queue' && value.status === 'must_be_empty_after_quiescence') return 'Finish or review queued v1 downloads before testing. Failed history entries alone do not block migration; DUMB does not delete Arr history or library files.'
  if (value?.passed !== false && value?.ready !== false && value?.name === 'contained_native_import' && value.status === 'required') return 'A successful test migration is required before the upgrade.'
  return text(typeof value === 'string' ? value : value?.message || value?.label || [value?.name, value?.status].filter(Boolean).join(': ').replaceAll('_', ' '))
}

export const infinidyskV2JobLabel = (value, mode) => {
  if (value === 'rehearsed' && mode === 'rehearsal') return 'Test migration passed'
  return ({ staging_blobs: 'Copying v1 import files to migration storage', verifying_blob_staging: 'Verifying the external v1 import files', releasing_local_blobs: 'Freeing local v1 blob space', restoring_source: 'Restoring v1 from the recovery copy' })[value] || text(value).replaceAll('_', ' ')
}

const runningJobStatuses = new Set(['queued', 'running', 'quiescing', 'snapshotting', 'rehearsing', 'importing', 'validating', 'cutover', 'starting', 'copying', 'syncing', 'rolling_back', 'cancelling'])
export const infinidyskV2JobPresentation = (job, { kind = 'migration', runtimeGeneration = null, currentMode = null } = {}) => {
  if (!job) return null
  const migration = kind !== 'database'
  const test = migration && job.mode === 'rehearsal'
  const legacy = migration && (['migrate', 'rehearsal'].includes(job.mode) || (!job.mode && currentMode === 'migrate'))
  const exposed = infinidyskV2ActivationExposed(job)
  const consumerRecovery = infinidyskV2ConsumerRecovery(job)
  const sourceRestored = (job.result?.source_restored === true && !exposed)
    || (job.status === 'rolled_back' && (migration ? job.result?.validated === true : true))
  const describe = (state, tone, title, message, next, active = false) => ({ state, tone, title, message, next, active, showProgress: active })
  // An admitted rollback retains historical exposure/consumer fields until
  // restoration finishes. Its exact work status is authoritative for display;
  // held/unknown states below still require explicit recovery authorization.
  if (job.status === 'rolling_back') return describe('rolling_back', 'info', migration ? 'Restoring previous installation' : 'Restoring SQLite snapshot',
    'DUMB is performing the rollback you requested. Restoration is not yet complete.',
    'Keep DUMB and its required storage online. Wait for the final restoration result before starting another operation.', true)
  if (['queued', 'verifying', 'retiring', 'deleting'].includes(job.cleanup?.state)) return { ...describe('cleanup', 'info', 'Old-file cleanup is running', 'DUMB is processing the reviewed old files. Keep the retained recovery archives.', '', true), showProgress: false }
  if (job.cleanup?.state === 'failed') return describe('cleanup_failed', 'warning', 'Old-file cleanup needs review', 'Review the cleanup error before removing more files. Retained archives stay protected.', 'Review the retained cleanup result; cleanup is never retried automatically.')
  if (consumerRecovery || (job.recovery_required === true && job.status !== 'rolling_back') || ['recovery_required', 'interrupted'].includes(job.status)
    || (exposed && !['completed', 'rolled_back', 'failed_rolled_back', 'cancelled'].includes(job.status))) {
    if (consumerRecovery && job.status === 'completed') return describe('completed', 'success', 'InfiniDysk 2 is selected', 'The upgrade finished. Review the retained service results below.', consumerRecovery.pending.length ? 'The listed pending services remain stopped by review. Resolve their errors before starting them.' : 'Verify playback and imports before retiring v1.')
    return describe('recovery', 'warning', exposed ? 'InfiniDysk 2 service recovery needs review' : migration ? 'Migration recovery needs review' : 'Database recovery needs review',
      sourceRestored ? 'DUMB restored the original source, but the backend still requires recovery review.' : 'This operation is waiting for an explicit recovery action.',
      'Use only the recovery controls currently offered below. No recovery or retry starts automatically.')
  }
  if (['failed_restored', 'failed_rolled_back', 'rolled_back', 'cancelled'].includes(job.status) && sourceRestored) {
    const failed = ['failed_restored', 'failed_rolled_back'].includes(job.status)
    const label = test ? 'Test migration' : migration ? 'Migration' : 'Database operation'
    const title = failed ? label + ' failed; ' + (legacy ? 'v1 restored' : 'original source restored')
      : job.status === 'cancelled' ? label + ' cancelled; ' + (legacy ? 'v1 restored' : 'original source restored')
        : legacy ? 'Migration rolled back to v1' : migration ? 'Original setup restored' : 'SQLite snapshot restored'
    return describe('restored', failed ? 'warning' : 'neutral', title,
      legacy ? 'DUMB restored the saved v1 state. This attempt did not select InfiniDysk 2.' : migration ? 'DUMB restored the previous setup.' : 'DUMB verified and restored the SQLite snapshot.',
      failed ? 'Review the error below and resolve it before requesting a fresh preview and another test. Nothing retries automatically.' : 'Check the restored services before requesting another operation.')
  }
  if (job.status === 'rehearsed' && test && job.result?.validated === true) return describe('test_passed', 'success', 'Test migration passed',
    runtimeGeneration === '1' ? 'InfiniDysk 1 remains selected. The upgrade has not started.' : 'The reviewed test passed. Starting the upgrade remains a separate action.',
    'Review the test report, then choose Start migration when ready. Changing your choices requires another review and test.')
  if (job.status === 'completed') return describe('completed', 'success', migration ? 'Migration completed' : 'Database operation completed',
    migration && (runtimeGeneration === '2' || job.result?.generation_2_started === true) ? 'InfiniDysk 2 is selected.' : 'Review the retained result and current service state.',
    migration ? 'Verify playback and imports before retiring v1.' : 'Confirm the selected database provider and application health.')
  if (['failed_restored', 'failed_rolled_back', 'failed', 'error'].includes(job.status)) return describe('failed', 'warning',
    test ? 'Test migration did not pass' : migration ? 'Migration stopped' : 'Database operation stopped',
    'The attempt ended, but this response does not confirm the original source was restored.',
    'Refresh status and review the error before requesting another operation. Nothing retries automatically.')
  if (!migration && job.status === 'cancelled') return describe('stopped', 'neutral', 'Database conversion cancelled', 'SQLite remains active. Review any retained native cleanup warning below.', 'No retry or provider change starts automatically.')
  if (['cancelled', 'canceled', 'rolled_back'].includes(job.status)) return describe('stopped', 'neutral',
    job.status === 'rolled_back' ? 'Migration rolled back' : 'Operation cancelled',
    'The operation ended. Refresh status to confirm the selected source and services.', 'No retry starts automatically.')
  if (runningJobStatuses.has(job.status)) return describe('running', 'info',
    test ? 'Test migration is running' : migration ? 'Migration is running' : 'Database operation is running',
    test ? 'DUMB is testing the migration and will restore v1 before this test finishes.' : 'DUMB is processing the current operation.',
    'Keep DUMB and its required storage running until the operation finishes.', true)
  return describe('unknown', 'warning', 'Operation status needs confirmation', 'The backend returned a state this frontend cannot fully classify.', 'Refresh status and keep the retained recovery evidence. No new request starts automatically.')
}

export const infinidyskV2PreviewDuration = (task, startedAt, now) => {
  const start = Number.isFinite(task?.created_at) ? task.created_at * 1000 : startedAt
  const finished = ['completed', 'failed', 'interrupted', 'cancelled'].includes(task?.status)
  const end = finished ? task.updated_at * 1000 : now
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { seconds: Math.floor((end - start) / 1000), finished }
}

export const infinidyskV2PreviewIsLatest = (task, job, intent = null) => {
  if (!task) return false
  if (!job) return true
  if (intent?.job_id === job.job_id && task.task_id !== intent.previous_task_id) return true
  if (['queued', 'running'].includes(task.status) && ['rehearsed', 'failed_restored', 'failed', 'cancelled', 'rolled_back', 'completed'].includes(job.status)) return true
  return Number.isFinite(task.created_at) && Number.isFinite(job.created_at) && task.created_at > job.created_at
}
