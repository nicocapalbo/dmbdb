import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSettingsUtilityCatalog, settingsUtilityHref, SETTINGS_UTILITY_IDS } from '../helper/settingsUtilities.js'

const caps = {
  api_version: '2.24.0', media_library_protection: true,
  symlink_repair: true, database_health_metrics: true,
  postgres_migration: true, infinidysk_v2: true,
  infinidysk_v2_migration_protocol: 1, infinidysk_v2_migration: true,
  infinidysk_v2_postgres: true, seerr_sync: true, plex_status_metric: true,
}
const service = (key, name, config = {}, extra = {}) => ({
  config_key: key, process_name: name, enabled: config.enabled === true, config, ...extra,
})
const catalog = (processes, extra = {}) => buildSettingsUtilityCatalog({ processes, capabilities: caps, ...extra })
const ids = row => row.tools.map(tool => tool.id)

test('enabled and running instances expose supported original utilities with exact context', () => {
  const rows = catalog([
    service('plex', 'Plex / Main?#', { enabled: true }),
    service('radarr', 'Radarr UHD', { enabled: false }, { status: 'running' }),
  ])
  assert.deepEqual(ids(rows[0]), ['library-protection', 'database-health', 'plex-status'])
  assert.equal(rows[0].tools[0].processName, 'Plex / Main?#')
  assert.deepEqual(ids(rows[1]), ['database-health', 'database-migration'])
  assert.equal(rows[1].stateLabel, 'Running service')
})

test('default disabled services, installed binaries and standard roots are not actual-use evidence', () => {
  assert.deepEqual(catalog([
    service('plex', 'Unused Plex', { enabled: false, config_dir: '/plex' }, { version: '99.0', installed_source: { source_kind: 'release' } }),
    service('infinidysk', 'Unused InfiniDysk', { enabled: false, runtime_generation: '1', symlink_backup_roots: ['/mnt/debrid/infinidysk-symlinks'], symlink_backup_path: '/config/symlink-repair/snapshots/{process_slug}-{timestamp}.json' }),
  ]), [])
})

test('synthesized policy defaults and disabled arrangement placeholders do not qualify unused services', () => {
  const processes = [service('plex', 'Plex', { enabled: false })]
  assert.deepEqual(catalog(processes, { globalConfig: { media_protection: { enabled: true, services: [] } }, mediaProtectionStatus: { enabled: true } }), [])
  assert.deepEqual(catalog(processes, { globalConfig: { media_protection: { services: [{ process_name: 'Plex', enabled: false, protected_mounts: [], stop_when_idle_on_outage: true }] } } }), [])
})

test('explicit custom media policies and recorded incidents retain disabled instances without cross-instance leakage', () => {
  const processes = [service('jellyfin', 'Jellyfin Main', { enabled: false }), service('jellyfin', 'Jellyfin Kids', { enabled: false })]
  const rows = catalog(processes, { globalConfig: { dumb: { media_protection: { services: [{ process_name: 'Jellyfin Kids', enabled: false, api_key_configured: true }] } } } })
  assert.deepEqual(rows.map(row => row.processName), ['Jellyfin Kids'])
  assert.deepEqual(ids(rows[0]), ['library-protection'])
  assert.equal(catalog(processes, { mediaProtectionStatus: { recent: [{ target_process: 'Provider', media_servers: [{ process_name: 'Jellyfin Main' }] }] } })[0].processName, 'Jellyfin Main')
})

test('saved symlink policy or backend history qualifies disabled service tools and preserves per-instance names', () => {
  const rows = catalog([
    service('decypharr', 'Decypharr Archive', { enabled: false, symlink_backup_enabled: true }),
    service('riven_backend', 'Riven Old', { enabled: false }, { symlink_backup_status: { last_backup_at: 123 } }),
    service('cli_debrid', 'CLI Other', { enabled: false }, { symlink_backup_status: { process_name: 'Wrong instance', last_backup_at: 123 } }),
  ])
  assert.deepEqual(rows.map(row => row.processName), ['Decypharr Archive', 'Riven Old'])
  assert.ok(rows.every(row => ids(row).includes('symlinks')))
})

test('strict capability advertisements and service-key scopes prevent unsupported or old-backend actions', () => {
  const processes = [service('plex', 'Plex', { enabled: true }), service('radarr', 'Radarr', { enabled: true })]
  assert.deepEqual(catalog(processes, { capabilities: null }), [])
  assert.deepEqual(catalog(processes, { capabilities: { media_library_protection: 'true', symlink_repair: 1 } }), [])
  assert.deepEqual(catalog(processes, { capabilities: { ...caps, media_library_protection_service_keys: [], database_health_service_keys: [], plex_status_metric: false, postgres_migration: false } }), [])
  const legacy = catalog([service('sonarr', 'Sonarr', { enabled: true }), service('lidarr', 'Lidarr', { enabled: true })], { capabilities: { arr_postgres_migration: true } })
  assert.deepEqual(legacy.map(row => row.processName), ['Sonarr'])
})

