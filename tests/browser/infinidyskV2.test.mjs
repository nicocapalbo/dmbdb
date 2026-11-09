import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const capabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1, infinidysk_v2_postgres: true }
const entry = `
import { createApp, ref, h } from 'vue';
import Major from '~/components/InfiniDyskV2Panel.vue';
import Postgres from '~/components/InfiniDyskV2PostgresPanel.vue';
const states = new Map();
window.useState = (key, init) => { if (!states.has(key)) states.set(key, ref(init())); return states.get(key); };
createApp({ setup() { const open = ref(true); return () => h(new URLSearchParams(location.search).has('postgres') ? Postgres : Major, { open: open.value, onClose: () => { open.value = false; } }); } }).mount('#app');
`
let bundle
const fixture = async (scenario = 'major') => {
  bundle ||= await buildVueComponentHarness(entry)
  const state = { scenario, generation: scenario === 'postgres' ? '2' : '1', capabilities: { ...capabilities }, job: null, pgJob: null, calls: [], stale: false, syncing: false }
  const server = http.createServer(async (req, res) => {
    if (/^\/(process|auth|config|logs|metrics|health)(?:[/?]|$)/.test(req.url)) req.url = `/api${req.url}`
    res.setHeader('content-type', 'application/json')
    if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); return }
    if (!req.url.startsWith('/api/')) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : null
    // Never retain credential bodies in test diagnostics or snapshots.
    state.calls.push({ path: req.url, method: req.method, body: body?.target?.password ? { target: 'redacted' } : body })
    const send = value => res.end(JSON.stringify(value))
    const base = '/api/process/infinidysk-v2'
    if (req.url === '/api/auth/status') return send({ enabled: false, has_users: true })
    if (req.url === '/api/process/processes') return send({ processes: [{ process_name: 'DUMB API', config_key: 'dumb', config: { enabled: true, onboarding_completed: true } }] })
    if (req.url === '/api/config/onboarding-status') return send({ completed: true, onboarding_completed: true })
    if (req.url === '/api/health') return send({ status: 'ok' })
    if (req.url === '/api/process/capabilities') return send(state.capabilities)
    if (req.url === `${base}/status`) return send({ protocol: 1, runtime_generation: state.generation, mode: scenario === 'fresh' ? 'fresh' : 'migrate', current: { mount_backend: 'rclone', mount_path: '/mnt/debrid/infinidysk' }, supported_mount_backends: ['rclone', 'fuse'], eligibility: { ready: !(state.blockers || []).length, blockers: state.blockers || [] }, job: state.job })
    if (req.url === `${base}/preview`) return send({ protocol: 1, ready: !(state.previewBlockers || []).length, preview_token: 'private-fixture-preview', plan_fingerprint: `plan-${body.mount_backend}`, expires_at: Math.floor(Date.now() / 1000) + 300, confirmation_text: scenario === 'fresh' ? 'INSTALL INFINIDYSK V2' : 'MIGRATE INFINIDYSK TO V2', current: { mount_backend: 'rclone', mount_path: '/mnt/debrid/infinidysk' }, target: { mount_backend: body.mount_backend, mount_path: '/mnt/debrid/infinidysk' }, inventory: { symlinks: 25, consumers: ['arr', 'media'] }, blockers: state.previewBlockers || [], warnings: ['Fixture independent backup warning'], checks: [{ label: 'Fixture source review', passed: !(state.previewBlockers || []).length }], required_acknowledgements: ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream'], rehearsal_required: scenario !== 'fresh' })
    if (req.url === `${base}/rehearse`) {
      if (state.stale) { res.statusCode = 409; return send({ detail: 'Preview expired. https://example.invalid/.ids/private?token=hidden' }) }
      state.job = { job_id: 'rehearsal-fixture', status: 'completed', mode: 'rehearsal', plan_fingerprint: 'plan-rclone', result: { validated: true } }
      return send({ job: state.job })
    }
    if (req.url === `${base}/start`) { state.job = { job_id: 'cutover-fixture', status: 'running', mode: 'cutover', stage: 'importing', message: 'Contained import is running', progress: 40 }; return send({ job: state.job }) }
    if (req.url.startsWith(`${base}/jobs/`)) return send({ job: state.job })
    if (req.url === `${base}/postgres/status`) {
      if (state.pgOffline) { res.statusCode = 503; return send({ detail: 'Native state unavailable' }) }
      return send({ protocol: 1, provider: state.pgJob?.status === 'completed' ? 'postgres' : 'sqlite', job: state.pgJob, ready: true, actions: { start: !state.pgJob || state.pgJob.status === 'cancelled', cutover: state.syncing && state.pgJob?.status !== 'completed', cancel: state.pgJob?.status === 'copying', rollback: state.pgJob?.status === 'completed' }, confirmation_texts: { cutover: 'SWITCH TO POSTGRESQL', cancel: 'EMPTY MIGRATION TARGET', rollback: 'RESTORE SQLITE SNAPSHOT' } })
    }
    if (req.url === `${base}/postgres/preview`) return send({ protocol: 1, ready: true, preview_token: 'private-pg-preview', expires_at: Math.floor(Date.now() / 1000) + 300, confirmation_text: 'COPY TO NEW POSTGRESQL DATABASE', current: { provider: 'sqlite' }, target: { provider: 'postgres', host: 'db.example.invalid', database: 'infinidysk_v2' }, target_identity: { system_identifier: 'fixture-cluster', database_oid: 12345, schema: 'public' } })
    if (req.url === `${base}/postgres/start`) { state.pgJob = { job_id: 'pg-fixture', status: 'copying', message: 'Native copy running' }; return send({ job: state.pgJob }) }
    if (req.url === `${base}/postgres/cutover`) { state.pgJob = { ...state.pgJob, status: 'completed', can_rollback: true }; return send({ job: state.pgJob }) }
    if (state.bootstrap) return send(req.url.includes('/logs') ? { logs: [] } : {})
    res.statusCode = 404; send({ detail: 'Unknown fixture route' })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
const acknowledgeMajor = async page => {
  for (const key of ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream']) await page.getByTestId(`v2-ack-${key}`).check()
  await page.getByTestId('v2-confirmation').fill('MIGRATE INFINIDYSK TO V2')
}

// Measure rendered, composited colors from the real packaged UI. These checks
// protect migration instructions and errors rather than particular CSS classes.
const assertReadable = async (locator, label) => {
  await locator.waitFor({ state: 'visible' })
  const ratio = await locator.evaluate(element => {
    const rgba = value => {
      const parts = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0]
      return [...parts.slice(0, 3), parts.length > 3 ? parts[3] : 1]
    }
    const ancestors = []
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node)
    let background = [255, 255, 255]
    for (const node of ancestors) {
      const color = rgba(getComputedStyle(node).backgroundColor)
      background = background.map((value, index) => color[index] * color[3] + value * (1 - color[3]))
    }
    const color = rgba(getComputedStyle(element).color)
    const foreground = background.map((value, index) => color[index] * color[3] + value * (1 - color[3]))
    const luminance = values => values.map(value => {
      value /= 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const first = luminance(foreground), second = luminance(background)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  })
  assert.ok(ratio >= 4.5, `${label}: normal migration text needs 4.5:1 contrast; got ${ratio.toFixed(2)}:1`)
}

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: production dashboard keeps migration review and recovery readable in light appearances`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture('fresh'); app.state.bootstrap = true
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening')
    const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser; let child; let output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], {
        env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-2000) })
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Built frontend exited: ${output}`)
        try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break } } catch {}
        await delay(100)
      }
      assert.equal(ready, true, 'Built frontend must become ready')
      browser = await type.launch({ headless: true })
      const page = await browser.newPage()
      const theme = name === 'chromium' ? 'light' : 'retro'
      await page.addInitScript(value => localStorage.setItem('dmbdb.appearance.theme', value), theme)
      await page.goto(`http://127.0.0.1:${port}/`)
      await assertReadable(page.getByTestId('v2-open-major').locator('..').locator('p').first(), `${theme} migration notice`)
      await page.getByTestId('v2-open-major').click(); await page.getByTestId('v2-panel').waitFor()
      await assertReadable(page.getByText('Fresh installation: the backend must verify that no existing library data will be replaced.', { exact: true }), `${theme} installation instructions`)
      app.state.previewBlockers = ['Fixture preview validation blocker']
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await assertReadable(page.getByText('Fixture preview validation blocker', { exact: true }), `${theme} preview blocker`)
      await assertReadable(page.getByText('Fixture independent backup warning', { exact: true }), `${theme} backup warning`)
      await assertReadable(page.getByText('Fixture source review', { exact: true }), `${theme} failed preview check`)
      app.state.previewBlockers = []
      await page.getByTestId('v2-preview').click()
      await assertReadable(page.getByTestId('v2-ack-downstream').locator('..'), `${theme} downstream acknowledgement`)
      for (const key of ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream']) await page.getByTestId(`v2-ack-${key}`).check()
      await page.getByTestId('v2-confirmation').fill('INSTALL INFINIDYSK V2'); await page.getByTestId('v2-start').click()
      await page.getByTestId('v2-job').filter({ hasText: 'cutover-fixture' }).waitFor()
      await page.getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      app.state.job = { ...app.state.job, status: 'failed', recovery_required: true, error: 'Fixture source validation error' }
      app.state.blockers = ['Fixture upgrade blocker']
      await page.reload(); await page.getByTestId('v2-open-major').click()
      await page.getByTestId('v2-job').filter({ hasText: 'cutover-fixture' }).waitFor()
      await assertReadable(page.getByText('Fixture upgrade blocker', { exact: true }), `${theme} upgrade blocker`)
      await assertReadable(page.getByText('Fixture source validation error', { exact: true }), `${theme} retained job error`)
      await assertReadable(page.getByText('Recovery is required. Keep the original data and backups; review the available backend recovery action.', { exact: true }), `${theme} recovery instructions`)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/start')).length, 1)
      app.state.generation = '2'
      app.state.blockers = []
      app.state.job = { job_id: 'cutover-fixture', status: 'completed', mode: 'cutover' }
      app.state.pgJob = { job_id: 'cancelled-pg-fixture', status: 'cancelled', cleanup_required: true, message: 'Native cleanup needs review; SQLite remains active.' }
      await page.reload()
      await assertReadable(page.getByTestId('v2-open-postgres').locator('..').locator('p').last(), `${theme} cleanup notice`)
      await page.getByTestId('v2-open-postgres').click()
      await page.getByTestId('v2-job').filter({ hasText: 'Native cleanup needs review' }).waitFor()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-pg-preview"]').disabled)
      assert.equal(await page.getByTestId('v2-pg-preview').isEnabled(), true)
      app.state.pgOffline = true
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await assertReadable(page.getByRole('alert').filter({ hasText: 'Native state unavailable' }), `${theme} database request error`)
    } finally {
      await browser?.close()
      if (child && child.exitCode === null) {
        child.kill('SIGTERM'); const forced = setTimeout(() => child.kill('SIGKILL'), 5000)
        await once(child, 'exit'); clearTimeout(forced)
      }
      assert.equal(!child || child.exitCode !== null || child.signalCode !== null, true, 'Task-created built frontend must terminate')
      await app.close()
    }
  })

  test(`${name}: actual major wizard preserves rclone, requires rehearsal, resumes jobs and fails closed on old API`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').waitFor()
      assert.equal(await page.locator('input[value="rclone"]').isChecked(), true)
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      await page.getByTestId('v2-rehearse').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-start"]').disabled)
      await page.getByTestId('v2-start').click()
      await page.getByTestId('v2-job').filter({ hasText: 'cutover-fixture' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/start')).length, 1)
      const stored = await page.evaluate(() => sessionStorage.getItem('dumb.infinidyskV2.jobs.v1'))
      assert.deepEqual(JSON.parse(stored), { major: 'cutover-fixture', postgres: null })
      assert.equal(stored.includes('private-fixture-preview'), false)
      app.state.capabilities.api_version = '2.23.0'; await page.reload()
      await page.getByTestId('v2-job').filter({ hasText: 'cutover-fixture' }).waitFor()
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      assert.equal(app.state.calls.some(call => call.path.includes('/infinidysk-migration/')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: changing mount invalidates review and stale tokens never replay`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await page.locator('input[value="fuse"]').check()
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      await page.locator('input[value="rclone"]').check()
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page)
      app.state.stale = true; await page.getByTestId('v2-rehearse').click()
      await page.getByRole('alert').filter({ hasText: 'Preview expired' }).waitFor()
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      assert.equal((await page.locator('body').innerText()).includes('token=hidden'), false)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rehearse')).length, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: fresh installation uses explicit backend eligibility without a legacy rehearsal`, { timeout: 60000 }, async () => {
    const app = await fixture('fresh'); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      for (const key of ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream']) await page.getByTestId(`v2-ack-${key}`).check()
      await page.getByTestId('v2-confirmation').fill('INSTALL INFINIDYSK V2')
      assert.equal(await page.getByTestId('v2-rehearse').count(), 0)
      await page.getByTestId('v2-start').click(); await page.getByTestId('v2-job').waitFor()
      const selection = app.state.calls.find(call => call.path.endsWith('/preview')).body
      assert.deepEqual(selection, { mode: 'fresh', mount_backend: 'rclone', import_strategy: 'preserve' })
      assert.equal(app.state.calls.some(call => call.path.endsWith('/rehearse')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: actual native PG panel clears secrets and admits guarded copy/cutover only`, { timeout: 60000 }, async () => {
    const app = await fixture('postgres'); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(`${app.origin}/?postgres`)
      await page.getByTestId('v2-pg-managed').uncheck()
      await page.getByTestId('v2-pg-host').fill('db.example.invalid'); await page.getByTestId('v2-pg-user').fill('fixture_user')
      await page.getByTestId('v2-pg-password').fill('fixture-only-password')
      await page.getByTestId('v2-pg-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(await page.getByTestId('v2-pg-password').inputValue(), '')
      assert.equal(await page.getByTestId('v2-pg-start').isDisabled(), true)
      await page.getByTestId('v2-pg-backup').check(); await page.getByTestId('v2-pg-target-ack').check()
      await page.getByTestId('v2-pg-confirmation').fill('COPY TO NEW POSTGRESQL DATABASE'); await page.getByTestId('v2-pg-start').click()
      await page.getByTestId('v2-job').filter({ hasText: 'pg-fixture' }).waitFor()
      assert.equal(await page.getByTestId('v2-pg-cutover').count(), 0)
      app.state.pgOffline = true
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Native state unavailable' }).waitFor()
      assert.equal(await page.getByTestId('v2-pg-cancel').count(), 0)
      assert.equal(await page.getByTestId('v2-job').count(), 1)
      app.state.pgOffline = false
      app.state.syncing = true
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-pg-cutover').waitFor()
      assert.equal(await page.getByTestId('v2-pg-cutover').isDisabled(), true)
      await page.getByTestId('v2-pg-backup').check(); await page.getByTestId('v2-pg-target-ack').check()
      await page.getByTestId('v2-pg-action-confirmation').fill('SWITCH TO POSTGRESQL'); await page.getByTestId('v2-pg-cutover').click()
      await page.getByTestId('v2-job').filter({ hasText: 'completed' }).waitFor()
      const stored = await page.evaluate(() => sessionStorage.getItem('dumb.infinidyskV2.jobs.v1'))
      assert.equal(stored.includes('password'), false); assert.equal(stored.includes('preview'), false)
      await page.reload(); await page.getByTestId('v2-job').filter({ hasText: 'pg-fixture' }).waitFor()
      assert.equal(app.state.calls.some(call => call.path.includes('arr-postgres-migration')), false)
    } finally { await browser?.close(); await app.close() }
  })
}
