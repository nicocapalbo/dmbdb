import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, firefox } from 'playwright'
import { WebSocketServer } from 'ws'
import { loadProxyHarness } from '../support/proxyHarness.mjs'

const listen = async (server) => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
const close = (server) => new Promise((resolve) => {
  server.close(resolve)
  server.closeAllConnections()
})

// These fixture services deliberately behave like root-based apps. All routing
// and HTML modification is performed by the real frontend proxy handlers.
const html = `<!doctype html><html><head>
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="/static/style.css">
<script>history.replaceState({ app: true }, '', '/activity/history');</script>
<script src="/static/app.js"></script>
</head><body>
<a id="next" href="/next">Next</a>
<form id="native" action="/submit" method="post"><input name="value" value="submitted"><button>Submit</button></form>
<div id="router-root"><form id="router" action="/login" method="post"><button>Router login</button></form></div>
<script>
// Match a framework's delegated submit handler: read action after capture,
// cancel native navigation, then submit through its own fetch implementation.
document.querySelector('#router-root').addEventListener('submit', async event => {
  event.preventDefault();
  window.routerAction = event.target.getAttribute('action');
  window.routerLogin = await fetch(new Request(window.routerAction, { method: 'POST', body: 'router-body' })).then(response => response.json());
});
</script>
</body></html>`

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: concurrent embedded tabs preserve HTTP, assets, navigation, forms and WebSocket identity`, { timeout: 90000 }, async () => {
    const seen = []
    const upstream = http.createServer(async (req, res) => {
      if (req.url === '/config/service-ui-map') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ radarr: 'radarr', radarr_second: 'radarr', decypharr: 'decypharr' }))
        return
      }
      const match = req.url.match(/^\/service\/ui\/([^/]+)(\/.*)$/)
      if (!match) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ service: 'dumb', path: req.url }))
        return
      }
      const [, service, path] = match
      assert.equal(req.headers['x-dumb-ui-service'], undefined)
      let body = ''
      for await (const chunk of req) body += chunk
      seen.push({ service, path, body, method: req.method })
      if (path.startsWith('/static/style.css')) {
        res.setHeader('content-type', 'text/css')
        res.end('@import "nested.css"; body { color: rgb(1, 2, 3); }')
      } else if (path.startsWith('/static/nested.css')) {
        res.setHeader('content-type', 'text/css')
        res.end('body { background: rgb(4, 5, 6); }')
      } else if (path.startsWith('/static/app.js')) {
        res.setHeader('content-type', 'text/javascript')
        res.end(`window.fixtureService = ${JSON.stringify(service)};`)
      } else if (path.startsWith('/events')) {
        res.setHeader('content-type', 'text/event-stream')
        res.write(`data: ${JSON.stringify({ service })}\n\n`)
      } else if (path.startsWith('/api/') || path.startsWith('/beacon') || path === '/login') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ service, path, body, method: req.method, header: req.headers['x-fixture'] }))
      } else if (path === '/submit') {
        res.writeHead(303, { location: '/submitted' })
        res.end()
      } else {
        res.setHeader('content-type', 'text/html')
        res.setHeader('set-cookie', [`${service}_session=example; Path=/; HttpOnly`, `${service}_csrf=example; Path=/`])
        res.end(html)
      }
    })
    const ws = new WebSocketServer({ noServer: true })
    upstream.on('upgrade', (req, socket, head) => ws.handleUpgrade(req, socket, head, (connection) => {
      const service = req.url.match(/^\/service\/ui\/([^/]+)/)?.[1] || 'dumb'
      connection.send(service)
    }))
    const upstreamUrl = await listen(upstream)
    let browser
    let frontend
    let builtServer
    let builtOutput = ''
    try {
      const { handler, plugin, errors } = await loadProxyHarness({ apiUrl: upstreamUrl, traefikUrl: upstreamUrl })
      let requestHook
      await plugin({ hooks: { hook: (name, fn) => { if (name === 'request') requestHook = fn } } })
      frontend = http.createServer((req, res) => {
        const event = { node: { req, res } }
        requestHook(event)
        if (req.url.startsWith('/services/')) {
          const service = req.url.split('/')[2]
          res.setHeader('content-type', 'text/html')
          res.end(`<html><body><iframe src="/ui/${service}/" referrerpolicy="same-origin"></iframe></body></html>`)
          return
        }
        handler(event).then(() => {
          if (!res.writableEnded && !res.headersSent) res.end('dashboard')
        }).catch((error) => { res.statusCode = 500; res.end(String(error)) })
      })
      const origin = await listen(frontend)
      if (process.env.DUMB_TEST_BUILT === '1') {
        await close(frontend)
        frontend = null
        builtServer = spawn(process.execPath, ['.output/server/index.mjs'], {
          env: { PATH: process.env.PATH, NODE_ENV: 'production',
            NITRO_HOST: '127.0.0.1', NITRO_PORT: new URL(origin).port,
            DUMB_API_URL: upstreamUrl, DMB_API_URL: upstreamUrl, DUMB_TRAEFIK_URL: upstreamUrl },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        for (const stream of [builtServer.stdout, builtServer.stderr]) stream.on('data', (chunk) => { builtOutput = (builtOutput + chunk).slice(-8000) })
        let ready = false
        for (let attempt = 0; attempt < 100; attempt++) {
          if (builtServer.exitCode !== null) throw new Error(`Built server exited: ${builtOutput}`)
          try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break } } catch {}
          await delay(100)
        }
        assert.ok(ready, `Built server failed to start: ${builtOutput}`)
      }
      browser = await browserType.launch({ headless: true })
      const context = await browser.newContext()
      const failures = []
      const browserErrors = []
      const pages = []
      for (const service of ['radarr', 'decypharr', 'radarr_second']) {
        const page = await context.newPage()
        page.on('pageerror', (error) => failures.push(error.message))
        page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
        if (process.env.DUMB_TEST_BUILT === '1') {
          // Start from a real loopback response. A route.fulfill() document has
          // no network address space, which Chromium's local-network checks
          // can reject when that synthetic parent opens a WebSocket.
          await page.goto(`${origin}/api/health`)
          await page.setContent(`<html><body><iframe src="/ui/${service}/" referrerpolicy="same-origin"></iframe></body></html>`)
        } else {
          await page.goto(`${origin}/services/${service}`)
        }
        const frame = page.frames().find((frame) => frame !== page.mainFrame())
        await frame.waitForFunction(() => window.fixtureService)
        assert.equal(await frame.evaluate(() => window.fixtureService), service)
        assert.equal(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(4, 5, 6)')
        pages.push({ page, frame, service })
      }
      for (const { frame, service } of pages) {
        await frame.locator('#router button').click()
        await frame.waitForFunction(() => window.routerLogin)
        assert.equal(await frame.evaluate(() => window.routerAction), '/login')
        const login = await frame.evaluate(() => window.routerLogin)
        assert.equal(login.service, service)
        assert.equal(login.body, 'router-body')
      }
      for (let cycle = 0; cycle < 2; cycle++) {
        await context.addCookies([{ name: 'dumb_ui_service', value: 'wrong_service', url: origin }])
        await Promise.all(pages.map(async ({ frame, service }) => {
          const result = await frame.evaluate(async () => {
            history.pushState({ test: 1 }, '', '/activity/history?page=2#details')
            const response = await fetch(new Request('/api/v3/history?count=3', {
              method: 'POST', body: 'request-body', headers: { 'x-fixture': 'preserved' },
            }))
            const fetchResult = await response.json()
            const xhrResult = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest()
              xhr.open('GET', '/api/status')
              xhr.onload = () => resolve(JSON.parse(xhr.responseText))
              xhr.onerror = reject
              xhr.send()
            })
            const socketResult = await new Promise((resolve, reject) => {
              const socket = new WebSocket(`ws://${location.host}/signalr`)
              socket.onmessage = (event) => { resolve(event.data); socket.close() }
              socket.onerror = reject
            })
            const eventResult = await new Promise((resolve, reject) => {
              const stream = new EventSource('/events')
              stream.onmessage = (event) => { resolve(JSON.parse(event.data)); stream.close() }
              stream.onerror = reject
            })
            navigator.sendBeacon('/beacon', 'beacon-body')
            return { fetchResult, xhrResult, socketResult, eventResult, url: location.href, state: history.state }
          })
          assert.equal(result.fetchResult.service, service)
          assert.equal(result.fetchResult.body, 'request-body')
          assert.equal(result.fetchResult.header, 'preserved')
          assert.equal(result.xhrResult.service, service)
          assert.equal(result.socketResult, service)
          assert.equal(result.eventResult.service, service)
          assert.equal(new URL(result.url).searchParams.get('__dumb_ui'), service)
          assert.deepEqual(result.state, { test: 1 })
        }))
        // A dashboard tab clearing the legacy cookie must not affect the iframes.
        await pages[0].page.evaluate(() => { document.cookie = 'dumb_ui_service=; Path=/; Max-Age=0' })
      }
      for (const { frame, service } of pages) {
        await frame.goto(frame.url())
        await frame.waitForFunction(() => window.fixtureService)
        assert.equal(await frame.evaluate(() => window.fixtureService), service)
        await Promise.all([frame.waitForNavigation({ waitUntil: 'load' }), frame.locator('#next').click()])
        await frame.waitForFunction(() => window.fixtureService)
        assert.equal(await frame.evaluate(() => window.fixtureService), service)
        await Promise.all([frame.waitForNavigation({ waitUntil: 'load' }), frame.locator('#native button').click()])
        await frame.waitForFunction(() => window.fixtureService)
        assert.equal(await frame.evaluate(() => window.fixtureService), service)
        assert.ok(seen.some((request) => request.service === service && request.path === '/static/nested.css'))
        assert.ok(seen.some((request) => request.service === service && request.path === '/submit' && request.body === 'value=submitted'))
        assert.ok(seen.some((request) => request.service === service && request.path === '/beacon' && request.body === 'beacon-body'))
      }
      const sessionCookies = await context.cookies()
      for (const { service } of pages) {
        assert.ok(sessionCookies.some((cookie) => cookie.name === `${service}_session` && cookie.httpOnly))
        assert.ok(sessionCookies.some((cookie) => cookie.name === `${service}_csrf`))
      }
      const dashboardSocket = await pages[0].page.evaluate(() => new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${location.host}/ws/logs`)
        socket.onmessage = (event) => { resolve(event.data); socket.close() }
        socket.onerror = reject
      })).catch((error) => { throw new Error(`Dashboard WebSocket failed: ${browserErrors.join('\n')}`, { cause: error }) })
      assert.equal(dashboardSocket, 'dumb')
      const health = await pages[0].page.evaluate(() => fetch('/api/health').then((response) => response.json()))
      assert.equal(health.service, 'dumb')
      assert.ok(seen.every((request) => !request.path.includes('__dumb_ui')))
      assert.deepEqual(failures, [])
      assert.deepEqual(errors, [])
    } catch (error) {
      if (builtOutput) throw new Error(`Built proxy output:\n${builtOutput}`, { cause: error })
      throw error
    } finally {
      await browser?.close()
      for (const client of ws.clients) client.terminate()
      ws.close()
      if (builtServer && builtServer.exitCode === null) {
        const exited = once(builtServer, 'exit')
        builtServer.kill('SIGTERM')
        const force = setTimeout(() => builtServer.kill('SIGKILL'), 5000)
        await exited
        clearTimeout(force)
      }
      if (frontend) await close(frontend)
      await close(upstream)
    }
  })
}

const mediaServices = {
  jellyfin: 'jellyfin',
  emby: 'emby',
  cinema_server: 'jellyfin',
  television_server: 'emby',
}
const mediaHtml = `<!doctype html><html><head>
<link rel="stylesheet" href="style.css">
<script src="apploader.js" defer></script>
</head><body><button id="login">Log in</button><ul id="libraries"></ul></body></html>`
const mediaScript = (service) => `
window.fixtureService = ${JSON.stringify(service)};
document.querySelector('#login').addEventListener('click', async () => {
  window.fixtureError = null;
  try {
    const login = await fetch(new Request('/Users/authenticatebyname', {
      method: 'POST', headers: {
        'content-type': 'application/json',
        authorization: 'MediaBrowser Client="fixture", Device="fixture-browser", DeviceId="fixture-device", Version="1"',
        'x-emby-authorization': 'MediaBrowser Client="fixture", Device="fixture-browser", DeviceId="fixture-device", Version="1"',
      }, body: JSON.stringify({ Username: 'fixture-user', Pw: 'fixture-password' }),
    }));
    if (!login.ok) throw new Error('Authentication failed: ' + login.status);
    const session = await login.json();
    const headers = {
      authorization: 'MediaBrowser Client="fixture", Token="' + session.AccessToken + '"',
      'x-emby-token': session.AccessToken,
      'x-mediabrowser-token': session.AccessToken,
    };
    const query = '?api_key=' + encodeURIComponent(session.AccessToken) + '&Fields=Name%20Path';
    const views = await fetch(new Request('/Users/' + session.User.Id + '/Views' + query, { headers }));
    if (!views.ok) throw new Error('Library loading failed: ' + views.status);
    window.fixtureViews = await views.json();
    window.fixtureSystem = await fetch('/System/Info/Public' + query, { headers }).then(response => response.json());
    window.fixtureItems = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/Items' + query);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.onload = () => xhr.status === 200 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error('Items failed: ' + xhr.status));
      xhr.onerror = () => reject(new Error('Items request failed'));
      xhr.send();
    });
    document.querySelector('#libraries').replaceChildren(...window.fixtureViews.Items.map(item => {
      const node = document.createElement('li');
      node.textContent = item.Name;
      return node;
    }));
    window.fixtureLogins = (window.fixtureLogins || 0) + 1;
  } catch (error) { window.fixtureError = error.message; }
});`

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: media server login and libraries retain root APIs, web assets and per-tab identity`, { timeout: 90000 }, async () => {
    const seen = []
    const upstream = http.createServer(async (req, res) => {
      if (req.url === '/config/service-ui-map') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(mediaServices))
        return
      }
      const match = req.url.match(/^\/service\/ui\/([^/]+)(\/.*)$/)
      if (!match) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ service: 'dumb', path: req.url }))
        return
      }
      const [, service, path] = match
      assert.equal(req.headers['x-dumb-ui-service'], undefined)
      let body = ''
      for await (const chunk of req) body += chunk
      seen.push({ service, path, body, method: req.method, headers: { ...req.headers } })
      const url = new URL(path, 'http://upstream.invalid')
      if (url.pathname === '/' || url.pathname === '/web/index.html') {
        // DUMB's media root middleware serves /web/index.html inline. The
        // browser therefore needs a canonical web URL before relative assets.
        res.setHeader('content-type', 'text/html')
        res.end(mediaHtml)
      } else if (url.pathname === '/web/style.css') {
        res.setHeader('content-type', 'text/css')
        res.end('@import "nested.css"; body { color: rgb(1, 2, 3); }')
      } else if (url.pathname === '/web/nested.css') {
        res.setHeader('content-type', 'text/css')
        res.end('body { background: rgb(4, 5, 6); }')
      } else if (url.pathname === '/web/apploader.js') {
        res.setHeader('content-type', 'text/javascript')
        res.end(mediaScript(service))
      } else if (url.pathname === '/Users/authenticatebyname' && req.method === 'POST') {
        const identity = 'MediaBrowser Client="fixture", Device="fixture-browser", DeviceId="fixture-device", Version="1"'
        if (body !== JSON.stringify({ Username: 'fixture-user', Pw: 'fixture-password' }) ||
            req.headers.authorization !== identity || req.headers['x-emby-authorization'] !== identity) {
          res.writeHead(401)
          res.end('Invalid fixture credentials')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ User: { Id: 'fixture-user' }, AccessToken: `fixture/${service}` }))
      } else if (['/Users/fixture-user/Views', '/Items', '/System/Info/Public'].includes(url.pathname)) {
        const token = `fixture/${service}`
        if (url.searchParams.get('api_key') !== token || req.headers['x-emby-token'] !== token ||
            req.headers['x-mediabrowser-token'] !== token ||
            req.headers.authorization !== `MediaBrowser Client="fixture", Token="${token}"`) {
          res.writeHead(401)
          res.end('Invalid fixture token')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ service, Items: [{ Id: 'fixture-library', Name: `${service} library` }] }))
      } else {
        res.writeHead(404)
        res.end(`Unexpected media path: ${url.pathname}`)
      }
    })
    const upstreamUrl = await listen(upstream)
    let browser
    let frontend
    let builtServer
    let builtOutput = ''
    try {
      const { handler, errors } = await loadProxyHarness({ apiUrl: upstreamUrl, traefikUrl: upstreamUrl })
      frontend = http.createServer((req, res) => {
        handler({ node: { req, res } }).then(() => {
          if (!res.writableEnded && !res.headersSent) res.end('dashboard')
        }).catch((error) => { res.statusCode = 500; res.end(String(error)) })
      })
      const origin = await listen(frontend)
      if (process.env.DUMB_TEST_BUILT === '1') {
        await close(frontend)
        frontend = null
        builtServer = spawn(process.execPath, ['.output/server/index.mjs'], {
          env: { PATH: process.env.PATH, NODE_ENV: 'production',
            NITRO_HOST: '127.0.0.1', NITRO_PORT: new URL(origin).port,
            DUMB_API_URL: upstreamUrl, DMB_API_URL: upstreamUrl, DUMB_TRAEFIK_URL: upstreamUrl },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        for (const stream of [builtServer.stdout, builtServer.stderr]) stream.on('data', (chunk) => { builtOutput = (builtOutput + chunk).slice(-8000) })
        let ready = false
        for (let attempt = 0; attempt < 100; attempt++) {
          if (builtServer.exitCode !== null) throw new Error(`Built server exited: ${builtOutput}`)
          try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break } } catch {}
          await delay(100)
        }
        assert.ok(ready, `Built server failed to start: ${builtOutput}`)
      }
      browser = await browserType.launch({ headless: true })
      const context = await browser.newContext()
      const failures = []
      const pages = []
      for (const service of Object.keys(mediaServices)) {
        const page = await context.newPage()
        page.on('pageerror', (error) => failures.push(error.message))
        await page.goto(`${origin}/api/health`)
        await page.setContent(`<html><body><iframe src="/ui/${service}/" referrerpolicy="same-origin"></iframe></body></html>`)
        const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
        await frame.waitForFunction(() => window.fixtureService)
        assert.equal(new URL(frame.url()).pathname, `/ui/${service}/web/index.html`)
        assert.equal(await frame.evaluate(() => window.fixtureService), service)
        assert.equal(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(4, 5, 6)')
        pages.push({ page, frame, service })
      }
      const login = async ({ frame, service }, expectedLogins) => {
        await frame.locator('#login').click()
        await frame.waitForFunction((count) => window.fixtureError || window.fixtureLogins === count, expectedLogins)
        assert.equal(await frame.evaluate(() => window.fixtureError), null)
        assert.deepEqual(await frame.locator('#libraries li').allTextContents(), [`${service} library`])
        for (const key of ['fixtureViews', 'fixtureItems', 'fixtureSystem']) {
          assert.equal(await frame.evaluate((name) => window[name].service, key), service)
        }
      }
      // Matching legacy cookies reproduce the original broad /web API rewrite.
      for (const current of pages) {
        await context.addCookies([{ name: 'dumb_ui_service', value: current.service, url: origin }])
        await login(current, 1)
      }
      // Conflicting shared cookies must not change any already open iframe.
      await context.addCookies([{ name: 'dumb_ui_service', value: 'wrong_service', url: origin }])
      await Promise.all(pages.map((current) => login(current, 2)))
      for (const { service } of pages) {
        for (const path of ['/web/index.html', '/web/apploader.js', '/web/style.css', '/web/nested.css']) {
          assert.ok(seen.some((request) => request.service === service && request.path === path), `${service}: ${path}`)
        }
        const requests = seen.filter((request) => request.service === service && request.path.startsWith('/Users/'))
        assert.equal(requests.length, 4)
        assert.equal(requests.filter((request) => request.method === 'POST').length, 2)
        for (const request of requests.filter((request) => request.method === 'GET')) {
          assert.equal(request.path, `/Users/fixture-user/Views?api_key=fixture%2F${service}&Fields=Name%20Path`)
        }
      }
      assert.ok(seen.every((request) => !request.path.includes('__dumb_ui')))
      assert.ok(seen.every((request) => !/^\/web\/(?:Users|Items|System)(?:\/|\?)/.test(request.path)))
      assert.deepEqual(failures, [])
      assert.deepEqual(errors, [])
    } catch (error) {
      if (builtOutput) throw new Error(`Built proxy output:\n${builtOutput}`, { cause: error })
      throw error
    } finally {
      await browser?.close()
      if (builtServer && builtServer.exitCode === null) {
        const exited = once(builtServer, 'exit')
        builtServer.kill('SIGTERM')
        const force = setTimeout(() => builtServer.kill('SIGKILL'), 5000)
        await exited
        clearTimeout(force)
      }
      if (frontend) await close(frontend)
      await close(upstream)
    }
  })
}
