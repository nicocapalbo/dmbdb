const names = new Map([
  ['infinidysk', 'Downloads and makes your media available'], ['decypharr', 'Downloads and makes your media available'],
  ['altmount', 'Makes your Usenet media available'], ['sonarr', 'Finds and organizes TV shows'],
  ['radarr', 'Finds and organizes movies'], ['lidarr', 'Finds and organizes music'], ['readarr', 'Finds and organizes books'],
  ['whisparr', 'Finds and organizes your selected library'], ['bazarr', 'Finds subtitles for your movies and shows'],
  ['prowlarr', 'Shares your search sources with your library apps'], ['plex', 'Lets you browse and play your library'],
  ['jellyfin', 'Lets you browse and play your library'], ['emby', 'Lets you browse and play your library'],
  ['audiobookshelf', 'Lets you browse and listen to audiobooks and podcasts'], ['seerr', 'Lets people request movies and shows'],
  ['tautulli', 'Shows activity and playback history'], ['maintainerr', 'Helps manage what stays in your library'],
])
const flow = ['infinidysk', 'decypharr', 'altmount', 'prowlarr', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'bazarr', 'plex', 'jellyfin', 'emby', 'audiobookshelf', 'seerr']
export const setupReviewServiceName = service => service?.name || service?.label || service?.service_key || service?.key || service?.id || 'App'
export const setupReviewServicePurpose = service => names.get(service?.service_key || String(service?.id || service?.key || '').split('.')[0]) || 'Adds the feature you selected'
export function setupReviewServiceGroups(services = []) {
  const groups = { chosen: [], required: [], external: [], companions: [] }
  for (const service of services) {
    const group = service.external || service.selection_kind === 'external' ? 'external'
      : service.selected || service.selection_kind === 'chosen' ? 'chosen'
        : service.required || service.selection_kind === 'required' || service.requirement === 'Required dependency' ? 'required' : 'companions'
    groups[group].push(service)
  }
  for (const group of Object.values(groups)) group.sort((a, b) => {
    const order = service => { const index = flow.indexOf(service.service_key || String(service.id || service.key || '').split('.')[0]); return index < 0 ? flow.length : index }
    return order(a) - order(b) || setupReviewServiceName(a).localeCompare(setupReviewServiceName(b))
  })
  return groups
}
export function setupReviewBlocker(check, services = []) {
  const service = services.find(service => service.id === check.resource_id)
  const name = service ? setupReviewServiceName(service) : 'an app'
  if (String(check.key || '').startsWith('storage:')) return {
    title: `DUMB cannot prepare ${name}'s folders`,
    explanation: 'This is an installation or storage-permissions issue. It is not a connection choice you need to fill in here.',
    next: 'Ask the person who manages this DUMB installation to check the folder and its permissions, then refresh this review.',
  }
  if (/native.transition|infinidysk.*(?:migration|runtime)/i.test(check.key || '')) return {
    title: 'Finish the InfiniDysk 2 installation or upgrade first',
    explanation: 'Changing the selected version does not install or convert its data.',
    next: 'Return to installation choices and complete the InfiniDysk 2 wizard, then refresh this review.',
  }
  if (/port/i.test(check.key || '')) return {
    title: `A network port for ${name} needs attention`,
    explanation: 'Another app may already be using the connection DUMB needs.',
    next: 'Review the app options, or ask the person who manages DUMB to choose an available port, then refresh this review.',
  }
  return { title: 'A setup check needs attention before starting', explanation: 'DUMB found something that would prevent this setup from starting safely.', next: 'Open the details below for the check, or ask the person who manages DUMB for help, then refresh this review.' }
}
export const setupReviewBlockingChecks = plan => (plan?.checks || []).filter(check => check.critical === true && check.ok === false)
export const setupReviewRemainingActions = plan => (plan?.actions || []).filter(action =>
  action.kind !== 'native_transition' && action.automation !== 'automatic'
  && !(action.automation === 'after_input' && action.explicit_only !== true
    && Array.isArray(action.missing_inputs) && action.missing_inputs.length === 0
    && action.execution === 'planned')
  && !['applied', 'already_present', 'user_confirmed'].includes(action.execution))
