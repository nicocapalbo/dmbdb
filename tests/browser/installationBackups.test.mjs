import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const capabilities = { installation_backup: true, installation_backup_protocol: 1, backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['installation_backup', 'symlink_manifest'] }
const entry = "import { createApp } from 'vue'; import Panel from '~/components/InstallationBackupPanel.vue'; createApp(Panel).mount('#app');"
const reference = 'dumb-backup://archive/installation/example'
const capacity = sufficient => ({ status: sufficient ? 'sufficient' : 'insufficient', complete: true, estimated: true, reserved: false, observed_at: 1700000000, source: { entries: 4, logical_bytes: 1024, root_count: 1 }, filesystems: [{ id: 'filesystem_1', roles: ['cold_archive'], base_required_bytes: 1024, safety_margin_bytes: 1024, required_bytes: 2048, free_bytes: sufficient ? 4096 : 1024, shortfall_bytes: sufficient ? 0 : 1024, sufficient }] })
let bundle
const fixture = async () => {
  bundle ||= await buildVueComponentHarness(entry)
  const state = { capabilities: { ...capabilities }, calls: [], job: null, acceptedJobs: 0, insufficient: false, failure: false, fresh: false, schedule: { enabled: false, destination_id: '', interval_hours: 24, keep_last: 7 } }
  const server = http.createServer(async (req, res) => {
    const originalPath = new URL(req.url, 'http://fixture.invalid').pathname
    const path = /^\/(process|auth|config|logs|metrics|health)(?:\/|$)/.test(originalPath) ? '/api' + originalPath : originalPath
    if (path === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); return }
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : null
    state.calls.push({ path, method: req.method, body: path.includes('/auth/') ? null : body })
    res.setHeader('content-type', 'application/json')
    const send = data => res.end(JSON.stringify(data))
    const base = '/api/process/installation-backups'
    if (path === '/api/process/capabilities') return send(state.capabilities)
    if (path === '/api/auth/status') return send({ enabled: state.fresh, has_users: true, mode: 'local' })
    if (path === '/api/auth/verify') return send({ valid: true, username: 'fixture_operator' })
    if (path === '/api/auth/users') return send({ users: [] })
    if (path === '/api/config/onboarding-status') return send({ completed: !state.fresh, onboarding_completed: !state.fresh })
    if (path === '/api/config/') return send({ dumb: { onboarding_completed: !state.fresh } })
    if (path === '/api/process/processes') return send({ processes: [{ process_name: 'DUMB API', config_key: 'dumb', config: { enabled: true, onboarding_completed: !state.fresh } }] })
    if (path === '/api/health') return send({ status: 'ok' })
    if (path === '/api/process/core-services' || path === '/api/process/optional-services') return send([])
    if (path === '/api/process/backup-storage') return send({ protocol: 1, default_destination_id: 'archive', destinations: ['archive', 'archive2'].map(id => ({ id, name: id, path: `/mnt/${id}`, enabled: true, registered: true, ready: true, storage_type: 'network', filesystem_type: 'nfs', last_checked_at: 1700000000, blockers: [] })) })
    if (path === base + '/status') return send({ protocol: 1, job: state.job, recovery_required: state.job?.status === 'recovery_required', schedule: state.schedule, schedule_runtime: state.scheduleRuntime || { status: state.schedule.enabled ? 'scheduled' : 'disabled', last_attempt_at: null, last_success_at: null, next_due_at: null, blocker: null, error: null }, scope: { includes: ['Managed configuration and databases'], excludes: ['Media payloads and external services'] }, warnings: [] })
    if (path === base + '/catalog') return send({ protocol: 1, artifacts: [{ reference, artifact_id: 'example', artifact_kind: 'installation_backup', created_at: 1700000000, size_bytes: 4096, verified: true, sha256: 'a'.repeat(64), extension: 'tar' }] })
    if (path === base + '/preview' || path === base + '/restore/preview') {
      if (state.requireShared && body.archive_path && body.allow_shared_permissions !== true) { res.statusCode = 409; return send({ detail: 'The archive file must enforce private permissions unless shared archive permissions are explicitly accepted.' }) }
      if (state.failure) { res.statusCode = 409; return send({ detail: { code: 'scope_unproven', message: 'A configured external database cannot be snapshotted; provide a separate verified backup.', blockers: ['Do not proceed until external coverage is confirmed.'] } }) }
      const restore = path.includes('/restore/')
      return send({ protocol: 1, ready: !state.insufficient, preview_token: 'private-installation-preview', expires_at: Date.now() / 1000 + 120, confirmation_text: restore ? 'RESTORE EXAMPLE INSTALLATION' : 'BACK UP EXAMPLE INSTALLATION', inventory: { roots: [{ id: 'config', path: '/config', kind: 'directory', roles: ['configuration'], entries: 4, logical_bytes: 1024 }], excluded: [{ path: '/media', reason: 'Media payloads are not included' }] }, capacity: capacity(!state.insufficient), backup: restore ? { schema_version: 1, verified: true, sha256: 'a'.repeat(64), ...(body.reference ? { reference: body.reference } : { archive_path: body.archive_path, allow_shared_permissions: body.allow_shared_permissions === true }) } : undefined, blockers: state.insufficient ? ['Insufficient space at the selected destination.'] : [], warnings: ['Managed applications will be stopped for consistency.', 'Proxy and tunnel ingress may pause. Establish direct frontend/API access before starting.', ...(body.allow_shared_permissions ? ['Shared archive permissions were explicitly accepted; protect mount ACLs.'] : [])], observed_permissions: restore && body.archive_path ? { directory_mode: '0755', file_mode: '0664' } : null, required_acknowledgements: restore ? ['downtime', 'replace_state', 'external_state'] : ['downtime', 'secrets', 'external_state'] })
    }
    if (path === base + '/start' || path === base + '/restore/start') {
      // Browsers can retransmit after a dropped response. Model the server's
      // single-use preview reservation, rather than creating another job.
      if (state.disconnectStart && state.acceptedJobs > 0) { res.statusCode = 409; return send({ detail: { code: 'operation_active', message: 'A backup operation is already active. Reconnect through direct frontend/API access and refresh backup status.' } }) }
      state.acceptedJobs++
      state.job = { job_id: 'installation_job', job_type: path.includes('/restore/') ? 'installation_restore' : 'installation_backup', status: 'running', stage: 'quiescing', message: 'Stopping managed applications', updated_at: 1700000000, can_rollback: false, errors: [] }
      if (state.disconnectStart) { req.socket.destroy(); return }
      return send({ protocol: 1, job: state.job })
    }
    if (path === base + '/schedule' && req.method === 'PUT') { state.schedule = body; return send({ protocol: 1, schedule: body }) }
    if (path === base + '/jobs/installation_job/rollback') { state.job = { ...state.job, status: 'rolled_back', can_rollback: false, message: 'Original state restored' }; return send({ protocol: 1, job: state.job }) }
    if (path === base + '/jobs/installation_job') return send({ protocol: 1, job: state.job })
    if (path.startsWith('/api/')) return send(path.includes('/logs') ? { logs: [] } : {})
    res.statusCode = 404; send({ detail: 'Unknown fixture path' })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
const acknowledge = async (page, mode) => {
  for (const key of mode === 'restore' ? ['downtime', 'replace_state', 'external_state'] : ['downtime', 'secrets', 'external_state']) await page.getByTestId(`installation-ack-${key}`).check()
  await page.getByTestId('installation-confirmation').fill(mode === 'restore' ? 'RESTORE EXAMPLE INSTALLATION' : 'BACK UP EXAMPLE INSTALLATION')
}
const offline = async (page, origin) => page.route('**/*', route => {
  const url = route.request().url()
  if (new URL(url).origin === origin) return route.continue()
  if (['https://api.github.com/repos/I-am-PUID-0/DUMB/contributors', 'https://api.github.com/repos/nicocapalbo/dmbdb/contributors'].includes(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  return route.abort()
})

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: installation backup review binds destination, acknowledgements, jobs and explicit schedules`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-tab-backup').waitFor()
      assert.equal(await page.getByTestId('backup-storage-selection').count(), 1)
      assert.equal(app.state.calls.filter(call => ['POST', 'PUT'].includes(call.method)).length, 0)
      const destination = page.getByTestId('installation-destination').getByTestId('backup-storage-selection')
      await destination.selectOption('archive'); await page.getByTestId('installation-preview').click(); await page.getByTestId('installation-review').waitFor()
      await page.getByText('Proxy and tunnel ingress may pause. Establish direct frontend/API access before starting.', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('installation-start').isEnabled(), false)
      await acknowledge(page, 'backup'); assert.equal(await page.getByTestId('installation-start').isEnabled(), true)
      await destination.selectOption('archive2'); await page.getByTestId('installation-review').waitFor({ state: 'detached' })
      await page.getByTestId('installation-preview').click(); await page.getByTestId('installation-review').waitFor(); await acknowledge(page, 'backup')
      await page.getByTestId('installation-start').click(); await page.getByTestId('installation-job').filter({ hasText: 'Stopping managed applications' }).waitFor()
      assert.equal(app.state.acceptedJobs, 1)
      app.state.job = { ...app.state.job, status: 'completed', message: 'Archive verified', result: { reference } }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-job').filter({ hasText: 'Archive verified' }).waitFor()
      await page.getByTestId('installation-tab-schedule').click()
      await page.getByTestId('installation-schedule-enabled').check()
      await page.getByTestId('installation-schedule-destination').getByTestId('backup-storage-selection').selectOption('archive')
      assert.equal(app.state.calls.filter(call => call.method === 'PUT').length, 0)
      await page.getByTestId('installation-schedule-save').click(); await page.getByText('Backup schedule saved.', { exact: true }).waitFor()
      assert.deepEqual(app.state.schedule, { enabled: true, destination_id: 'archive', interval_hours: 24, keep_last: 7 })
      assert.equal(await page.getByTestId('backup-storage-selection').count(), 1)
      await page.getByTestId('installation-tab-backup').click()
      assert.equal(await page.getByTestId('backup-storage-selection').inputValue(), 'archive2')
      await page.getByTestId('installation-tab-schedule').click()
      assert.equal(await page.getByTestId('backup-storage-selection').inputValue(), 'archive')
      assert.equal(app.state.calls.filter(call => call.method === 'PUT').length, 1)
      app.state.scheduleRuntime = { status: 'blocked', last_attempt_at: 1700000000, last_success_at: null, next_due_at: 1700000300, blocker: 'Backup mount is unavailable; reconnect the registered destination.', error: null }
      await page.getByTestId('installation-refresh').click()
      await page.getByTestId('installation-schedule-runtime').filter({ hasText: 'Backup mount is unavailable' }).waitFor()
      assert.match(await page.getByTestId('installation-schedule-runtime').innerText(), /Last verified scheduled backup: Not recorded/)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: unknown support, low space and restore recovery fail closed with actionable errors`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin)
      app.state.capabilities = { ...capabilities, installation_backup: false }; await page.goto(app.origin); await page.getByText(/does not advertise installation backup/).waitFor()
      await page.getByTestId('backup-storage-current-default').waitFor()
      assert.equal(await page.getByTestId('backup-storage-selection').isEnabled(), true, 'Advertised storage management remains independent of installation-backup support')
      assert.equal(await page.getByTestId('backup-storage-clear-default').isEnabled(), true)
      assert.equal(app.state.calls.some(call => call.path.startsWith('/api/process/installation-backups')), false)
      app.state.capabilities = { ...capabilities }; await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-tab-backup').waitFor()
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      app.state.insufficient = true; await page.getByTestId('installation-preview').click(); await page.getByTestId('installation-capacity').getByText(/Insufficient space/).waitFor(); await acknowledge(page, 'backup')
      assert.equal(await page.getByTestId('installation-start').isEnabled(), false)
      app.state.failure = true; await page.getByTestId('installation-preview').click(); await page.getByTestId('installation-error').filter({ hasText: 'scope_unproven' }).waitFor()
      app.state.failure = false; app.state.insufficient = false
      await page.getByTestId('installation-tab-restore').click(); await page.getByTestId('installation-restore-file-mode').check(); await page.getByTestId('installation-archive-path').fill('/mnt/backups/installation.tar')
      await page.getByTestId('installation-restore-preview').click(); await page.getByTestId('installation-review').waitFor(); await acknowledge(page, 'restore'); await page.getByTestId('installation-restore-start').click()
      await page.getByTestId('installation-job').filter({ hasText: 'Stopping managed applications' }).waitFor()
      app.state.job = { ...app.state.job, status: 'recovery_required', can_rollback: true, rollback_confirmation_text: 'RESTORE ORIGINAL EXAMPLE', errors: ['Destination changed; review retained state.'] }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-job').filter({ hasText: 'Destination changed' }).waitFor()
      assert.equal(await page.getByTestId('installation-rollback').isEnabled(), false)
      await page.getByTestId('installation-rollback-confirmation').fill('RESTORE ORIGINAL EXAMPLE'); await page.getByTestId('installation-rollback').click()
      await page.getByTestId('installation-job').filter({ hasText: 'Original state restored' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: lost ingress acknowledgement preserves uncertainty and recovers one admitted job`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      const destination = page.getByTestId('installation-destination').getByTestId('backup-storage-selection')
      await destination.selectOption('archive'); await page.getByTestId('installation-preview').click(); await page.getByTestId('installation-review').waitFor(); await acknowledge(page, 'backup')
      app.state.disconnectStart = true
      await page.getByTestId('installation-start').click(); await page.getByTestId('installation-error').filter({ hasText: 'direct frontend/API access' }).waitFor()
      assert.equal(await page.getByTestId('installation-start').count(), 0)
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-job').filter({ hasText: 'Stopping managed applications' }).waitFor()
      assert.equal(await destination.inputValue(), 'archive')
      assert.equal(app.state.acceptedJobs, 1)
      assert.equal(new Set(app.state.calls.filter(call => call.path.endsWith('/start')).map(call => call.body.preview_token)).size, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: mounted-file shared permission consent is explicit and catalog policy is never overridden`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-tab-restore').click(); await page.getByTestId('installation-restore-file-mode').check(); await page.getByTestId('installation-archive-path').fill('/mnt/backups/installation.tar')
      assert.equal(await page.getByTestId('installation-restore-shared-permissions').count(), 0)
      await page.getByTestId('installation-restore-preview').click(); await page.getByTestId('installation-review').waitFor()
      assert.equal('allow_shared_permissions' in app.state.calls.findLast(call => call.path.endsWith('/restore/preview')).body, false)
      app.state.capabilities.installation_backup_shared_permissions = true; app.state.requireShared = true
      await page.getByTestId('installation-refresh').click()
      const consent = page.getByTestId('installation-restore-shared-permissions')
      await consent.waitFor(); assert.equal(await consent.isChecked(), false)
      await page.getByTestId('installation-review').waitFor({ state: 'detached' })
      await page.getByTestId('installation-restore-preview').click()
      await page.getByTestId('installation-error').filter({ hasText: 'unless shared archive permissions are explicitly accepted' }).waitFor()
      assert.equal(app.state.calls.findLast(call => call.path.endsWith('/restore/preview')).body.allow_shared_permissions, false)
      await consent.check(); await page.getByTestId('installation-restore-preview').click(); await page.getByTestId('installation-review').waitFor(); await acknowledge(page, 'restore')
      await page.getByText('Shared archive permissions were explicitly accepted; protect mount ACLs.', { exact: true }).waitFor()
      await page.getByText('Archive and permission details', { exact: true }).click()
      assert.match(await page.getByTestId('installation-observed-permissions').innerText(), /0755.*0664.*do not prove ACL privacy/)
      assert.equal(await page.getByTestId('installation-restore-start').isEnabled(), true)
      assert.equal(app.state.calls.findLast(call => call.path.endsWith('/restore/preview')).body.allow_shared_permissions, true)
      await consent.uncheck(); await page.getByTestId('installation-review').waitFor({ state: 'detached' })
      await consent.check(); await page.getByTestId('installation-archive-path').fill('/mnt/backups/other.tar')
      assert.equal(await consent.isChecked(), false)
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByRole('radio', { name: 'Registered archive', exact: true }).check()
      await page.getByTestId('installation-archive').selectOption(reference)
      await page.getByTestId('installation-restore-preview').click(); await page.getByTestId('installation-review').waitFor()
      assert.deepEqual(app.state.calls.findLast(call => call.path.endsWith('/restore/preview')).body, { reference })
      assert.equal(app.state.calls.some(call => call.path.endsWith('/restore/start')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: actual authenticated fresh-container Settings permits reviewed restore without setup or service start`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture(); app.state.fresh = true; app.state.capabilities.installation_backup_shared_permissions = true; app.state.requireShared = true
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening'); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser, child, output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-2000) })
      const origin = `http://127.0.0.1:${port}`
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break } } catch {} await delay(100) }
      assert.equal(ready, true)
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, origin)
      await page.context().addCookies([{ name: 'dumb_ui_service', value: 'infinidysk', url: origin }])
      await page.addInitScript(theme => { sessionStorage.setItem('dumb_access_token', 'reserved-fixture-session'); localStorage.setItem('dmbdb.settings.section.backups.open', 'true'); localStorage.setItem('dmbdb.appearance.theme', theme) }, name === 'chromium' ? 'light' : 'retro')
      await page.goto(origin + '/settings#backups'); await page.getByTestId('installation-tab-restore').waitFor()
      assert.match(page.url(), /\/settings#backups$/)
      assert.equal(app.state.calls.some(call => call.path === '/api/auth/verify'), true)
      assert.equal(app.state.calls.some(call => call.path.includes('start-core-service') || call.path.includes('/setup/runs')), false)
      await page.getByTestId('installation-tab-restore').click(); await page.getByTestId('installation-restore-file-mode').check(); await page.getByTestId('installation-archive-path').fill('/mnt/backups/installation.tar')
      const consent = page.getByTestId('installation-restore-shared-permissions')
      assert.equal(await consent.isChecked(), false); await consent.check()
      await page.getByTestId('installation-restore-preview').click(); await page.getByTestId('installation-review').waitFor()
      assert.equal(app.state.calls.findLast(call => call.path.endsWith('/restore/preview')).body.allow_shared_permissions, true)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/restore/start')), false)
      await acknowledge(page, 'restore'); await page.getByTestId('installation-restore-start').click()
      await page.getByTestId('installation-job').filter({ hasText: 'Stopping managed applications' }).waitFor()
      app.state.job = { ...app.state.job, status: 'completed', can_rollback: false, result: { restart_required: true }, message: 'Restore verified; applications remain stopped' }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-restart-required').waitFor()
      assert.equal(app.state.calls.some(call => /restart-service|start-service|start-core-service/.test(call.path)), false)
    } finally {
      await browser?.close()
      if (child && child.exitCode === null) { child.kill('SIGTERM'); const done = await Promise.race([once(child, 'exit').then(() => true), delay(3000).then(() => false)]); if (!done) { child.kill('SIGKILL'); await once(child, 'exit') } }
      await app.close()
    }
  })
}
