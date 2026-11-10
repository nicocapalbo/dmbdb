import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { chromium, firefox } from 'playwright'
import { WebSocketServer } from 'ws'
import { loadProxyHarness } from '../support/proxyHarness.mjs'

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
async function close(server) {
  if (!server) return
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
}
async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await exited } finally { clearTimeout(force) }
}

// Protocol fixtures deliberately use Audiobookshelf's root routes and Socket.IO
// transport URLs. They exercise the actual frontend proxy and serialized browser
// adapter; full upstream login is validated separately against a disposable app.
const fixtureHtml = `<!doctype html><html><head></head><body data-base="/audiobookshelf">
<div id="ready">Library</div><script>
const base = document.body.dataset.base || '';
window.initialRouterPath = location.pathname;
if (base && !location.pathname.startsWith(base + '/')) throw new Error('Native router base mismatch');
history.replaceState({}, '', base + '/library');
window.signIn = async function() {
  const response = await fetch(new Request(location.origin + base + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reader', password: 'fixture-passphrase' })
  }));
  const auth = await response.json();
  window.fixtureToken = auth.token;
  return auth;
};
window.libraries = (rootAlias = false) => fetch((rootAlias ? '' : base) + '/api/libraries', {
  headers: { Authorization: 'Bearer ' + window.fixtureToken }
}).then(response => response.json());
window.poll = () => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', base + '/socket.io/?EIO=4&transport=polling&t=fixture');
  xhr.onload = () => resolve(JSON.parse(xhr.responseText));
  xhr.onerror = reject;
  xhr.send();
});
window.socket = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + base + '/socket.io/?EIO=4&transport=websocket');
  ws.onmessage = event => { resolve(JSON.parse(event.data)); ws.close(); };
  ws.onerror = reject;
});
window.play = () => fetch(base + '/api/items/book/file', { headers: { Range: 'bytes=0-3' } })
  .then(async response => ({ status: response.status, range: response.headers.get('content-range'), body: await response.text() }));
</script></body></html>`

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: Audiobookshelf-style login, playback and Socket.IO keep their tab context`, { timeout: 90000 }, async () => {
    const requests = []
    const upstream = http.createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/config/service-ui-map') {
        res.end(JSON.stringify({ audiobookshelf: 'audiobookshelf', radarr: 'radarr' }))
        return
      }
      const match = req.url.match(/^\/service\/ui\/([^/]+)(\/.*)$/)
      if (!match) {
        res.end(JSON.stringify({ service: 'dumb', path: req.url }))
        return
      }
      const [, service, path] = match
      const applicationPath = service === 'audiobookshelf' && path.startsWith('/audiobookshelf/')
        ? path.slice('/audiobookshelf'.length) : path
      let body = ''
      for await (const chunk of req) body += chunk
      requests.push({ service, path, body, method: req.method, authorization: req.headers.authorization, range: req.headers.range })
      assert.equal(req.headers['x-dumb-ui-service'], undefined)
      if (applicationPath === '/login') {
        res.end(JSON.stringify({ service, token: 'fixture-token' }))
      } else if (applicationPath === '/api/libraries') {
        res.end(JSON.stringify({ service, libraries: ['Audiobooks'] }))
      } else if (applicationPath.startsWith('/socket.io/')) {
        res.end(JSON.stringify({ service, transport: 'polling' }))
      } else if (applicationPath === '/api/items/book/file') {
        res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-3/8', 'accept-ranges': 'bytes' })
        res.end('book')
      } else {
        res.setHeader('content-type', 'text/html')
        res.end(service === 'audiobookshelf' ? fixtureHtml : fixtureHtml.replace('data-base="/audiobookshelf"', 'data-base=""'))
      }
    })
    const websocketServer = new WebSocketServer({ noServer: true })
    upstream.on('upgrade', (req, socket, head) => {
      websocketServer.handleUpgrade(req, socket, head, connection => {
        const service = req.url.match(/^\/service\/ui\/([^/]+)/)?.[1]
        connection.send(JSON.stringify({ service, transport: 'websocket', path: req.url }))
      })
    })
    const upstreamUrl = await listen(upstream)
    let frontend
    let builtServer
    let browser
    let buildOutput = ''
    let errors = []
    try {
      let origin
      if (process.env.DUMB_TEST_BUILT === '1') {
        const reserve = http.createServer()
        origin = await listen(reserve)
        await close(reserve)
        builtServer = spawn(process.execPath, ['.output/server/index.mjs'], {
          env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1',
            NITRO_PORT: new URL(origin).port, DUMB_API_URL: upstreamUrl,
            DMB_API_URL: upstreamUrl, DUMB_TRAEFIK_URL: upstreamUrl },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        for (const stream of [builtServer.stdout, builtServer.stderr]) {
          stream.on('data', chunk => { buildOutput = (buildOutput + chunk).slice(-8000) })
        }
        let ready = false
        for (let attempt = 0; attempt < 100; attempt++) {
          if (builtServer.exitCode !== null) throw new Error(`Built frontend exited: ${buildOutput}`)
          try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break } } catch {}
          await delay(100)
        }
        assert.ok(ready, `Built frontend did not start: ${buildOutput}`)
      } else {
        const harness = await loadProxyHarness({ apiUrl: upstreamUrl, traefikUrl: upstreamUrl })
        errors = harness.errors
        let requestHook
        await harness.plugin({ hooks: { hook: (name, fn) => { if (name === 'request') requestHook = fn } } })
        frontend = http.createServer((req, res) => {
          const event = { node: { req, res } }
          requestHook(event)
          harness.handler(event).then(() => {
            if (!res.writableEnded && !res.headersSent) res.end('dashboard')
          }).catch(error => { res.statusCode = 500; res.end(String(error)) })
        })
        origin = await listen(frontend)
      }
      browser = await browserType.launch({ headless: true })
      const context = await browser.newContext()
      const booksPage = await context.newPage()
      const otherPage = await context.newPage()
      await booksPage.goto(origin + '/api/health')
      await booksPage.setContent('<iframe src="/ui/audiobookshelf/audiobookshelf/"></iframe>')
      const books = booksPage.frames().find(frame => frame.parentFrame() === booksPage.mainFrame())
      await books.waitForFunction(() => typeof window.signIn === 'function')
      await otherPage.goto(origin + '/api/health')
      await otherPage.setContent('<iframe src="/ui/radarr/"></iframe>')
      const other = otherPage.frames().find(frame => frame.parentFrame() === otherPage.mainFrame())
      await other.waitForFunction(() => typeof window.signIn === 'function')
      await context.addCookies([{ name: 'dumb_ui_service', value: 'radarr', url: origin }])

      assert.equal(await books.evaluate(() => window.initialRouterPath), '/audiobookshelf/')
      assert.equal((await books.evaluate(() => window.signIn())).service, 'audiobookshelf')
      assert.equal((await books.evaluate(() => window.libraries())).service, 'audiobookshelf')
      assert.equal((await books.evaluate(() => window.libraries(true))).service, 'audiobookshelf')
      assert.deepEqual(await books.evaluate(() => window.poll()), { service: 'audiobookshelf', transport: 'polling' })
      const socket = await books.evaluate(() => window.socket())
      assert.equal(socket.service, 'audiobookshelf')
      assert.equal(socket.transport, 'websocket')
      assert.match(socket.path, /\/audiobookshelf\/socket\.io\/\?EIO=4&transport=websocket/)
      assert.deepEqual(await books.evaluate(() => window.play()), { status: 206, range: 'bytes 0-3/8', body: 'book' })
      assert.equal((await other.evaluate(() => window.signIn())).service, 'radarr')
      await Promise.all([books.waitForNavigation(), books.evaluate(() => location.reload())])
      await books.waitForFunction(() => typeof window.signIn === 'function')
      assert.equal((await books.evaluate(() => window.signIn())).service, 'audiobookshelf')

      const mainApi = await context.request.get(origin + '/api/process/processes')
      assert.deepEqual(await mainApi.json(), { service: 'dumb', path: '/process/processes' })
      const login = requests.find(request => request.service === 'audiobookshelf' && request.path === '/audiobookshelf/login')
      assert.equal(login.method, 'POST')
      assert.deepEqual(JSON.parse(login.body), { username: 'reader', password: 'fixture-passphrase' })
      assert.equal(requests.find(request => request.service === 'audiobookshelf' && request.path === '/audiobookshelf/api/libraries').authorization, 'Bearer fixture-token')
      assert.equal(requests.find(request => request.service === 'audiobookshelf' && request.path === '/audiobookshelf/api/items/book/file').range, 'bytes=0-3')
      assert.deepEqual(errors, [])
    } finally {
      if (browser) await browser.close()
      await stopChild(builtServer)
      await close(frontend)
      for (const client of websocketServer.clients) client.terminate()
      await new Promise(resolve => websocketServer.close(resolve))
      await close(upstream)
      assert.ok(!builtServer || builtServer.exitCode !== null)
    }
  })
}
