import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const capabilities = { installation_backup: true, installation_backup_protocol: 1, backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['installation_backup', 'symlink_manifest'] }
const entry = "import { createApp, ref } from 'vue'; import Panel from '~/components/InstallationBackupPanel.vue'; const states = new Map(); globalThis.useState = (key, initial) => { if (!states.has(key)) states.set(key, ref(initial())); return states.get(key); }; window.__backupToasts = []; globalThis.useToast = () => Object.fromEntries(['success','warning','error'].map(type => [type, value => window.__backupToasts.push({ type, ...value })])); let app; window.__remountBackup = () => { app?.unmount(); app = createApp(Panel); app.mount('#app'); }; window.__remountBackup();"
const reference = 'dumb-backup://archive/installation/example'
const savedReference = 'dumb-backup://archive/installation/' + 'a'.repeat(32)
const savedReceipt = () => ({ artifact_id: 'a'.repeat(32), reference: savedReference, backup_destination_id: 'archive', namespace: 'installation', artifact_kind: 'installation_backup', size_bytes: 4096, sha256: 'b'.repeat(64), verified: true, extension: 'tar', created_at: 1700000000 })
const capacity = sufficient => ({ status: sufficient ? 'sufficient' : 'insufficient', complete: true, estimated: true, reserved: false, observed_at: 1700000000, source: { entries: 4, logical_bytes: 1024, root_count: 1 }, filesystems: [{ id: 'filesystem_1', roles: ['cold_archive'], base_required_bytes: 1024, safety_margin_bytes: 1024, required_bytes: 2048, free_bytes: sufficient ? 4096 : 1024, shortfall_bytes: sufficient ? 0 : 1024, sufficient }] })
let bundle
const fixture = async () => {
  bundle ||= await buildVueComponentHarness(entry)
  const state = { capabilities: { ...capabilities }, calls: [], job: null, acceptedJobs: 0, previewOperation: null, previewSession: 'controller_fixture', holdPreview: false, finishPreview: null, previewStatusFailure: false, holdStart: false, finishStart: null, insufficient: false, failure: false, fresh: false, schedule: { enabled: false, destination_id: '', interval_hours: 24, keep_last: 7 } }
  const server = http.createServer(async (req, res) => {
    const originalPath = new URL(req.url, 'http://fixture.invalid').pathname
    const query = new URL(req.url, 'http://fixture.invalid').searchParams
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
    if (state.onboardingHold && ['/api/config/onboarding-status', '/api/config/', '/api/process/processes', '/api/health'].includes(path)) { res.statusCode = 409; return send({ detail: 'Installation recovery owns persistence; use its status and recovery controls.' }) }
    if (path === '/api/config/onboarding-status') return send({ completed: !state.fresh, onboarding_completed: !state.fresh })
    if (path === '/api/config/') return send({ dumb: { onboarding_completed: !state.fresh } })
    if (path === '/api/process/processes') return send({ processes: [{ process_name: 'DUMB API', config_key: 'dumb', config: { enabled: true, onboarding_completed: !state.fresh } }] })
    if (path === '/api/health') return send({ status: 'ok' })
    if (path === '/api/process/core-services' || path === '/api/process/optional-services') return send([])
    if (path === '/api/process/backup-storage') return send({ protocol: 1, default_destination_id: 'archive', destinations: ['archive', 'archive2'].map(id => ({ id, name: id, path: `/mnt/${id}`, enabled: true, registered: true, ready: true, storage_type: 'network', filesystem_type: 'nfs', last_checked_at: 1700000000, blockers: [] })) })
    if (path === base + '/status') return send({ protocol: 1, job: state.job, recovery_required: state.job?.status === 'recovery_required', schedule: state.schedule, schedule_runtime: state.scheduleRuntime || { status: state.schedule.enabled ? 'scheduled' : 'disabled', last_attempt_at: null, last_success_at: null, next_due_at: null, blocker: null, error: null }, preparation: state.preparation || null, scope: { includes: ['Managed configuration and databases'], excludes: ['Media payloads and external services'] }, warnings: [] })
    if (path === base + '/preview/status') {
      if (state.previewStatusFailure) { res.statusCode = 503; return send({ detail: 'Preview status unavailable' }) }
      if (query.has('preview_id') && query.get('preview_id') !== state.previewOperation?.preview_id) { res.statusCode = 409; return send({ detail: 'The previous preview is no longer retained' }) }
      return send({ protocol: 1, controller_session: state.previewSession, preview: state.previewOperation })
    }
    if (path === base + '/preview/preview_fixture/cancel') {
      state.previewOperation = { ...state.previewOperation, status: 'cancelling', cancel_requested: true, message: 'Waiting for current filesystem call before cleanup', updated_at: Date.now() / 1000 }
      return send({ protocol: 1, controller_session: state.previewSession, preview: state.previewOperation })
    }
    if (path === base + '/catalog') return send({ protocol: 1, artifacts: [{ reference, artifact_id: 'example', artifact_kind: 'installation_backup', created_at: 1700000000, size_bytes: 4096, verified: true, sha256: 'a'.repeat(64), compression: state.catalogCompression, extension: state.catalogCompression === 'zstd' ? 'tar.zst' : 'tar' }] })
    if (path === base + '/preview' || path === base + '/restore/preview') {
      if (state.requireShared && body.archive_path && body.allow_shared_permissions !== true) { res.statusCode = 409; return send({ detail: 'The archive file must enforce private permissions unless shared archive permissions are explicitly accepted.' }) }
      if (state.failure) { res.statusCode = 409; return send({ detail: { code: 'scope_unproven', message: 'A configured external database cannot be snapshotted; provide a separate verified backup.', blockers: ['Do not proceed until external coverage is confirmed.'] } }) }
      const restore = path.includes('/restore/')
      const result = { protocol: 1, ready: !state.insufficient, preview_token: 'private-installation-preview', expires_at: Date.now() / 1000 + 120, confirmation_text: restore ? 'RESTORE EXAMPLE INSTALLATION' : 'BACK UP EXAMPLE INSTALLATION', inventory: { roots: [{ id: 'config', path: '/config', kind: 'directory', roles: ['configuration'], entries: 4, logical_bytes: 1024 }], excluded: [{ path: '/media', reason: 'Media payloads are not included' }] }, capacity: capacity(!state.insufficient), backup: restore ? { schema_version: 1, verified: true, sha256: 'a'.repeat(64), ...(body.reference ? { reference: body.reference } : { archive_path: body.archive_path, allow_shared_permissions: body.allow_shared_permissions === true }) } : undefined, blockers: state.insufficient ? ['Insufficient space at the selected destination.'] : [], warnings: ['Managed applications will be stopped for consistency.', 'Proxy and tunnel ingress may pause. Establish direct frontend/API access before starting.', ...(body.allow_shared_permissions ? ['Shared archive permissions were explicitly accepted; protect mount ACLs.'] : [])], observed_permissions: restore && body.archive_path ? { directory_mode: '0755', file_mode: '0664' } : null, required_acknowledgements: restore ? ['downtime', 'replace_state', 'external_state'] : ['downtime', 'secrets', 'external_state'] }
      if (state.capabilities.installation_backup_zstd === true) {
        if (restore) result.backup.compression = body.reference ? state.catalogCompression || 'none' : body.archive_path.endsWith('.zst') ? 'zstd' : 'none'
        else result.compression = body.compression || 'none'
      }
      const tracked = !restore && state.capabilities.installation_backup_preview_status === true
      if (tracked) state.previewOperation = { preview_id: 'preview_fixture', kind: 'backup', destination_id: body.destination_id, compression: result.compression, status: 'running', stage: 'inventory', message: 'Inspecting managed application state', started_at: Date.now() / 1000, updated_at: Date.now() / 1000, last_progress_at: Date.now() / 1000, completed_at: null, elapsed_seconds: 0, entries: 2213066, logical_bytes: 1073741824, roots_completed: 1, root_count: 61, current_root: { id: 'application', path: '/data/application', kind: 'directory', roles: ['managed_state'] }, cancel_requested: false, result: null, expires_at: null }
      if (state.holdPreview) { await new Promise(resolve => { state.finishPreview = resolve }); state.finishPreview = null }
      if (tracked && state.previewOperation.status === 'cancelling') {
        state.previewOperation = { ...state.previewOperation, status: 'cancelled', updated_at: Date.now() / 1000, completed_at: Date.now() / 1000, message: 'Temporary inventory cleaned up' }
        res.statusCode = 409; return send({ detail: 'Backup preview cancelled' })
      }
      if (tracked) state.previewOperation = { ...state.previewOperation, status: 'completed', updated_at: Date.now() / 1000, completed_at: Date.now() / 1000, expires_at: result.expires_at, result }
      return send(result)

    }
    if (path === base + '/start' || path === base + '/restore/start') {
      // Browsers can retransmit after a dropped response. Model the server's
      // single-use preview reservation, rather than creating another job.
      if (state.disconnectStart && state.acceptedJobs > 0) { res.statusCode = 409; return send({ detail: { code: 'operation_active', message: 'A backup operation is already active. Reconnect through direct frontend/API access and refresh backup status.' } }) }
      state.acceptedJobs++
      if (state.holdStart) { state.preparation = { stage: 'checking_capacity', message: 'Rechecking backup coverage and space before stopping services.', started_at: Date.now() / 1000 }; await new Promise(resolve => { state.finishStart = resolve }); state.finishStart = null; state.preparation = null }
      state.job = { job_id: 'installation_job', job_type: path.includes('/restore/') ? 'installation_restore' : 'installation_backup', status: 'running', stage: 'quiescing', message: 'Stopping managed applications', updated_at: 1700000000, can_rollback: false, errors: [] }
      if (state.disconnectStart) { req.socket.destroy(); return }
      return send({ protocol: 1, job: state.job })
    }
    if (path === base + '/schedule' && req.method === 'PUT') { state.schedule = body; return send({ protocol: 1, schedule: body }) }
    if (path === base + '/jobs/installation_job/cancel') {
      if (state.disconnectCancel) { req.socket.destroy(); return }
      state.job = { ...state.job, cancel_requested: true, can_cancel: false, updated_at: state.job.updated_at + 1, message: 'Cancellation accepted; finishing cleanup and service resumption' }
      return send({ protocol: 1, job: state.job })
    }
    if (path === base + '/jobs/installation_job/rollback') { state.job = { ...state.job, status: 'rolled_back', can_rollback: false, message: 'Original state restored', ...(state.archiveRecoveryRestart ? { stage: 'restart_required', restart_required: true, result: { ...state.job.result, restart_required: true } } : {}) }; return send({ protocol: 1, job: state.job }) }
    if (path === base + '/jobs/' + state.job?.job_id) return send({ protocol: 1, job: state.job })
    if (path.startsWith('/api/')) return send(path.includes('/logs') ? { logs: [] } : {})
    res.statusCode = 404; send({ detail: 'Unknown fixture path' })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: () => { state.finishPreview?.(); state.finishStart?.(); return new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) } }
}
const releaseFixture = async (state, key) => {
  for (let attempt = 0; attempt < 100 && typeof state[key] !== 'function'; attempt++) await delay(20)
  assert.equal(typeof state[key], 'function', 'The fixture must acknowledge its held request before release')
  state[key]()
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


  test(`${name}: compression choices stay independent, invalidate review and are omitted for legacy backends`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.installation_backup_compression = true; app.state.capabilities.installation_backup_zstd = true
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      const manual = page.getByTestId('installation-backup-compression')
      await manual.waitFor(); assert.equal(await manual.inputValue(), 'none')
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await manual.selectOption('zstd')
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-review-format').filter({ hasText: 'Zstandard (.tar.zst)' }).waitFor()
      assert.equal(app.state.calls.findLast(call => call.path === '/api/process/installation-backups/preview').body.compression, 'zstd')
      await acknowledge(page, 'backup')
      assert.equal(await page.getByTestId('installation-start').isEnabled(), true)
      await manual.selectOption('none')
      await page.getByTestId('installation-review').waitFor({ state: 'detached' })
      await page.getByTestId('installation-tab-schedule').click()
      const schedule = page.getByTestId('installation-schedule-compression')
      assert.equal(await schedule.inputValue(), 'none')
      await schedule.selectOption('zstd')
      await page.getByTestId('installation-schedule-save').click()
      await page.getByText('Backup schedule saved.', { exact: true }).waitFor()
      assert.equal(app.state.schedule.compression, 'zstd')
      await page.getByTestId('installation-tab-backup').click()
      assert.equal(await manual.inputValue(), 'none')
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-review-format').filter({ hasText: 'Uncompressed tar (.tar)' }).waitFor()
      await manual.selectOption('zstd')
      app.state.capabilities.installation_backup_zstd = false
      await page.getByTestId('installation-refresh').click()
      await page.getByRole('alert').filter({ hasText: 'does not advertise Zstandard' }).waitFor()
      assert.equal(await page.getByTestId('installation-preview').isEnabled(), false)
      await manual.selectOption('none')
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-review').waitFor()
      assert.equal(app.state.calls.findLast(call => call.path === '/api/process/installation-backups/preview').body.compression, 'none')
      await page.getByTestId('installation-tab-schedule').click()
      await page.getByTestId('installation-schedule-compression').selectOption('none')
      await page.getByTestId('installation-schedule-save').click()
      await page.getByText('Backup schedule saved.', { exact: true }).waitFor()
      assert.equal(app.state.schedule.compression, 'none')
      await page.getByTestId('installation-tab-backup').click()
      delete app.state.capabilities.installation_backup_compression; delete app.state.capabilities.installation_backup_zstd
      await page.getByTestId('installation-refresh').click()
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-review').waitFor()
      assert.equal('compression' in app.state.calls.findLast(call => call.path === '/api/process/installation-backups/preview').body, false)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/start')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: compressed preview reconnects its codec and restore displays the detected format without sending a format choice`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.installation_backup_compression = true; app.state.capabilities.installation_backup_zstd = true; app.state.capabilities.installation_backup_preview_status = true; app.state.holdPreview = true; app.state.catalogCompression = 'zstd'
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('installation-backup-compression').selectOption('zstd')
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-preview-counters').waitFor()
      await page.reload()
      await page.getByTestId('installation-preview-counters').waitFor()
      assert.equal(await page.getByTestId('installation-backup-compression').inputValue(), 'zstd')
      assert.equal(await page.getByTestId('installation-backup-compression').isEnabled(), false)
      await releaseFixture(app.state, 'finishPreview')
      await page.getByTestId('installation-review-format').filter({ hasText: 'Zstandard (.tar.zst)' }).waitFor()
      assert.equal(await page.getByTestId('installation-start').isEnabled(), false)
      assert.equal(app.state.calls.filter(call => call.path === '/api/process/installation-backups/preview').length, 1)
      app.state.holdPreview = false
      await page.getByTestId('installation-tab-restore').click()
      await page.getByTestId('installation-archive').selectOption(reference)
      await page.getByTestId('installation-restore-preview').click()
      await page.getByTestId('installation-review-format').filter({ hasText: 'Zstandard (.tar.zst)' }).waitFor()
      const restored = app.state.calls.findLast(call => call.path.endsWith('/restore/preview'))
      assert.deepEqual(restored.body, { reference })
      assert.equal(app.state.calls.some(call => call.path.endsWith('/restore/start')), false)
    } finally { await browser?.close(); await app.close() }
  })


  test(`${name}: pre-admission recheck never offers cancellation or live progress for an old completed backup`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      app.state.capabilities.installation_backup_cancellation = true; app.state.capabilities.installation_backup_phase_progress = true
      app.state.job = { job_id: 'installation_job', job_type: 'installation_backup', status: 'completed', stage: 'verifying', updated_at: 1700000010, can_cancel: false, progress: { stage: 'verifying', percent_scope: 'phase', entries: 4, total_entries: 4, bytes_processed: 4096, total_bytes: 4096, percent: 100, percent_basis: 'bytes' } }
      app.state.preparation = { stage: 'checking_capacity', started_at: Date.now() / 1000 - 20, message: 'Rechecking backup space before stopping applications' }
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-admission-progress').waitFor()
      assert.match(await page.getByTestId('installation-admission-progress').innerText(), /no archive is being written.*services are not stopped.*after DUMB accepts/is)
      assert.equal(await page.getByTestId('installation-job-cancellation').count(), 0)
      assert.equal(await page.getByTestId('installation-job').getByRole('progressbar').count(), 0)
      app.state.preparation = null
      app.state.job = { ...app.state.job, status: 'running', stage: 'quiescing', updated_at: 1700000011, can_cancel: true, cancel_requested: false, progress: undefined }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-cancel').waitFor()
      assert.equal(await page.getByTestId('installation-cancel').isEnabled(), true)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/cancel') || call.path.endsWith('/restore/start')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: downtime warnings precede consent and safe cancellation reports measured phase progress`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      app.state.capabilities.installation_backup_cancellation = true; app.state.capabilities.installation_backup_phase_progress = true
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-manual-downtime-warning').waitFor()
      assert.match(await page.getByTestId('installation-manual-downtime-warning').innerText(), /hours.*managed applications.*unavailable.*verification/s)
      await page.getByTestId('installation-tab-schedule').click()
      await page.getByTestId('installation-schedule-downtime-warning').waitFor()
      assert.match(await page.getByTestId('installation-schedule-downtime-warning').innerText(), /Every scheduled backup stops.*unavailable.*hours/s)
      assert.equal(app.state.calls.some(c => c.method === 'PUT'), false)
      app.state.job = { job_id: 'installation_job', job_type: 'installation_backup', status: 'running', stage: 'archiving', updated_at: 1700000010, can_cancel: true, cancel_requested: false, progress: { stage: 'archiving', percent_scope: 'phase', entries: 2, total_entries: 4, logical_bytes: 1024, total_logical_bytes: 2048, bytes_processed: 1536, percent: 50, percent_basis: 'bytes' } }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-phase-percent').filter({ hasText: '50% of this phase' }).waitFor()
      assert.equal(await page.getByRole('progressbar', { name: 'Current backup phase progress' }).getAttribute('value'), '50')
      await page.getByTestId('installation-cancel').click()
      await page.getByTestId('installation-cancel-pending').waitFor()
      assert.equal(await page.getByTestId('installation-cancel').isEnabled(), false)
      assert.match(await page.getByTestId('installation-cancel-pending').innerText(), /Keep DUMB and the host running/)
      assert.equal(app.state.calls.filter(c => c.path.endsWith('/cancel')).length, 1)
      assert.equal(app.state.calls.some(c => c.path.endsWith('/rollback') || c.path.endsWith('/restore/start')), false)
      app.state.job = { ...app.state.job, stage: 'resuming', updated_at: 1700000012, progress: { stage: 'verifying', percent_scope: 'phase', entries: 4, total_entries: 4, bytes_processed: 4096, total_bytes: 4096, percent: 100, percent_basis: 'bytes' } }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-phase-percent').filter({ hasText: 'total for this phase is not yet known' }).waitFor()
      assert.equal(await page.getByRole('progressbar', { name: 'Current backup phase progress' }).getAttribute('value'), null)
      app.state.job = { ...app.state.job, status: 'cancelled', stage: 'cancelled', updated_at: 1700000013, message: 'Backup cancelled; retained applications resumed' }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-job').filter({ hasText: 'Backup cancelled; retained applications resumed' }).waitFor()
      assert.equal(await page.getByTestId('installation-cancel').count(), 0)
      app.state.job = { ...app.state.job, job_id: 'publication_job', status: 'running', stage: 'publishing', can_cancel: false, cancel_requested: false, updated_at: 1700000014 }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-cancel-unavailable').waitFor(); assert.equal(await page.getByTestId('installation-cancel').isEnabled(), false)
      app.state.job = { ...app.state.job, job_id: 'restore_job', job_type: 'installation_restore', status: 'running', stage: 'restoring', can_cancel: true, cancel_requested: false, updated_at: 1700000015 }
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-job').getByText('Installation restore', { exact: true }).waitFor(); await page.getByTestId('installation-job-cancellation').waitFor({ state: 'detached' })
      assert.equal(await page.getByTestId('installation-cancel').count(), 0)
      app.state.job = { ...app.state.job, job_id: 'unsupported_job', job_type: 'installation_backup' }; delete app.state.capabilities.installation_backup_cancellation
      await page.getByTestId('installation-refresh').click(); await page.getByTestId('installation-job').getByText('Installation backup', { exact: true }).waitFor(); await page.getByTestId('installation-job-cancellation').waitFor({ state: 'detached' }); assert.equal(await page.getByTestId('installation-cancel').count(), 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: a saved verified archive stays distinct from service failure and survives reviewed recovery`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.archiveRecoveryRestart = true
    app.state.job = { job_id: 'installation_job', job_type: 'installation_backup', status: 'recovery_required', stage: 'resume_required', message: 'The complete installation operation did not finish', can_rollback: true, rollback_confirmation_text: 'FINISH EXAMPLE BACKUP RECOVERY', errors: ['A retained service could not resume'], result: { complete: true, archive: savedReceipt() } }
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      const details = page.getByTestId('installation-job')
      await details.getByTestId('installation-verified-archive').waitFor()
      assert.match(await details.innerText(), /Backup saved; service recovery required/)
      assert.equal(await details.getByTestId('installation-verified-archive-reference').innerText(), savedReference)
      assert.match(await details.innerText(), /does not require creating the backup again/)
      assert.doesNotMatch(await details.innerText(), /Backup attempt failed|no archive was accepted/i)
      await page.getByTestId('installation-rollback-confirmation').fill('FINISH EXAMPLE BACKUP RECOVERY')
      await page.getByTestId('installation-rollback').click()
      await details.getByText('Backup saved; restart required', { exact: true }).waitFor()
      assert.equal(await details.getByTestId('installation-verified-archive-reference').innerText(), savedReference)
      assert.match(await details.getByTestId('installation-backup-error-history').innerText(), /Previous service recovery issue/)
      app.state.job = { ...app.state.job, restart_required: false, result: { ...app.state.job.result, restart_required: false }, archive_verified: true }
      await page.getByTestId('installation-refresh').click()
      await details.getByText('Backup saved; recovery complete', { exact: true }).waitFor()
      assert.equal(await details.getByTestId('installation-verified-archive-reference').innerText(), savedReference)
      app.state.job = { ...app.state.job, job_id: 'unverified_job', status: 'recovery_required', stage: 'checking_source', can_rollback: true, archive_verified: false, result: { complete: true, archive: { ...savedReceipt(), verified: false } }, progress: { entries: 4, bytes_processed: 4096, percent: 100 }, message: 'Source validation failed before publication' }
      await page.getByTestId('installation-refresh').click()
      await details.getByText(/Source validation failed before publication/).waitFor()
      assert.equal(await details.getByTestId('installation-verified-archive').count(), 0)
      app.state.job = { ...app.state.job, job_id: 'unconfirmed_job', archive_publication_uncertain: true, stage: 'interrupted', result: undefined, message: 'Publication did not return a receipt' }
      await page.getByTestId('installation-refresh').click(); await details.getByTestId('installation-archive-publication-uncertain').waitFor()
      assert.equal(await details.getByTestId('installation-verified-archive').count(), 0)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 1)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/restore/start') || call.path.endsWith('/start')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: failed-backup recovery clearly differs from restoring application data`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.job = { job_id: 'installation_job', job_type: 'installation_backup', status: 'recovery_required', stage: 'recovery_required', message: 'Backup was interrupted', updated_at: 1700000000.25, can_rollback: true, rollback_confirmation_text: 'ROLLBACK BACKUP SESSION', errors: ['Review the interrupted backup session'] }
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      const status = page.getByTestId('installation-job')
      await status.getByRole('heading', { name: 'Backup status and recovery', exact: true }).waitFor()
      await status.getByText(/Your existing application data remains in place/).waitFor()
      assert.match(await status.innerText(), /does not restore an archive or install services/)
      const finish = page.getByRole('button', { name: 'Finish backup recovery', exact: true })
      assert.equal(await finish.isEnabled(), false)
      await page.getByTestId('installation-rollback-confirmation').fill('ROLLBACK BACKUP SESSION')
      assert.equal(await finish.isEnabled(), true)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/rollback')), false)
      app.state.job = { ...app.state.job, job_id: 'restore_job', job_type: 'installation_restore', rollback_confirmation_text: 'RESTORE ORIGINAL EXAMPLE' }
      await page.getByTestId('installation-refresh').click()
      await status.getByRole('heading', { name: 'Restore status and recovery', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Request reviewed rollback', exact: true }).isEnabled(), false)
      assert.equal(await page.getByRole('button', { name: 'Finish backup recovery', exact: true }).count(), 0)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/rollback')), false)
    } finally { await browser?.close(); await app.close() }
  })


  test(`${name}: acknowledged backup restart displays completed recovery and preserves errors as history`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    const base = { job_id: 'installation_job', job_type: 'installation_backup', status: 'rolled_back', stage: 'restart_required', message: 'The restored configuration loaded in a new controller. Automatic rollback is retired; retained previous trees remain available.', updated_at: 1700000000.5, restart_required: false, result: { restart_required: false }, can_rollback: false, errors: ['A persistent entry changed while the backup was being created'] }
    app.state.job = { ...base }
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      const status = page.getByTestId('installation-job')
      await status.getByText('Recovery complete', { exact: true }).waitFor()
      assert.match(await status.innerText(), /Backup recovery complete/)
      assert.doesNotMatch(await status.innerText(), /restart_required|restored configuration/)
      assert.match(await status.innerText(), /Original application data remains in place; backup recovery is complete/)
      assert.match(app.state.job.message, /restored configuration/)
      assert.equal(await page.getByTestId('installation-restart-required').count(), 0)
      const history = page.getByTestId('installation-backup-error-history')
      await history.getByRole('heading', { name: 'Backup attempt failed', exact: true }).waitFor()
      assert.match(await history.innerText(), /A persistent entry changed/)
      assert.equal(await history.getByRole('alert').count(), 0)
      assert.equal(app.state.job.stage, 'restart_required')
      for (const [top, nested] of [[true, true], [undefined, undefined], [false, true], [false, undefined]]) {
        app.state.job = { ...base, restart_required: top, result: { restart_required: nested } }
        await page.getByTestId('installation-refresh').click()
        await page.getByTestId('installation-restart-required').waitFor()
        assert.equal(await status.getByText('Recovery complete', { exact: true }).count(), 0)
        assert.equal(await history.getByRole('alert').count(), 0)
      }
      app.state.job = { ...base, job_id: 'restore_job', job_type: 'installation_restore' }
      await page.getByTestId('installation-refresh').click()
      await status.getByText(/Restart complete/).waitFor()
      assert.equal(await status.getByText('rolled back', { exact: true }).count(), 1)
      assert.match(await status.innerText(), /restored configuration loaded in a new controller/)
      assert.equal(await page.getByTestId('installation-backup-error-history').count(), 0)
      app.state.job = { ...base, status: 'running', stage: 'failed', can_rollback: true }
      await page.getByTestId('installation-refresh').click()
      await status.getByText('running', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('installation-restart-required').count(), 0)
      assert.equal(await page.getByTestId('installation-rollback-confirmation').count(), 0)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/rollback')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: pending preview shows real counters, keeps services running and waits for cooperative cancellation`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.installation_backup_preview_status = true; app.state.holdPreview = true
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('installation-preview').click()
      const progress = page.getByTestId('installation-preview-progress')
      await progress.getByText('Entries inspected', { exact: true }).waitFor()
      await progress.filter({ hasText: '2,213,066' }).waitFor()
      assert.match(await progress.innerText(), /Applications stay running.*does not create a backup archive/s)
      assert.equal(await page.getByTestId('installation-preview').isEnabled(), false)
      assert.equal(await progress.locator('.animate-spin').count(), 1)
      const firstElapsed = await page.getByTestId('installation-preview-elapsed').innerText()
      await delay(1100)
      assert.notEqual(await page.getByTestId('installation-preview-elapsed').innerText(), firstElapsed)
      await page.getByTestId('installation-preview-cancel').click()
      await progress.filter({ hasText: 'Cancelling backup preview' }).waitFor()
      assert.equal(await page.getByTestId('installation-preview-cancel').isEnabled(), false)
      assert.equal(await page.getByTestId('installation-preview').isEnabled(), false)
      await releaseFixture(app.state, 'finishPreview')
      await progress.getByRole('heading', { name: 'Backup preview cancelled', exact: true }).waitFor()
      assert.equal(await page.getByTestId('installation-preview').isEnabled(), true)
      assert.equal(app.state.calls.filter(call => call.path === '/api/process/installation-backups/preview').length, 1)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/start')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: reloading or remounting reconnects one preview and restores review without replay or duplicate toast`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.installation_backup_preview_status = true; app.state.holdPreview = true
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-preview-counters').waitFor()
      await page.reload()
      await page.getByTestId('installation-preview-counters').waitFor()
      assert.equal(await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').inputValue(), 'archive')
      await releaseFixture(app.state, 'finishPreview')
      await page.getByTestId('installation-review').waitFor()
      assert.equal(await page.getByTestId('installation-start').isEnabled(), false)
      assert.equal(app.state.calls.filter(call => call.path === '/api/process/installation-backups/preview').length, 1)
      assert.equal(await page.evaluate(() => window.__backupToasts.filter(value => value.title === 'Backup preview complete').length), 1)
      await page.evaluate(() => window.__remountBackup())
      await page.getByTestId('installation-review').waitFor()
      assert.equal(await page.evaluate(() => window.__backupToasts.filter(value => value.title === 'Backup preview complete').length), 1)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/start')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: preview contact loss keeps last progress and prevents duplicate work until status reconnects`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.installation_backup_preview_status = true; app.state.holdPreview = true
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-preview-counters').waitFor()
      app.state.previewStatusFailure = true
      await page.getByTestId('installation-preview-refresh').click()
      await page.getByTestId('installation-preview-status-error').filter({ hasText: 'may still be scanning' }).waitFor()
      assert.equal(await page.getByTestId('installation-preview').isEnabled(), false)
      assert.match(await page.getByTestId('installation-preview-counters').innerText(), /2,213,066/)
      app.state.previewStatusFailure = false
      await page.getByTestId('installation-preview-refresh').click()
      await page.getByTestId('installation-preview-status-error').waitFor({ state: 'detached' })
      await releaseFixture(app.state, 'finishPreview')
      await page.getByTestId('installation-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path === '/api/process/installation-backups/preview').length, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: legacy preview shows elapsed activity without claiming reconnect or cancellation support`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.holdPreview = true
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('installation-preview').click()
      await page.getByTestId('installation-preview-progress').filter({ hasText: 'Keep this page open' }).waitFor()
      assert.equal(await page.getByTestId('installation-preview-cancel').count(), 0)
      assert.equal(await page.getByTestId('installation-preview-counters').count(), 0)
      assert.equal(await page.getByTestId('installation-preview').isEnabled(), false)
      await releaseFixture(app.state, 'finishPreview')
      await page.getByTestId('installation-review').waitFor()
      assert.equal(app.state.calls.some(call => call.path.endsWith('/preview/status')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: reviewed start shows admission activity and active jobs never expose rollback controls`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.holdStart = true
    try {
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, app.origin); await page.goto(app.origin)
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('installation-preview').click(); await page.getByTestId('installation-review').waitFor(); await acknowledge(page, 'backup')
      await page.getByTestId('installation-start').click()
      await page.getByTestId('installation-admission-progress').filter({ hasText: 'Rechecking backup coverage and space before stopping services' }).waitFor()
      assert.equal(await page.getByTestId('installation-preview-progress').count(), 0)
      await releaseFixture(app.state, 'finishStart')
      await page.getByTestId('installation-job').waitFor()
      app.state.job = { ...app.state.job, can_rollback: true, updated_at: 1700000000.125 }
      await page.getByTestId('installation-refresh').click()
      assert.equal(await page.getByTestId('installation-rollback-confirmation').count(), 0)
      assert.doesNotMatch(await page.getByTestId('installation-job').innerText(), /Last update: Not recorded/)
    } finally { await browser?.close(); await app.close() }
  })

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



  test(`${name}: built authenticated landing during an installation hold opens recovery without an onboarding loop`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture(); app.state.fresh = true; app.state.onboardingHold = true
    app.state.job = { job_id: 'installation_job', job_type: 'installation_backup', status: 'recovery_required', stage: 'recovery_required', message: 'Interrupted installation operation requires review', created_at: Date.now() / 1000 - 120, updated_at: Date.now() / 1000, can_rollback: false, errors: [] }
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening'); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser, child, output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-2000) })
      const origin = 'http://127.0.0.1:' + port
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(origin + '/login')).ok) { ready = true; break } } catch {} await delay(100) }
      assert.equal(ready, true)
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage(); await offline(page, origin)
      await page.addInitScript(theme => { sessionStorage.setItem('dumb_access_token', 'reserved-fixture-session'); localStorage.setItem('dmbdb.appearance.theme', theme) }, name === 'chromium' ? 'dark' : 'light')
      for (const [index, path] of ['/', '/settings'].entries()) {
        await page.goto(origin + path)
        await page.waitForURL(origin + '/settings#backups')
        await page.getByTestId('installation-tab-restore').waitFor()
        await page.getByTestId('installation-backup-activity').getByRole('heading', { name: 'Installation recovery requires attention', exact: true }).waitFor()
        assert.equal(app.state.calls.filter(call => call.path === '/api/config/onboarding-status').length, index + 1)
        await page.reload()
        await page.getByTestId('installation-tab-restore').waitFor()
        assert.equal(page.url(), origin + '/settings#backups')
        assert.equal(app.state.calls.filter(call => call.path === '/api/config/onboarding-status').length, index + 1)
        assert.equal(await page.getByTestId('installation-preview').isEnabled(), false)
      }
      assert.equal(app.state.calls.some(call => call.path.endsWith('/start') || call.path.includes('start-core-service') || call.path.includes('/setup/runs')), false)
      assert.equal(app.state.calls.filter(call => call.path === '/api/auth/refresh').length, 0)
      app.state.onboardingHold = false
      app.state.job = { ...app.state.job, status: 'rolled_back', stage: 'restart_required', message: 'Configuration loaded; normal startup resumed', restart_required: false, result: { restart_required: false }, errors: ['A persistent entry changed while the backup was being created'] }
      await page.getByTestId('installation-refresh').click()
      await page.getByTestId('installation-backup-error-history').getByRole('heading', { name: 'Backup attempt failed', exact: true }).waitFor()
      await page.getByTestId('installation-job').getByText('Recovery complete', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('installation-restart-required').count(), 0)
      assert.equal(await page.getByTestId('installation-backup-error-history').getByRole('alert').count(), 0)
      await page.getByTestId('installation-backup-activity').waitFor({ state: 'detached' })
      if (process.env.DUMB_PREVIEW_SCREENSHOT_DIR) { await page.getByTestId('installation-backup-error-history').scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.DUMB_PREVIEW_SCREENSHOT_DIR + '/recovery-' + name + '.png' }) }

    } finally {
      await browser?.close()
      if (child && child.exitCode === null) { child.kill('SIGTERM'); const done = await Promise.race([once(child, 'exit').then(() => true), delay(3000).then(() => false)]); if (!done) { child.kill('SIGKILL'); await once(child, 'exit') } }
      await app.close()
    }
  })

  test(`${name}: built recovery keeps a verified saved archive after service recovery and rejects unverified copies`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture(); app.state.fresh = true; app.state.onboardingHold = true; app.state.archiveRecoveryRestart = true
    app.state.job = { job_id: 'installation_job', job_type: 'installation_backup', status: 'recovery_required', stage: 'resume_required', archive_verified: true, can_rollback: true, rollback_confirmation_text: 'FINISH SAVED BACKUP SERVICE RECOVERY', created_at: Date.now() / 1000 - 120, updated_at: Date.now() / 1000, errors: ['An application did not resume'], result: { complete: true, archive: savedReceipt() } }
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening'); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser, child, output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-2000) })
      const origin = 'http://127.0.0.1:' + port
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(origin + '/login')).ok) { ready = true; break } } catch {} await delay(100) }
      assert.equal(ready, true)
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage({ viewport: name === 'chromium' ? { width: 1440, height: 1000 } : { width: 390, height: 844 } }); await offline(page, origin)
      await page.addInitScript(() => sessionStorage.setItem('dumb_access_token', 'reserved-fixture-session'))
      await page.goto(origin + '/settings#backups')
      if (page.viewportSize().width < 768) await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
      const details = page.getByTestId('installation-job'), activity = page.getByTestId('installation-backup-activity')
      await details.getByTestId('installation-verified-archive-reference').filter({ hasText: savedReference }).waitFor()
      await activity.getByRole('heading', { name: 'Backup saved; service recovery required', exact: true }).waitFor()
      assert.doesNotMatch(await details.innerText(), /Backup attempt failed|no archive was accepted/i)
      await page.getByTestId('installation-rollback-confirmation').fill('FINISH SAVED BACKUP SERVICE RECOVERY')
      await page.getByTestId('installation-rollback').click()
      await details.getByText('Backup saved; restart required', { exact: true }).waitFor()
      assert.equal(await details.getByTestId('installation-verified-archive-reference').innerText(), savedReference)
      app.state.onboardingHold = false
      app.state.job = { ...app.state.job, restart_required: false, result: { ...app.state.job.result, restart_required: false } }
      await page.reload()
      await details.getByText('Backup saved; recovery complete', { exact: true }).waitFor()
      assert.equal(await details.getByTestId('installation-verified-archive-reference').innerText(), savedReference)
      assert.match(await details.getByTestId('installation-backup-error-history').innerText(), /Previous service recovery issue/)
      app.state.job = { job_id: 'unverified_job', job_type: 'installation_backup', status: 'recovery_required', stage: 'checking_source', archive_verified: false, archive_publication_uncertain: false, created_at: Date.now() / 1000, updated_at: Date.now() / 1000, can_rollback: false, message: 'Complete copy did not pass verification', progress: { bytes_processed: 4096, percent: 100 }, result: { complete: false, archive: { ...savedReceipt(), verified: false } } }
      await page.reload()
      await details.getByText(/Complete copy did not pass verification/).waitFor()
      assert.equal(await page.getByTestId('installation-verified-archive').count(), 0)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 1)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/restore/start') || call.path.endsWith('/start')), false)
    } finally {
      await browser?.close()
      if (child && child.exitCode === null) { child.kill('SIGTERM'); const done = await Promise.race([once(child, 'exit').then(() => true), delay(3000).then(() => false)]); if (!done) { child.kill('SIGKILL'); await once(child, 'exit') } }
      await app.close()
    }
  })

  test(`${name}: built Settings renders preview and global archive progress with safe navigation`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture(); app.state.fresh = true; app.state.capabilities.installation_backup_preview_status = true; app.state.capabilities.installation_backup_compression = true; app.state.capabilities.installation_backup_zstd = true; app.state.holdPreview = true
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening'); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser, child, output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-2000) })
      const origin = 'http://127.0.0.1:' + port
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break } } catch {} await delay(100) }
      assert.equal(ready, true)
      browser = await browserType.launch({ headless: true }); const page = await browser.newPage({ viewport: name === 'chromium' ? { width: 1440, height: 1000 } : { width: 390, height: 844 } }); await offline(page, origin)
      await page.addInitScript(theme => { sessionStorage.setItem('dumb_access_token', 'reserved-fixture-session'); localStorage.setItem('dmbdb.appearance.theme', theme) }, name === 'chromium' ? 'light' : 'retro')
      await page.goto(origin + '/settings#backups')
      if (page.viewportSize().width < 768) await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
      await page.getByTestId('installation-destination').getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('installation-backup-compression').selectOption('zstd')
      await page.getByTestId('installation-preview').click()
      const progress = page.getByTestId('installation-preview-progress')
      await progress.getByText('Entries inspected', { exact: true }).waitFor()
      assert.match(await progress.innerText(), /2,213,066/)
      assert.notEqual(await progress.evaluate(element => getComputedStyle(element).borderTopColor), 'rgba(0, 0, 0, 0)')
      if (process.env.DUMB_PREVIEW_SCREENSHOT_DIR) {
        await progress.scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_PREVIEW_SCREENSHOT_DIR + '/preview-' + name + '.png' })
      }
      await releaseFixture(app.state, 'finishPreview')
      await page.getByTestId('installation-review').waitFor()
      await page.getByTestId('installation-review-format').filter({ hasText: 'Zstandard (.tar.zst)' }).waitFor()
      assert.equal(app.state.calls.findLast(call => call.path === '/api/process/installation-backups/preview').body.compression, 'zstd')
      await acknowledge(page, 'backup')
      await page.getByTestId('installation-start').click()
      await page.getByTestId('installation-job').waitFor()
      app.state.job = { ...app.state.job, stage: 'inventorying', message: 'Inspecting the cold source before archive writing', updated_at: Date.now() / 1000, can_rollback: true, progress: { entries: 2213066, logical_bytes: 1073741824, bytes_processed: 0 } }
      await page.getByTestId('installation-refresh').click()
      await page.getByTestId('installation-job-progress').filter({ hasText: '2,213,066' }).waitFor()
      assert.equal(await page.getByTestId('installation-rollback-confirmation').count(), 0)
      const activity = page.getByTestId('installation-backup-activity')
      await activity.getByRole('heading', { name: 'Installation backup running', exact: true }).waitFor()
      assert.match(await activity.innerText(), /Do not stop the DUMB container or shut down the host/)
      await activity.getByTestId('installation-backup-activity-refresh').click()
      await activity.getByTestId('installation-backup-activity-progress').filter({ hasText: '2,213,066' }).waitFor()
      const section = page.getByTestId('settings-section-backups')
      await section.getByRole('button', { name: /Backups and restore/ }).click()
      assert.equal(await section.getByRole('button', { name: /Backups and restore/ }).getAttribute('aria-expanded'), 'false')
      await page.getByTestId('installation-backup-activity-open').click()
      assert.equal(await section.getByRole('button', { name: /Backups and restore/ }).getAttribute('aria-expanded'), 'true')
      if (process.env.DUMB_PREVIEW_SCREENSHOT_DIR) {
        await activity.scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_PREVIEW_SCREENSHOT_DIR + '/archive-' + name + '.png' })
      }
      app.state.job = { ...app.state.job, status: 'completed', stage: 'completed', message: 'Archive verified', can_rollback: false, result: { complete: true, archive: savedReceipt() } }
      // Completion can arrive through the automatic poll while smooth navigation
      // is settling. Observe that transition instead of clicking a disappearing control.
      await activity.waitFor({ state: 'detached', timeout: 12000 })
      assert.equal(app.state.acceptedJobs, 1)
      assert.equal(app.state.calls.filter(call => call.path === '/api/process/installation-backups/preview').length, 1)
    } finally {
      await browser?.close()
      if (child && child.exitCode === null) { child.kill('SIGTERM'); const done = await Promise.race([once(child, 'exit').then(() => true), delay(3000).then(() => false)]); if (!done) { child.kill('SIGKILL'); await once(child, 'exit') } }
      await app.close()
    }
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
