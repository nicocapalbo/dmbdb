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

// Compare known package versions only. Branch and commit markers are intentionally
// left unclassified so that a newer frontend commit is never hidden as a downgrade.
const parseProjectVersion = (value) => {
  if (typeof value !== 'string' || value.length > 160) return null
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/i.exec(value.trim())
  if (!match) return null
  const prerelease = match[4] ? match[4].split('.') : []
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return null
  return { core: match.slice(1, 4).map(BigInt), prerelease }
}

export const compareProjectVersions = (left, right) => {
  const a = parseProjectVersion(left)
  const b = parseProjectVersion(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export const projectNoticeActionable = (notice, currentVersion = '') => {
  if (!notice || (notice.type && notice.type !== 'available')) return !!notice
  const targetKind = notice.configured_target_kind
  if (['branch', 'commit', 'release', 'version'].includes(targetKind)) {
    if (notice.configured_target_installed === true) return false
    if (notice.configured_target_installed === false) return true
    if (targetKind === 'branch' || targetKind === 'commit') return true
  }
  const comparison = compareProjectVersions(notice.available_version, currentVersion || notice.current_version)
  return comparison === null || comparison > 0
}

export const projectNoticeCurrentVersion = (notice, processes = []) => {
  const kind = projectComponentKind(notice?.process_name || notice?.display_name)
  const service = kind && Array.isArray(processes) && processes.find((row) => projectServiceKind(row) === kind)
  return service?.version || notice?.current_version || ''
}

export const actionableProjectNotices = (notices, processes = []) => (
  Array.isArray(notices) ? notices.filter((notice) => projectNoticeActionable(
    notice, projectNoticeCurrentVersion(notice, processes),
  )) : []
)

export const projectNoticeForService = (notices, service) => {
  const serviceKind = projectServiceKind(service)
  if (!serviceKind || !Array.isArray(notices)) return null
  return notices.find((notice) => (
    projectComponentKind(notice?.process_name || notice?.display_name) === serviceKind
    && projectNoticeActionable(notice, service?.version)
  )) || null
}

export const isDevelopmentVersion = (version) => /(?:^|[._-])dev(?:[._-]|$)/i.test(String(version || ''))

export const aboutUpdateLabel = (notice, currentVersion = '') => {
  if (!projectNoticeActionable(notice, currentVersion)) return ''
  const distance = releaseDistanceLabel(notice)
  if (distance) return `Update available · ${distance}`
  if (isDevelopmentVersion(currentVersion) && parseProjectVersion(notice.available_version)?.prerelease.length === 0
    && !['branch', 'commit'].includes(notice.configured_target_kind)) return 'Stable release available'
  return 'Update available'
}
