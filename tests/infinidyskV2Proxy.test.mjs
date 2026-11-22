import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { loadProxyHarness } from './support/proxyHarness.mjs'
import {
  nativeInfiniDyskUi,
  prepareInfiniDyskV2Request,
  infiniDyskV2ResponseCookies,
  infiniDyskV2DocumentPolicy,
  injectInfiniDyskV2Document,
  isInfiniDyskV2ExternalLoginRedirect,
} from '../server/utils/infinidyskV2Embedded.js'

const runRequest = async (handler, path, headers = {}) => {
  const result = { headers: new Map(), status: 200 }
  const response = {
    statusCode: 200,
    setHeader(key, value) { result.headers.set(key, value) },
    getHeader(key) { return result.headers.get(key) },
    end(value) { result.body = value; result.status = this.statusCode; this.writableEnded = true },
  }
  await handler({ node: { req: { url: path, method: 'GET', headers: { host: 'dashboard.example.invalid', ...headers } }, res: response } })
  return result
}

test('native routing reads public per-service proof without dashboard or native credentials and never reuses expired proof', async () => {
  let clock = 10000
  let available = true
  const upstream = []
  const metadata = []
  const { handler } = await loadProxyHarness({ apiUrl: 'http://api.invalid', now: () => clock,
    proxy: () => (request, response, done) => { upstream.push({ path: request.url, headers: { ...request.headers } }); response.end('native'); done() },
    fetchImpl: async (url, options) => {
      metadata.push({ url: String(url), headers: options?.headers || {} })
      if (String(url).endsWith('/config/service-ui-map')) return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
      assert.equal(String(url), 'http://api.invalid/config/embedded-ui-routing/infinidysk')
      return new Response(JSON.stringify(available ? { name: 'InfiniDysk', config_key: 'infinidysk', runtime_generation: '2', embedded_ui_protocol: 1 } : {}), {
        status: available ? 200 : 503, headers: { 'content-type': 'application/json' },
      })
    },
  })
  const headers = { cookie: 'dumb_ifd_v2_infinidysk_session=embedded; infinidysk_session=direct', authorization: 'Bearer fixture-dashboard-token' }
  assert.equal((await runRequest(handler, '/ui/infinidysk/', headers)).status, 200)
  assert.deepEqual(upstream[0].headers, { host: 'dashboard.example.invalid', cookie: 'infinidysk_session=embedded' })
  assert.ok(metadata.filter(row => row.url.includes('/embedded-ui-routing/')).every(row => Object.keys(row.headers).length === 0))
  available = false
  clock += 6000
  const unavailable = await runRequest(handler, '/ui/infinidysk/', headers)
  assert.equal(unavailable.status, 503)
  assert.match(unavailable.body, /routing cannot be confirmed/)
  assert.equal(upstream.length, 1)
})

test('missing proof endpoint, wrong identity and unsupported protocol never downgrade into the legacy adapter', async () => {
  for (const mode of ['old-backend', 'wrong-service', 'missing-generation', 'unsupported']) {
    let forwarded = false
    const { handler } = await loadProxyHarness({ apiUrl: 'http://api.invalid',
      proxy: () => (_request, _response, done) => { forwarded = true; done() },
      fetchImpl: async url => String(url).endsWith('/config/service-ui-map')
        ? new Response('{"infinidysk":"infinidysk"}', { headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ name: mode === 'wrong-service' ? 'Other' : 'InfiniDysk', config_key: 'infinidysk', runtime_generation: mode === 'missing-generation' ? undefined : '2', embedded_ui_protocol: 2 }), {
          status: mode === 'old-backend' ? 404 : 200, headers: { 'content-type': 'application/json' },
        }),
    })
    const response = await runRequest(handler, '/ui/infinidysk/')
    assert.equal(response.status, 503)
    assert.equal(forwarded, false)
    assert.match(response.body, mode === 'old-backend' ? /compatible DUMB backend/ : mode === 'unsupported' ? /compatible embedded UI adapter/ : /routing cannot be confirmed/)
  }
})

