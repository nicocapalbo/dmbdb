export const releaseDistanceLabel = (notice) => {
  const count = Number(notice?.releases_behind)
  if (!Number.isInteger(count) || count <= 0) return ''
  return `${count} release${count === 1 ? '' : 's'} behind`
}

const normalizedProjectName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')

export const projectComponentKind = (value) => {
  const name = normalizedProjectName(value)
  if (!name) return ''
  if (name === 'dumbfrontend' || name === 'dmbfrontend') return 'frontend'
  if (name === 'dumb' || name === 'dumbapi' || name === 'dmb' || name === 'dmbapi') return 'api'
  return ''
}

export const projectServiceKind = (service) => (
  projectComponentKind(service?.process_name)
  || projectComponentKind(service?.display_name)
  || projectComponentKind(service?.config_key)
)

export const projectNoticeForService = (notices, service) => {
  const serviceKind = projectServiceKind(service)
  if (!serviceKind || !Array.isArray(notices)) return null
  return notices.find((notice) => (
    projectComponentKind(notice?.process_name || notice?.display_name) === serviceKind
  )) || null
}

export const isDevelopmentVersion = (version) => /(?:^|[._-])dev(?:[._-]|$)/i.test(String(version || ''))

export const aboutUpdateLabel = (notice, currentVersion = '') => {
  if (!notice) return ''
  const distance = releaseDistanceLabel(notice)
  if (distance) return `Update available · ${distance}`
  if (isDevelopmentVersion(currentVersion)) return 'Stable release available'
  return 'Update available'
}
