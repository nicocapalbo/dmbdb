import assert from 'node:assert/strict'
import test from 'node:test'
import { contextualizeEmbeddedRequest, serviceFromEmbeddedUrl } from '../server/utils/embeddedRequestContext.js'
import { loadProxyHarness } from './support/proxyHarness.mjs'

const req = (url, referer, cookie = 'decypharr') => ({
  url, method: 'GET', headers: { host: 'example.test', accept: '*/*', referer,
    cookie: `dumb_ui_service=${cookie}`, 'x-api-key': 'example' },
})

test('explicit service identity wins over cookies, and the marker is not forwarded', () => {
  assert.deepEqual(contextualizeEmbeddedRequest(req('/api/v3/history?page=1', 'http://example.test/activity/history?__dumb_ui=radarr')), {
    service: 'radarr', path: '/ui/radarr/api/v3/history?page=1', prefixed: false, documentContext: false,
  })
  assert.equal(contextualizeEmbeddedRequest(req('/ui/sonarr_main/api?__dumb_ui=decypharr', 'http://example.test/?__dumb_ui=radarr')).path, '/ui/sonarr_main/api')
  assert.equal(contextualizeEmbeddedRequest(req('/activity/history?__dumb_ui=radarr&page=2')).path, '/ui/radarr/activity/history?page=2')
})

test('rejects foreign referrers and malformed service identifiers', () => {
  assert.equal(contextualizeEmbeddedRequest(req('/api/health', 'http://foreign.test/?__dumb_ui=radarr')), null)
  for (const value of ['%ZZ', '..', '<script>', 'a?b', 'a#b']) {
    assert.equal(serviceFromEmbeddedUrl(`/?__dumb_ui=${encodeURIComponent(value)}`), null)
  }
  assert.equal(serviceFromEmbeddedUrl('/ui/Radarr%20Main/'), 'radarr_main')
})

test('actual HTTP handler routes concurrent contexts and leaves dashboard APIs at DUMB', async () => {
  const calls = []
  const { handler, errors } = await loadProxyHarness({
    apiUrl: 'http://api.invalid',
    proxy: (options) => (request, response, done) => {
      calls.push({ url: request.url, target: options.target })
      done()
    },
    fetchImpl: async () => new Response(JSON.stringify({ radarr: 'radarr', decypharr: 'decypharr' }), { headers: { 'content-type': 'application/json' } }),
  })
  for (const [url, referer, expected] of [
    ['/api/v3/history', '/activity/history?__dumb_ui=radarr', '/ui/radarr/api/v3/history'],
    ['/api/status', '/?__dumb_ui=decypharr', '/ui/decypharr/api/status'],
    ['/api/v3/history', '/activity/history?__dumb_ui=radarr', '/ui/radarr/api/v3/history'],
    ['/ui/riven_frontend/api/settings', '/?__dumb_ui=riven_frontend', '/ui/riven_backend/api/settings'],
    ['/ui/_app/chunk.js', '/?__dumb_ui=riven_frontend', '/ui/riven_frontend/_app/chunk.js'],
    ['/ui/jellyfin/apploader.js', '/?__dumb_ui=jellyfin', '/ui/jellyfin/web/apploader.js'],
    ['/api/health', '/services/radarr', '/api/health'],
  ]) {
    const headers = new Map()
    await handler({ node: { req: req(url, `http://example.test${referer}`), res: {
      setHeader: (k, v) => headers.set(k, v), getHeader: (k) => headers.get(k), end() {},
    } } })
    assert.equal(calls.at(-1).url, expected)
  }
  assert.equal(calls.at(-1).target, 'http://api.invalid')
  assert.deepEqual(errors, [])
})


test('preserves encoded application query bytes when removing context', () => {
  const request = req('/api/play?token=a%20b%2fc&__dumb_ui=radarr&next=%2Fhome')
  assert.equal(contextualizeEmbeddedRequest(request).path, '/ui/radarr/api/play?token=a%20b%2fc&next=%2Fhome')
})

test('Request headers provide identity without requiring a referrer', () => {
  const request = req('/api/upload')
  request.headers['x-dumb-ui-service'] = 'radarr_second'
  assert.equal(contextualizeEmbeddedRequest(request).path, '/ui/radarr_second/api/upload')
  request.url = '/ui/decypharr/api/upload'
  assert.equal(contextualizeEmbeddedRequest(request).service, 'decypharr')
})


test('preserves document context behind a proxy that forwards the public host', () => {
  const request = req('/static/app.js', 'https://public.example.test/?__dumb_ui=radarr')
  request.headers['x-forwarded-host'] = 'public.example.test'
  assert.equal(contextualizeEmbeddedRequest(request).service, 'radarr')
})
