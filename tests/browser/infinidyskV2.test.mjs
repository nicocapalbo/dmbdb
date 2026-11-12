import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const frontendPackageVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
const capabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1, infinidysk_v2_postgres: true }
const storageCapabilities = { backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['symlink_manifest', 'infinidysk_v2_archive'], infinidysk_v2_migration_backup_storage: true, infinidysk_v2_cleanup: true, infinidysk_v2_cleanup_protocol: 1 }
const capacityEstimate = (sufficient = false) => ({
  status: sufficient ? 'sufficient' : 'insufficient', complete: true, estimated: true, reserved: false, observed_at: Math.floor(Date.now() / 1000),
  source: { entries: 350000, logical_bytes: 64 * 1024 ** 3, root_count: 1 },
  filesystems: [{ id: 'filesystem_1', roles: ['retained_backup', 'candidate'], base_required_bytes: 140 * 1024 ** 3, safety_margin_bytes: 10 * 1024 ** 3, required_bytes: 150 * 1024 ** 3, free_bytes: (sufficient ? 200 : 100) * 1024 ** 3, shortfall_bytes: (sufficient ? 0 : 50) * 1024 ** 3, sufficient }],
})
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
  state.catalog = { protocol: 1, default_destination_id: 'archive', destinations: [{ id: 'archive', name: 'Example archive', path: '/mnt/backups', enabled: true, registered: true, ready: true, storage_type: 'network', filesystem_type: 'nfs', last_checked_at: 1700000000, blockers: [] }] }
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
    if (req.url === '/api/process/processes') return send({ processes: [{ process_name: 'DUMB API', config_key: 'dumb', version: 'v2.24.0-dev.3', repo_url: 'https://github.com/I-am-PUID-0/DUMB', config: { enabled: true, onboarding_completed: true } }, ...(state.installedSource ? [{ process_name: 'DUMB Frontend', config_key: 'dumb_frontend', version: `v${frontendPackageVersion}`, repo_url: 'https://github.com/nicocapalbo/dmbdb', config: { enabled: true }, installed_source: state.installedSource }] : [])] })
    if (req.url === '/api/config/onboarding-status') return send({ completed: true, onboarding_completed: true })
    if (req.url === '/api/health') return send({ status: 'ok' })
    if (req.url === '/api/process/capabilities') {
      await state.capabilitiesGate
      return send(state.capabilities)
    }
    if (req.url === '/api/process/backup-storage') {
      await state.catalogGate
      return send(state.catalog)
    }
    if (req.url === '/api/process/backup-storage/preview') return send({ protocol: 1, ready: !state.storageBlocked, profile: body, blockers: state.storageBlocked ? ['Destination mount could not be confirmed.'] : [] })
    if (req.url === '/api/process/backup-storage/profiles') {
      const profile = { ...body, enabled: true, registered: true, ready: true, storage_type: 'network', filesystem_type: 'cifs', blockers: [] }
      state.catalog.destinations.push(profile); return send({ protocol: 1, profile })
    }
    if (req.url === '/api/process/backup-storage/default') { state.catalog.default_destination_id = body.destination_id; return send({ protocol: 1, default_destination_id: body.destination_id }) }
    if (req.url === `${base}/status`) return send({ protocol: 1, runtime_generation: state.generation, mode: scenario === 'fresh' ? 'fresh' : 'migrate', current: { mount_backend: 'rclone', mount_path: '/mnt/debrid/infinidysk', compatibility_auth_policy: state.currentAuthPolicy }, supported_mount_backends: ['rclone', 'fuse'], eligibility: { ready: !(state.blockers || []).length, blockers: state.blockers || [] }, job: state.job })
    if (req.url === `${base}/preview`) {
      state.reclaimSourceSpace = body.reclaim_source_space === true
      state.plan = `plan-${body.mount_backend}${body.backup_destination_id ? `-${body.backup_destination_id}` : ''}${body.reclaim_source_space ? '-reclaim' : ''}`
      return send({ protocol: 1, ready: !(state.previewBlockers || []).length, preview_token: 'private-fixture-preview', plan_fingerprint: state.plan, expires_at: state.previewExpiry ?? Math.floor(Date.now() / 1000) + 300, confirmation_text: scenario === 'fresh' ? 'INSTALL INFINIDYSK V2' : 'MIGRATE INFINIDYSK TO V2', current: { mount_backend: 'rclone', mount_path: '/mnt/debrid/infinidysk' }, target: { mount_backend: body.mount_backend, mount_path: '/mnt/debrid/infinidysk', compatibility_auth_policy: state.targetAuthPolicy }, inventory: { symlinks: 25, consumers: ['arr', 'media'] }, capacity: state.capacity, backup_storage: body.backup_destination_id ? { mode: 'cold_archive', name: 'Example archive', path: '/mnt/backups', control_state_local: true, candidate_local: true, backups_retained: true } : undefined, source_storage: body.reclaim_source_space && !state.dropSourceStorage ? { mode: 'archive_recovery', reclaim_source_space: true, rollback_requires_archive: true } : undefined, blockers: state.previewBlockers || [], warnings: ['Fixture independent backup warning'], checks: [{ label: 'Fixture source review', passed: !(state.previewBlockers || []).length }], required_acknowledgements: ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream', ...(body.reclaim_source_space ? ['archive_recovery'] : [])], rehearsal_required: scenario !== 'fresh' })
    }
    if (req.url === `${base}/rehearse`) {
      await state.rehearsalGate
      if (state.stale) { res.statusCode = 409; return send({ detail: 'Preview expired. https://example.invalid/.ids/private?token=hidden' }) }
      state.job = state.rehearsalFailed
        ? { job_id: 'restored-rehearsal-fixture', status: 'failed_restored', mode: 'rehearsal', plan_fingerprint: state.plan || 'plan-rclone', error: 'Import failed; the original source and consumers were restored.', result: { source_restored: true } }
        : { job_id: 'rehearsal-fixture', status: 'rehearsed', mode: 'rehearsal', plan_fingerprint: state.plan || 'plan-rclone', result: { validated: true }, ...(state.importReport ? { import_report: state.importReport } : {}) }
      if (state.reclaimSourceSpace) state.job.source_storage = { mode: 'archive_recovery', reclaim_source_space: true, rollback_requires_archive: true }
      if (state.rehearsalPreviewExpiry) state.job.preview_expires_at = state.rehearsalPreviewExpiry
      return send({ job: state.job })
    }
    if (req.url === `${base}/start`) { state.job = { job_id: 'cutover-fixture', status: 'running', mode: 'cutover', stage: 'importing', message: 'Contained import is running', progress: 40 }; return send({ job: state.job }) }
    if (req.url === `${base}/cancel`) {
      if (state.cancelRejected) { res.statusCode = 409; return send({ detail: 'The native owner is being reconciled. Refresh the retained migration job before retrying.' }) }
      state.job = { ...state.job, cancel_requested: true, can_cancel: false, can_rollback: false, actions: { cancel: false, rollback: false }, stage: 'rolling_back', message: 'Stopping the native worker before source restoration.' }
      return send({ job: state.job })
    }
    if (req.url === `${base}/rollback`) { state.job = { ...state.job, status: 'rolled_back', stage: 'rolled_back', can_cancel: false, can_rollback: false, actions: { cancel: false, rollback: false }, result: { source_restored: true } }; return send({ job: state.job }) }
    if (req.url === `${base}/cleanup/preview`) return send({ protocol: 1, job_id: state.job.job_id, ready: !state.cleanupBlocked, preview_token: 'private-cleanup-token', expires_at: Math.floor(Date.now() / 1000) + (state.cleanupExpired ? -1 : 300), confirmation_text: `RETIRE EXAMPLE V1 ${state.job.job_id}`, targets: [{ roles: ['v1_data', 'v1_runtime'], path: '/data/example-v1', published_paths: ['/example-v1'], entries: 4, logical_bytes: 1024, reclaim_estimate_bytes: 1024 }], kept_backups: [{ role: 'archive', reference: 'dumb-backup://archive/namespace/artifact', kept: true }], rollback_will_be_retired: true, acknowledgements_required: ['playback', 'test_import', 'rollback_retirement'], blockers: state.cleanupBlocked ? ['Current source ownership could not be verified.'] : [], warnings: [] })
    if (req.url === `${base}/cleanup`) {
      state.job = { ...state.job, can_cleanup: false, actions: { cleanup: false, rollback: false }, can_rollback: false, rollback_retired: true, cleanup: { state: 'verifying', message: 'Checking retained archive', deleted_entries: 0, total_entries: 4 } }
      return send({ job: state.job })
    }
    if (req.url === `${base}/jobs/${state.job?.job_id}/report`) {
      if (state.reportOffline) { res.statusCode = 503; return send({ detail: 'The retained native report could not be read.' }) }
      res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.end(state.nativeReport || 'Imported 100 files.\nFiles not carried over:\n/content/example.mkv: Example excluded metadata\n<script>window.reportExecuted=true</script>')
    }
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
  test(`${name}: a long verified rehearsal renews only the matching reviewed token without automatic cutover`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.previewExpiry = Math.floor(Date.now() / 1000) + 300; app.state.rehearsalPreviewExpiry = app.state.previewExpiry + 1800
    let releaseRehearsal, browser
    app.state.rehearsalGate = new Promise(resolve => { releaseRehearsal = resolve })
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage()
      await page.addInitScript(() => { const original = Date.now.bind(Date); Date.now = () => Number.isSafeInteger(window.__migrationNow) ? window.__migrationNow : original() })
      await page.goto(app.origin); await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page)
      const requested = page.waitForRequest(request => request.url().endsWith('/rehearse'))
      await page.getByTestId('v2-rehearse').click(); await requested
      await page.evaluate(now => { window.__migrationNow = now }, (app.state.previewExpiry + 1) * 1000)
      await page.getByText('This preview is blocked or expired.', { exact: false }).waitFor()
      releaseRehearsal()
      await page.getByTestId('v2-job').filter({ hasText: 'rehearsed' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-start"]')?.disabled === false)
      assert.equal(await page.getByTestId('v2-confirmation').inputValue(), 'MIGRATE INFINIDYSK TO V2')
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview')).length, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/start')).length, 0, 'Renewal never starts a cutover')
      await page.getByTestId('v2-start').click()
      await page.getByTestId('v2-job').filter({ hasText: 'cutover-fixture' }).waitFor()
      assert.equal(app.state.calls.find(call => call.path.endsWith('/start')).body.preview_token, 'private-fixture-preview')
    } finally { releaseRehearsal(); await browser?.close(); await app.close() }
  })

  test(`${name}: active migration cancellation stays separate from new work and failed recovery exposes guarded rollback`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.capabilities.infinidysk_v2_cancel = true
    app.state.job = { job_id: 'active-import-fixture', mode: 'rehearsal', status: 'running', stage: 'importing', message: 'Contained native stage: done', import_progress: { stage: 'files', processed: 2, total: 5990, elapsed_seconds: 901, provider_connections: 0, provider_requests: 0 }, can_cancel: true, cancel_requested: false, cancel_confirmation_text: 'CANCEL INFINIDYSK V2 active-import-fixture', can_rollback: false, actions: { cancel: true, rollback: false } }
    let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-cancel-review').waitFor()
      await page.getByTestId('v2-job-explanation').filter({ hasText: 'has not yet completed acceptance or recovery' }).waitFor()
      await page.getByTestId('v2-import-progress').filter({ hasText: '5,990' }).waitFor()
      assert.match(await page.getByTestId('v2-import-progress').innerText(), /Processed records/)
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-rollback').count(), 0)
      await page.getByTestId('v2-cancel-confirmation').fill('CANCEL another job')
      assert.equal(await page.getByTestId('v2-cancel').isDisabled(), true)
      await page.getByTestId('v2-cancel-confirmation').fill(app.state.job.cancel_confirmation_text)
      app.state.cancelRejected = true
      await page.getByTestId('v2-cancel').click()
      await page.getByRole('alert').filter({ hasText: 'native owner is being reconciled' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/cancel')).length, 1)
      assert.equal(app.state.job.cancel_requested, false)
      app.state.cancelRejected = false
      await page.getByTestId('v2-cancel').click()
      await page.getByTestId('v2-job-explanation').filter({ hasText: 'Cancellation was requested' }).waitFor()
      assert.equal(await page.getByTestId('v2-cancel-review').count(), 0)
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      await page.reload()
      await page.getByTestId('v2-job-explanation').filter({ hasText: 'Cancellation was requested' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/cancel')).length, 2, 'Reload never repeats cancellation')
      app.state.job = { ...app.state.job, status: 'recovery_required', stage: 'recovery_required', can_rollback: true, actions: { cancel: false, rollback: true }, rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 active-import-fixture', error: 'The archive mount must be restored before recovery can finish.' }
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-job-explanation').filter({ hasText: 'needs recovery review' }).waitFor()
      await page.getByTestId('v2-rollback').waitFor()
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      await page.getByTestId('v2-rollback-confirmation').fill(app.state.job.rollback_confirmation_text)
      assert.equal(await page.getByTestId('v2-rollback').isEnabled(), true, 'Recovery is not disabled by new-work admission')
      await page.getByTestId('v2-rollback').click()
      await page.getByTestId('v2-job').filter({ hasText: 'rolled_back' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: old APIs explain unavailable cancellation and confirmed orphan recovery remains visible`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.job = { job_id: 'legacy-worker-fixture', status: 'running', stage: 'importing', can_rollback: false }; let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-recovery-unavailable').filter({ hasText: 'does not advertise cooperative migration cancellation' }).waitFor()
      assert.equal(await page.getByTestId('v2-cancel').count(), 0)
      app.state.job = { job_id: 'older-orphan-fixture', status: 'interrupted', stage: 'importing', can_rollback: true, actions: { rollback: true }, rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 older-orphan-fixture' }
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-job').filter({ hasText: 'older-orphan-fixture' }).waitFor()
      await page.getByTestId('v2-rollback').waitFor()
      assert.equal(await page.getByTestId('v2-cancel').count(), 0)
      await page.getByTestId('v2-rollback-confirmation').fill(app.state.job.rollback_confirmation_text)
      assert.equal(await page.getByTestId('v2-rollback').isEnabled(), true)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/cancel')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: expected skipped items require exact report review while provider failures stay blocked`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.capabilities.infinidysk_v2_reviewed_skips = true
    app.state.importReport = { status: 'review_required', imported_files: 100, skipped_files: 1, reasons: [{ reason: 'Example excluded metadata', count: 1 }], skipped: [{ path: '/content/example.mkv', reason: 'Example excluded metadata' }], review_digest: 'a'.repeat(64), review_required: true, blocking_reasons: [], skipped_details_truncated: false, reasons_truncated: false, skipped_details_count: 1, reason_count: 1 }
    let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page)
      await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-import-report').filter({ hasText: 'Skipped items: 1' }).waitFor()
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      await page.getByText('Skipped paths and reasons', { exact: true }).click()
      await page.getByText('/content/example.mkv · Example excluded metadata', { exact: true }).waitFor()
      app.state.reportOffline = true
      await page.getByTestId('v2-load-native-report').click()
      await page.getByRole('alert').filter({ hasText: 'retained native report could not be read' }).waitFor()
      app.state.reportOffline = false
      await page.getByTestId('v2-load-native-report').click()
      await page.getByTestId('v2-full-native-report').filter({ hasText: '<script>window.reportExecuted=true</script>' }).waitFor()
      assert.equal(await page.evaluate(() => window.reportExecuted), undefined, 'Native report content remains inert text')
      const downloading = page.waitForEvent('download')
      await page.getByTestId('v2-download-native-report').click()
      assert.equal((await downloading).suggestedFilename(), 'infinidysk-import-rehearsal-fixture.txt')
      await page.getByTestId('v2-ack-skipped_media').check()
      assert.equal(await page.getByTestId('v2-start').isEnabled(), true)
      app.state.importReport = { ...app.state.importReport, review_digest: 'b'.repeat(64) }
      app.state.job = { ...app.state.job, import_report: app.state.importReport }
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-full-native-report').waitFor({ state: 'detached' })
      assert.equal(await page.getByTestId('v2-ack-skipped_media').isChecked(), false, 'A changed reviewed report needs new consent')
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      app.state.importReport = { ...app.state.importReport, status: 'blocked', review_required: false, blocking_reasons: ['Provider metadata recovery required'] }
      app.state.job = { ...app.state.job, import_report: app.state.importReport }
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-import-report').filter({ hasText: 'Provider metadata recovery required' }).waitFor()
      assert.equal(await page.getByTestId('v2-ack-skipped_media').count(), 0)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      app.state.job = { ...app.state.job, import_report: undefined }
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-import-report').waitFor({ state: 'detached' })
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true, 'A new backend cannot omit diagnostics and reuse the validated flag')
      app.state.importReport = { ...app.state.importReport, status: 'review_required', review_required: true, blocking_reasons: [] }
      app.state.job = { ...app.state.job, import_report: app.state.importReport }
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-ack-skipped_media').check()
      await page.getByTestId('v2-start').click()
      await page.getByTestId('v2-job').filter({ hasText: 'cutover-fixture' }).waitFor()
      const start = app.state.calls.find(call => call.path.endsWith('/start')).body
      assert.equal(start.skip_review_digest, 'b'.repeat(64))
      assert.equal(start.acknowledgements.skipped_media, true)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: local v1 storage reuse requires an archive, explicit recovery consent and an exact backend preview`, { timeout: 60000 }, async () => {
    const app = await fixture(); Object.assign(app.state.capabilities, storageCapabilities, { infinidysk_v2_low_space_migration: true }); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      const reclaim = page.getByTestId('v2-reclaim-source-space')
      await reclaim.waitFor(); assert.equal(await reclaim.isChecked(), false)
      await reclaim.check()
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      const selector = page.getByTestId('backup-storage-selection')
      assert.equal(await selector.isEnabled(), true, 'A missing archive cannot lock the destination selector')
      await selector.selectOption('archive')
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-source-storage-review').waitFor()
      const request = app.state.calls.filter(call => call.path === '/api/process/infinidysk-v2/preview').at(-1).body
      assert.equal(request.reclaim_source_space, true); assert.equal(request.backup_destination_id, 'archive')
      assert.match(await page.getByTestId('v2-source-storage-review').innerText(), /requires its mount to remain available/)
      await acknowledgeMajor(page)
      assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      await page.getByTestId('v2-ack-archive_recovery').check()
      await page.getByTestId('v2-rehearse').click()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-start"]')?.disabled === false)
      await page.getByTestId('v2-archive-recovery-state').filter({ hasText: 'selected archive mount to remain available' }).waitFor()
      await reclaim.uncheck()
      assert.equal(await page.getByTestId('v2-review').count(), 0, 'Changing reuse policy invalidates the prior rehearsal review')
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(await page.getByTestId('v2-ack-archive_recovery').count(), 0)
      assert.equal(app.state.calls.filter(call => call.path === '/api/process/infinidysk-v2/preview').at(-1).body.reclaim_source_space, undefined)
      app.state.dropSourceStorage = true
      await reclaim.check(); await page.getByTestId('v2-preview').click()
      await page.getByRole('alert').filter({ hasText: 'did not confirm the selected local-space' }).waitFor()
      assert.equal(await page.getByTestId('v2-review').count(), 0, 'A silently downgraded response is never reviewed')
      app.state.capabilities.infinidysk_v2_low_space_migration = false
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'cannot confirm the selected storage-reuse option' }).waitFor()
      assert.equal(await reclaim.isChecked(), true, 'Capability loss does not silently change the requested recovery policy')
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      await reclaim.click()
      await page.getByTestId('v2-low-space').waitFor({ state: 'detached' })
      assert.equal(await page.getByTestId('v2-preview').isEnabled(), true)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/start')).length, 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: old backends and fresh installs never offer local v1 storage reuse`, { timeout: 60000 }, async () => {
    const app = await fixture('fresh'); Object.assign(app.state.capabilities, storageCapabilities, { infinidysk_v2_low_space_migration: true }); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').waitFor()
      assert.equal(await page.getByTestId('v2-low-space').count(), 0)
      app.state.capabilities.infinidysk_v2_low_space_migration = false
      await page.reload(); await page.getByTestId('v2-preview').waitFor()
      assert.equal(await page.getByTestId('v2-low-space').count(), 0)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path === '/api/process/infinidysk-v2/preview').at(-1).body.reclaim_source_space, undefined)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: compatibility authentication is a read-only current and target policy, absent on older responses`, { timeout: 60000 }, async () => {
    const app = await fixture('fresh'); let browser
    const policy = { enforced: true, mode: 'required', reason: 'legacy_compatibility_listener' }
    app.state.targetAuthPolicy = policy
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      assert.equal(await page.getByTestId('v2-compatibility-auth-current').count(), 0)
      await page.getByTestId('v2-preview').click()
      const target = page.getByTestId('v2-compatibility-auth-target')
      await target.waitFor()
      assert.match(await target.innerText(), /stored policy unchanged/)
      assert.equal(await target.locator('input, select, button').count(), 0)
      app.state.generation = '2'; app.state.currentAuthPolicy = policy
      await page.reload()
      const current = page.getByTestId('v2-compatibility-auth-current')
      await current.waitFor()
      assert.match(await current.innerText(), /cannot relax this launch requirement/)
      assert.equal(await current.locator('input, select, button').count(), 0)
      delete app.state.currentAuthPolicy
      await page.reload()
      await page.getByText('InfiniDysk 2 is already selected.', { exact: false }).waitFor()
      assert.equal(await page.getByTestId('v2-compatibility-auth-current').count(), 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: production dashboard keeps migration review and recovery readable in light appearances`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture('fresh'); app.state.bootstrap = true
    app.state.installedSource = { schema_version: 1, repository: 'nicocapalbo/dmbdb', source_kind: 'branch', requested_ref: 'dev', commit_sha: 'a'.repeat(40), package_version: frontendPackageVersion }
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
      const uiOrigin = `http://127.0.0.1:${port}`
      const contributorFixtures = new Set(['https://api.github.com/repos/I-am-PUID-0/DUMB/contributors', 'https://api.github.com/repos/nicocapalbo/dmbdb/contributors'])
      await page.route('**/*', route => {
        const url = route.request().url()
        if (new URL(url).origin === uiOrigin) return route.continue()
        if (contributorFixtures.has(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return route.abort()
      })
      const theme = name === 'chromium' ? 'light' : 'retro'
      await page.addInitScript(value => localStorage.setItem('dmbdb.appearance.theme', value), theme)
      await page.goto(`http://127.0.0.1:${port}/`)
      assert.equal(await page.getByTestId('frontend-version').count(), 0)
      await page.goto(`http://127.0.0.1:${port}/settings#about`)
      const about = page.locator('#settings-section-about')
      const frontendRow = about.locator('div').filter({ has: page.getByText('DUMB Frontend', { exact: true }) }).last()
      const frontendVersion = frontendRow.getByTestId('about-service-version').filter({ hasText: `v${frontendPackageVersion} · dev aaaaaaaa` })
      await frontendVersion.waitFor()
      assert.equal(await frontendVersion.getAttribute('title'), `dev · ${'a'.repeat(40)}`)
      await frontendRow.getByTestId('about-dev-build').waitFor()
      assert.equal(await frontendVersion.getAttribute('href'), 'https://github.com/nicocapalbo/dmbdb')
      const apiRow = about.locator('div').filter({ has: page.getByText('DUMB API', { exact: true }) }).last()
      await apiRow.getByTestId('about-service-version').filter({ hasText: 'v2.24.0-dev.3' }).waitFor()
      await apiRow.getByTestId('about-dev-build').waitFor()
      assert.equal(await page.getByTestId('frontend-version').count(), 0)
      await page.goto(`http://127.0.0.1:${port}/`)
      await assertReadable(page.getByTestId('v2-open-major').locator('..').locator('p').first(), `${theme} migration notice`)
      await page.getByTestId('v2-open-major').click(); await page.getByTestId('v2-panel').waitFor()
      await assertReadable(page.getByText('Fresh installation: the backend must verify that no existing library data will be replaced.', { exact: true }), `${theme} installation instructions`)
      app.state.previewBlockers = ['Fixture preview validation blocker']
      app.state.capacity = capacityEstimate()
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await assertReadable(page.getByText('Fixture preview validation blocker', { exact: true }), `${theme} preview blocker`)
      await assertReadable(page.getByText('Fixture independent backup warning', { exact: true }), `${theme} backup warning`)
      await assertReadable(page.getByText('Fixture source review', { exact: true }), `${theme} failed preview check`)
      await assertReadable(page.getByTestId('v2-capacity-filesystem').locator('p').first(), `${theme} capacity shortfall status`)
      await assertReadable(page.getByTestId('v2-capacity').getByText('Required, including safety margin', { exact: true }), `${theme} capacity requirement`)
      app.state.previewBlockers = []
      app.state.capacity = capacityEstimate(true)
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
      Object.assign(app.state.capabilities, storageCapabilities)
      app.state.pgOffline = false; app.state.pgJob = null
      app.state.job = { job_id: 'completed-cutover', status: 'completed', mode: 'cutover', can_cleanup: true, can_rollback: true }
      await page.reload(); await page.getByTestId('v2-open-major').click()
      await page.getByTestId('v2-cleanup-preview').click(); await page.getByTestId('v2-cleanup-review').waitFor()
      await assertReadable(page.getByTestId('v2-cleanup-ack-playback').locator('..'), `${theme} actual playback acknowledgement`)
      await assertReadable(page.getByTestId('v2-cleanup-ack-rollback_retirement').locator('..'), `${theme} rollback retirement acknowledgement`)
      app.state.generation = '1'; app.state.job = null
      await page.evaluate(() => sessionStorage.removeItem('dumb.infinidyskV2.jobs.v1'))
      await page.reload(); await page.getByTestId('v2-open-major').click()
      await page.getByTestId('backup-storage').waitFor()
      await assertReadable(page.getByTestId('backup-storage').getByText('Cold archives may use network storage.', { exact: false }), `${theme} network archive limits`)
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

  test(`${name}: storage selection is explicit, changes invalidate rehearsal, and profile/default writes require Save`, { timeout: 60000 }, async () => {
    const app = await fixture(); Object.assign(app.state.capabilities, storageCapabilities); let browser
    let releaseCapabilities
    let releaseCatalog
    app.state.capabilitiesGate = new Promise(resolve => { releaseCapabilities = resolve })
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      const selector = page.getByTestId('backup-storage-selection')
      assert.equal(await selector.count(), 0, 'The selector stays hidden until capabilities arrive')
      const selectorReady = selector.waitFor({ state: 'visible' })
      releaseCapabilities()
      await selectorReady
      await page.waitForFunction(() => document.querySelector('[data-testid="backup-storage-selection"]')?.disabled === false)
      assert.equal(await selector.inputValue(), '', 'An existing global default is not implicit adoption')
      await selector.selectOption('archive')
      await page.getByText('Last registration check:', { exact: false }).waitFor()
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-backup-storage-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview') && call.path.includes('infinidysk-v2')).at(-1).body.backup_destination_id, 'archive')
      assert.match(await page.getByTestId('v2-backup-storage-review').innerText(), /working candidate stay local/)
      await acknowledgeMajor(page); await page.getByTestId('v2-rehearse').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-start"]').disabled)
      await selector.selectOption('@default')
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-ack-backup').isChecked(), false)
      await page.getByText('Register a backup destination', { exact: true }).click()
      await page.getByTestId('backup-storage-id').fill('second_archive')
      await page.getByTestId('backup-storage-name').fill('Second archive')
      await page.getByTestId('backup-storage-path').fill('/mnt/second-backups')
      app.state.storageBlocked = true
      await page.getByTestId('backup-storage-preview').click()
      await page.getByText('Destination mount could not be confirmed.', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('backup-storage-register').isDisabled(), true)
      app.state.storageBlocked = false
      await page.getByTestId('backup-storage-preview').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="backup-storage-register"]').disabled)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/profiles') || call.path.endsWith('/default')).length, 0)
      await page.getByTestId('backup-storage-register').click()
      await page.getByText('Destination registered. Existing service paths and defaults were preserved.', { exact: true }).waitFor()
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await page.getByTestId('backup-storage-default').selectOption('second_archive')
      assert.equal(await page.getByTestId('v2-review').count(), 1, 'Editing a default draft does not save it')
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/default')).length, 0)
      app.state.catalogGate = new Promise(resolve => { releaseCatalog = resolve })
      const catalogReloaded = page.waitForResponse(response => response.url() === `${app.origin}/api/process/backup-storage` && response.request().method() === 'GET')
      await page.getByTestId('backup-storage-save-default').click()
      await page.getByText('Global default saved. Only selections using the global default adopt it.', { exact: true }).waitFor()
      releaseCatalog()
      await catalogReloaded
      await page.getByTestId('v2-review').waitFor({ state: 'detached' })
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/profiles')).length, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/default')).length, 1)
      assert.equal(await page.getByTestId('v2-review').count(), 0, 'A changed catalog invalidates the reviewed selection')
    } finally { releaseCapabilities(); releaseCatalog?.(); await browser?.close(); await app.close() }
  })

  test(`${name}: old installation cleanup requires exact job review and human playback/import validation`, { timeout: 60000 }, async () => {
    const app = await fixture(); Object.assign(app.state.capabilities, storageCapabilities); app.state.generation = '2'
    app.state.job = { job_id: 'completed-cutover', status: 'completed', mode: 'cutover', can_cleanup: true, can_rollback: true, rollback_confirmation_text: 'ROLLBACK EXAMPLE' }
    let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-cleanup-preview').click(); await page.getByTestId('v2-cleanup-review').waitFor()
      assert.match(await page.getByTestId('v2-cleanup-review').innerText(), /\/data\/example-v1/)
      assert.equal(await page.getByTestId('v2-cleanup-review').locator('input[type="checkbox"]').count(), 3, 'There is no delete-backups toggle')
      await page.getByTestId('v2-cleanup-ack-playback').check()
      await page.getByTestId('v2-cleanup-ack-test_import').check()
      await page.getByTestId('v2-cleanup-confirmation').fill('RETIRE EXAMPLE V1 completed-cutover')
      assert.equal(await page.getByTestId('v2-cleanup-start').isDisabled(), true)
      await page.getByTestId('v2-cleanup-ack-rollback_retirement').check()
      assert.equal(await page.getByTestId('v2-cleanup-start').isEnabled(), true)
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      assert.equal(await page.getByTestId('v2-cleanup-confirmation').inputValue(), 'RETIRE EXAMPLE V1 completed-cutover', 'Unchanged polling does not erase review')
      app.state.cleanupExpired = true
      await page.getByTestId('v2-cleanup-preview').click()
      for (const key of ['playback', 'test_import', 'rollback_retirement']) await page.getByTestId(`v2-cleanup-ack-${key}`).check()
      await page.getByTestId('v2-cleanup-confirmation').fill('RETIRE EXAMPLE V1 completed-cutover')
      assert.equal(await page.getByTestId('v2-cleanup-start').isDisabled(), true)
      app.state.cleanupExpired = false
      await page.getByTestId('v2-cleanup-preview').click()
      for (const key of ['playback', 'test_import', 'rollback_retirement']) await page.getByTestId(`v2-cleanup-ack-${key}`).check()
      await page.getByTestId('v2-cleanup-confirmation').fill('RETIRE EXAMPLE V1 completed-cutover')
      await page.getByTestId('v2-cleanup-start').click()
      await page.getByTestId('v2-cleanup-progress').filter({ hasText: 'Checking retained archive' }).waitFor()
      assert.equal(await page.getByTestId('v2-cleanup-preview').isDisabled(), true)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/cleanup')).length, 1)
      await page.reload()
      await page.getByTestId('v2-cleanup-progress').waitFor()
      assert.equal(await page.getByTestId('v2-cleanup-preview').isDisabled(), true)
      await page.goto(`${app.origin}/?postgres`)
      await page.getByTestId('v2-pg-preview').waitFor()
      assert.equal(await page.getByTestId('v2-pg-preview').isDisabled(), true, 'Provider changes wait for active cleanup')
      assert.equal(app.state.calls.some(call => /drop|unmount|delete-backup/.test(call.path)), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: capacity review explains shared space and never enables a blocked migration`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(await page.getByTestId('backup-storage').count(), 0)
      assert.equal(await page.getByTestId('v2-low-space').count(), 0, 'Older backends cannot opt into source storage reuse')
      assert.equal(await page.getByTestId('v2-cleanup').count(), 0)
      assert.equal(app.state.calls.some(call => call.path.includes('/backup-storage')), false)
      assert.equal(await page.getByTestId('v2-capacity').count(), 0, 'Older protocol 1 previews need no capacity field')
      app.state.capacity = capacityEstimate()
      app.state.previewBlockers = ['Insufficient estimated free space; no copy was started.']
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-capacity').waitFor()
      assert.equal(await page.getByTestId('v2-capacity-filesystem').count(), 1)
      const summary = await page.getByTestId('v2-capacity').innerText()
      assert.match(summary, /350,000 entries · 64 GiB logical size · 1 unique source root/)
      for (const text of ['Retained backups · Candidate installation', '150 GiB', '100 GiB', '50 GiB', '10 GiB', 'estimates, not a space reservation']) assert.ok(summary.includes(text), text)
      await acknowledgeMajor(page)
      assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      app.state.capacity = capacityEstimate(true); app.state.previewBlockers = []
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-capacity-filesystem').filter({ hasText: 'Enough estimated space' }).waitFor()
      await acknowledgeMajor(page)
      assert.equal(await page.getByTestId('v2-rehearse').isEnabled(), true)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true, 'Capacity does not replace the matching rehearsal')
      app.state.capacity = { ...capacityEstimate(), status: 'unavailable', complete: false }
      app.state.previewBlockers = ['Source inventory could not be completed.']
      await page.getByTestId('v2-preview').click()
      await page.getByText('A complete capacity estimate is unavailable.', { exact: false }).waitFor()
      const unknown = await page.getByTestId('v2-capacity').innerText()
      assert.ok(unknown.includes('Unknown'))
      assert.doesNotMatch(unknown, /150 GiB|100 GiB|50 GiB|350,000|Enough estimated space/)
      await acknowledgeMajor(page)
      assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      assert.equal(app.state.calls.filter(call => /\/(start|rehearse)$/.test(call.path)).length, 0)
    } finally { await browser?.close(); await app.close() }
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
      await page.getByTestId('v2-job').filter({ hasText: 'rehearsed' }).waitFor()
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

  test(`${name}: failed_restored rehearsal permits a fresh review and successful retry`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.rehearsalFailed = true; let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page)
      await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-job').filter({ hasText: 'failed_restored' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-preview"]')?.disabled === false)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      const previews = app.state.calls.filter(call => call.path.endsWith('/preview')).length
      app.state.rehearsalFailed = false
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview')).length, previews + 1)
      assert.equal(await page.getByTestId('v2-ack-backup').isChecked(), false)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      await acknowledgeMajor(page); await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-job').filter({ hasText: 'rehearsed' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-start"]')?.disabled === false)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rehearse')).length, 2)
      await page.getByTestId('v2-start').click()
      await page.getByTestId('v2-job').filter({ hasText: 'cutover-fixture' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/start')).length, 1)
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
