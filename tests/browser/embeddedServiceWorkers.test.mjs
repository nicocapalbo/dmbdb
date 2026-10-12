import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, firefox } from 'playwright'
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
const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await exited } finally { clearTimeout(force) }
}

// Loopback is a secure context in both supported browsers. Every case uses a
// disposable browser context; no operator profile, registration or cache is used.
const fixtureWorker = (identity, version = 1) => `
importScripts('/worker-helper.js');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname.endsWith('/worker-identity')) {
    event.respondWith(new Response(JSON.stringify({ service: ${JSON.stringify(identity)}, version: ${version}, importedService: self.importedService })));
  }
});
self.addEventListener('message', event => {
  const run = async () => {
    if (event.data === 'fetch') return fetch('/api/worker-probe').then(response => response.json());
    if (event.data === 'open') {
      const client = await self.clients.openWindow('/');
      return { url: client && client.url };
    }
  };
  event.waitUntil(run().then(result => event.ports[0].postMessage(result), error => event.ports[0].postMessage({ error: error.name, message: error.message })));
});`
const seedWorker = (identity) => `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname === '/worker-identity') {
    event.respondWith(new Response(${JSON.stringify(identity)}));
  }
});`

const startFixture = async () => {
  const upstreamRequests = []
  const frontendRequests = []
  const seededScripts = new Map()
  const versions = new Map([['radarr', 1], ['decypharr', 1]])
  const upstream = http.createServer((req, res) => {
    if (req.url === '/config/service-ui-map') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ radarr: 'radarr', decypharr: 'decypharr' }))
      return
    }
    const match = req.url.match(/^\/service\/ui\/([^/]+)(\/.*)$/)
    if (!match) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ service: 'dumb', path: req.url }))
      return
    }
    const [, service, path] = match
    upstreamRequests.push({ service, path, method: req.method })
    if (path.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ service, path }))
    } else if (/\/sw\.js(?:\?|$)/.test(path)) {
      // An upstream app may request root scope. The embedding layer must not
      // grant that worker control over the dashboard or another embedded UI.
      res.setHeader('content-type', 'text/javascript')
      res.setHeader('service-worker-allowed', '/')
      res.setHeader('cache-control', 'no-store')
      res.end(fixtureWorker(service, versions.get(service)))
    } else if (path === '/worker-helper.js') {
      res.setHeader('content-type', 'text/javascript')
      res.end(`self.importedService = ${JSON.stringify(service)};`)
    } else {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><html><head></head><body><button id="open">Open worker window</button>Worker fixture</body></html>')
    }
  })
  const upstreamUrl = await listen(upstream)
  let frontend
  let builtServer
  let builtOutput = ''
  let errors = []
  try {
    let dispatch
    if (process.env.DUMB_TEST_BUILT === '1') {
      const reserve = http.createServer()
      const backendOrigin = await listen(reserve)
      await close(reserve)
      builtServer = spawn(process.execPath, ['.output/server/index.mjs'], {
        env: { PATH: process.env.PATH, NODE_ENV: 'production',
          NITRO_HOST: '127.0.0.1', NITRO_PORT: new URL(backendOrigin).port,
          DUMB_API_URL: upstreamUrl, DMB_API_URL: upstreamUrl, DUMB_TRAEFIK_URL: upstreamUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      for (const stream of [builtServer.stdout, builtServer.stderr]) {
        stream.on('data', (chunk) => { builtOutput = (builtOutput + chunk).slice(-8000) })
      }
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (builtServer.exitCode !== null) throw new Error(`Built server exited: ${builtOutput}`)
        try { if ((await fetch(`${backendOrigin}/api/health`)).ok) { ready = true; break } } catch {}
        await delay(100)
      }
      assert.ok(ready, `Built server failed to start: ${builtOutput}`)
      dispatch = (req, res) => {
        const forwarded = http.request(new URL(req.url, backendOrigin), {
          method: req.method, headers: req.headers,
        }, (response) => {
          res.writeHead(response.statusCode, response.headers)
          response.pipe(res)
        })
        forwarded.on('error', (error) => {
          if (!res.headersSent) res.statusCode = 502
          res.end(String(error))
        })
        res.once('close', () => forwarded.destroy())
        req.pipe(forwarded)
      }
    } else {
      const harness = await loadProxyHarness({ apiUrl: upstreamUrl, traefikUrl: upstreamUrl })
      errors = harness.errors
      dispatch = (req, res) => {
        harness.handler({ node: { req, res } }).then(() => {
          if (!res.writableEnded && !res.headersSent) {
            res.setHeader('content-type', 'text/html')
            res.end('<!doctype html><html><head></head><body>Dashboard fixture</body></html>')
          }
        }).catch((error) => { res.statusCode = 500; res.end(String(error)) })
      }
    }
    // Only fixture-owned scripts bypass the actual middleware while seeding
    // old registrations. Removing a seed sends updates through today's server.
    frontend = http.createServer((req, res) => {
      const path = new URL(req.url, 'http://fixture.invalid').pathname
      frontendRequests.push({ path, destination: req.headers['sec-fetch-dest'],
        worker: req.headers['service-worker'], referer: req.headers.referer })
      if (seededScripts.has(path)) {
        res.setHeader('content-type', 'text/javascript')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('service-worker-allowed', '/')
        res.end(seededScripts.get(path))
        return
      }
      dispatch(req, res)
    })
    const origin = await listen(frontend)
    return { origin, seededScripts, versions, upstreamRequests, frontendRequests, errors,
      close: async () => {
        await close(frontend)
        await stopChild(builtServer)
        await close(upstream)
      }, builtOutput: () => builtOutput }
  } catch (error) {
    if (frontend) await close(frontend)
    await stopChild(builtServer)
    await close(upstream)
    throw error
  }
}
const openDashboard = async (context, origin) => {
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await page.goto(`${origin}/api/health`)
  return page
}
const openEmbedded = async (context, origin, service) => {
  const page = await openDashboard(context, origin)
  await page.setContent(`<html><body><iframe src="/ui/${service}/" referrerpolicy="same-origin"></iframe></body></html>`)
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
  await frame.waitForFunction(() => window.__dumbEmbeddedRequests)
  return { page, frame, service }
}
const registerSeed = async (page, script, scope) => {
  await page.evaluate(async ({ script, scope }) => {
    window.fixtureSeedRegistration = await navigator.serviceWorker.register(script, { scope, updateViaCache: 'none' })
  }, { script, scope })
  await page.waitForFunction(() => window.fixtureSeedRegistration.active?.state === 'activated')
}

// Playwright's waitForFunction polling does not await an async predicate.
// Poll asynchronous registration snapshots from Node so false stays false.
const waitForAsyncPageState = async (page, predicate) => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return
    await delay(50)
  }
  throw new Error('Asynchronous browser state did not settle')
}

