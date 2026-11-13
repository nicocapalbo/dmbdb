import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { buildAuthRedirectFixture } from '../support/authRedirectFixture.mjs'

let bundle
before(async () => { bundle = await buildAuthRedirectFixture() })
const origin = 'https://dashboard.example'
const vectors = [
  ['/services/Plex?tab=logs#tail', '/services/Plex?tab=logs#tail'],
  ['/' + String.fromCharCode(92) + 'reserved.example/', '/'],
  ['/' + String.fromCharCode(9) + '/reserved.example/', '/'],
  ['/a/..//reserved.example', '/'],
]

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) for (const flow of ['password', 'oidc']) {
  test(name + ': actual ' + flow + ' success keeps login redirects on the dashboard origin', { timeout: 90000 }, async () => {
    let browser
    try {
      browser = await type.launch({ headless: true })
      for (const [value, expected] of vectors) {
        const context = await browser.newContext({ serviceWorkers: 'block' })
        const external = [], events = []
        let release
        const accepted = new Promise(resolve => { release = resolve })
        try {
          await context.route('**/*', async route => {
            const url = new URL(route.request().url())
            if (url.origin !== origin) { external.push(url.origin); await route.abort(); return }
            if (url.pathname === '/fixture.js') { await route.fulfill({ contentType: 'text/javascript', body: bundle }); return }
            if (!route.request().isNavigationRequest()) { await route.fulfill({ status: 204, body: '' }); return }
            await route.fulfill({ contentType: 'text/html', body: url.pathname === '/login'
              ? '<!doctype html><html><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'
              : '<!doctype html><html><body><p>Local destination</p></body></html>' })
          })
          const page = await context.newPage()
          await page.exposeFunction('__authEvent', event => { events.push(event) })
          await page.exposeFunction('__authWait', async () => { await accepted })
          const initial = origin + '/login' + (flow === 'password' ? '?redirect=' + encodeURIComponent(value)
            : '#oidc_code=offline-fixture-code&return_to=' + encodeURIComponent(value))
          await page.goto(initial, { waitUntil: 'domcontentloaded' })
          if (flow === 'password') {
            await page.locator('#username').fill('example-user')
            await page.locator('#password').fill('example-password')
            await page.getByRole('button', { name: 'Sign in', exact: true }).click()
          }
          await page.waitForFunction(() => globalThis.__authStarted)
          assert.equal(events[0]?.kind, flow)
          if (flow === 'oidc') assert.equal(events[0].fragment, '', 'The one-time callback fragment is removed before exchange')
          const arrived = page.waitForURL(origin + expected)
          release()
          await arrived
          assert.equal(page.url(), origin + expected)
          assert.deepEqual(external, [], 'Every request is fulfilled locally; foreign destinations are blocked')
        } finally { release?.(); await context.close() }
      }
    } finally { await browser?.close() }
  })
}

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  test(name + ': actual login displays retained token-verification failure without another login or redirect', { timeout: 60000 }, async () => {
    let browser
    try {
      browser = await type.launch({ headless: true })
      const context = await browser.newContext({ serviceWorkers: 'block' })
      const message = 'Token verification is temporarily unavailable while an installation operation holds persistence. Retry after access is restored.'
      await context.addInitScript(value => { globalThis.__authFixtureError = value }, message)
      await context.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) return route.abort()
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle })
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>' })
        return route.fulfill({ status: 204, body: '' })
      })
      const page = await context.newPage()
      const events = []
      await page.exposeFunction('__authEvent', event => events.push(event))
      await page.exposeFunction('__authWait', async () => {})
      await page.goto(origin + '/login?redirect=%2Fsettings')
      await page.getByText(message, { exact: true }).waitFor()
      assert.equal(page.url(), origin + '/login?redirect=%2Fsettings')
      assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true)
      assert.deepEqual(events, [])
      await context.close()
    } finally { await browser?.close() }
  })
}
