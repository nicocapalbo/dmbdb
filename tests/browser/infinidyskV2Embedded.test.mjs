import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium, firefox } from 'playwright'
import { startInfiniDyskV2ProxyFixture, nativeFixtureCredentials } from '../support/infinidyskV2ProxyFixture.mjs'

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: native-v2 proxy preserves CSP, password sessions, navigation, uploads, SSE and ranges behind HTTPS`, { timeout: 90000 }, async () => {
    const app = await startInfiniDyskV2ProxyFixture()
    let browser
    try {
      browser = await browserType.launch({ headless: true })
      const context = await browser.newContext({ ignoreHTTPSErrors: true })
      await context.addCookies([
        { name: 'dumb_access_token', value: 'controller-cookie', url: app.origin, httpOnly: true },
        { name: 'infinidysk_session', value: 'direct-session-preserved', url: app.origin, httpOnly: true },
      ])
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(app.origin + '/parent')
      const frame = page.frames().find(frame => frame !== page.mainFrame())
      await frame.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
      await frame.getByLabel('Username').fill(nativeFixtureCredentials.username)
      await frame.getByLabel('Password').fill(nativeFixtureCredentials.password)
      await frame.getByRole('button', { name: 'Sign in', exact: true }).click()
      await frame.getByRole('heading', { name: 'Overview' }).waitFor()
      assert.equal(await frame.evaluate(() => window.fixtureEntryLoads), 1, 'The entry module and its lazy chunks must share one module identity')
      assert.equal(await frame.evaluate(() => window.fixtureModuleIdentity), true)
      assert.equal(await frame.evaluate(() => document.querySelector('script[type="module"][src^="/assets/native.js"]')?.getAttribute('src')), '/assets/native.js', 'Native build checks must still see their original entry path')
      assert.equal(await frame.evaluate(() => window.untrustedInlineRan), undefined)
      assert.equal(await frame.evaluate(() => getComputedStyle(document.body).color), 'rgb(1, 2, 3)')
      await frame.getByRole('link', { name: 'Settings', exact: true }).click()
      assert.equal(new URL(frame.url()).pathname, '/settings/providers')
      await frame.goto(frame.url())
      await frame.getByRole('heading', { name: 'Overview' }).waitFor()
      const result = await frame.evaluate(async () => {
        const upload = await fetch(new Request('/api/v1/fixture', { method: 'POST', body: 'native-request-body' })).then(r => r.json())
        const stream = await new Promise((resolve, reject) => {
          const events = new EventSource('/api/v1/events')
          events.addEventListener('live', event => { events.close(); resolve(JSON.parse(event.data)) })
          events.onerror = () => { events.close(); reject(new Error('SSE failed')) }
        })
        const range = await fetch('/view/fixture?signature=unchanged%2Bbytes', { headers: { Range: 'bytes=2-4' } })
        return { upload, stream, range: { status: range.status, value: await range.text(), contentRange: range.headers.get('content-range') } }
      })
      assert.equal(result.upload.body, 'native-request-body')
      assert.equal(result.stream.fixture, true)
      assert.deepEqual(result.range, { status: 206, value: '234', contentRange: 'bytes 2-4/10' })
      const dumb = await page.evaluate(() => fetch('/api/health').then(r => r.json()))
      assert.equal(dumb.service, 'dumb')
      assert.equal(dumb.cookie, 'dumb_access_token=controller-cookie')
      const nativeRequests = app.requests.filter(row => row.service === 'infinidysk')
      const ranged = nativeRequests.find(row => row.path === '/view/fixture')
      assert.equal(ranged.headers.range, 'bytes=2-4')
      assert.equal(ranged.url, '/service/ui/infinidysk/view/fixture?signature=unchanged%2Bbytes')
      assert.ok(nativeRequests.some(row => row.path === '/api/v1/auth/login' && row.body.includes('fixture_operator')))
      assert.ok(nativeRequests.every(row => !row.headers.authorization && !row.headers['x-api-key'] && !String(row.headers.cookie || '').includes('controller-cookie') && !String(row.headers.cookie || '').includes('direct-session-preserved')))
      const cookies = await context.cookies()
      const embedded = cookies.find(cookie => cookie.name === 'dumb_ifd_v2_infinidysk_session')
      assert.equal(embedded.httpOnly, true)
      assert.equal(embedded.secure, true)
      assert.equal(embedded.sameSite, 'Strict')
      assert.equal(cookies.find(cookie => cookie.name === 'infinidysk_session').value, 'direct-session-preserved')
      assert.equal(cookies.find(cookie => cookie.name === 'dumb_access_token').value, 'controller-cookie')
      await frame.getByRole('button', { name: 'Sign out', exact: true }).click()
      await frame.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
      assert.equal((await context.cookies()).some(cookie => cookie.name === 'dumb_ifd_v2_infinidysk_session'), false)
      assert.deepEqual(errors, [])
      assert.deepEqual(app.errors, [])
      assert.deepEqual(app.harnessErrors, [])
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: opt-in disposable native InfiniDysk v2 signs in and streams through the real proxy`, { timeout: 90000, skip: process.env.DUMB_TEST_IFD_V2_DISPOSABLE !== '1' || !process.env.DUMB_TEST_IFD_V2_URL }, async () => {
    const nativeUrl = process.env.DUMB_TEST_IFD_V2_URL
    const auth = await fetch(nativeUrl + '/api/v1/auth').then(r => r.json())
    if (auth.setup_required) {
      const setup = await fetch(nativeUrl + '/api/v1/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nativeFixtureCredentials) })
      assert.equal(setup.status, 204)
    }
    const app = await startInfiniDyskV2ProxyFixture({ nativeUrl, entryService: 'InfiniDysk', entryPath: '/queue' })
    let browser
    try {
      browser = await browserType.launch({ headless: true })
      const page = await browser.newPage({ ignoreHTTPSErrors: true })
      const errors = []
      const consoleErrors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      await page.goto(app.origin + '/parent')
      const frame = page.frames().find(frame => frame !== page.mainFrame())
      await frame.getByLabel('Username', { exact: true }).fill(nativeFixtureCredentials.username)
      await frame.getByLabel('Password', { exact: true }).fill(nativeFixtureCredentials.password)
      await frame.getByRole('button', { name: 'Sign in', exact: true }).click()
      await frame.getByRole('link', { name: 'Overview', exact: true }).waitFor()
      const result = await frame.evaluate(async () => {
        const auth = await fetch(new Request('/api/v1/auth')).then(r => r.json())
        const stream = await new Promise((resolve, reject) => {
          const events = new EventSource('/api/v1/events')
          events.addEventListener('live', event => { events.close(); resolve(JSON.parse(event.data)) })
          events.onerror = () => { events.close(); reject(new Error('Native SSE failed')) }
        })
        return { user: auth.user, stream }
      })
      assert.equal(result.user, nativeFixtureCredentials.username)
      assert.equal(typeof result.stream, 'object')
      await frame.getByRole('link', { name: 'Queue', exact: true }).click()
      await frame.getByRole('heading', { name: 'Queue', exact: true }).waitFor()
      assert.equal(new URL(frame.url()).pathname, '/queue')
      await frame.goto(frame.url())
      await frame.getByRole('heading', { name: 'Queue', exact: true }).waitFor()
      await frame.getByRole('link', { name: 'Overview', exact: true }).waitFor()
      assert.deepEqual(consoleErrors, [])
      await frame.getByRole('button', { name: nativeFixtureCredentials.username, exact: true }).click()
      await frame.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
      await frame.getByLabel('Username', { exact: true }).waitFor()
      assert.equal(await frame.evaluate(() => fetch('/api/v1/auth').then(r => r.json()).then(auth => auth.user)), null)
      assert.equal((await page.context().cookies()).some(cookie => cookie.name === 'dumb_ifd_v2_infinidysk_session'), false)
      assert.deepEqual(errors, [])
      assert.deepEqual(app.errors, [])
      assert.deepEqual(app.harnessErrors, [])
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: native asset reload guard survives an authenticated warm reload`, { timeout: 90000, skip: process.env.DUMB_TEST_IFD_V2_DISPOSABLE !== '1' || !process.env.DUMB_TEST_IFD_V2_URL }, async () => {
    const nativeUrl = process.env.DUMB_TEST_IFD_V2_URL
    const auth = await fetch(nativeUrl + '/api/v1/auth').then(response => response.json())
    if (auth.setup_required) {
      const setup = await fetch(nativeUrl + '/api/v1/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nativeFixtureCredentials) })
      assert.equal(setup.status, 204)
    }
    const app = await startInfiniDyskV2ProxyFixture({ nativeUrl })
    let browser
    try {
      browser = await browserType.launch({ headless: true })
      const page = await browser.newPage({ ignoreHTTPSErrors: true })
      await page.clock.install()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(app.origin + '/parent')
      const frame = page.frames().find(frame => frame !== page.mainFrame())
      await frame.getByLabel('Username', { exact: true }).fill(nativeFixtureCredentials.username)
      await frame.getByLabel('Password', { exact: true }).fill(nativeFixtureCredentials.password)
      await frame.getByRole('button', { name: 'Sign in', exact: true }).click()
      await frame.getByRole('link', { name: 'Overview', exact: true }).waitFor()
      const statusPath = /\/api\/v1\/status(?:\?|$)/
      const warmStatus = page.waitForResponse(response => statusPath.test(response.url()) && response.request().frame() === frame && response.status() === 200)
      await frame.goto(frame.url())
      const originalStatus = await (await warmStatus).json()
      await frame.getByRole('link', { name: 'Overview', exact: true }).waitFor()
      assert.match(originalStatus.ui_entry, /^\/assets\/index-[^/]+\.js$/)
      await frame.evaluate(() => { window.fixturePreviousDocument = true })
      let changed = 0
      let restored = 0
      // Install interception only after the warm load; routing disables the
      // browser's HTTP cache and must not change how that load evaluates JS.
      await page.route(statusPath, async route => {
        const response = await route.fetch()
        const status = await response.json()
        if (!changed) {
          changed++
          await route.fulfill({ response, json: { ...status, ui_entry: '/assets/index-fixture-next-build.js' } })
        } else {
          restored++
          await route.fulfill({ response })
        }
      })
      // Native v2 checks its served build every five minutes. Advance that
      // existing timer without waiting five wall-clock minutes or calling its
      // internals; the native banner and navigation must drive the reload.
      await page.clock.fastForward(5 * 60_000 + 1)
      await frame.getByText('infinidysk was updated', { exact: true }).waitFor()
      const documentRequest = page.waitForRequest(request => request.frame() === frame && request.isNavigationRequest() && request.resourceType() === 'document')
      await frame.getByRole('link', { name: 'Queue', exact: true }).click()
      await documentRequest
      await frame.getByRole('heading', { name: 'Queue', exact: true }).waitFor()
      await frame.getByText('infinidysk was updated', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal(await frame.evaluate(() => window.fixturePreviousDocument), undefined, 'The native guard must replace the document, rather than only change routes')
      assert.equal(changed, 1)
      assert.ok(restored > 0, 'The replacement document must receive the actual native status again')
      assert.deepEqual(errors, [])
      assert.deepEqual(app.errors, [])
      assert.deepEqual(app.harnessErrors, [])
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: unconfirmed runtime metadata blocks embedding and native SSO redirects stay external`, { timeout: 60000 }, async () => {
    let browser
    const unavailable = await startInfiniDyskV2ProxyFixture()
    unavailable.state.inventoryAvailable = false
    const incompatible = await startInfiniDyskV2ProxyFixture()
    incompatible.state.protocol = 2
    const app = await startInfiniDyskV2ProxyFixture()
    try {
      browser = await browserType.launch({ headless: true })
      for (const [fixture, message] of [[unavailable, 'routing cannot be confirmed'], [incompatible, 'does not have a compatible embedded UI adapter']]) {
        const page = await browser.newPage({ ignoreHTTPSErrors: true })
        await page.goto(fixture.origin + '/parent')
        const frame = page.frames().find(frame => frame !== page.mainFrame())
        await frame.getByText(message, { exact: false }).waitFor()
        assert.equal(fixture.requests.length, 0)
        await page.close()
      }
      const context = await browser.newContext({ ignoreHTTPSErrors: true })
      await context.addCookies([{ name: 'dumb_access_token', value: 'controller-cookie', url: app.origin }])
      const response = await context.request.get(app.origin + '/ui/infinidysk/auth/oidc/login', { maxRedirects: 0 })
      assert.equal(response.status(), 302)
      assert.equal(response.headers().location, 'https://identity.example.invalid/authorize?state=opaque')
      const flow = (await context.cookies()).find(cookie => cookie.name === 'dumb_ifd_v2_infinidysk_sso')
      assert.equal(flow.httpOnly, true)
      assert.equal(flow.secure, true)
      assert.equal(flow.sameSite, 'Lax')
      assert.equal(app.requests[0].headers.cookie, undefined)
    } finally { await browser?.close(); await unavailable.close(); await incompatible.close(); await app.close() }
  })

  test(`${name}: opt-in native SSO verifies PKCE and signed tokens through an explicitly registered embedded callback`, { timeout: 90000,
    skip: process.env.DUMB_TEST_IFD_V2_DISPOSABLE !== '1' || !process.env.DUMB_TEST_IFD_V2_URL || !process.env.DUMB_TEST_IFD_OIDC_CONTROL_URL,
  }, async () => {
    const nativeUrl = process.env.DUMB_TEST_IFD_V2_URL
    const control = process.env.DUMB_TEST_IFD_OIDC_CONTROL_URL
    const login = await fetch(nativeUrl + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nativeFixtureCredentials) })
    assert.equal(login.status, 204)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const headers = { cookie, 'content-type': 'application/json' }
    const saved = await fetch(nativeUrl + '/api/v1/settings', { headers }).then(r => r.json())
    // Keep the published authorization endpoint stable across browser cases:
    // native discovery correctly caches provider metadata for one minute.
    const app = await startInfiniDyskV2ProxyFixture({ nativeUrl, oidcControlUrl: control, externalPort: Number(process.env.DUMB_TEST_IFD_OIDC_CALLBACK_PORT || 34443) })
    let browser
    try {
      const changed = structuredClone(saved.settings)
      changed.auth.oidc = { ...changed.auth.oidc, issuer: 'http://127.0.0.1:5555', client_id: 'disposable-embedded-client', client_secret: 'disposable-oidc-client-secret', redirect_uri: app.origin + '/ui/infinidysk/auth/oidc/callback', display_name: 'Fixture Identity' }
      assert.equal((await fetch(control + '/configure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authorization_endpoint: app.origin + '/fixture-oidc/authorize' }) })).status, 200)
      assert.equal((await fetch(nativeUrl + '/api/v1/settings', { method: 'PUT', headers, body: JSON.stringify(changed) })).status, 200)
      browser = await browserType.launch({ headless: true })
      const page = await browser.newPage({ ignoreHTTPSErrors: true })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(app.origin + '/parent')
      const frame = page.frames().find(frame => frame !== page.mainFrame())
      await frame.getByRole('link', { name: 'Sign in with Fixture Identity', exact: true }).click()
      await frame.getByRole('link', { name: 'Overview', exact: true }).waitFor()
      const auth = await frame.evaluate(() => fetch('/api/v1/auth').then(r => r.json()))
      assert.equal(auth.user, 'fixture_sso')
      assert.equal(auth.method, 'sso')
      assert.equal(auth.sso_current, true)
      const settings = await fetch(nativeUrl + '/api/v1/settings', { headers }).then(r => r.json())
      assert.equal(settings.settings.network.public_url, saved.settings.network.public_url)
      assert.equal(settings.settings.auth.oidc.redirect_uri, changed.auth.oidc.redirect_uri)
      assert.deepEqual(errors, [])
      assert.deepEqual(app.errors, [])
      assert.deepEqual(app.harnessErrors, [])
    } finally {
      await browser?.close()
      try {
        const restored = await fetch(nativeUrl + '/api/v1/settings', { method: 'PUT', headers, body: JSON.stringify(saved.settings) })
        assert.equal(restored.status, 200)
      } finally { await app.close() }
    }
  })
}
