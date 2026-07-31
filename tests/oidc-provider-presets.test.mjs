import test from 'node:test'
import assert from 'node:assert/strict'

import {
  availableOidcProviderPresets,
  detectOidcProviderPreset,
  getOidcProviderPreset,
} from '../helper/oidcProviderPresets.js'

test('Google preset uses its official issuer and discovery document', () => {
  const google = getOidcProviderPreset('google')
  assert.equal(google.issuerUrl, 'https://accounts.google.com')
  assert.equal(
    google.discoveryUrl,
    'https://accounts.google.com/.well-known/openid-configuration',
  )
  assert.deepEqual(google.scopes, ['openid', 'profile', 'email'])
  assert.equal(google.usernameClaim, 'email')
})

test('provider selector offers the supported named OIDC presets', () => {
  const ids = availableOidcProviderPresets({ managedAutheliaConfigured: true })
    .map((entry) => entry.id)

  assert.deepEqual(ids, [
    'managed-authelia',
    'external-authelia',
    'google',
    'authentik',
    'keycloak',
    'microsoft-entra',
    'auth0',
    'okta',
    'zitadel',
    'dex',
    'custom',
  ])
})

test('managed Authelia is offered only after DUMB reports it configured', () => {
  assert.equal(
    availableOidcProviderPresets().some((entry) => entry.id === 'managed-authelia'),
    false,
  )
  assert.equal(
    availableOidcProviderPresets({ managedAutheliaConfigured: true })
      .some((entry) => entry.id === 'managed-authelia'),
    true,
  )
})

test('stored providers map back to a useful preset without changing custom issuers', () => {
  assert.equal(
    detectOidcProviderPreset({ source: 'managed', issuerUrl: 'https://auth.example.com' }),
    'managed-authelia',
  )
  assert.equal(
    detectOidcProviderPreset({ source: 'custom_oidc', issuerUrl: 'https://accounts.google.com' }),
    'google',
  )
  assert.equal(
    detectOidcProviderPreset({
      source: 'custom_oidc',
      issuerUrl: 'https://keycloak.example.com/realms/media',
    }),
    'keycloak',
  )
  assert.equal(
    detectOidcProviderPreset({ source: 'custom_oidc', issuerUrl: 'https://id.example.com' }),
    'custom',
  )
})
