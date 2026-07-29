import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MEDIASTORM_SERVICES,
  NZBDAV_SERVICES,
  isDumbWebSocketPath,
  isMediaStormNavigationPath,
  isNzbDavWebSocketPath,
  shouldPreferDumbApiRoute,
} from '../server/utils/embeddedServiceRoutes.js'

test('recognizes mediastorm root navigation without claiming DUMB routes', () => {
  assert.equal(MEDIASTORM_SERVICES.has('mediastorm'), true)

  for (const pathname of [
    '/admin',
    '/admin/settings',
    '/account/login',
    '/watch',
    '/watch/movie/123',
    '/share/invite-token',
    '/register',
  ]) {
    assert.equal(isMediaStormNavigationPath(pathname), true, pathname)
  }

  for (const pathname of ['/', '/services/mediastorm', '/api/process/processes']) {
    assert.equal(isMediaStormNavigationPath(pathname), false, pathname)
  }
})

test('distinguishes NzbDAV /ws from DUMB websocket endpoints', () => {
  assert.equal(NZBDAV_SERVICES.has('nzbdav'), true)

  for (const requestUrl of ['/ws', '/ws?connection=overview', '/']) {
    assert.equal(isNzbDavWebSocketPath(requestUrl), true, requestUrl)
  }

  for (const requestUrl of ['/ws/status', '/ws/metrics?history=true', '/ws/logs?token=redacted']) {
    assert.equal(isDumbWebSocketPath(requestUrl), true, requestUrl)
    assert.equal(isNzbDavWebSocketPath(requestUrl), false, requestUrl)
  }

  for (const requestUrl of ['/ws', '/ws/unknown', '/socket']) {
    assert.equal(isDumbWebSocketPath(requestUrl), false, requestUrl)
  }
})

test('known DUMB APIs win over stale embedded-service cookie context', () => {
  assert.equal(shouldPreferDumbApiRoute({
    isKnownDumbApiPath: true,
    hasExplicitEmbeddedContext: false,
    isTpaCookieApi: false,
  }), true)

  assert.equal(shouldPreferDumbApiRoute({
    isKnownDumbApiPath: true,
    hasExplicitEmbeddedContext: true,
    isTpaCookieApi: false,
  }), false)

  assert.equal(shouldPreferDumbApiRoute({
    isKnownDumbApiPath: true,
    hasExplicitEmbeddedContext: false,
    isTpaCookieApi: true,
  }), false)
})
