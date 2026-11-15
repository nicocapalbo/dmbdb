import { infinidyskCompatibilityAuthRequired, safeInfiniDyskV2Text as text } from './infinidyskV2.js'

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
