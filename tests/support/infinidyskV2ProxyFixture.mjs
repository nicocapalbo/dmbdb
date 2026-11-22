import http from 'node:http'
import https from 'node:https'
import { once } from 'node:events'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { loadProxyHarness } from './proxyHarness.mjs'

const listen = async (server, secure = false, port = 0) => {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return `${secure ? 'https' : 'http'}://127.0.0.1:${server.address().port}`
}
const close = server => new Promise(resolve => {
  if (!server) return resolve()
  server.close(resolve)
  server.closeAllConnections()
})

export const nativeFixtureCredentials = { username: 'fixture_operator', password: 'fixture-only-embedded-passphrase' }
export const nativeFixtureCsp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

const fixtureHtml = '<!doctype html><html><head><meta name="referrer" content="same-origin"><link rel="stylesheet" href="/assets/native.css"><script type="module" src="/assets/native.js"></script><script>window.untrustedInlineRan=true</script></head><body><main id="app"></main></body></html>'
const fixtureScript = `
export const singleton=Symbol('native-entry');window.fixtureEntryLoads=(window.fixtureEntryLoads||0)+1;
const app=document.querySelector('#app');
async function render(){const auth=await fetch(new Request('/api/v1/auth')).then(r=>r.json());app.innerHTML=auth.user?'<h1>Overview</h1><a href="/settings/providers" id="settings">Settings</a><button id="logout">Sign out</button>':'<label>Username<input id="username"></label><label>Password<input id="password" type="password"></label><button id="login">Sign in</button>';document.querySelector('#login')?.addEventListener('click',async()=>{await fetch(new Request('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer must-not-forward','x-api-key':'must-not-forward'},body:JSON.stringify({username:document.querySelector('#username').value,password:document.querySelector('#password').value})}));window.fixtureModuleIdentity=(await import('./native-lazy.js')).entry===singleton;await render()});document.querySelector('#logout')?.addEventListener('click',async()=>{await fetch('/api/v1/auth/logout',{method:'POST'});await render()});document.querySelector('#settings')?.addEventListener('click',event=>{event.preventDefault();history.pushState({},'','/settings/providers');document.querySelector('h1').textContent='Providers'})}
await render();window.nativeFixtureReady=true;
`

