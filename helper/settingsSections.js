// Only explicit user actions create this record. Older automatic open flags
// do not establish a preference for the collapsed-by-default Settings layout.
export const settingsSectionStorageKey = id => `dmbdb.settings.section.${id}.user-choice`

export const readSettingsSectionChoice = (storage, id) => {
  try {
    const value = JSON.parse(storage?.getItem(settingsSectionStorageKey(id)) || 'null')
    return value?.schema_version === 1 && value.user_applied === true && typeof value.open === 'boolean' ? value.open : false
  } catch { return false }
}

export const writeSettingsSectionChoice = (storage, id, open) => {
  if (typeof open !== 'boolean') return false
  try {
    if (!storage) return false
    storage.setItem(settingsSectionStorageKey(id), JSON.stringify({ schema_version: 1, user_applied: true, open }))
    return true
  } catch { return false }
}

export const settingsSectionHashMatches = (hash, id) => {
  if (typeof hash !== 'string') return false
  try {
    const target = decodeURIComponent(hash.replace(/^#/, ''))
    return target === id || target === `settings-section-${id}`
  } catch { return false }
}
