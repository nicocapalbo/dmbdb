const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export function whisparrProfilesSupported(config) {
  return isRecord(config) && Object.hasOwn(config, 'whisparr_profiles') && isRecord(config.whisparr_profiles)
}

export function whisparrVersionChoice(config) {
  const version = String(config?.whisparr_version || '').trim().toLowerCase()
  return ['v2', 'v3'].includes(version) ? version : ''
}

export function selectWhisparrVersion(draft, savedConfig, version) {
  if (!whisparrProfilesSupported(savedConfig)) throw new Error('This backend does not support saved Whisparr libraries.')
  if (!isRecord(draft)) throw new Error('Fix the configuration JSON before choosing a Whisparr version.')
  if (!['', 'v2', 'v3'].includes(version)) throw new Error('Choose a supported Whisparr version.')
  if (savedConfig.postgres_enabled === true || draft.postgres_enabled === true) {
    throw new Error('Use a separate Whisparr instance and PostgreSQL database for each version.')
  }
  return { ...draft, whisparr_version: version }
}

export function savedWhisparrProfile(config, version) {
  if (!whisparrProfilesSupported(config) || !['v2', 'v3'].includes(version)) return null
  const profile = config.whisparr_profiles[version]
  return isRecord(profile) && profile.initialized === true && typeof profile.config_dir === 'string'
    && profile.config_dir.trim() ? profile : null
}