// This test-only relay stands in for DUMB's API and Traefik. The frontend proxy,
// browser adapter and optional packaged Nitro server are the real implementation.
export async function startInfiniDyskV2ProxyFixture({ nativeUrl, directRoot = false, entryPath = '/', entryService = 'infinidysk', oidcControlUrl, externalPort = 0, dashboardAuthEnabled = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dmbdb-native-v2-'))
  const requests = []
  const metadataRequests = []
  const errors = []
  let upstream, frontend, external, built
  let builtOutput = ''
  const state = { protocol: 1, inventoryAvailable: true }
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')], { stdio: 'ignore', timeout: 10000 })
    const nativeProxy = nativeUrl && createProxyMiddleware({ target: nativeUrl, changeOrigin: false,
      pathRewrite: path => path.replace(/^\/service\/ui\/infinidysk/, ''),
      on: { error(error, _req, res) { errors.push(error.message); res.writeHead(502); res.end() } },
    })
    upstream = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid')
      if (url.pathname === '/config/service-ui' || url.pathname === '/config/service-ui-map') {
        metadataRequests.push({ path: req.url, authorization: Boolean(req.headers.authorization), cookie: Boolean(req.headers.cookie) })
        if (dashboardAuthEnabled && req.headers.authorization !== 'Bearer fixture-dashboard-token') {
          res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"detail":"Authentication required"}'); return
        }
      }
      if (url.pathname === '/config/service-ui-map') {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ infinidysk: 'infinidysk', radarr: 'radarr' })); return
      }
      if (url.pathname === '/config/service-ui') {
        res.setHeader('content-type', 'application/json')
        if (!state.inventoryAvailable) { res.statusCode = 503; res.end('{}'); return }
        assertMetadataOnly(url)
        res.end(JSON.stringify({ services: [{ name: 'InfiniDysk', config_key: 'infinidysk', runtime_generation: '2', embedded_ui_protocol: state.protocol }] })); return
      }
      if (url.pathname === '/config/embedded-ui-routing/infinidysk') {
        metadataRequests.push({ path: req.url, authorization: Boolean(req.headers.authorization), cookie: Boolean(req.headers.cookie) })
        res.setHeader('content-type', 'application/json')
        if (!state.inventoryAvailable) { res.statusCode = 503; res.end('{}'); return }
        res.end(JSON.stringify({ name: 'InfiniDysk', config_key: 'infinidysk', runtime_generation: '2', embedded_ui_protocol: state.protocol })); return
      }
      if (!url.pathname.startsWith('/service/ui/')) {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ service: 'dumb', path: req.url, cookie: req.headers.cookie || '' })); return
      }
      const match = url.pathname.match(/^\/service\/ui\/([^/]+)(\/.*)$/)
      const service = match?.[1]
      const path = match?.[2]
      requests.push({ service, path, url: req.url, headers: { ...req.headers }, method: req.method })
      if (nativeProxy && service === 'infinidysk') { nativeProxy(req, res); return }
      let body = ''
      for await (const chunk of req) body += chunk
      requests.at(-1).body = body
      const authenticated = /(?:^|;\s*)infinidysk_session=embedded-token(?:;|$)/.test(req.headers.cookie || '')
      if (path === '/assets/native.js') { res.setHeader('content-type', 'text/javascript'); res.end(fixtureScript); return }
      if (path === '/assets/native-lazy.js') { res.setHeader('content-type', 'text/javascript'); res.end("export {singleton as entry} from './native.js'"); return }
      if (path === '/assets/native.css') { res.setHeader('content-type', 'text/css'); res.end('body{color:rgb(1,2,3)}'); return }
      if (path === '/api/v1/auth/login') {
        const login = JSON.parse(body)
        res.statusCode = login.username === nativeFixtureCredentials.username && login.password === nativeFixtureCredentials.password ? 204 : 401
        if (res.statusCode === 204) res.setHeader('set-cookie', ['infinidysk_session=embedded-token; Path=/; HttpOnly; SameSite=Strict; Secure', 'dumb_access_token=upstream-must-not-set; Path=/'])
        res.end(); return
      }
      if (path === '/api/v1/auth/logout') { res.statusCode = 204; res.setHeader('set-cookie', 'infinidysk_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure'); res.end(); return }
      if (path === '/api/v1/auth') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ required: true, user: authenticated ? nativeFixtureCredentials.username : null })); return }
      if (path === '/auth/oidc/login') { res.writeHead(302, { location: 'https://identity.example.invalid/authorize?state=opaque', 'set-cookie': 'infinidysk_sso=flow; Path=/; HttpOnly; SameSite=Lax; Secure' }); res.end(); return }
      if (path?.startsWith('/api/v1/')) {
        if (!authenticated) { res.writeHead(401); res.end(); return }
        if (path === '/api/v1/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: live\ndata: {"fixture":true}\n\n'); return }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ service, path, body })); return
      }
      if (path === '/view/fixture') { res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 2-4/10', 'content-length': '3', 'accept-ranges': 'bytes' }); res.end('234'); return }
      res.setHeader('content-type', 'text/html'); res.setHeader('content-security-policy', nativeFixtureCsp); res.setHeader('x-frame-options', 'DENY'); res.end(fixtureHtml)
    })
    const upstreamUrl = await listen(upstream)
    const harness = await loadProxyHarness({ apiUrl: upstreamUrl, traefikUrl: upstreamUrl })
    let requestHook
    await harness.plugin({ hooks: { hook(name, fn) { if (name === 'request') requestHook = fn } } })
    frontend = http.createServer((req, res) => {
      const event = { node: { req, res } }
      requestHook(event)
      if (req.url === '/parent') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>DUMB fixture</title><iframe style="width:100%;height:95vh" src="/ui/infinidysk/" referrerpolicy="same-origin"></iframe>'); return }
      harness.handler(event).then(() => { if (!res.writableEnded && !res.headersSent) res.end('dashboard') }).catch(error => { errors.push(error.message); res.writeHead(500); res.end('Fixture failed') })
    })
    let frontendUrl = await listen(frontend)
    if (process.env.DUMB_TEST_BUILT === '1') {
      await close(frontend); frontend = null
      built = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: new URL(frontendUrl).port, DUMB_API_URL: upstreamUrl, DMB_API_URL: upstreamUrl, DUMB_TRAEFIK_URL: upstreamUrl }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [built.stdout, built.stderr]) stream.on('data', chunk => { builtOutput = (builtOutput + chunk).slice(-12000) })
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (built.exitCode !== null) throw new Error('Built frontend exited: ' + builtOutput)
        try { if ((await fetch(frontendUrl + '/api/health')).ok) { ready = true; break } } catch {}
        await delay(100)
      }
      if (!ready) throw new Error('Built frontend did not start: ' + builtOutput)
    }
    const reverseProxy = createProxyMiddleware({ target: frontendUrl, changeOrigin: false, on: { proxyReq(proxyReq, req) { proxyReq.setHeader('X-Forwarded-Proto', 'https'); proxyReq.setHeader('X-Forwarded-Host', req.headers.host) } } })
    const directProxy = directRoot && nativeUrl && createProxyMiddleware({ target: nativeUrl, changeOrigin: false, on: {
      proxyReq(proxyReq, req) { proxyReq.setHeader('X-Forwarded-Proto', 'https'); proxyReq.setHeader('X-Forwarded-Host', req.headers.host) },
      proxyRes(proxyRes) { proxyRes.headers['content-security-policy'] = String(proxyRes.headers['content-security-policy'] || '').replace("frame-ancestors 'none'", "frame-ancestors 'self'"); proxyRes.headers['x-frame-options'] = 'SAMEORIGIN' },
    } })
    external = https.createServer({ key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) }, async (req, res) => {
      if (req.url === '/parent') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>DUMB fixture</title><iframe style="width:100%;height:95vh" src="' + (directProxy ? '/' : '/ui/' + entryService + entryPath) + '" referrerpolicy="same-origin"></iframe>'); return }
      if (oidcControlUrl && req.url.startsWith('/fixture-oidc/authorize?')) {
        const url = new URL(req.url, 'https://fixture.invalid')
        const flow = Object.fromEntries(url.searchParams)
        const callback = new URL(flow.redirect_uri)
        if (callback.host !== req.headers.host || callback.pathname !== '/ui/infinidysk/auth/oidc/callback') { res.writeHead(400); res.end(); return }
        const code = await fetch(oidcControlUrl + '/authorize-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(flow) }).then(r => r.json())
        callback.searchParams.set('code', code.code)
        callback.searchParams.set('state', flow.state)
        res.writeHead(302, { location: callback.href }); res.end(); return
      }
      if (directProxy) { directProxy(req, res); return }
      reverseProxy(req, res)
    })
    const origin = await listen(external, true, externalPort)
    return { origin, requests, metadataRequests, errors, state, harnessErrors: harness.errors, nativeUrl,
      async close() {
        await close(external); await close(frontend); await close(upstream)
        if (built && built.exitCode === null) { const exited = once(built, 'exit'); built.kill('SIGTERM'); const force = setTimeout(() => built.kill('SIGKILL'), 5000); await exited; clearTimeout(force) }
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await close(external); await close(frontend); await close(upstream)
    if (built && built.exitCode === null) { built.kill('SIGKILL'); await once(built, 'exit') }
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function assertMetadataOnly(url) {
  if (url.searchParams.get('metadata_only') !== 'true') throw new Error('The proxy must request the read-only service inventory')
}
