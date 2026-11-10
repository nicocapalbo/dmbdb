const categories = [
  {
    key: 'access-security',
    title: 'Access and security',
    description: 'Manage sign-in, public access, and reverse proxy routes.',
    serviceKeys: ['authelia', 'cloudflared', 'traefik_proxy_admin', 'traefik']
  },
  {
    key: 'databases-administration',
    title: 'Databases and administration',
    description: 'Store application data and manage databases.',
    serviceKeys: ['pgadmin', 'postgres', 'phalanx_db']
  },
  {
    key: 'download-workflows',
    title: 'Download workflows',
    description: 'Connect Debrid, Usenet, and mounted media workflows.',
    serviceKeys: ['altmount', 'cli_debrid', 'cli_battery', 'decypharr', 'infinidysk', 'nzbdav', 'riven_backend', 'rclone', 'zurg']
  },
  {
    key: 'library-automation',
    title: 'Library automation',
    description: 'Organize libraries, subtitles, profiles, and upgrades.',
    serviceKeys: ['bazarr', 'lidarr', 'maintainerr', 'neutarr', 'profilarr', 'radarr', 'sonarr', 'whisparr']
  },
  {
    key: 'media-playback',
    title: 'Media servers and playback',
    description: 'Browse and play movies, shows, music, and audiobooks.',
    serviceKeys: ['aiostreams', 'audiobookshelf', 'mediastorm', 'emby', 'jellyfin', 'plex']
  },
  {
    key: 'requests-discovery',
    title: 'Requests and discovery',
    description: 'Find media, search indexers, and handle requests.',
    serviceKeys: ['pulsarr', 'seerr', 'prowlarr', 'zilean']
  },
  {
    key: 'utilities-interfaces',
    title: 'Utilities and interfaces',
    description: 'Add companion interfaces and usage monitoring.',
    serviceKeys: ['riven_frontend', 'tautulli']
  }
]

const fallbackCategory = {
  key: 'other-services',
  title: 'Other services',
  description: 'Additional services provided by your backend.'
}
const categoryByService = new Map(
  categories.flatMap(category => category.serviceKeys.map(key => [key, category]))
)
const compareNames = (left, right) => String(left).localeCompare(String(right), 'en', { sensitivity: 'base' })

// Group display metadata only. Keep backend filtering and service objects intact.
export function groupOnboardingServices(services) {
  const groups = new Map()
  for (const service of Array.isArray(services) ? services : []) {
    if (!service || typeof service !== 'object') continue
    const advertised = Array.isArray(service.roles)
      ? service.roles.find(role => role && typeof role.key === 'string' && role.key && typeof role.title === 'string' && role.title)
      : null
    const known = categoryByService.get(service.key)
    const category = advertised ? {
      key: advertised.key,
      title: advertised.title,
      description: advertised.description || categories.find(category => category.key === advertised.key)?.description || '',
    } : known || fallbackCategory
    if (!groups.has(category.key)) {
      groups.set(category.key, {
        key: category.key,
        title: category.title,
        description: category.description,
        services: []
      })
    }
    groups.get(category.key).services.push(service)
  }
  return Array.from(groups.values())
    .map(group => ({
      ...group,
      services: group.services.sort((left, right) =>
        compareNames(left.name || left.key, right.name || right.key) ||
        compareNames(left.key, right.key)
      )
    }))
    .sort((left, right) => compareNames(left.title, right.title))
}
