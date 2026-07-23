import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldStripUiProxyCookies,
  stripUiProxyCookies,
} from '../server/utils/proxyCookies.js'

test('strips the shared-origin cookie jar before proxying Plex', () => {
  const request = {
    headers: {
      cookie: 'auth-session=example; another-service=example',
      accept: 'text/html',
    },
  }

  assert.equal(stripUiProxyCookies(request, 'plex'), true)
  assert.equal('cookie' in request.headers, false)
  assert.equal(request.headers.accept, 'text/html')
})

test('recognizes normalized Plex service candidates', () => {
  assert.equal(shouldStripUiProxyCookies('Plex'), true)
  assert.equal(shouldStripUiProxyCookies('other-name', 'plex'), true)
  assert.equal(shouldStripUiProxyCookies('Plex%20Media%20Server'), true)
})

test('preserves cookies for services that require cookie authentication', () => {
  const request = {
    headers: {
      cookie: 'service-session=example',
    },
  }

  assert.equal(stripUiProxyCookies(request, 'tautulli'), false)
  assert.equal(request.headers.cookie, 'service-session=example')
})
