export const capabilityEnabled = (capabilities, key) => (
  capabilities != null
  && typeof capabilities === 'object'
  && capabilities[key] === true
)

export const POSTGRES_MIGRATION_FALLBACK_SERVICE_KEYS = Object.freeze([
  'sonarr',
  'radarr',
  'lidarr',
  'prowlarr',
  'whisparr',
  'bazarr',
  'pulsarr',
  'seerr',
  'altmount',
])

const normalizeServiceKey = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')

export const resolvePostgresMigrationServiceKeys = (capabilities) => {
  const advertised = Array.isArray(capabilities?.postgres_migration_service_keys)
    ? capabilities.postgres_migration_service_keys
    : POSTGRES_MIGRATION_FALLBACK_SERVICE_KEYS
  return new Set(advertised.map(normalizeServiceKey).filter(Boolean))
}

export const postgresMigrationSupported = (capabilities, serviceKey) => {
  const normalizedKey = normalizeServiceKey(serviceKey)
  if (!resolvePostgresMigrationServiceKeys(capabilities).has(normalizedKey)) return false
  if (capabilityEnabled(capabilities, 'postgres_migration')) return true
  return capabilityEnabled(capabilities, 'arr_postgres_migration')
    && ['sonarr', 'radarr'].includes(normalizedKey)
}

export const autheliaIntegrationSupported = (capabilities) => (
  capabilityEnabled(capabilities, 'authelia_integration')
)

export const authCapabilitySupport = (capabilities) => {
  const oidc = capabilityEnabled(capabilities, 'auth_oidc')
  return {
    oidc,
    hybrid: oidc && capabilityEnabled(capabilities, 'auth_hybrid'),
  }
}

export const filterOptionalServicesByCapabilities = (services, capabilities) => {
  const entries = Array.isArray(services) ? services : []
  return entries.filter((service) => (
    service?.key !== 'authelia' || autheliaIntegrationSupported(capabilities)
  ))
}
