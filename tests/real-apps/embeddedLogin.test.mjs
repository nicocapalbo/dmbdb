import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium, firefox } from 'playwright'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { loadProxyHarness } from '../support/proxyHarness.mjs'

// Opt-in only: targets must be disposable, already initialized real apps.
// The credentials file is generated outside Git. Never print its contents.
const targets = { infinidysk: process.env.TEST_INFINIDYSK_URL, seerr: process.env.TEST_SEERR_URL }
const credentialsPath = process.env.TEST_EMBEDDED_CREDENTIALS_FILE
const enabled = Object.values(targets).every(Boolean) && Boolean(credentialsPath)
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: real InfiniDysk and Seerr local login survives reload and routing-cookie changes`, { skip: !enabled, timeout: 90000 }, async () => {
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'))
    const proxies = Object.fromEntries(Object.entries(targets).map(([service, target]) => [service, createProxyMiddleware({ target, changeOrigin: false })]))
    const upstream = http.createServer((req, res) => {
      if (req.url === '/config/service-ui-map') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ infinidysk: 'infinidysk', seerr: 'seerr' }))
        return
      }
      const match = req.url.match(/^\/service\/ui\/([^/]+)(\/.*)$/)
      if (!match || !proxies[match[1]]) { res.statusCode = 404; res.end(); return }
      req.url = match[2]
      proxies[match[1]](req, res)
    })
    let browser
    let frontend
    try {
      const upstreamUrl = await listen(upstream)
      const { handler } = await loadProxyHarness({ apiUrl: upstreamUrl, traefikUrl: upstreamUrl })
      frontend = http.createServer((req, res) => {
        const service = req.url.match(/^\/parent\/(infinidysk|seerr)$/)?.[1]
        if (service) {
          res.setHeader('content-type', 'text/html')
          res.end(`<iframe src="/ui/${service}/"></iframe>`)
          return
        }
        handler({ node: { req, res } }).then(() => {
          if (!res.headersSent && !res.writableEnded) res.end('dashboard')
        }).catch(() => { res.statusCode = 500; res.end('proxy error') })
      })
      const origin = await listen(frontend)
      browser = await browserType.launch()
      const context = await browser.newContext()
      const frames = []
      for (const service of Object.keys(targets)) {
        const page = await context.newPage()
        await page.goto(`${origin}/parent/${service}`)
        const frame = page.frames().find(frame => frame !== page.mainFrame())
        if (service === 'seerr') {
          // Exercise the real popup/polling code, but simulate the external
          // provider. No fake token is sent to either Plex or the real backend.
          let polls = 0
          await context.route('https://plex.tv/api/v2/pins**', async route => {
            assert.equal(route.request().headers()['x-dumb-ui-service'], undefined)
            const create = route.request().method() === 'POST'
            if (!create) polls++
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(create
              ? { id: 341, code: 'test-code' }
              : { id: 341, authToken: polls > 1 ? 'test-provider-token' : null }) })
          })
          await context.route('https://app.plex.tv/**', route => route.fulfill({
            contentType: 'text/html', headers: { 'Cross-Origin-Opener-Policy': 'same-origin' },
            body: '<h1>Simulated provider approval</h1>',
          }))
          await page.route('**/api/v1/auth/plex', route => route.fulfill({
            status: 401, contentType: 'application/json', body: '{"message":"Simulated provider only"}',
          }))
          const callback = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/v1/auth/plex'))
          await frame.getByTestId('plex-login-button').click()
          assert.equal((await callback).status(), 401)
          assert.ok(polls >= 2)
          await page.unroute('**/api/v1/auth/plex')
        }
        await frame.locator(`input[name=${service === 'seerr' ? 'email' : 'username'}]`).fill(service === 'seerr' ? credentials.email : credentials.username)
        await frame.locator('input[name=password]').fill(credentials.password)
        await frame.getByRole('button', { name: service === 'seerr' ? 'Sign In' : 'Login', exact: true }).click()
        await frame.waitForURL(url => !url.pathname.includes('login'))
        if (service === 'infinidysk') assert.equal(new URL(frame.url()).pathname, '/overview')
        frames.push({ frame, service })
      }
      await context.addCookies([{ name: 'dumb_ui_service', value: 'wrong_service', url: origin }])
      for (const { frame, service } of frames) {
        await frame.goto(frame.url())
        if (service === 'seerr') {
          assert.equal(await frame.evaluate(() => fetch('/api/v1/auth/me').then(response => response.status)), 200)
        } else {
          await frame.waitForURL(url => url.pathname === '/overview')
        }
        assert.equal(await frame.locator('input[name=password]').count(), 0)
      }
    } finally {
      await browser?.close()
      if (frontend) await close(frontend)
      await close(upstream)
    }
  })
}
