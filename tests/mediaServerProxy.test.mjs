import assert from 'node:assert/strict'
import test from 'node:test'
import { loadProxyHarness } from './support/proxyHarness.mjs'

const serviceTypes = {
  jellyfin: 'jellyfin',
  emby: 'emby',
  cinema_server: 'jellyfin',
  television_server: 'emby',
}

const createHarness = async () => {
  const calls = []
  const { handler, errors } = await loadProxyHarness({
    apiUrl: 'http://api.invalid',
    traefikUrl: 'http://traefik.invalid',
    proxy: (options) => (request, _response, done) => {
      calls.push({ url: request.url, target: options.target, method: request.method,
        headers: { ...request.headers } })
      done()
    },
    fetchImpl: async () => new Response(JSON.stringify(serviceTypes), {
      headers: { 'content-type': 'application/json' },
    }),
  })
  const request = async (url, { cookie = 'jellyfin', referer, method = 'GET', headers = {} } = {}) => {
    const responseHeaders = new Map()
    const response = { setHeader: (key, value) => responseHeaders.set(key, value),
      getHeader: (key) => responseHeaders.get(key), end() {} }
    await handler({ node: {
      req: { url, method, headers: { host: 'example.test', accept: 'application/json',
        'sec-fetch-dest': 'empty', cookie: `dumb_ui_service=${cookie}`,
        ...(referer ? { referer } : {}), ...headers } },
      res: response,
    } })
    assert.deepEqual(errors, [])
    return { call: calls.at(-1), responseHeaders, response }
  }
  return { request, calls }
}

test('media servers preserve root API paths instead of treating every request as a web asset', async () => {
  const { request } = await createHarness()
  for (const service of Object.keys(serviceTypes)) {
    for (const path of ['/Users/example/Views', '/Users/authenticatebyname', '/Items/example/Images/Primary.jpg', '/System/Info/Public']) {
      const { call } = await request(`/ui/${service}${path}`, {
        cookie: service,
        method: path.endsWith('authenticatebyname') ? 'POST' : 'GET',
      })
      assert.equal(call.url, `/ui/${service}${path}`, `${service}: ${path}`)
      assert.equal(call.target, 'http://traefik.invalid')
    }
  }
})

test('explicit media service context preserves authentication and query bytes despite a conflicting cookie', async () => {
  const { request } = await createHarness()
  const path = '/Users/example/Views?api_key=example%2Ftoken&Fields=Name%20Path'
  for (const service of Object.keys(serviceTypes)) {
    for (const cookie of [service, 'decypharr', 'emby']) {
      const headers = {
        authorization: 'MediaBrowser Client="fixture", Token="example-token"',
        'x-emby-token': 'example-token',
        'x-mediabrowser-token': 'example-token',
        'x-dumb-ui-service': 'wrong_service',
      }
      const { call, responseHeaders } = await request(`/ui/${service}${path}`, { cookie, headers })
      assert.equal(call.url, `/ui/${service}${path}`)
      for (const key of ['authorization', 'x-emby-token', 'x-mediabrowser-token']) {
        assert.equal(call.headers[key], headers[key])
      }
      assert.equal(call.headers['x-dumb-ui-service'], undefined)
      assert.equal(responseHeaders.has('set-cookie'), false)
    }
  }
})

test('root API calls use the media document identity without adding its web directory', async () => {
  const { request } = await createHarness()
  for (const service of Object.keys(serviceTypes)) {
    const { call } = await request('/Users/example/Views?api_key=example', {
      cookie: 'wrong_service',
      referer: `http://example.test/ui/${service}/web/index.html`,
    })
    assert.equal(call.url, `/ui/${service}/Users/example/Views?api_key=example`)
  }
})

test('media web assets and legacy service API prefixes retain their application paths', async () => {
  const { request } = await createHarness()
  for (const [service, type] of Object.entries(serviceTypes)) {
    for (const path of ['/web', '/web/index.html', '/web/apploader.js', '/apploader.js', `/${type}/Users/example/Views`]) {
      const { call } = await request(`/ui/${service}${path}`, { cookie: service })
      assert.equal(call.url, `/ui/${service}${path}`)
    }
    const { call } = await request(`/${type}/Users/example/Views?api_key=example`, { cookie: service })
    assert.equal(call.url, `/ui/${service}/${type}/Users/example/Views?api_key=example`)
  }
})

test('a legacy media cookie does not claim dashboard APIs', async () => {
  const { request } = await createHarness()
  for (const cookie of Object.keys(serviceTypes)) {
    const { call } = await request('/api/health', { cookie })
    assert.equal(call.url, '/api/health')
    assert.equal(call.target, 'http://api.invalid')
  }
})

test('media entry navigations use the web index directory so relative assets keep working', async () => {
  const { request, calls } = await createHarness()
  for (const service of Object.keys(serviceTypes)) {
    for (const ending of ['', '/']) {
      for (const method of ['GET', 'HEAD']) {
        const before = calls.length
        const { responseHeaders, response } = await request(`/ui/${service}${ending}?next=%2Fhome&token=example%20value`, {
          cookie: 'wrong_service', method,
          headers: { accept: 'text/html', 'sec-fetch-dest': 'iframe' },
        })
        assert.equal(response.statusCode, 307)
        assert.equal(responseHeaders.get('Location'), `/ui/${service}/web/index.html?next=%2Fhome&token=example%20value`)
        assert.equal(responseHeaders.get('Cache-Control'), 'no-store')
        assert.equal(responseHeaders.has('set-cookie'), false)
        assert.equal(calls.length, before)
      }
    }
    const { call, responseHeaders } = await request(`/ui/${service}/`, { cookie: service })
    assert.equal(call.url, `/ui/${service}/`)
    assert.equal(responseHeaders.has('Location'), false)
  }
})
