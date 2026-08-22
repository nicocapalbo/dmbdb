import test from 'node:test'
import assert from 'node:assert/strict'

import {
  authCapabilitySupport,
  autheliaIntegrationSupported,
  capabilityEnabled,
  filterOptionalServicesByCapabilities,
  postgresMigrationSupported,
  resolvePostgresMigrationServiceKeys,
} from '../helper/backendCapabilities.js'

test('capabilities require explicit true values', () => {
  assert.equal(capabilityEnabled(undefined, 'auth_oidc'), false)
  assert.equal(capabilityEnabled({}, 'auth_oidc'), false)
  assert.equal(capabilityEnabled({ auth_oidc: 'true' }, 'auth_oidc'), false)
  assert.equal(capabilityEnabled({ auth_oidc: true }, 'auth_oidc'), true)
})

test('hybrid auth is available only when both OIDC and hybrid are advertised', () => {
  assert.deepEqual(authCapabilitySupport({}), { oidc: false, hybrid: false })
  assert.deepEqual(
    authCapabilitySupport({ auth_hybrid: true }),
    { oidc: false, hybrid: false },
  )
  assert.deepEqual(
    authCapabilitySupport({ auth_oidc: true, auth_hybrid: true }),
    { oidc: true, hybrid: true },
  )
})

test('managed Authelia requires its explicit integration capability', () => {
  assert.equal(autheliaIntegrationSupported({}), false)
  assert.equal(autheliaIntegrationSupported({ authelia_integration: true }), true)
})

test('older backends do not offer Authelia during onboarding', () => {
  const services = [
    { key: 'cloudflared' },
    { key: 'aiostreams' },
    { key: 'authelia' },
    { key: 'maintainerr' },
  ]

  assert.deepEqual(
    filterOptionalServicesByCapabilities(services, {}).map((service) => service.key),
    ['cloudflared', 'aiostreams', 'maintainerr'],
  )
  assert.deepEqual(
    filterOptionalServicesByCapabilities(services, { authelia_integration: true })
      .map((service) => service.key),
    ['cloudflared', 'aiostreams', 'authelia', 'maintainerr'],
  )
})

test('PostgreSQL migration fallback excludes InfiniDysk on older backends', () => {
  const serviceKeys = resolvePostgresMigrationServiceKeys({})

  assert.equal(serviceKeys.has('sonarr'), true)
  assert.equal(serviceKeys.has('altmount'), true)
  assert.equal(serviceKeys.has('infinidysk'), false)
})

test('InfiniDysk migration requires generic capability and an advertised key', () => {
  assert.equal(postgresMigrationSupported({ postgres_migration: true }, 'infinidysk'), false)
  assert.equal(postgresMigrationSupported({
    postgres_migration: true,
    postgres_migration_service_keys: ['InfiniDysk'],
  }, 'infinidysk'), true)
  assert.equal(postgresMigrationSupported({
    postgres_migration: 'true',
    postgres_migration_service_keys: ['infinidysk'],
  }, 'infinidysk'), false)
})

test('legacy Arr migration capability remains limited to Sonarr and Radarr', () => {
  const capabilities = {
    arr_postgres_migration: true,
    postgres_migration_service_keys: ['sonarr', 'radarr', 'infinidysk'],
  }

  assert.equal(postgresMigrationSupported(capabilities, 'sonarr'), true)
  assert.equal(postgresMigrationSupported(capabilities, 'radarr'), true)
  assert.equal(postgresMigrationSupported(capabilities, 'infinidysk'), false)
})
