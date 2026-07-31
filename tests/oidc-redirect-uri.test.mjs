import test from 'node:test'
import assert from 'node:assert/strict'

import {
  oidcRedirectUriForOrigin,
  validateOidcRedirectUri,
} from '../helper/oidcRedirectUri.js'

test('OIDC callback requires the exact HTTPS FQDN route', () => {
  assert.equal(
    validateOidcRedirectUri('https://dumb.example.com/api/auth/oidc/callback'),
    '',
  )
  assert.match(validateOidcRedirectUri('http://dumb.example.com/api/auth/oidc/callback'), /HTTPS FQDN/)
  assert.match(validateOidcRedirectUri('https://dumb/api/auth/oidc/callback'), /HTTPS FQDN/)
  assert.match(validateOidcRedirectUri('https://dumb.example.com/api/auth/oidc/callback?next=/'), /exact DUMB origin/)
})

test('OIDC callback rejects localhost and IP addresses', () => {
  assert.match(validateOidcRedirectUri('http://localhost:3005/api/auth/oidc/callback'), /HTTPS FQDN/)
  assert.match(validateOidcRedirectUri('https://127.0.0.1/api/auth/oidc/callback'), /HTTPS FQDN/)
  assert.match(validateOidcRedirectUri('https://[::1]/api/auth/oidc/callback'), /HTTPS FQDN/)
})

test('browser-origin suggestion is blank for unsafe local origins', () => {
  assert.equal(
    oidcRedirectUriForOrigin('https://dumb.example.com'),
    'https://dumb.example.com/api/auth/oidc/callback',
  )
  assert.equal(oidcRedirectUriForOrigin('http://localhost:3005'), '')
  assert.equal(oidcRedirectUriForOrigin('https://192.0.2.10'), '')
})
