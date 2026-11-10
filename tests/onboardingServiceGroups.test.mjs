import assert from 'node:assert/strict'
import test from 'node:test'
import { groupOnboardingServices } from '../helper/onboardingServiceGroups.js'

const currentCoreKeys = [
  'plex', 'jellyfin', 'emby', 'cli_debrid', 'decypharr', 'infinidysk',
  'altmount', 'riven_backend', 'radarr', 'sonarr', 'lidarr', 'prowlarr',
  'whisparr', 'seerr', 'neutarr', 'profilarr',
]
const currentOptionalKeys = [
  'zilean', 'pgadmin', 'postgres', 'riven_frontend', 'tautulli', 'bazarr',
  'pulsarr', 'maintainerr', 'aiostreams', 'audiobookshelf', 'mediastorm',
  'traefik_proxy_admin', 'authelia', 'cloudflared',
]

test('every current onboarding catalog entry has a functional category, including the legacy mount alias', () => {
  const services = [...currentCoreKeys, ...currentOptionalKeys, 'nzbdav']
    .map(key => ({ key, name: key, service_options: { enabled: false } }))
  const categories = groupOnboardingServices(services)
  assert.equal(categories.some(category => category.key === 'other-services'), false)
  const grouped = categories.flatMap(category => category.services)
  assert.equal(grouped.length, services.length)
  assert.deepEqual(new Set(grouped.map(service => service.key)), new Set(services.map(service => service.key)))
  assert.equal(new Set(categories.map(category => category.key)).size, categories.length)
  assert.deepEqual(
    categories.map(category => category.title),
    [
      'Access and security', 'Databases and administration', 'Download workflows',
      'Library automation', 'Media servers and playback', 'Requests and discovery',
      'Utilities and interfaces',
    ],
  )
})

test('services sort by their displayed names without changing API metadata or nested options', () => {
  const names = ['Plex', 'mediastorm', 'jellyfin', 'Emby', 'Audiobookshelf', 'aIOStreams']
  const keys = ['plex', 'mediastorm', 'jellyfin', 'emby', 'audiobookshelf', 'aiostreams']
  const services = Object.freeze(names.map((name, index) => Object.freeze({
    key: keys[index],
    name,
    service_options: Object.freeze({ port: 1000 + index }),
  })))
  const original = JSON.stringify(services)
  const groups = groupOnboardingServices(services)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].services.map(service => service.name),
    ['aIOStreams', 'Audiobookshelf', 'Emby', 'jellyfin', 'mediastorm', 'Plex'])
  assert.equal(JSON.stringify(services), original)
  for (const service of groups[0].services) {
    assert.equal(service, services.find(original => original.key === service.key))
    assert.equal(service.service_options, services.find(original => original.key === service.key).service_options)
  }
})

test('future backend services remain visible alphabetically in Other services and empty categories are omitted', () => {
  const services = [
    { key: 'future_z', name: 'Zulu helper', description: 'Advertised by a newer API' },
    { key: 'future_a', name: 'alpha helper' },
    { key: 'future_b', name: 'Bravo helper' },
  ]
  const groups = groupOnboardingServices(services)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].key, 'other-services')
  assert.equal(groups[0].title, 'Other services')
  assert.deepEqual(groups[0].services.map(service => service.key), ['future_a', 'future_b', 'future_z'])
  assert.equal(groups[0].services[2].description, 'Advertised by a newer API')
})

test('categories only contain the supplied catalog, so unavailable dependencies and capability-gated services stay absent', () => {
  const services = [{ key: 'audiobookshelf', name: 'Audiobookshelf' }]
  const groups = groupOnboardingServices(services)
  assert.deepEqual(groups.flatMap(group => group.services).map(service => service.key), ['audiobookshelf'])
  assert.deepEqual(groupOnboardingServices([]), [])
})

test('equal display names have a deterministic key tie-breaker without renaming services', () => {
  const groups = groupOnboardingServices([
    { key: 'new_z', name: 'Utility' },
    { key: 'new_a', name: 'Utility' },
  ])
  assert.deepEqual(groups[0].services.map(service => service.key), ['new_a', 'new_z'])
  assert.deepEqual(groups[0].services.map(service => service.name), ['Utility', 'Utility'])
})

test('backend-advertised roles own categories while older metadata retains its fallback', () => {
  const future = { key: 'new_application', name: 'New application', roles: [{ key: 'media-playback', title: 'Media servers and playback' }] }
  const existing = { key: 'tautulli', name: 'Tautulli', roles: [{ key: 'monitoring', title: 'Monitoring', description: 'Backend-provided role' }] }
  const groups = groupOnboardingServices([future, existing, { key: 'sonarr', name: 'Sonarr' }])
  assert.deepEqual(groups.map(group => group.title), ['Library automation', 'Media servers and playback', 'Monitoring'])
  assert.equal(groups.find(group => group.key === 'monitoring').description, 'Backend-provided role')
  assert.equal(groups.find(group => group.key === 'media-playback').services[0], future)
})
