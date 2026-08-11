const normalizeVersion = (value) => String(value || '').trim().toLowerCase().replace(/^v/, '')

const normalizeServiceKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const fixedReleaseTarget = (config, serviceKey) => {
  if (config?.release_version_enabled !== true) return null
  const value = String(config?.release_version || '').trim()
  const normalized = value.toLowerCase()
  if (!value || normalized === 'latest' || normalized === 'prerelease' || normalized.includes('nightly')) {
    return null
  }

  const key = normalizeServiceKey(serviceKey)
  if (['nzbdav', 'infinidysk'].includes(key) && !/\d/.test(value)) return null
  return { kind: 'release', value, label: value }
}

export const resolveConfiguredSourceTarget = (config, serviceKey = '') => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null

  const pinnedVersion = String(config.pinned_version || '').trim()
  if (pinnedVersion) {
    return { kind: 'version', value: pinnedVersion, label: pinnedVersion }
  }

  const commit = String(config.commit_sha || '').trim().toLowerCase()
  if (commit) {
    return { kind: 'commit', value: commit, label: commit.slice(0, 12) }
  }

  if (config.branch_enabled === true) {
    const branch = String(config.branch || 'main').trim() || 'main'
    return { kind: 'branch', value: branch, label: branch }
  }

  return fixedReleaseTarget(config, serviceKey)
}

export const configuredSourceTargetInstalled = (target, status, currentVersion) => {
  if (!target) return false
  const current = String(status?.current_version || currentVersion || '').trim()
  const available = String(status?.available_version || '').trim()
  const statusKind = String(status?.configured_target_kind || '').trim().toLowerCase()

  if (target.kind === 'branch') {
    return statusKind === 'branch'
      && status?.configured_target_installed === true
      && normalizeVersion(current) === normalizeVersion(available)
      && available.toLowerCase().startsWith(`${target.value.toLowerCase()}-`)
  }

  if (target.kind === 'commit') {
    const marker = `commit-${target.value.slice(0, 12)}`
    return normalizeVersion(current) === normalizeVersion(marker)
  }

  if (target.kind === 'release' || target.kind === 'version') {
    return normalizeVersion(current) === normalizeVersion(target.value)
  }

  return false
}