test('mixed-case native SSO callback logs omit queries while HTTP routing and redirects preserve them', async t => {
  const received = []
  const upstream = createServer((request, response) => {
    received.push(request.url)
    response.writeHead(302, { location: '/queue?result=accepted', 'content-type': 'application/json' })
    response.end('{}')
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(() => new Promise(resolve => upstream.close(resolve)))
  const { handler, errors, logs } = await loadProxyHarness({
    apiUrl: 'http://api.invalid', traefikUrl: `http://127.0.0.1:${upstream.address().port}`,
    fetchImpl: async url => new Response(JSON.stringify(String(url).includes('/config/embedded-ui-routing/')
      ? { name: 'InfiniDysk', config_key: 'infinidysk', runtime_generation: '2', embedded_ui_protocol: 1 }
      : { infinidysk: 'infinidysk' }), { headers: { 'content-type': 'application/json' } }),
  })
  const frontend = createServer((request, response) => {
    handler({ node: { req: request, res: response } }).catch(error => response.destroy(error))
  })
  frontend.listen(0, '127.0.0.1')
  await once(frontend, 'listening')
  t.after(() => new Promise(resolve => frontend.close(resolve)))
  const query = '?code=private-fixture-code%2Bvalue&state=private-fixture-state'
  const result = await fetch(`http://127.0.0.1:${frontend.address().port}/ui/InfiniDysk/auth/oidc/callback${query}`, { redirect: 'manual' })
  await result.text()
  assert.equal(result.status, 302)
  assert.equal(result.headers.get('location'), '/ui/infinidysk/queue?result=accepted')
  assert.deepEqual(received, [`/service/ui/infinidysk/auth/oidc/callback${query}`])
  assert.deepEqual(logs.find(row => row[0] === '[URL Normalization]:'), [
    '[URL Normalization]:', '/ui/InfiniDysk/auth/oidc/callback', '->', '/ui/infinidysk/auth/oidc/callback',
  ])
  assert.doesNotMatch(JSON.stringify(logs), /private-fixture-(?:code|state)/)
  assert.deepEqual(errors, [])
})

test('native proxy selection uses only an exact trusted inventory identity and protocol', () => {
  const row = { name: 'InfiniDysk', config_key: 'infinidysk', runtime_generation: '2', embedded_ui_protocol: 1 }
  assert.deepEqual(nativeInfiniDyskUi({ services: [row] }, 'infinidysk'), { service: 'infinidysk', supported: true })
  assert.deepEqual(nativeInfiniDyskUi({ services: [{ ...row, embedded_ui_protocol: 2 }] }, 'infinidysk'), { service: 'infinidysk', supported: false })
  for (const services of [[], [{ ...row, runtime_generation: 2 }], [{ ...row, runtime_generation: '3' }], [{ ...row, config_key: 'sonarr' }], [{ ...row, name: 'Other' }]]) {
    assert.deepEqual(nativeInfiniDyskUi({ services }, 'infinidysk'), { service: 'infinidysk', supported: false })
  }
  assert.equal(nativeInfiniDyskUi({ services: [{ ...row, runtime_generation: '1' }] }, 'infinidysk'), null)
  assert.equal(nativeInfiniDyskUi(undefined, '..'), null)
})

test('native requests receive only their own namespaced session and SSO flow credentials', () => {
  const req = { headers: {
    cookie: 'dumb_access_token=controller; infinidysk_session=direct; infinidysk_sso=direct-flow; dumb_ifd_v2_infinidysk_session=embedded==; dumb_ifd_v2_other_session=other; dumb_ifd_v2_infinidysk_sso=flow; unrelated=other',
    Authorization: 'Bearer controller', 'X-Api-Key': 'controller-admin', 'x-sab-api-key': 'download-client',
    'proxy-authorization': 'proxy', 'x-dumb-ui-service': 'infinidysk', 'content-type': 'application/json',
  } }
  prepareInfiniDyskV2Request(req, 'infinidysk')
  assert.deepEqual(req.headers, { cookie: 'infinidysk_session=embedded==; infinidysk_sso=flow', 'content-type': 'application/json' })
})

test('native and namespaced cookies never reach DUMB APIs or unrelated services', () => {
  const req = { headers: { Cookie: 'dumb_access_token=controller; infinidysk_session=direct; infinidysk_sso=flow; dumb_ifd_v2_infinidysk_session=embedded; unrelated=keep', authorization: 'Bearer controller' } }
  prepareInfiniDyskV2Request(req)
  assert.deepEqual(req.headers, { cookie: 'dumb_access_token=controller; unrelated=keep', authorization: 'Bearer controller' })
})

test('native response cookies retain their security and expiry with service-specific browser names', () => {
  assert.deepEqual(infiniDyskV2ResponseCookies([
    'infinidysk_session=token; Path=/; Max-Age=100; HttpOnly; SameSite=Strict; Secure',
    'infinidysk_sso=flow; Domain=example.com; Path=/; Max-Age=0; SameSite=Lax',
    'dumb_access_token=overwrite; Path=/',
  ], 'infinidysk'), [
    'dumb_ifd_v2_infinidysk_session=token; Path=/; HttpOnly; Max-Age=100; SameSite=Strict; Secure',
    'dumb_ifd_v2_infinidysk_sso=flow; Path=/; HttpOnly; Max-Age=0; SameSite=Lax',
  ])
})

test('native CSP preserves upstream restrictions and permits only nonce-bound injected scripts', () => {
  const policy = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
  const { headers, nonce } = infiniDyskV2DocumentPolicy({ 'content-security-policy': policy, 'x-frame-options': 'DENY' })
  const adjusted = headers['content-security-policy']
  assert.match(adjusted, /frame-ancestors 'self'/)
  assert.match(adjusted, /base-uri 'self'/)
  assert.match(adjusted, /object-src 'none'/)
  assert.match(adjusted, /form-action 'self'/)
  assert.ok(adjusted.includes(`script-src 'self' 'nonce-${nonce}'`))
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN')
  const original = '<html><head><script src="/assets/native.js" type="module"></script></head><body>Native UI</body></html>'
  const html = injectInfiniDyskV2Document(original, 'infinidysk', nonce)
  assert.equal((html.match(new RegExp(`nonce="${nonce}"`, 'g')) || []).length, 2)
  assert.ok(html.includes('<script data-dumb-native-src="/assets/native.js" src="/ui/infinidysk/assets/native.js" type="module">'))
  assert.ok(html.includes('<base href="/ui/infinidysk/">'))
  assert.equal(injectInfiniDyskV2Document(original, 'infinidysk', '"><script>'), original)
})

test('an identity provider authorization redirect remains external only from the native SSO entry point', () => {
  assert.equal(isInfiniDyskV2ExternalLoginRedirect('https://identity.example.com/authorize?state=opaque', '/auth/oidc/login'), true)
  for (const [location, path] of [['/login', '/auth/oidc/login'], ['javascript:alert(1)', '/auth/oidc/login'], ['https://example.com/', '/api/v1/library']]) {
    assert.equal(isInfiniDyskV2ExternalLoginRedirect(location, path), false)
  }
})

test('native UI sessions do not reach dashboard WebSocket handshakes', async () => {
  const handshakes = []
  const { plugin } = await loadProxyHarness({
    apiUrl: 'http://api.invalid', traefikUrl: 'http://traefik.invalid',
    fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    proxy: options => {
      const proxy = () => {}
      proxy.upgrade = req => handshakes.push({ target: options.target, cookie: req.headers.cookie, authorization: req.headers.authorization })
      return proxy
    },
  })
  let hook
  await plugin({ hooks: { hook(name, fn) { if (name === 'request') hook = fn } } })
  const server = new EventEmitter()
  hook({ node: { req: { socket: { server } } } })
  server.emit('upgrade', { url: '/ws/status', headers: { cookie: 'dumb_access_token=dashboard; infinidysk_session=direct; dumb_ifd_v2_infinidysk_session=embedded', authorization: 'Bearer dashboard' } }, { destroy() {} }, Buffer.alloc(0))
  server.emit('upgrade', { url: '/ui/radarr/signalr', headers: { cookie: 'radarr_session=radarr; infinidysk_sso=direct-flow; dumb_ifd_v2_infinidysk_sso=embedded-flow' } }, { destroy() {} }, Buffer.alloc(0))
  assert.deepEqual(handshakes, [
    { target: 'http://api.invalid', cookie: 'dumb_access_token=dashboard', authorization: 'Bearer dashboard' },
    { target: 'http://traefik.invalid', cookie: 'radarr_session=radarr', authorization: undefined },
  ])
})
