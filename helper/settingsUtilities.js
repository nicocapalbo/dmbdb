import { capabilityEnabled, postgresMigrationSupported } from './backendCapabilities.js'
import { infinidyskRcloneOptimizerAllowed, infinidyskV2Support } from './infinidyskV2.js'
import { isNzbDavRcloneConfig } from './rcloneOptimizer.js'

export const SETTINGS_UTILITY_IDS = Object.freeze([
  'library-protection', 'symlinks', 'database-health', 'database-migration',
  'infinidysk-v2-migration', 'infinidysk-v2-postgres', 'rclone-optimizer',
  'seerr-sync', 'plex-status',
])
const utilityIds = new Set(SETTINGS_UTILITY_IDS)
const symlinkKeys = new Set(['decypharr', 'infinidysk', 'nzbdav', 'clidebrid', 'rivenbackend'])
const healthDefaults = ['infinidysk', 'nzbdav', 'sonarr', 'radarr', 'lidarr', 'prowlarr', 'whisparr', 'bazarr', 'plex']
const defaultRoots = new Set([
  '/mnt/debrid/decypharr_symlinks', '/mnt/debrid/infinidysk-symlinks',
  '/mnt/debrid/nzbdav-symlinks', '/mnt/debrid/clid_symlinks',
  '/mnt/debrid/riven_symlinks', '/mnt/debrid/combined_symlinks',
])
const definitions = Object.freeze({
  'library-protection': ['Media Protection', 'Review protection policies, mounts and media library settings.'],
  symlinks: ['Symlinks', 'Repair links, compare or restore snapshots, and manage backup schedules.'],
  'database-health': ['Database Health', 'Inspect and configure database monitoring.'],
  'database-migration': ['Database Migration', 'Review the existing guarded database migration and recovery tools.'],
  'infinidysk-v2-migration': ['InfiniDysk 2 migration', 'Review installation, major upgrade and retained recovery.'],
  'infinidysk-v2-postgres': ['InfiniDysk 2 database conversion', 'Review native database conversion and retained recovery.'],
  'rclone-optimizer': ['Rclone Optimizer', 'Open the optimizer for a qualified rclone provider.'],
  'seerr-sync': ['Seerr Sync', 'Configure and inspect Seerr synchronization.'],
  'plex-status': ['Plex Status', 'View cached Plex-operated cloud service status.'],
})
const object = value => value != null && typeof value === 'object' && !Array.isArray(value)
const keyOf = value => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/g, '') : ''
const text = value => typeof value === 'string' && value.trim().length > 0
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const own = (value, key) => object(value) && Object.hasOwn(value, key)
const list = value => Array.isArray(value) ? value : []
const contextName = process => process?.process_name ?? process?.processName
const processKey = process => process?.config_key ?? process?.serviceKey
const advertisedKeys = (capabilities, field, fallback) => new Set(
  (Array.isArray(capabilities?.[field]) ? capabilities[field] : fallback).map(keyOf).filter(Boolean),
)
const validContext = process => text(contextName(process))
  && contextName(process).length <= 512
  && !/[\u0000-\u001f\u007f]/.test(contextName(process))
  && Boolean(keyOf(processKey(process)))

const scoped = (value, name) => object(value)
  && (!own(value, 'process_name') || value.process_name === name)
  && (!own(value, 'processName') || value.processName === name)
const jobUsed = (value, name) => {
  const job = object(value?.job) ? value.job : value
  return scoped(job, name) && text(job.job_id)
    && (job.process_name === name || job.processName === name)
}
const incidentUsed = (status, name) => [...list(status?.active), ...list(status?.recent)].some(incident => (
  object(incident) && (
    incident.target_process === name
    || list(incident.media_servers).some(server => server?.process_name === name)
  )
))
const explicitMediaPolicy = (config, name) => {
  const root = object(config?.dumb) ? config.dumb : config
  return list(root?.media_protection?.services).some(policy => scoped(policy, name)
    && policy.process_name === name
    && (
      policy.enabled === true || policy.api_key_configured === true
      || text(policy.api_key) || list(policy.protected_mounts).some(text)
      || policy.stop_when_idle_on_outage === false
      || positive(policy.updated_at) || positive(policy.created_at)
    ))
}
const symlinkPolicyUsed = config => config.symlink_backup_enabled === true
  || text(config.backup_destination_id)
  || list(config.symlink_backup_roots).some(root => text(root) && !defaultRoots.has(root.trim()))
  || (text(config.symlink_backup_path) && ![
    '/config/symlink-repair/snapshots/{process_slug}-{timestamp}.json',
    '/config/symlink-repair/snapshots/latest.json',
    ...['cli-debrid', 'decypharr', 'infinidysk', 'nzbdav', 'riven-backend']
      .map(slug => '/config/symlink-repair/snapshots/' + slug + '-{timestamp}.json'),
  ].includes(config.symlink_backup_path.trim()))
