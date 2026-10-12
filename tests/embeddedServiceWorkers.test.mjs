import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import vm from 'node:vm'
import test from 'node:test'
import { loadProxyHarness } from './support/proxyHarness.mjs'
import {
  RETIRED_ROOT_SERVICE_WORKER,
  embeddedServiceWorkerAllowedScope,
  serviceWorkerRequestContext,
} from '../server/utils/embeddedServiceWorkers.js'

const workerHeaders = { 'service-worker': 'script', 'sec-fetch-dest': 'serviceworker' }

const createHarness = async ({ upstreamHeaders = {}, status = 200, body = '/* upstream worker */' } = {}) => {
  const calls = []
  let mappings = 0
  const { handler, errors } = await loadProxyHarness({
    apiUrl: 'http://api.invalid', traefikUrl: 'http://traefik.invalid',
    fetchImpl: async (url) => {
      if (!url.endsWith('/config/service-ui-map')) return new Response(body, { status, headers: { 'content-type': 'application/javascript', ...upstreamHeaders } })
      mappings++
      return new Response(JSON.stringify({ jellyfin: 'jellyfin', seerr: 'seerr', infinidysk: 'infinidysk' }), {
        headers: { 'content-type': 'application/json' },
      })
    },
    proxy: (options) => (request, response, done) => {
      calls.push({ url: request.url, target: options.target, headers: { ...request.headers } })
      if (!options.selfHandleResponse) { response.end(); done(); return }
      // Real http-proxy-middleware mutates req.url during pathRewrite. Keep
      // this seam realistic so response scopes use the saved browser URL.
      request.url = options.pathRewrite(request.url)
      const upstream = Readable.from([body])
      upstream.headers = { 'content-type': 'application/javascript', ...upstreamHeaders }
      upstream.statusCode = status
      response.once('finish', done)
      options.on.proxyRes(upstream, request, response)
    },
  })
  const request = async (url, { method = 'GET', headers = workerHeaders } = {}) => {
    const responseHeaders = new Map()
    const chunks = []
    const response = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
    response.setHeader = (key, value) => responseHeaders.set(key.toLowerCase(), value)
    response.getHeader = (key) => responseHeaders.get(key.toLowerCase())
    response.removeHeader = (key) => responseHeaders.delete(key.toLowerCase())
    await handler({ node: { req: { url, method, headers: { host: 'example.test', accept: '*/*', ...headers } }, res: response } })
    assert.deepEqual(errors, [])
    return { response, headers: responseHeaders, body: Buffer.concat(chunks).toString() }
  }
  return { request, calls, get mappings() { return mappings } }
}

test('legacy root worker updates retire only their own registration before any upstream or shared-state routing', async () => {
  for (const headers of [
    workerHeaders,
    { ...workerHeaders, cookie: 'dumb_ui_service=infinidysk; session=example' },
    { ...workerHeaders, cookie: 'dumb_ui_service=infinidysk', referer: 'http://example.test/ui/jellyfin/web/index.html' },
    { ...workerHeaders, cookie: 'dumb_ui_service=jellyfin', 'x-dumb-ui-service': 'seerr' },
    { 'service-worker': 'script' },
    { 'sec-fetch-dest': 'serviceworker' },
  ]) {
    const harness = await createHarness()
    const result = await harness.request('/sw.js?__dumb_ui=seerr', { headers })
    assert.equal(result.response.statusCode, 200)
    assert.equal(result.body, RETIRED_ROOT_SERVICE_WORKER)
    assert.equal(result.headers.get('content-type'), 'application/javascript; charset=utf-8')
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(result.headers.has('location'), false)
    assert.equal(result.headers.has('set-cookie'), false)
    assert.equal(harness.mappings, 0)
    assert.deepEqual(harness.calls, [])
  }
})

test('retirement code unregisters its own scope without traffic interception, cache deletion or client takeover', async () => {
  const callbacks = new Map()
  const actions = []
  const forbidden = new Proxy({}, { get() { throw new Error('Retirement must preserve clients and caches') } })
  vm.runInNewContext(RETIRED_ROOT_SERVICE_WORKER, {
    self: { addEventListener: (name, callback) => callbacks.set(name, callback),
      skipWaiting: async () => { actions.push('skipWaiting') },
      registration: { unregister: async () => { actions.push('unregister') } },
      clients: forbidden, caches: forbidden },
    caches: forbidden, clients: forbidden,
  })
  assert.deepEqual([...callbacks.keys()], ['install', 'activate'])
  for (const callback of callbacks.values()) {
    let work
    callback({ waitUntil(promise) { work = promise } })
    assert.ok(work)
    await work
  }
  assert.deepEqual(actions, ['skipWaiting', 'unregister'])
})

