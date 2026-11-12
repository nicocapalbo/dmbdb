import { SETTINGS_UTILITY_IDS } from './settingsUtilities.js'

// A Settings shortcut can open an existing utility, never perform its work.
// The original service toolbar supplies its current capability/admission guards.
export const openServiceUtility = (id, groups, beforeOpen = () => {}) => {
  if (typeof id !== 'string' || !SETTINGS_UTILITY_IDS.includes(id)) return { status: 'unknown' }
  const item = (Array.isArray(groups) ? groups : []).flatMap(group => Array.isArray(group?.items) ? group.items : [])
    .find(tool => tool?.id === id)
  if (!item || !item.visible || typeof item.onSelect !== 'function') {
    return { status: 'unavailable', message: 'This utility is unavailable for this service or backend version.' }
  }
  if (item.disabled) return { status: 'blocked', message: item.description || 'Complete the required service preparation before opening this utility.' }
  beforeOpen()
  if (item.status !== 'Open') item.onSelect()
  return { status: 'opened' }
}