const symlinkHistoryUsed = (status, name) => scoped(status, name) && (
  positive(status.last_backup_at) || positive(status.last_run_at)
  || positive(status.manifest_count) || text(status.last_manifest)
  || jobUsed(status, name)
)
const recordEvidence = (process, evidence, name) => (
  evidence.used === true || evidence.persistentData === true
  || ['symlink', 'migration', 'optimizer', 'mediaProtection'].some(key => evidence[key] === true)
  || [
    process.symlink_job, process.migration_job, process.postgres_migration_job,
    process.rclone_optimizer_job, evidence.job,
  ].some(job => jobUsed(job, name))
  || symlinkHistoryUsed(process.symlink_backup_status, name)
)
const configUsed = (config, key) => (
  (symlinkKeys.has(key) && symlinkPolicyUsed(config))
  || (['infinidysk', 'nzbdav'].includes(key) && String(config.runtime_generation) === '2')
)
const enabled = (process, config) => own(config, 'enabled')
  ? config.enabled === true : process.enabled === true
const running = process => process.running === true || (
  typeof process.status === 'string' && process.status.toLowerCase() === 'running'
)

export const settingsUtilityHref = ({ id, processName } = {}) => {
  if (!utilityIds.has(id) || !text(processName) || processName.length > 512
    || /[\u0000-\u001f\u007f]/.test(processName)) return null
  try {
    const path = '/services/' + encodeURIComponent(processName)
    return id === 'rclone-optimizer'
      ? path + '?tab=rclone-optimizer'
      : path + '?utility=' + encodeURIComponent(id)
  } catch {
    return null
  }
}

export const buildSettingsUtilityCatalog = ({
  processes = [], capabilities = null, globalConfig = {},
  evidenceByProcess = {}, mediaProtectionStatus = null,
} = {}) => {
  if (!object(capabilities)) return []
  const contexts = list(processes).filter(validContext)
  const counts = new Map()
  for (const process of contexts) counts.set(contextName(process), (counts.get(contextName(process)) || 0) + 1)
  const mediaKeys = advertisedKeys(capabilities, 'media_library_protection_service_keys', ['plex', 'jellyfin', 'emby'])
  const healthKeys = advertisedKeys(capabilities, 'database_health_service_keys', healthDefaults)
  const v2 = infinidyskV2Support(capabilities)
  return contexts.flatMap(process => {
    const processName = contextName(process)
    if (counts.get(processName) !== 1) return []
    const serviceKey = processKey(process)
    const key = keyOf(serviceKey)
    const config = object(process.config) ? process.config : {}
    const evidence = own(evidenceByProcess, processName) && object(evidenceByProcess[processName])
      ? evidenceByProcess[processName] : {}
    const isEnabled = enabled(process, config)
    const isRunning = running(process)
    const used = explicitMediaPolicy(globalConfig, processName)
      || incidentUsed(mediaProtectionStatus, processName)
      || configUsed(config, key) || recordEvidence(process, evidence, processName)
    if (!isEnabled && !isRunning && !used) return []
    const ids = []
    if (capabilityEnabled(capabilities, 'media_library_protection') && mediaKeys.has(key)) ids.push('library-protection')
    if (capabilityEnabled(capabilities, 'symlink_repair') && symlinkKeys.has(key)) ids.push('symlinks')
    if (capabilityEnabled(capabilities, 'database_health_metrics') && healthKeys.has(key)) ids.push('database-health')
    const isNative = ['infinidysk', 'nzbdav'].includes(key) && String(config.runtime_generation) === '2'
    if (!isNative && postgresMigrationSupported(capabilities, serviceKey)) ids.push('database-migration')
    if (['infinidysk', 'nzbdav'].includes(key) && v2.migration) ids.push('infinidysk-v2-migration')
    if (['infinidysk', 'nzbdav'].includes(key) && isNative && v2.postgres) ids.push('infinidysk-v2-postgres')
    if (isNzbDavRcloneConfig(serviceKey, config)
      && capabilityEnabled(capabilities, 'rclone_optimizer_infinidysk')
      && infinidyskRcloneOptimizerAllowed(capabilities, evidence.providerStatus, evidence.providerConfirmed === true)) {
      ids.push('rclone-optimizer')
    }
    if (key === 'seerr' && capabilityEnabled(capabilities, 'seerr_sync')) ids.push('seerr-sync')
    if (key === 'plex' && capabilityEnabled(capabilities, 'plex_status_metric')) ids.push('plex-status')
    if (!ids.length) return []
    return [{
      processName, serviceKey,
      stateLabel: isRunning ? 'Running service' : isEnabled ? 'Enabled service' : 'Saved utility configuration or history',
      enabled: isEnabled || isRunning,
      tools: ids.map(id => ({
        id, label: definitions[id][0], description: definitions[id][1],
        processName, serviceKey, href: settingsUtilityHref({ id, processName }),
      })),
    }]
  }).sort((left, right) => Number(right.enabled) - Number(left.enabled)
    || left.processName.localeCompare(right.processName))
}
