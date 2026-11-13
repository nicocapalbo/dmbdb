export const backupCompressionSchemaSupported = capabilities => capabilities?.installation_backup_compression === true
export const backupCompressionSupported = capabilities => backupCompressionSchemaSupported(capabilities) && capabilities?.installation_backup_zstd === true
export const backupCompressionMode = value => value === undefined ? 'none' : ['none', 'zstd'].includes(value) ? value : null
export const backupCompressionValid = (capabilities, value) => {
  const mode = backupCompressionMode(value)
  return mode !== null && (mode === 'none' || backupCompressionSupported(capabilities))
}
export const backupCompressionFields = (capabilities, value) => {
  const mode = backupCompressionMode(value)
  if (mode === null) throw new Error('Choose an uncompressed tar or Zstandard archive format before continuing.')
  if (!backupCompressionValid(capabilities, mode)) throw new Error('This backend does not advertise Zstandard backup support. Choose uncompressed tar or refresh support before continuing.')
  return backupCompressionSchemaSupported(capabilities) ? { compression: mode } : {}
}
export const backupArchiveFormat = archive => {
  const value = archive?.compression === undefined && archive?.extension === 'tar.zst' ? 'zstd' : archive?.compression
  const mode = backupCompressionMode(value)
  return mode === 'zstd' ? 'Zstandard (.tar.zst)' : mode === 'none' ? 'Uncompressed tar (.tar)' : 'Unrecognized archive format'
}