test('unowned worker scripts fail closed without cookie, Referer, marker, or header ownership', async () => {
  const harness = await createHarness()
  for (const path of ['/other-worker.js', '/api/health', '/serviceworker.js', '/ui/seerr', '/ui/%73eerr/sw.js', '/ui/seerr/../jellyfin/sw.js']) {
    const result = await harness.request(path, { headers: {
      ...workerHeaders, cookie: 'dumb_ui_service=infinidysk', referer: 'http://example.test/ui/seerr/',
      'x-dumb-ui-service': 'seerr',
    } })
    assert.equal(result.response.statusCode, 410, path)
    assert.equal(result.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal(result.headers.has('location'), false)
    assert.equal(result.headers.has('set-cookie'), false)
  }
  assert.equal(harness.mappings, 0)
  assert.deepEqual(harness.calls, [])
})

test('worker GET and HEAD policy rejects other methods without activating a retirement script', async () => {
  const harness = await createHarness()
  const head = await harness.request('/sw.js', { method: 'HEAD' })
  assert.equal(head.response.statusCode, 200)
  assert.equal(head.body, '')
  for (const path of ['/sw.js', '/ui/seerr/sw.js']) {
    const result = await harness.request(path, { method: 'POST' })
    assert.equal(result.response.statusCode, 405)
    assert.equal(result.headers.get('allow'), 'GET, HEAD')
    assert.equal(result.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.notEqual(result.body, RETIRED_ROOT_SERVICE_WORKER)
  }
  assert.equal(harness.mappings, 0)
  assert.deepEqual(harness.calls, [])
})

test('explicit worker scripts keep their original application code and stable identity independently of shared context', async () => {
  const body = '"use strict"; self.example = "<html><head></head></html>"; self.probe = () => fetch("/api/example");'
  const harness = await createHarness({ body, upstreamHeaders: { 'service-worker-allowed': '/' } })
  for (const path of ['/ui/seerr/sw.js?v=example%2Fversion', '/service/ui/jellyfin/web/serviceworker.js', '/ui/media_alias/web/serviceworker.js']) {
    const result = await harness.request(path, { headers: {
      ...workerHeaders, cookie: 'dumb_ui_service=infinidysk', referer: 'http://example.test/ui/infinidysk/',
      'x-dumb-ui-service': 'wrong_service', 'if-none-match': '"old-worker"', 'if-modified-since': 'Tue, 01 Jan 2030 00:00:00 GMT',
    } })
    const context = serviceWorkerRequestContext({ url: path })
    assert.equal(harness.calls.at(-1).url, path)
    assert.equal(harness.calls.at(-1).target, 'http://traefik.invalid')
    assert.equal(harness.calls.at(-1).headers['x-dumb-ui-service'], undefined)
    assert.equal(harness.calls.at(-1).headers['if-none-match'], undefined)
    assert.equal(harness.calls.at(-1).headers['if-modified-since'], undefined)
    assert.ok(result.body.startsWith('"use strict";'))
    const scriptUrl = new URL(path, 'http://example.test')
    const requests = []
    const worker = vm.createContext({ location: scriptUrl, Request, Headers, URL, URLSearchParams,
      fetch: async (url) => { requests.push(url) } })
    vm.runInContext('globalThis.self = globalThis', worker)
    vm.runInContext(result.body, worker)
    assert.equal(worker.example, '<html><head></head></html>')
    await worker.probe()
    assert.equal(requests[0], `http://example.test${context.prefix}api/example`)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal(result.headers.get('service-worker-allowed'), context.prefix)
    assert.equal(result.headers.get('referrer-policy'), 'same-origin')
    assert.equal(result.headers.has('location'), false)
    assert.equal(result.headers.has('set-cookie'), false)
  }
  assert.equal(harness.mappings, 0)
})

test('missing scope headers preserve the native script-directory restriction and upstream redirects remain redirects', async () => {
  const noHeader = await createHarness()
  const response = await noHeader.request('/ui/jellyfin/web/serviceworker.js')
  assert.equal(response.headers.has('service-worker-allowed'), false)
  const redirect = await createHarness({ status: 302, upstreamHeaders: { location: '/login' } })
  const result = await redirect.request('/ui/seerr/sw.js')
  assert.equal(result.response.statusCode, 302)
  assert.equal(result.headers.get('location'), '/login')
  assert.equal(result.headers.has('set-cookie'), false)
})

test('upstream scope restrictions stay inside their service, preserving narrower paths and failing unsafe values', async () => {
  const context = serviceWorkerRequestContext({ url: '/ui/seerr/nested/sw.js' })
  for (const [scope, expected] of [
    ['/', '/ui/seerr/'], ['/web/', '/ui/seerr/web/'], ['./', '/ui/seerr/nested/'],
    ['../', '/ui/seerr/'], ['/ui/seerr/web/', '/ui/seerr/web/'],
  ]) assert.equal(embeddedServiceWorkerAllowedScope(scope, context), expected)
  assert.equal(embeddedServiceWorkerAllowedScope(undefined, context), undefined)
  for (const scope of ['../../', '/ui/jellyfin/', '//foreign.test/', 'https://foreign.test/', '', '/%2e%2e/', '/web/%2fother/']) {
    assert.throws(() => embeddedServiceWorkerAllowedScope(scope, context), undefined, scope)
    const harness = await createHarness({ upstreamHeaders: { 'service-worker-allowed': scope } })
    const result = await harness.request('/ui/seerr/nested/sw.js')
    assert.equal(result.response.statusCode, 502, scope)
    assert.equal(result.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal(result.headers.has('service-worker-allowed'), false)
    assert.equal(result.headers.has('set-cookie'), false)
    assert.notEqual(result.body, '/* upstream worker */')
  }
})

test('ordinary script and dashboard API requests retain their existing routing', async () => {
  const harness = await createHarness()
  await harness.request('/api/health', { headers: { 'sec-fetch-dest': 'empty', cookie: 'dumb_ui_service=seerr' } })
  assert.equal(harness.calls.at(-1).target, 'http://api.invalid')
  assert.equal(harness.calls.at(-1).url, '/api/health')
  const result = await harness.request('/ui/seerr/application.js', { headers: { 'sec-fetch-dest': 'script' } })
  assert.equal(harness.calls.at(-1).url, '/ui/seerr/application.js')
  assert.equal(result.body, '/* upstream worker */')
  assert.equal(harness.mappings, 1)
})


test('ordinary cached script variants and manually patched JavaScript retain bounded scope metadata', async () => {
  const harness = await createHarness({ upstreamHeaders: {
    'service-worker-allowed': '/', vary: 'Accept-Encoding, service-worker',
    'cache-control': 'public, max-age=3600',
  } })
  for (const path of ['/ui/seerr/sw.js', '/ui/neutarr/static/js/new-main.js']) {
    const result = await harness.request(path, { headers: { 'sec-fetch-dest': 'script' } })
    const context = serviceWorkerRequestContext({ url: path })
    assert.equal(result.headers.get('service-worker-allowed'), context.prefix)
    const fields = result.headers.get('vary').toLowerCase().split(',').map((value) => value.trim())
    assert.deepEqual(fields, ['accept-encoding', 'service-worker', 'sec-fetch-dest'])
    assert.equal(result.headers.get('cache-control'), 'public, max-age=3600')
    assert.equal(result.body.includes('installEmbeddedServiceWorkerAdapter'), false)
  }
})


test('HTML responses retain their MIME and receive cache-scope metadata without becoming worker scripts', async () => {
  const body = '<html><head></head><body>example</body></html>'
  const harness = await createHarness({ body, upstreamHeaders: {
    'content-type': 'text/html', 'service-worker-allowed': '/', vary: 'Accept',
  } })
  const worker = await harness.request('/ui/seerr/sw.js')
  assert.equal(worker.headers.get('content-type'), 'text/html')
  assert.equal(worker.body, body)
  assert.equal(worker.headers.get('service-worker-allowed'), '/ui/seerr/')
  assert.equal(worker.headers.get('cache-control'), 'no-store')
  const ordinary = await harness.request('/ui/seerr/example', { method: 'POST', headers: { 'sec-fetch-dest': 'empty' } })
  assert.equal(ordinary.headers.get('service-worker-allowed'), '/ui/seerr/')
  assert.equal(ordinary.headers.get('vary'), 'Accept, Service-Worker, Sec-Fetch-Dest')
  assert.equal(ordinary.body.includes('installEmbeddedBrowserAdapter'), true)
  assert.equal(ordinary.body.includes('installEmbeddedServiceWorkerAdapter'), false)
})


test('unowned imported scripts cannot run retirement callbacks inside their legitimate parent worker', async () => {
  const harness = await createHarness()
  const result = await harness.request('/sw.js', { headers: {
    'service-worker': 'script', 'sec-fetch-dest': 'script',
    referer: 'http://example.test/ui/seerr/sw.js', cookie: 'dumb_ui_service=infinidysk',
  } })
  assert.equal(result.response.statusCode, 410)
  assert.equal(result.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.notEqual(result.body, RETIRED_ROOT_SERVICE_WORKER)
  assert.equal(result.body.includes('registration.unregister'), false)
  assert.equal(harness.mappings, 0)
  assert.deepEqual(harness.calls, [])
})
