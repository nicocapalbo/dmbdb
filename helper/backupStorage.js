export const backupStorageSupported = (capabilities, kind) => capabilities?.backup_storage_selection === true
  && capabilities?.backup_storage_protocol === 1
  && Array.isArray(capabilities?.backup_storage_kinds) && capabilities.backup_storage_kinds.includes(kind)

export const backupStorageText = value => typeof value === 'string' ? value
  .replace(/(?:https?|postgres(?:ql)?|smb|nfs):\/\/[^\s<>"']+/gi, '[URL omitted]')
  .replace(/\b(password|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]').slice(0, 1600) : ''

export const backupStorageError = error => backupStorageText(error?.response?.data?.detail?.message
  || error?.response?.data?.detail || error?.data?.detail?.message || error?.data?.detail)
  || 'Storage could not be confirmed. Refresh and review the backend before retrying.'

export const backupDestinationFields = (capabilities, destination, kind = 'symlink_manifest') => (
  backupStorageSupported(capabilities, kind) && typeof destination === 'string' && destination
    ? { backup_destination_id: destination } : {}
)

export const backupStorageCatalog = value => value?.protocol === 1 && Array.isArray(value.destinations) ? {
  default_destination_id: typeof value.default_destination_id === 'string' ? value.default_destination_id : '',
  destinations: value.destinations.filter(item => item && typeof item.id === 'string' && item.id && item.id !== '@default'),
} : null

export const backupDestinationProfile = (catalog, selection) => catalog?.destinations?.find(item => item.id === (
  selection === '@default' ? catalog.default_destination_id : selection
)) || null

export const symlinkBackupPayload = ({ capabilities, destination, processName, path, includeBroken, roots }) => {
  if (destination && !backupStorageSupported(capabilities, 'symlink_manifest')) throw new Error('The selected backup destination is not supported by this backend. Refresh storage capabilities before retrying.')
  const selected = backupDestinationFields(capabilities, destination)
  if (!selected.backup_destination_id && !String(path || '').trim()) throw new Error('Backup manifest path is required.')
  return { process_name: processName, ...selected, ...(!selected.backup_destination_id ? { backup_path: String(path).trim() } : {}), include_broken: includeBroken, ...(roots ? { roots } : {}) }
}