test('native FUSE and unknown provider state never expose inappropriate rclone optimizer actions', () => {
  const processes = [service('rclone', 'Rclone InfiniDysk', { enabled: true, key_type: 'infinidysk' })]
  const capabilities = { ...caps, rclone_optimizer_infinidysk: true, infinidysk_v2_rclone_optimizer: true }
  assert.deepEqual(catalog(processes, { capabilities }), [])
  assert.deepEqual(catalog(processes, { capabilities, evidenceByProcess: { 'Rclone InfiniDysk': { providerConfirmed: true, providerStatus: { runtime_generation: '2', current: { mount_backend: 'fuse' } } } } }), [])
  assert.deepEqual(ids(catalog(processes, { capabilities, evidenceByProcess: { 'Rclone InfiniDysk': { providerConfirmed: true, providerStatus: { runtime_generation: '2', current: { mount_backend: 'rclone' } } } } })[0]), ['rclone-optimizer'])
})

test('native InfiniDysk routes require strict API version/protocol and avoid legacy conversion tools', () => {
  const processes = [service('infinidysk', 'InfiniDysk Native', { enabled: false, runtime_generation: '2' })]
  const rows = catalog(processes)
  assert.ok(ids(rows[0]).includes('infinidysk-v2-migration'))
  assert.ok(ids(rows[0]).includes('infinidysk-v2-postgres'))
  assert.ok(!ids(rows[0]).includes('database-migration'))
  assert.deepEqual(ids(catalog(processes, { capabilities: { ...caps, api_version: '2.24.0-dev.1', database_health_metrics: false } })[0]), ['symlinks'])
})

test('ambiguous or malformed process contexts never route a utility to another instance', () => {
  assert.deepEqual(catalog([
    service('plex', 'Duplicate', { enabled: true }),
    service('jellyfin', 'Duplicate', { enabled: true }),
    service('plex', 'Bad\nName', { enabled: true }),
    service('', 'No key', { enabled: true }),
  ]), [])
  assert.deepEqual(catalog([service('plex', 'Disabled', { enabled: false }, { enabled: true })]), [])
})

test('only supported tool IDs produce local, safely encoded service links', () => {
  assert.ok(Object.isFrozen(SETTINGS_UTILITY_IDS))
  assert.equal(settingsUtilityHref({ id: 'symlinks', processName: 'Name /?#' }), '/services/Name%20%2F%3F%23?utility=symlinks')
  assert.equal(settingsUtilityHref({ id: 'rclone-optimizer', processName: 'Rclone' }), '/services/Rclone?tab=rclone-optimizer')
  for (const id of ['reset', 'start', 'update', 'javascript:alert(1)', '__proto__']) assert.equal(settingsUtilityHref({ id, processName: 'Plex' }), null)
  assert.equal(settingsUtilityHref({ id: 'symlinks', processName: '\ud800' }), null)
})

test('catalog output contains utility context rather than configuration secrets', () => {
  const rows = catalog([service('plex', 'Plex', { enabled: true, env: { TOKEN: 'fixture-secret' } })])
  assert.ok(!JSON.stringify(rows).includes('fixture-secret'))
})

test('database provider flags alone never infer use for disabled default services', () => {
  for (const key of ['infinidysk', 'sonarr', 'radarr', 'zilean']) {
    assert.deepEqual(catalog([service(key, 'Unused ' + key, {
      enabled: false, database_provider: 'postgres', database_type: 'postgresql', db_provider: 'postgres',
    })]), [])
  }
})

test('tracked default per-service symlink paths do not qualify unused services', () => {
  for (const [key, slug, root] of [
    ['cli_debrid', 'cli-debrid', '/mnt/debrid/clid_symlinks'],
    ['decypharr', 'decypharr', '/mnt/debrid/decypharr_symlinks'],
    ['infinidysk', 'infinidysk', '/mnt/debrid/infinidysk-symlinks'],
    ['nzbdav', 'nzbdav', '/mnt/debrid/nzbdav-symlinks'],
    ['riven_backend', 'riven-backend', '/mnt/debrid/riven_symlinks'],
  ]) {
    assert.deepEqual(catalog([service(key, 'Unused ' + key, {
      enabled: false, symlink_backup_enabled: false,
      symlink_backup_path: '/config/symlink-repair/snapshots/' + slug + '-{timestamp}.json',
      symlink_backup_roots: [root], symlink_backup_include_broken: true,
      symlink_backup_interval: 168, symlink_backup_start_time: '04:00',
    })]), [])
  }
})
