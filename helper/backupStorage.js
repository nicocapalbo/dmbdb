export const backupStorageSupported = (capabilities, kind) => capabilities?.backup_storage_selection === true
  && capabilities?.backup_storage_protocol === 1
  && Array.isArray(capabilities?.backup_storage_kinds) && capabilities.backup_storage_kinds.includes(kind)

export const backupStoragePermissionFields = (capabilities, allowSharedPermissions) => capabilities?.backup_storage_shared_permissions === true
  ? { allow_shared_permissions: allowSharedPermissions === true } : {}

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

export const backupStorageManagementSupported = (capabilities, kind = 'symlink_manifest') => backupStorageSupported(capabilities, kind)
  && capabilities?.backup_storage_profile_management === true && capabilities?.backup_storage_management_protocol === 1

export const backupStorageRevalidationSupported = (capabilities, kind = 'symlink_manifest') => backupStorageManagementSupported(capabilities, kind)
  && capabilities?.backup_storage_revalidation === true

export const backupStorageAvailability = profile => profile?.enabled !== true ? 'Disabled'
  : profile?.registered !== true ? 'Not registered'
    : profile.live_checked !== true ? 'Not checked'
      : profile.ready === true && profile.validation_state === 'ready' ? 'Available at last check' : 'Unavailable at last check'

export const backupStorageUsage = value => Array.isArray(value) ? value.map(item => backupStorageText(typeof item === 'string' ? item : item?.label)).filter(Boolean).slice(0, 50) : []

export const backupStorageRevalidationReady = ({ capabilities, kind = 'symlink_manifest', profile, review, confirmed, busy, now = Date.now() }) => backupStorageRevalidationSupported(capabilities, kind)
  && !busy && confirmed === true && review?.protocol === 1 && review.ready === true && review.revalidation_required === true
  && typeof profile?.id === 'string' && Boolean(profile.id) && typeof profile.path === 'string' && profile.path.startsWith('/')
  && review.destination_id === profile.id && review.registered?.path === profile?.path && review.observed?.path === profile?.path
  && typeof review.token === 'string' && review.token.length > 0 && review.token.length <= 4096 && !/\s/.test(review.token)
  && Number.isSafeInteger(review.expires_at) && review.expires_at * 1000 > now
