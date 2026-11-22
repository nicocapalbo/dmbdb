import { setupWalkthroughActions, setupWalkthroughOutcome } from './setupWalkthrough.js'

export function setupChecklistActions(run = {}, scope = {}) {
  return setupWalkthroughActions(run, { ...scope, includeOptionalChecks: true })
}

export function setupChecklistSummary(actions = []) {
  const summary = { total: actions.length, remaining: 0, required: 0, optional: 0, verified: 0, manual: 0, notRequired: 0 }
  for (const action of actions) {
    const outcome = setupWalkthroughOutcome(action)
    if (!outcome.resolved) {
      summary.remaining++
      summary[action.required === true ? 'required' : 'optional']++
    }
    if (outcome.verified) summary.verified++
    if (outcome.manual && outcome.resolved) summary.manual++
    if (outcome.state === 'not_required') summary.notRequired++
  }
  return summary
}

export function setupChecklistFilteredActions(actions = [], status = 'attention') {
  if (status === 'all') return actions
  return actions.filter(action => {
    const outcome = setupWalkthroughOutcome(action)
    return status === 'checked' ? outcome.resolved && (outcome.verified || outcome.manual) : !outcome.resolved
  })
}

const familyNames = {
  infinidysk: 'InfiniDysk', cli_debrid: 'CLI Debrid', riven: 'Riven', decypharr: 'Decypharr',
  plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby', audiobookshelf: 'Audiobookshelf',
  sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', whisparr: 'Whisparr',
  prowlarr: 'Prowlarr', profilarr: 'Profilarr', bazarr: 'Bazarr', seerr: 'Seerr',
  neutarr: 'NeutArr', postgres: 'PostgreSQL', pgadmin: 'pgAdmin', setup: 'Shared connections',
}
const instanceName = (key, value) => String(value || '').startsWith(key + '.') ? String(value).slice(key.length + 1) : String(value || '')

export function setupChecklistGroups(actions = [], services = []) {
  const groups = new Map()
  for (const action of actions) {
    const family = action.service_key || 'setup'
    const instance = instanceName(family, action.instance_key)
    const key = instance ? family + '.' + instance : family
    if (!groups.has(key)) {
      const service = services.find(item => (item.service_key || item.id?.split('.')[0]) === family
        && instanceName(family, item.instance_key || (item.id?.startsWith(family + '.') ? item.id.slice(family.length + 1) : '')) === instance)
      const name = familyNames[family] || family.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
      groups.set(key, { key, label: service?.process_name || service?.name || (instance ? name + ' — ' + instance : name), actions: [] })
    }
    groups.get(key).actions.push(action)
  }
  return [...groups.values()].map(group => ({ ...group, summary: setupChecklistSummary(group.actions) }))
}
