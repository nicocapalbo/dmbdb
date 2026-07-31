import test from 'node:test'
import assert from 'node:assert/strict'

import {
  authCapabilitySupport,
  autheliaIntegrationSupported,
  capabilityEnabled,
  filterOptionalServicesByCapabilities,
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
    { key: 'authelia' },
    { key: 'maintainerr' },
  ]

  assert.deepEqual(
    filterOptionalServicesByCapabilities(services, {}).map((service) => service.key),
    ['cloudflared', 'maintainerr'],
  )
  assert.deepEqual(
    filterOptionalServicesByCapabilities(services, { authelia_integration: true })
      .map((service) => service.key),
    ['cloudflared', 'authelia', 'maintainerr'],
  )
})
