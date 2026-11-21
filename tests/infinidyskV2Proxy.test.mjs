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
    fetchImpl: async url => new Response(JSON.stringify(String(url).includes('/config/service-ui?')
      ? { services: [{ name: 'InfiniDysk', config_key: 'infinidysk', runtime_generation: '2', embedded_ui_protocol: 1 }] }
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
