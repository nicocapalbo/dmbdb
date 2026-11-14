import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const base = '/api/process/installation-backups'
const verifiedResult = { complete: true, archive: { artifact_id: 'a'.repeat(32), backup_destination_id: 'archive', namespace: 'installation', artifact_kind: 'installation_backup', reference: 'dumb-backup://archive/installation/' + 'a'.repeat(32), verified: true, sha256: 'b'.repeat(64), size_bytes: 4096, extension: 'tar' } }
const capabilities = { installation_backup: true, installation_backup_protocol: 1 }
const job = (id, status = 'running', extra = {}) => ({ job_id: id, job_type: 'installation_backup', status, ...(status === 'completed' ? { result: verifiedResult } : {}), stage: status === 'queued' ? 'queued' : 'creating_archive', message: 'Reserved fixture archive operation', started_at: Date.now() / 1000 - 30, created_at: Date.now() / 1000 - 31, updated_at: Date.now() / 1000, ...extra })
const preparation = () => ({ stage: 'checking_capacity', message: 'Rechecking backup coverage and space before stopping services.', started_at: Date.now() / 1000 - 12 })
const entry = [
  "import { createApp, h, reactive, ref } from 'vue'",
  "import { routeLocationKey } from 'vue-router'",
  "import Banner from '~/components/InstallationBackupActivityBanner.vue'",
  "import Section from '~/components/SettingsSection.vue'",
  "const values = new Map()",
  "window.__fixtureAuth = reactive({ _initialized: true, isAuthEnabled: false, isAuthenticated: true, user: { username: 'fixture_operator' }, ...window.__initialAuth })",
  "const route = reactive({ path: location.pathname, hash: location.hash })",
  "window.__fixtureRoute = route",
  "window.__fixtureNotifications = []",
  "window.__fixtureState = key => values.get(key)?.value",
  "globalThis.useState = (key, initial) => { if (!values.has(key)) values.set(key, ref(initial())); return values.get(key) }",
  "globalThis.useRoute = () => route",
  "globalThis.useToast = () => Object.fromEntries(['success', 'warning', 'error'].map(type => [type, value => window.__fixtureNotifications.push({ type, ...value })]))",
  "const navigate = to => { const before = route.path + route.hash; history.pushState({}, '', to); route.path = location.pathname; route.hash = location.hash; if (before !== route.path + route.hash) window.dispatchEvent(new Event('hashchange')) }",
  "window.__fixtureNavigate = navigate",
  "const Link = { props: ['to'], emits: ['click'], setup(props, { slots, emit }) { return () => h('a', { href: props.to, onClick: event => { emit('click', event); event.preventDefault(); navigate(props.to) } }, slots.default?.()) } }",
  "const app = createApp({ setup: () => () => [h(Banner), h('button', { 'data-testid': 'fixture-home', onClick: () => navigate('/home') }, 'Go home'), route.path === '/settings' ? h('div', [h('div', { style: 'height: 1300px' }, 'Fixture spacing'), h(Section, { sectionId: 'backups', title: 'Backups and restore' }, { default: () => h('p', { 'data-testid': 'fixture-backup-content' }, 'Existing backup controls') })]) : h('p', { 'data-testid': 'fixture-home-content' }, 'Another application page')] })",
  "app.component('NuxtLink', Link)",
  "app.provide(routeLocationKey, route)",
  "app.mount('#app')"
].join('\n')
let bundle
const fixture = async () => {
  bundle ||= await buildVueComponentHarness(entry, { modules: { '~/stores/auth.js': 'export const useAuthStore = () => window.__fixtureAuth' } })
  const state = { calls: [], job: null, preparation: null, exact: {}, statusCode: 200, disconnect: false, hold: false, pending: [] }
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture.invalid').pathname
    if (path === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); return }
    if (!path.startsWith('/api/')) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return }
    state.calls.push({ path, method: req.method })
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    const send = value => res.end(JSON.stringify(value))
    if (path === '/api/process/capabilities') return send(capabilities)
    if (path === base + '/status') {
      if (state.hold) await new Promise(resolve => state.pending.push(resolve))
      if (state.disconnect) { req.socket.destroy(); return }
      res.statusCode = state.statusCode
      if (state.statusCode !== 200) return send({ detail: 'Reserved fixture authorization refusal' })
      return send({ protocol: 1, job: state.job, preparation: state.preparation })
    }
    if (path.startsWith(base + '/jobs/')) return send({ protocol: 1, job: state.exact[decodeURIComponent(path.slice((base + '/jobs/').length))] || null })
    res.statusCode = 404
    send({ detail: 'Unknown fixture endpoint' })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { state, origin: 'http://127.0.0.1:' + server.address().port, release: () => { state.hold = false; for (const resolve of state.pending.splice(0)) resolve() }, close: () => new Promise(resolve => { for (const resume of state.pending.splice(0)) resume(); server.close(resolve); server.closeAllConnections() }) }
}
const attach = async (browserType, app, { auth, path = '/home' } = {}) => {
  const browser = await browserType.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort())
  await page.addInitScript(initialAuth => { window.__initialAuth = initialAuth || {}; localStorage.setItem('dmbdb.settings.section.backups.user-choice', JSON.stringify({ schema_version: 1, user_applied: true, open: false })) }, auth)
  await page.goto(app.origin + path)
  await page.waitForFunction(() => Boolean(window.__fixtureState))
  return { browser, page, errors }
}
const settled = page => page.waitForFunction(() => window.__fixtureState('installationBackupActivity')?.loading === false)
const refresh = async page => { await page.getByTestId('installation-backup-activity-refresh').click(); await settled(page) }
const banner = page => page.getByTestId('installation-backup-activity')
const assertReadOnly = app => assert.equal(app.state.calls.some(call => call.method !== 'GET'), false, 'Activity tracking must never start, stop, cancel or replay an operation')

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(name + ': verified saved archive changes global service-recovery messaging without a failed-backup toast', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    const reference = 'dumb-backup://archive/installation/' + 'a'.repeat(32)
    const archive = { artifact_id: 'a'.repeat(32), backup_destination_id: 'archive', verified: true, reference, sha256: 'b'.repeat(64), size_bytes: 4096, namespace: 'installation', artifact_kind: 'installation_backup', extension: 'tar' }
    app.state.job = job('saved', 'running', { stage: 'resuming', result: { complete: true, archive } })
    try {
      const attached = await attach(browserType, app); browser = attached.browser; const { page, errors } = attached
      await banner(page).getByRole('heading', { name: 'Backup saved; resuming services', exact: true }).waitFor()
      assert.equal(await banner(page).getByTestId('installation-verified-archive-reference').innerText(), reference)
      app.state.job = { ...app.state.job, status: 'recovery_required', stage: 'resume_required', errors: ['Example service could not resume'] }
      await refresh(page)
      await banner(page).getByRole('heading', { name: 'Backup saved; service recovery required', exact: true }).waitFor()
      assert.doesNotMatch(await banner(page).innerText(), /failed or interrupted backup|backup failed/i)
      const notices = await page.evaluate(() => window.__fixtureNotifications)
      assert.equal(notices.length, 1); assert.equal(notices[0].type, 'warning'); assert.match(notices[0].title, /Backup saved/)
      assertReadOnly(app); assert.deepEqual(errors, [])
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': manual and scheduled backups show global progress and reopen the real collapsed Settings disclosure', { timeout: 60000 }, async () => {
    const app = await fixture()
    let browser
    try {
      app.state.job = job('manual', 'queued', { scheduled: false })
      const attached = await attach(browserType, app)
      browser = attached.browser
      const { page, errors } = attached
      await banner(page).filter({ hasText: 'Installation backup queued' }).waitFor()
      assert.match(await banner(page).innerText(), /Do not stop the DUMB container or shut down the host/)
      app.state.job = job('manual', 'running', { scheduled: false })
      app.state.preparation = preparation()
      await refresh(page)
      assert.match(await banner(page).innerText(), /Installation backup running/)
      assert.doesNotMatch(await banner(page).innerText(), /Preparing installation backup/)
      await page.getByTestId('installation-backup-activity-open').click()
      const section = page.getByTestId('settings-section-backups')
      await section.getByRole('button', { name: 'Backups and restore' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="settings-section-backups"] button')?.getAttribute('aria-expanded') === 'true')
      assert.equal(await page.getByTestId('fixture-backup-content').isVisible(), true)
      assert.match(page.url(), /\/settings#backups$/)
      await section.getByRole('button', { name: 'Backups and restore' }).click()
      assert.equal(await page.getByTestId('fixture-backup-content').isVisible(), false)
      await page.getByTestId('installation-backup-activity-open').click()
      await page.waitForFunction(() => document.querySelector('[data-testid="settings-section-backups"] button')?.getAttribute('aria-expanded') === 'true')
      assert.equal(await page.getByTestId('fixture-backup-content').isVisible(), true)
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dmbdb.settings.section.backups.user-choice')).open), false, 'Navigation must not overwrite the explicit collapsed preference')
      await page.getByTestId('fixture-home').click()
      await page.getByTestId('fixture-home-content').waitFor()
      assert.equal(await banner(page).isVisible(), true)
      app.state.preparation = null
      app.state.exact.manual = job('manual', 'completed')
      app.state.job = job('scheduled', 'running', { scheduled: true })
      await refresh(page)
      assert.match(await banner(page).innerText(), /Installation backup running/)
      assert.match(await banner(page).innerText(), /scheduled/)
      assert.deepEqual(errors, [])
      assertReadOnly(app)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': preparation reconnects, contact loss keeps the warning, and exact terminal/recovery results remain renderable', { timeout: 60000 }, async () => {
    const app = await fixture()
    let browser
    try {
      app.state.preparation = preparation()
      const attached = await attach(browserType, app)
      browser = attached.browser
      const { page, errors } = attached
      await banner(page).filter({ hasText: 'Preparing installation backup' }).waitFor()
      assert.match(await banner(page).innerText(), /Elapsed/)
      await page.reload()
      await banner(page).filter({ hasText: 'Preparing installation backup' }).waitFor()
      app.state.preparation = null
      app.state.job = job('retained')
      await refresh(page)
      app.state.disconnect = true
      await refresh(page)
      await banner(page).filter({ hasText: 'backup may still be running' }).waitFor()
      assert.match(await banner(page).innerText(), /not confirmed finished/)
      app.state.disconnect = false
      app.state.job = null
      app.state.exact.retained = job('retained', 'recovery_required', { stage: 'review_recovery' })
      await refresh(page)
      await banner(page).filter({ hasText: 'recovery requires attention' }).waitFor()
      await refresh(page)
      assert.equal(await banner(page).isVisible(), true, 'A later null current job must not break the retained recovery banner')
      assert.match(await banner(page).innerText(), /retained/)
      assert.deepEqual(errors, [])
      assertReadOnly(app)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': restore restart and confirmed backup completion use distinct global states', { timeout: 60000 }, async () => {
    const app = await fixture()
    let browser
    try {
      app.state.job = job('complete_me')
      const attached = await attach(browserType, app)
      browser = attached.browser
      const { page, errors } = attached
      await banner(page).waitFor()
      app.state.job = null
      app.state.exact.complete_me = job('complete_me', 'completed')
      await refresh(page)
      await banner(page).waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => window.__fixtureNotifications.filter(value => value.title === 'Installation backup complete').length), 1)
      await page.evaluate(() => { window.__fixtureAuth.isAuthEnabled = true; window.__fixtureAuth.isAuthenticated = false })
      await page.evaluate(() => { window.__fixtureAuth.isAuthenticated = true })
      app.state.job = job('restore_done', 'completed', { job_type: 'installation_restore', restart_required: true, stage: 'restart_required' })
      await page.evaluate(() => { window.__fixtureAuth.user = { username: 'another_fixture_operator' } })
      // Re-entering an allowed page restarts discovery without running any operation.
      await page.evaluate(() => { window.__fixtureNavigate('/login') })
      await page.evaluate(() => { window.__fixtureNavigate('/home') })
      await banner(page).filter({ hasText: 'restart required' }).waitFor()
      assert.match(await banner(page).innerText(), /Managed applications remain stopped/)
      assert.doesNotMatch(await banner(page).innerText(), /Installation backup running/)
      assert.deepEqual(errors, [])
      assertReadOnly(app)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': an initial status network failure never invents a running backup warning', { timeout: 60000 }, async () => {
    const app = await fixture()
    let browser
    try {
      app.state.disconnect = true
      const attached = await attach(browserType, app)
      browser = attached.browser
      const { page, errors } = attached
      await page.waitForFunction(() => Boolean(window.__fixtureState('installationBackupActivity')?.error) && !window.__fixtureState('installationBackupActivity').loading)
      assert.equal(await banner(page).count(), 0)
      assert.equal(await page.evaluate(() => window.__fixtureNotifications.length), 0)
      app.state.disconnect = false
      app.state.job = job('discovered_after_contact_returns', 'queued')
      await page.evaluate(() => window.__fixtureNavigate('/login'))
      await page.evaluate(() => window.__fixtureNavigate('/home'))
      await banner(page).filter({ hasText: 'Installation backup queued' }).waitFor()
      assert.deepEqual(errors, [])
      assertReadOnly(app)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': auth bootstrap, login, authorization rejection and stale logout responses do not leak private job state or poll blindly', { timeout: 60000 }, async () => {
    const app = await fixture()
    let browser
    try {
      app.state.job = job('private_fixture_job')
      const attached = await attach(browserType, app, { auth: { _initialized: false, isAuthEnabled: true, isAuthenticated: false }, path: '/login' })
      browser = attached.browser
      const { page, errors } = attached
      await page.waitForFunction(() => Boolean(window.__fixtureState('installationBackupActivity')))
      assert.equal(app.state.calls.length, 0)
      assert.equal(await banner(page).count(), 0)
      await page.evaluate(() => { window.__fixtureAuth._initialized = true; window.__fixtureAuth.isAuthenticated = true; window.__fixtureNavigate('/home') })
      await banner(page).waitFor()
      app.state.statusCode = name === 'chromium' ? 401 : 403
      await refresh(page)
      await banner(page).waitFor({ state: 'detached' })
      const rejectedCalls = app.state.calls.length
      await page.clock.install()
      await page.clock.fastForward(16000)
      assert.equal(app.state.calls.length, rejectedCalls, 'Authorization rejection must suppress repeated private-status polling')
      assert.equal(await page.evaluate(() => window.__fixtureState('installationBackupActivity').job), null)
      assert.equal(await page.evaluate(() => window.__fixtureState('installationBackupState').job), null)
      app.state.statusCode = 200
      await page.evaluate(() => { window.__fixtureAuth.isAuthenticated = false })
      await page.evaluate(() => { window.__fixtureAuth.isAuthenticated = true })
      await banner(page).waitFor()
      app.state.hold = true
      await page.getByTestId('installation-backup-activity-refresh').click()
      await page.waitForFunction(() => window.__fixtureState('installationBackupActivity').loading)
      await page.evaluate(() => { window.__fixtureAuth.isAuthenticated = false; window.__fixtureNavigate('/login') })
      app.release()
      await banner(page).waitFor({ state: 'detached' })
      await page.waitForFunction(() => window.__fixtureState('installationBackupActivity').job === null)
      assert.equal(await page.evaluate(() => window.__fixtureState('installationBackupState').job), null)
      assert.deepEqual(errors, [])
      assertReadOnly(app)
    } finally { app.release(); await browser?.close(); await app.close() }
  })
}
