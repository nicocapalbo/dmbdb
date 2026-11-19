const paths = {
  keep_local: { label: 'Keep v1 data locally', explanation: 'Create a separate local working copy. This needs more local free space and keeps v1 available for restoration.' },
  reuse_local: { label: 'Reuse the v1 directory', explanation: 'Avoid the extra working copy during preparation. Restoring v1 must rebuild it from its verified archive.' },
  external_blobs: { label: 'Move v1 blobs to external storage', explanation: 'Copy and read back the legacy input on migration storage before removing the local copy. The importer also reads that storage.' },
}
const legs = {
  candidate_copy: 'Copy local working data', blob_copy: 'Copy input to migration storage', blob_readback: 'Verify the external input copy',
  retained_source_check: 'Check retained local data', archive_reuse_checks: 'Verify the archive before reusing v1 storage',
  archive_acceptance: 'Check the archive before activation', archive_restore_checks: 'Verify the archive before restoring v1',
  archive_restore: 'Rebuild v1 from its recovery archive', restored_readback: 'Verify the restored v1 data',
}
const bytes = value => Number.isSafeInteger(value) && value >= 0
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const parseLegs = value => {
  if (!Array.isArray(value) || value.length > 8 || new Set(value.map(row => row?.id)).size !== value.length
    || !value.every(row => object(row) && Object.hasOwn(legs, row.id)
      && ['local', 'archive'].includes(row.storage) && Number.isSafeInteger(row.passes) && row.passes > 0 && row.passes <= 10
      && typeof row.minimum === 'boolean'
      && (row.read_bytes == null || bytes(row.read_bytes)) && (row.write_bytes == null || bytes(row.write_bytes)))) return null
  return value.map(row => ({ id: row.id, label: legs[row.id], readBytes: row.read_bytes ?? null,
    writeBytes: row.write_bytes ?? null, storage: row.storage,
    storageLabel: row.id === 'blob_copy' ? 'local to migration storage' : row.id === 'archive_restore' ? 'migration to local storage'
      : row.storage === 'archive' ? 'migration storage' : 'local storage',
    passes: row.passes, minimum: row.minimum }))
}
const sum = (rows, field) => rows.every(row => bytes(row[field])) && Number.isSafeInteger(rows.reduce((total, row) => total + row[field], 0))
  ? rows.reduce((total, row) => total + row[field], 0) : null

export const infinidyskV2StorageWork = value => {
  if (!object(value) || value.protocol !== 1 || value.comparison_basis !== 'logical_io_same_storage'
    || value.ranking !== 'not_estimated'
    || !Object.hasOwn(paths, value.selected_path) || !['local', 'network', 'unknown'].includes(value.archive_storage_type)
    || typeof value.archive_required !== 'boolean' || !Array.isArray(value.paths) || value.paths.length !== 3
    || new Set(value.paths.map(row => row?.id)).size !== 3) return null
  const rows = []
  for (const row of value.paths) {
    if (!object(row) || !Object.hasOwn(paths, row.id) || typeof row.selected !== 'boolean'
      || row.selected !== (row.id === value.selected_path) || row.preparation_order !== null
      || typeof row.requires_registered_archive !== 'boolean') return null
    const phases = ['preparation', 'activation', 'restoration'].map(id => {
      const parsed = parseLegs(row[id])
      return parsed ? { id, label: { preparation: 'Prepare', activation: 'Activate', restoration: 'Restore v1 if needed' }[id],
        legs: parsed, readBytes: sum(parsed, 'readBytes'), writeBytes: sum(parsed, 'writeBytes'), minimum: parsed.some(leg => leg.minimum) } : null
    })
    if (phases.some(phase => !phase)) return null
    rows.push({ id: row.id, ...paths[row.id], selected: row.selected,
      needsArchive: row.requires_registered_archive, phases })
  }
  return { paths: ['keep_local', 'reuse_local', 'external_blobs'].map(id => rows.find(row => row.id === id)), selected: value.selected_path,
    storageType: value.archive_storage_type, archiveRequired: value.archive_required,
    sourceDataBytes: bytes(value.source_data_bytes) ? value.source_data_bytes : null,
    sourceTotalBytes: bytes(value.source_total_bytes) ? value.source_total_bytes : null,
    legacyBlobBytes: bytes(value.legacy_blob_bytes) ? value.legacy_blob_bytes : null,
    archiveBytes: bytes(value.archive_bytes) ? value.archive_bytes : null,
    archiveBytesIsMinimum: value.archive_bytes_is_minimum === true }
}
