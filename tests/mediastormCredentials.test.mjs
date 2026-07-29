import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeMediaStormCredentialKind } from '../helper/mediastormCredentials.js'

test('uses backend credential classification when available', () => {
  assert.equal(
    normalizeMediaStormCredentialKind({
      available: true,
      password: 'custom-password',
      credential_kind: 'installation_specific',
    }),
    'installation_specific',
  )
})

test('classifies responses from older DUMB backends', () => {
  assert.equal(
    normalizeMediaStormCredentialKind({ available: true, password: 'admin' }),
    'default',
  )
  assert.equal(
    normalizeMediaStormCredentialKind({ available: true, password: 'generated-password' }),
    'installation_specific',
  )
})

test('does not classify an unavailable credential', () => {
  assert.equal(
    normalizeMediaStormCredentialKind({ available: false, password: null }),
    null,
  )
})
