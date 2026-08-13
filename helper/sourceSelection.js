export const normalizeReleaseSelection = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  if (config.release_version_enabled !== true) return config
  if (String(config.release_version || '').trim()) return config
  return { ...config, release_version: 'latest' }
}

export const sourceOptionUpdates = (key, value, current = {}) => {
  const updates = { [key]: value }
  if (key === 'commit_sha' && /^[0-9a-fA-F]{40}$/.test(String(value || '').trim())) {
    updates.commit_sha = String(value).trim().toLowerCase()
    updates.release_version_enabled = false
    updates.branch_enabled = false
  } else if (key === 'release_version_enabled' && value === true) {
    updates.commit_sha = ''
    updates.branch_enabled = false
    if (!String(current.release_version || '').trim()) updates.release_version = 'latest'
  } else if (key === 'branch_enabled' && value === true) {
    updates.commit_sha = ''
    updates.release_version_enabled = false
  }
  return updates
}
