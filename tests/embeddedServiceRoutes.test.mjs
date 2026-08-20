import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AIOSTREAMS_SERVICES,
  MEDIASTORM_SERVICES,
  NZBDAV_SERVICES,
  isDumbWebSocketPath,
  isAioStreamsApiPath,
  isAioStreamsNavigationPath,
  isMediaStormNavigationPath,
  isNzbDavPlaybackPath,
  isNzbDavWebSocketPath,
  shouldRouteAioStreamsApi,
  shouldRouteAioStreamsNavigation,
  shouldRouteNzbDavPlaybackNavigation,
  shouldPreferDumbApiRoute,
  shouldPreserveExternalServiceRedirect,
  shouldRouteEmbeddedServiceApi,
} from '../server/utils/embeddedServiceRoutes.js'

test('recognizes only AIOStreams root SPA navigation paths', () => {
  assert.equal(AIOSTREAMS_SERVICES.has('aiostreams'), true)

  for (const pathname of [
    '/login',
    '/oauth/callback/gdrive',
    '/splashscreen',
    '/stremio/configure',
    '/stremio/example-user/example-password/configure',
    '/dashboard',
    '/dashboard/settings',
  ]) {
    assert.equal(isAioStreamsNavigationPath(pathname), true, pathname)
  }

  for (const pathname of ['/', '/services/aiostreams', '/api/v1/status', '/login/help']) {
    assert.equal(isAioStreamsNavigationPath(pathname), false, pathname)
  }
})

test('routes AIOStreams login only with explicit iframe or embedded referer context', () => {
  const base = {
    isNavigation: true,
    pathname: '/login',
    serviceType: 'aiostreams',
  }

  assert.equal(shouldRouteAioStreamsNavigation({
    ...base,
    fetchDest: 'document',
  }), false, 'a stale cookie must not claim the main dmbdb login page')

  assert.equal(shouldRouteAioStreamsNavigation({
    ...base,
    fetchDest: '',
  }), false, 'missing browser fetch metadata must remain collision-safe')

  assert.equal(shouldRouteAioStreamsNavigation({
    ...base,
    fetchDest: 'document',
    hasExplicitEmbeddedContext: true,
  }), true, 'an explicit /ui/aiostreams referer may retain the SPA route')

  assert.equal(shouldRouteAioStreamsNavigation({
    ...base,
    fetchDest: 'iframe',
  }), true, 'an explicit iframe navigation may enter AIOStreams')

  assert.equal(shouldRouteAioStreamsNavigation({
    ...base,
    fetchDest: 'iframe',
    serviceType: 'pulsarr',
  }), false)
})

test('routes only AIOStreams versioned API calls from its service context', () => {
  for (const pathname of ['/api/v1', '/api/v1/auth/login', '/api/v1/status']) {
    assert.equal(isAioStreamsApiPath(pathname), true, pathname)
    assert.equal(shouldRouteAioStreamsApi({
      isNavigation: false,
      pathname,
      serviceType: 'aiostreams',
    }), true, pathname)
  }

  for (const pathname of ['/api/process/processes', '/api/config/', '/api/auth/login', '/api/v10/status']) {
    assert.equal(isAioStreamsApiPath(pathname), false, pathname)
    assert.equal(shouldRouteAioStreamsApi({
      isNavigation: false,
      pathname,
      serviceType: 'aiostreams',
    }), false, pathname)
  }

  assert.equal(shouldRouteAioStreamsApi({
    isNavigation: false,
    pathname: '/api/v1/auth/login',
    serviceType: 'pulsarr',
  }), false)

  assert.equal(shouldRouteAioStreamsApi({
    isNavigation: true,
    pathname: '/api/v1/auth/login',
    serviceType: 'aiostreams',
  }), false)
})

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

test('distinguishes InfiniDysk /ws from DUMB websocket endpoints', () => {
  assert.equal(NZBDAV_SERVICES.has('nzbdav'), true)
  assert.equal(NZBDAV_SERVICES.has('infinidysk'), true)

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

test('recognizes only NzbDAV playback content routes', () => {
  for (const pathname of [
    '/view/content/NzbDAV-Movies/%5B%5DThe.Avengers.2012.1080p.mkv',
    '/view/example.mkv',
  ]) {
    assert.equal(isNzbDavPlaybackPath(pathname), true, pathname)
  }

  for (const pathname of ['/', '/view', '/overview', '/api/process/processes', '/services/nzbdav']) {
    assert.equal(isNzbDavPlaybackPath(pathname), false, pathname)
  }

  assert.equal(shouldRouteNzbDavPlaybackNavigation({
    isNavigation: true,
    pathname: '/view/content/NzbDAV-Movies/example.mkv',
    serviceType: 'nzbdav',
  }), true)

  assert.equal(shouldRouteNzbDavPlaybackNavigation({
    isNavigation: true,
    pathname: '/view/content/NzbDAV-Movies/example.mkv',
    serviceType: 'profilarr',
  }), false)

  assert.equal(shouldRouteNzbDavPlaybackNavigation({
    isNavigation: false,
    pathname: '/view/content/NzbDAV-Movies/example.mkv',
    serviceType: 'nzbdav',
  }), false)
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

test('routes TPA SSO document navigations through the embedded service proxy', () => {
  assert.equal(shouldRouteEmbeddedServiceApi({
    hasExplicitEmbeddedContext: true,
    isNavigation: true,
    serviceType: 'traefik_proxy_admin',
    isTpaApiPath: true,
  }), true)

  assert.equal(shouldRouteEmbeddedServiceApi({
    hasExplicitEmbeddedContext: true,
    isNavigation: true,
    serviceType: 'authelia',
    isTpaApiPath: false,
  }), false)
})

test('preserves TPA admin SSO redirects to the external identity provider', () => {
  assert.equal(shouldPreserveExternalServiceRedirect({
    location: 'https://auth.example.com/api/oidc/authorization?client_id=tpa',
    serviceName: 'traefik_proxy_admin',
    serviceType: 'traefik_proxy_admin',
    requestPathname: '/api/auth/admin/login',
  }), true)

  assert.equal(shouldPreserveExternalServiceRedirect({
    location: '/auth/login',
    serviceName: 'traefik_proxy_admin',
    serviceType: 'traefik_proxy_admin',
    requestPathname: '/api/auth/admin/login',
  }), false)

  assert.equal(shouldPreserveExternalServiceRedirect({
    location: 'https://auth.example.com/api/oidc/authorization?client_id=tpa',
    serviceName: 'traefik_proxy_admin',
    serviceType: null,
    requestPathname: '/service/ui/traefik_proxy_admin/api/auth/admin/login',
  }), true)
})