const workerMessage = (frame, command) => frame.evaluate((command) => new Promise((resolve, reject) => {
  const channel = new MessageChannel()
  const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Worker response timed out')) }, 10000)
  channel.port1.onmessage = (event) => {
    clearTimeout(timeout)
    channel.port1.close()
    resolve(event.data)
  }
  window.fixtureRegistration.active.postMessage(command, [channel.port2])
}), command)

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: service workers register and update within their embedded service`, { timeout: 90000 }, async (t) => {
    const fixture = await startFixture()
    let browser
    t.signal.addEventListener('abort', () => { browser?.close().catch(() => {}) }, { once: true })
    try {
      browser = await browserType.launch({ headless: true })
      const context = await browser.newContext()
      const dashboard = await openDashboard(context, fixture.origin)
      const pages = []
      for (const service of ['radarr', 'decypharr']) {
        const current = await openEmbedded(context, fixture.origin, service)
        const registration = await current.frame.evaluate(async () => {
          history.replaceState({ fixture: true }, '', '/dashboard')
          const ready = navigator.serviceWorker.ready
          const registration = await navigator.serviceWorker.register('/sw.js?fixture=1', {
            scope: '/', updateViaCache: 'none', type: 'classic',
          })
          window.fixtureRegistration = registration
          const ownReady = await ready
          return { scope: registration.scope, script: ownReady.active.scriptURL,
            readyScope: ownReady.scope, updateViaCache: registration.updateViaCache }
        })
        assert.equal(new URL(registration.scope).pathname, `/ui/${service}/`)
        assert.equal(new URL(registration.readyScope).pathname, `/ui/${service}/`)
        assert.equal(new URL(registration.script).pathname, `/ui/${service}/sw.js`)
        assert.equal(new URL(registration.script).search, '?fixture=1')
        assert.equal(registration.updateViaCache, 'none')
        await current.frame.waitForFunction(() => navigator.serviceWorker.controller)
        const identity = await current.frame.evaluate(() => fetch('/worker-identity').then((response) => response.json()))
        assert.deepEqual(identity, { service, version: 1, importedService: service })
        pages.push(current)
      }
      await context.addCookies([{ name: 'dumb_ui_service', value: 'wrong_service', url: fixture.origin }])
      for (const { frame, service } of pages) {
        assert.deepEqual(await workerMessage(frame, 'fetch'), { service, path: '/api/worker-probe' })
        fixture.versions.set(service, 2)
        await frame.evaluate(async () => {
          const registration = window.fixtureRegistration
          const activated = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Updated worker did not activate')), 15000)
            registration.addEventListener('updatefound', () => {
              const candidate = registration.installing
              const check = () => {
                if (candidate.state === 'activated') { clearTimeout(timeout); resolve() }
                if (candidate.state === 'redundant') { clearTimeout(timeout); reject(new Error('Updated worker became redundant')) }
              }
              candidate.addEventListener('statechange', check)
              check()
            }, { once: true })
          })
          await registration.update()
          await activated
        })
        const identity = await frame.evaluate(() => fetch('/worker-identity').then((response) => response.json()))
        assert.deepEqual(identity, { service, version: 2, importedService: service })
        const originalUrl = frame.url()
        await frame.goto(originalUrl, { waitUntil: 'domcontentloaded' })
        await frame.waitForFunction(() => window.__dumbEmbeddedRequests)
        const readyScope = await frame.evaluate(async () => (await navigator.serviceWorker.ready).scope)
        assert.equal(new URL(readyScope).pathname, `/ui/${service}/`)
        assert.equal((await frame.evaluate(() => fetch('/api/status').then((response) => response.json()))).service, service)
      }
      const radarrFrame = pages[0].frame
      const invalid = await radarrFrame.evaluate(async () => {
        const attempts = [
          () => navigator.serviceWorker.register('/ui/decypharr/sw.js'),
          () => navigator.serviceWorker.register('/sw.js', { scope: '/ui/decypharr/' }),
          // Bypass the document adapter to prove the server's published scope
          // prevents an upstream Service-Worker-Allowed: / origin takeover.
          () => ServiceWorkerContainer.prototype.register.call(navigator.serviceWorker,
            '/ui/radarr/sw.js', { scope: '/' }),
        ]
        return Promise.all(attempts.map(async (attempt) => {
          try { await attempt(); return 'accepted' } catch (error) { return error.name }
        }))
      })
      assert.deepEqual(invalid, ['SecurityError', 'SecurityError', 'SecurityError'])
      const defaultScope = await radarrFrame.evaluate(async () => {
        const registration = await navigator.serviceWorker.register('/nested/sw.js')
        return registration.scope
      })
      assert.equal(new URL(defaultScope).pathname, '/ui/radarr/nested/')
      assert.equal(await dashboard.evaluate(() => navigator.serviceWorker.controller), null)
      const health = await dashboard.evaluate(() => fetch('/api/health').then((response) => response.json()))
      assert.equal(health.service, 'dumb')
      const registrations = await dashboard.evaluate(async () =>
        (await navigator.serviceWorker.getRegistrations()).map((registration) => new URL(registration.scope).pathname).sort())
      assert.deepEqual(registrations, ['/ui/decypharr/', '/ui/radarr/', '/ui/radarr/nested/'])
      assert.ok(fixture.upstreamRequests.some((request) => request.service === 'radarr' && request.path === '/worker-helper.js'))
      assert.ok(fixture.upstreamRequests.some((request) => request.service === 'decypharr' && request.path === '/worker-helper.js'))
      assert.ok(fixture.upstreamRequests.every((request) => !request.path.includes('__dumb_ui')))
      assert.deepEqual(fixture.errors, [])
    } catch (error) {
      if (fixture.builtOutput()) throw new Error(`Built proxy output:\n${fixture.builtOutput()}`, { cause: error })
      throw error
    } finally {
      await browser?.close()
      await fixture.close()
    }
  })

  test(`${name}: a legacy root worker retires without clearing unrelated registration or cached data`, { timeout: 90000 }, async (t) => {
    const fixture = await startFixture()
    let browser
    t.signal.addEventListener('abort', () => { browser?.close().catch(() => {}) }, { once: true })
    try {
      browser = await browserType.launch({ headless: true })
      const context = await browser.newContext()
      fixture.seededScripts.set('/sw.js', seedWorker('legacy-fixture'))
      fixture.seededScripts.set('/unrelated/worker.js', seedWorker('unrelated-fixture'))
      const dashboard = await openDashboard(context, fixture.origin)
      await registerSeed(dashboard, '/sw.js', '/')
      await registerSeed(dashboard, '/unrelated/worker.js', '/unrelated/')
      await dashboard.evaluate(async () => {
        const cache = await caches.open('fixture-private-cache')
        await cache.put('/fixture-private-entry', new Response('preserved fixture data'))
        localStorage.setItem('fixture-private-state', 'preserved')
        window.legacyRegistration = await navigator.serviceWorker.getRegistration('/')
      })
      const { frame } = await openEmbedded(context, fixture.origin, 'radarr')
      // Native ready can be permanently bound to the old root registration if
      // first read before this service registers. The adapter must wait for its
      // own registration rather than subscribing through a different app.
      const readyScope = await frame.evaluate(async () => {
        const earlyReady = navigator.serviceWorker.ready
        await new Promise((resolve) => setTimeout(resolve, 30))
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        window.fixtureRegistration = registration
        return (await earlyReady).scope
      })
      assert.equal(new URL(readyScope).pathname, '/ui/radarr/')
      fixture.seededScripts.delete('/sw.js')
      await context.addCookies([{ name: 'dumb_ui_service', value: 'decypharr', url: fixture.origin }])
      const before = fixture.upstreamRequests.length
      await dashboard.evaluate(async () => {
        try { await window.legacyRegistration.update() } catch (error) {
          // Firefox may complete the retirement while the explicitly requested
          // update is still queued. A rejected update is safe only once this
          // exact root registration is already absent.
          const remaining = await navigator.serviceWorker.getRegistrations()
          if (remaining.some((registration) => new URL(registration.scope).pathname === '/')) throw error
        }
      })
      await waitForAsyncPageState(dashboard, async () => {
        // Registry removal is authoritative. Firefox may retain stale worker
        // state on the JavaScript object after its registration is removed.
        return !(await navigator.serviceWorker.getRegistrations()).some((registration) => new URL(registration.scope).pathname === '/')
      })
      const retained = await dashboard.evaluate(async () => ({
        registrations: (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
          scope: new URL(registration.scope).pathname, script: new URL(registration.active.scriptURL).pathname,
        })).sort((left, right) => left.scope.localeCompare(right.scope)),
        cached: await caches.open('fixture-private-cache').then((cache) => cache.match('/fixture-private-entry')).then((response) => response.text()),
        stored: localStorage.getItem('fixture-private-state'),
        health: await fetch('/api/health').then((response) => response.json()),
      }))
      assert.deepEqual(retained.registrations, [
        { scope: '/ui/radarr/', script: '/ui/radarr/sw.js' },
        { scope: '/unrelated/', script: '/unrelated/worker.js' },
      ])
      assert.equal(retained.cached, 'preserved fixture data')
      assert.equal(retained.stored, 'preserved')
      assert.equal(retained.health.service, 'dumb')
      assert.ok(fixture.upstreamRequests.slice(before).every((request) => !request.path.startsWith('/sw.js')))
      const unknown = await dashboard.evaluate(async () => {
        try { await navigator.serviceWorker.register('/unknown-worker.js', { scope: '/unknown/' }); return 'accepted' }
        catch (error) { return error.name }
      })
      assert.equal(unknown, 'TypeError')
      assert.ok(fixture.upstreamRequests.every((request) => !request.path.startsWith('/unknown-worker.js')))
      assert.ok(fixture.frontendRequests.some((request) => request.path === '/sw.js' && request.worker === 'script'))
      assert.deepEqual(fixture.errors, [])
    } catch (error) {
      if (fixture.builtOutput()) throw new Error(`Built proxy output:\n${fixture.builtOutput()}`, { cause: error })
      throw error
    } finally {
      await browser?.close()
      await fixture.close()
    }
  })
}
