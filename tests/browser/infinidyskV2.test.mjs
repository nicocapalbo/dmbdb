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
const preparedReport = { status: 'accepted', imported_files: 2, skipped_files: 0, review_required: false, reasons: [], skipped: [], blocking_reasons: [], reason_count: 0, skipped_details_count: 0, reasons_truncated: false, skipped_details_truncated: false }
const storageCapabilities = { backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['symlink_manifest', 'infinidysk_v2_archive'], infinidysk_v2_migration_backup_storage: true, infinidysk_v2_cleanup: true, infinidysk_v2_cleanup_protocol: 1 }
const consumerCapabilities = { infinidysk_v2_consumer_recovery: true, infinidysk_v2_consumer_recovery_protocol: 1 }
const stageRetryCapabilities = { infinidysk_v2_stage_retry: true, infinidysk_v2_stage_retry_protocol: 1 }
const stageRetryJob = (attempt = 1) => ({
  job_id: 'paused-step-fixture', mode: 'prepare', prepare_mode: 'migrate', status: 'stage_retry_required', stage: 'verifying_archive', created_at: Math.floor(Date.now() / 1000) - 3600,
  error: 'The archive read could not finish.', can_retry_stage: true, can_cancel: true, cancel_requested: false,
  actions: { retry_stage: true, cancel: true }, cancel_confirmation_text: 'CANCEL INFINIDYSK V2 paused-step-fixture',
  stage_retry: { protocol: 1, operation: 'verify_archive', stage: 'verifying_archive', label: 'Verify the recovery archive', attempt, state: 'waiting', failed_at: Math.floor(Date.now() / 1000), message: 'Reconnect the selected migration storage. api_key=fixture-secret' },
  confirmation_texts: { retry_stage: `RETRY INFINIDYSK V2 STAGE paused-step-fixture nonce-${attempt}` },
  stage_progress: stageProgress('save_recovery', 'failed'),
})
const consumerRecoveryJob = () => ({
  job_id: 'consumer-recovery-fixture', mode: 'cutover', status: 'recovery_required', recovery_kind: 'v2_consumers', activation_exposed: true, activation_committed: true,
  can_retry_consumers: true, can_finish_consumer_recovery: true, can_cancel: false, can_rollback: false, actions: { cancel: false, rollback: false },
  result: { validated: true, generation_2_started: true },
  confirmation_texts: { retry_consumers: 'RETRY CONSUMERS consumer-recovery-fixture', finish_consumer_recovery: 'FINISH CONSUMER RECOVERY consumer-recovery-fixture' },
  consumer_recovery: { ready: true, failed: [{ process_name: 'Example Sonarr', reason_code: 'start_failed', message: 'The retained process did not start. api_key=fixture-secret' }], pending: ['Example Sonarr', 'Example Prowlarr'], resumed: ['Example Radarr'] },
})
const capacityEstimate = (sufficient = false) => ({
  status: sufficient ? 'sufficient' : 'insufficient', complete: true, estimated: true, reserved: false, observed_at: Math.floor(Date.now() / 1000),
  source: { entries: 350000, logical_bytes: 64 * 1024 ** 3, root_count: 1 },
  filesystems: [{ id: 'filesystem_1', roles: ['retained_backup', 'candidate'], base_required_bytes: 140 * 1024 ** 3, safety_margin_bytes: 10 * 1024 ** 3, required_bytes: 150 * 1024 ** 3, free_bytes: (sufficient ? 200 : 100) * 1024 ** 3, shortfall_bytes: (sufficient ? 0 : 50) * 1024 ** 3, sufficient }],
})
const entry = `
import { createApp, ref, h } from 'vue';
import Major from '~/components/InfiniDyskV2Panel.vue';
import Postgres from '~/components/InfiniDyskV2PostgresPanel.vue';
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js';
const states = new Map();
window.useState = (key, init) => { if (!states.has(key)) states.set(key, ref(init())); return states.get(key); };
window.fixtureRefreshSettled = () => useInfiniDyskV2State().refresh({ force: true });
createApp({ setup() { const open = ref(true); window.fixtureReset = () => useInfiniDyskV2State().reset(); window.fixtureOpen = () => { open.value = true; }; return () => h(new URLSearchParams(location.search).has('postgres') ? Postgres : Major, { open: open.value, onClose: () => { open.value = false; } }); } }).mount('#app');
`
let bundle
const stagedCapacityEstimate = () => ({
  status: 'sufficient', complete: true, estimated: true, reserved: false, release_is_projected: true,
  source: { entries: 350000, logical_bytes: 64 * 1024 ** 3, root_count: 1 },
  filesystems: [
    { id: 'local_before', filesystem_id: 'filesystem_1', phase: 'before_blob_release', roles: ['external_blob_manifest'], base_required_bytes: 2 * 1024 ** 3, safety_margin_bytes: 256 * 1024 ** 2, required_bytes: 2 * 1024 ** 3 + 256 * 1024 ** 2, free_bytes: 20 * 1024 ** 3, projected_released_bytes: 0, projected_available_bytes: 20 * 1024 ** 3, shortfall_bytes: 0, sufficient: true },
    { id: 'external_before', filesystem_id: 'filesystem_2', phase: 'before_blob_release', roles: ['cold_archive', 'external_blob_staging'], base_required_bytes: 120 * 1024 ** 3, safety_margin_bytes: 12 * 1024 ** 3, required_bytes: 132 * 1024 ** 3, free_bytes: 2 * 1024 ** 4, projected_released_bytes: 0, projected_available_bytes: 2 * 1024 ** 4, shortfall_bytes: 0, sufficient: true },
    { id: 'local_after', filesystem_id: 'filesystem_1', phase: 'after_blob_release', roles: ['native_import_growth'], base_required_bytes: 60 * 1024 ** 3, safety_margin_bytes: 6 * 1024 ** 3, required_bytes: 66 * 1024 ** 3, free_bytes: 20 * 1024 ** 3, projected_released_bytes: 64 * 1024 ** 3, projected_available_bytes: 84 * 1024 ** 3, shortfall_bytes: 0, sufficient: true },
  ],
})

const stageProgress = (current = 'native_import', state = 'running') => {
  const ids = ['check_plan', 'pause_services', 'source_database', 'save_recovery', 'prepare_input', 'native_import', 'validate_import', 'review', 'activate', 'resume_services']
  return { protocol: 1, tracking: 'recorded', current_step_id: current,
    steps: ids.map((id, index) => ({ id, state: index < ids.indexOf(current) ? 'completed' : id === current ? state : 'pending' })) }
}
const recoveryStageProgress = (state = 'running') => {
  const progress = stageProgress('activate', 'failed')
  progress.steps = progress.steps.map(step => step.state === 'pending' ? { ...step, state: 'not_run' } : step)
  progress.steps.push({ id: 'restore_v1', state }); progress.current_step_id = 'restore_v1'
  return progress
}
const storageWork = () => {
  const leg = (id, read, write, extra = {}) => ({ id, read_bytes: read, write_bytes: write, storage: 'local', passes: 1, minimum: false, ...extra })
  const restoration = () => [leg('archive_restore_checks', 140 * 1024 ** 3, 0, { storage: 'archive', passes: 2, minimum: true }),
    leg('archive_restore', 70 * 1024 ** 3, 60 * 1024 ** 3, { storage: 'archive', minimum: true }), leg('restored_readback', 60 * 1024 ** 3, 0)]
  return { protocol: 1, comparison_basis: 'logical_io_same_storage', ranking: 'not_estimated', selected_path: 'external_blobs',
    archive_storage_type: 'network', archive_required: true, archive_bytes: 70 * 1024 ** 3, archive_bytes_is_minimum: true,
    source_data_bytes: 60 * 1024 ** 3, source_total_bytes: 70 * 1024 ** 3, legacy_blob_bytes: 50 * 1024 ** 3,
    paths: [
      { id: 'keep_local', selected: false, preparation_order: null, requires_registered_archive: false,
        preparation: [leg('candidate_copy', 60 * 1024 ** 3, 60 * 1024 ** 3), leg('retained_source_check', 60 * 1024 ** 3, 0)],
        activation: [leg('retained_source_check', 60 * 1024 ** 3, 0)], restoration: [] },
      { id: 'reuse_local', selected: false, preparation_order: null, requires_registered_archive: true,
        preparation: [leg('archive_reuse_checks', 140 * 1024 ** 3, 0, { storage: 'archive', passes: 2, minimum: true })],
        activation: [leg('archive_acceptance', 70 * 1024 ** 3, 0, { storage: 'archive', minimum: true })],
        restoration: restoration() },
      { id: 'external_blobs', selected: true, preparation_order: null, requires_registered_archive: true,
        preparation: [leg('archive_reuse_checks', 210 * 1024 ** 3, 0, { storage: 'archive', passes: 3, minimum: true }),
          leg('blob_copy', 50 * 1024 ** 3, 50 * 1024 ** 3, { storage: 'archive' }), leg('blob_readback', 150 * 1024 ** 3, 0, { storage: 'archive', passes: 3 })],
        activation: [leg('archive_acceptance', 70 * 1024 ** 3, 0, { storage: 'archive', minimum: true })], restoration: restoration() },
    ] }
}

const fixture = async (scenario = 'major') => {
  bundle ||= await buildVueComponentHarness(entry)
  const state = { scenario, generation: scenario === 'postgres' ? '2' : '1', capabilities: { ...capabilities }, job: null, pgJob: null, calls: [], stale: false, syncing: false }
  state.catalog = { protocol: 1, default_destination_id: 'archive', destinations: [{ id: 'archive', name: 'Example archive', path: '/mnt/backups', enabled: true, registered: true, ready: true, storage_type: 'network', filesystem_type: 'nfs', last_checked_at: 1700000000, blockers: [] }] }
  const majorPreview = body => {
    state.reclaimSourceSpace = body.reclaim_source_space === true
    state.offloadLegacyBlobs = body.offload_legacy_blobs === true
    state.omitQueuedDownloads = body.omit_queued_downloads === true
    state.plan = `plan-${body.mount_backend}${body.backup_destination_id ? `-${body.backup_destination_id}` : ''}${body.reclaim_source_space ? '-reclaim' : ''}${body.offload_legacy_blobs ? '-offload' : ''}`
    if (state.omitQueuedDownloads) state.plan += '-omit-queue'
    const sourceQueue = state.queueCount === undefined ? undefined : { policy: state.omitQueuedDownloads ? 'omit_from_v2' : 'require_empty', observed_count: state.queueCount, observed_at: state.queueCount === null ? null : Math.floor(Date.now() / 1000), observation: state.queueCount === null ? 'unavailable' : 'live', omitted_count: null, source_queue_preserved: true }
    const previewBlockers = [...(state.previewBlockers || []), ...(sourceQueue?.observed_count > 0 && !state.omitQueuedDownloads ? ['The source queue contains ' + sourceQueue.observed_count + ' queued downloads. Finish them or explicitly continue without queued downloads.'] : [])]
    return { protocol: 1, ready: !previewBlockers.length, preview_token: 'private-fixture-preview', plan_fingerprint: state.plan, source_queue: sourceQueue, expires_at: state.previewExpiry ?? Math.floor(Date.now() / 1000) + 300, confirmation_text: body.mode === 'fresh' ? 'INSTALL INFINIDYSK V2' : 'MIGRATE INFINIDYSK TO V2', current: { mount_backend: 'rclone', mount_path: '/mnt/debrid/infinidysk' }, target: { mount_backend: body.mount_backend, mount_path: '/mnt/debrid/infinidysk', compatibility_auth_policy: state.targetAuthPolicy }, inventory: { symlinks: 25, consumers: ['arr', 'media'] }, capacity: state.capacity, backup_storage: body.backup_destination_id ? { mode: 'cold_archive', name: 'Example archive', path: '/mnt/backups', control_state_local: true, candidate_local: true, backups_retained: true } : undefined, source_storage: body.reclaim_source_space && !state.dropSourceStorage ? { mode: 'archive_recovery', reclaim_source_space: true, rollback_requires_archive: true, ...(body.offload_legacy_blobs && !state.dropOffloadEcho ? { offload_legacy_blobs: true } : {}) } : undefined, blockers: previewBlockers, warnings: state.previewWarnings || ['Fixture independent backup warning'], checks: [{ label: 'Fixture source review', passed: !(state.previewBlockers || []).length }], required_acknowledgements: ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream', ...(body.reclaim_source_space ? ['archive_recovery'] : []), ...(body.offload_legacy_blobs ? ['external_blob_staging'] : [])], rehearsal_required: body.mode !== 'fresh' }
  }
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
    if (req.url === base + '/status' && state.majorStatusOffline) { res.statusCode = 503; return send({ detail: 'Fixture migration status unavailable' }) }
    if (req.url === '/api/auth/status') return send({ enabled: false, has_users: true })
    if (req.url === '/api/process/processes') return send({ processes: [{ process_name: 'DUMB API', config_key: 'dumb', version: 'v2.24.0-dev.3', repo_url: 'https://github.com/I-am-PUID-0/DUMB', config: { enabled: true, onboarding_completed: state.onboardingCompleted !== false } }, ...(state.installedSource ? [{ process_name: 'DUMB Frontend', config_key: 'dumb_frontend', version: `v${frontendPackageVersion}`, repo_url: 'https://github.com/nicocapalbo/dmbdb', config: { enabled: true }, installed_source: state.installedSource }] : []), ...(state.services || [])] })
    if (req.url.startsWith('/api/process/?')) {
      const processName = new URL(req.url, 'http://fixture.invalid').searchParams.get('process_name')
      return send((state.services || []).find(service => service.process_name === processName) || {})
    }
    if (req.url.startsWith('/api/process/service-status?')) {
      const processName = new URL(req.url, 'http://fixture.invalid').searchParams.get('process_name')
      if ((state.serviceStatusOffline || []).includes(processName)) { res.statusCode = 503; return send({ detail: 'Fixture service status unavailable' }) }
      const status = state.serviceStatuses?.[processName] || 'running'
      return send({ process_name: processName, status, healthy: status === 'running' ? true : null, health_status: status === 'running' ? 'healthy' : null })
    }
    if (req.url === '/api/config/onboarding-status') return send({ needs_onboarding: state.onboardingCompleted === false, completed: state.onboardingCompleted !== false, onboarding_completed: state.onboardingCompleted !== false })
    if (req.url === '/api/config/onboarding-completed') { state.onboardingCompleted = true; return send({ completed: true }) }
    if (req.url === '/api/config/' && state.onboardingCatalog) return send({ dumb: { onboarding_completed: state.onboardingCompleted !== false }, infinidysk: { enabled: false } })
    if (req.url === '/api/config/service-ui' && state.onboardingCatalog) return send({ enabled: true, services: [] })
    if (req.url === '/api/process/core-services' && state.onboardingCatalog) return send({ core_services: state.onboardingCatalog })
    if (req.url.startsWith('/api/process/optional-services') && state.onboardingCatalog) return send({ optional_services: [] })
    if (req.url === '/api/health') return send({ status: state.onboardingCatalog ? 'healthy' : 'ok' })
    if (req.url === '/api/process/startup-status') return send(state.startup || { phase: 'ready', terminal: true, expected_services: [], services: {} })
    if (req.url === '/api/process/capabilities') {
      await state.capabilitiesGate
      return send(state.capabilities)
    }
    if (state.setupRun && req.url.startsWith('/api/process/setup/runs/')) {
      const pathname = new URL(req.url, 'http://fixture.invalid').pathname
      const prefix = '/api/process/setup/runs/'
      const suffix = pathname.slice(prefix.length)
      if (req.method === 'GET' && ['latest', state.setupRun.run_id].includes(suffix)) return send(state.setupRun)
      if (req.method === 'POST' && suffix === state.setupRun.run_id + '/recheck') return send(state.setupRun)
      const actionPrefix = state.setupRun.run_id + '/actions/'
      if (req.method === 'POST' && suffix.startsWith(actionPrefix)) {
        const action = state.setupRun.actions.find(item => item.id === decodeURIComponent(suffix.slice(actionPrefix.length)))
        if (!action) { res.statusCode = 404; return send({ detail: 'The requested setup action was not found.' }) }
        if (body?.operation === 'confirm') {
          Object.assign(action, { execution: 'applied', verification: 'not_checked', deferred_by_user: false,
            evidence: { level: 'user_attested' }, reason: 'You confirmed this step in the app.' })
        } else if (body?.operation === 'recheck') {
          action.deferred_by_user = false
        } else { res.statusCode = 400; return send({ detail: 'This fixture supports explicit recheck and manual confirmation only.' }) }
        return send(state.setupRun)
      }
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
    if (req.url === `${base}/status`) {
      if (state.majorStatusOffline) { res.statusCode = 503; return send({ detail: 'Migration status is temporarily unavailable.' }) }
      return send({ protocol: 1, runtime_generation: state.generation, mode: state.majorMode || (scenario === 'fresh' ? 'fresh' : 'migrate'), current: { mount_backend: 'rclone', mount_path: '/mnt/debrid/infinidysk', compatibility_auth_policy: state.currentAuthPolicy }, supported_mount_backends: ['rclone', 'fuse'], eligibility: { ready: !(state.blockers || []).length, blockers: state.blockers || [] }, job: state.job, ...(state.capabilities.infinidysk_v2_async_preview === true ? { preview_task: state.previewTask || null } : {}) })
    }
    if (req.url === base + '/preview') {
      await state.syncPreviewGate
      if (state.previewHttpFailure) { res.statusCode = state.previewHttpFailure; return res.end('<html>private response token=fixture-secret</html>') }
      return send({ ...majorPreview(body), stage_plan: state.stagePlan, storage_work: state.storageWork })
    }
    if (req.url === base + '/preview/start') {
      if (state.previewTask?.request_id !== body.request_id && !['queued', 'running'].includes(state.previewTask?.status)) {
        const options = Object.fromEntries(Object.entries(body).filter(([key]) => ['mode', 'mount_backend', 'import_strategy', 'backup_destination_id', 'use_default_backup_destination', 'reclaim_source_space', 'offload_legacy_blobs', 'omit_queued_downloads'].includes(key)))
        const created = Date.now() / 1000
        state.previewTask = { task_id: 'a'.repeat(32), request_id: body.request_id, status: 'running', stage: 'inventory', message: 'Inspecting v1 state without stopping services.',
          options, options_fingerprint: 'f'.repeat(64), created_at: created - (state.previewElapsed || 0), updated_at: created,
          can_cancel: true, cancel_requested: false, preview_available: false, preview: null,
          progress: { entries: 1200, logical_bytes: 1024 ** 3 } }
        state.previewScans = (state.previewScans || 0) + 1
      }
      if (state.dropPreviewStartResponse) { res.statusCode = 504; return send({ detail: 'The proxy did not return the accepted preview response.' }) }
      await state.previewStartGate
      return send({ protocol: 1, task: state.previewTask })
    }
    if (req.url === base + '/preview/task' || req.url === base + '/preview/task/' + 'a'.repeat(32)) {
      await state.previewStatusGate
      if (state.previewStatusOffline) { res.statusCode = 503; return send({ detail: 'Preview status unavailable api_key=fixture-secret' }) }
      return send({ protocol: 1, task: state.previewTask || null })
    }
    if (req.url === base + '/preview/task/' + 'a'.repeat(32) + '/cancel') {
      state.previewTask = { ...state.previewTask, status: state.previewCancelImmediate ? 'cancelled' : 'running', can_cancel: false, cancel_requested: true, updated_at: Date.now() / 1000 }
      return send({ protocol: 1, task: state.previewTask })
    }
    if (req.url === `${base}/prepare`) {
      state.job = { job_id: 'prepared-fixture', mode: 'prepare', prepare_mode: scenario === 'fresh' ? 'fresh' : 'migrate', status: state.prepareRunning ? 'running' : 'prepared', stage: state.prepareRunning ? 'revalidating' : 'awaiting_activation',
        plan_fingerprint: state.plan, result: { validated: !state.prepareRunning }, can_activate: !state.prepareRunning, can_rollback: !state.prepareRunning, can_cancel: false,
        activate_confirmation: 'ACTIVATE INFINIDYSK V2 prepared-fixture', rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 prepared-fixture',
        import_report: state.omitPreparedReport ? undefined : state.importReport || preparedReport, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) }
      await state.prepareGate
      if (state.dropPrepareResponse) { res.statusCode = 504; return send({ detail: 'The proxy lost the accepted preparation response.' }) }
      return send({ job: state.job })
    }
    if (req.url === `${base}/activate`) {
      if (body.job_id !== state.job.job_id || body.confirmation !== state.job.activate_confirmation) { res.statusCode = 409; return send({ detail: 'Review the exact prepared candidate.' }) }
      if (state.job.import_report?.review_required && (body.acknowledgements?.skipped_media !== true || body.skip_review_digest !== state.job.import_report.review_digest)) { res.statusCode = 409; return send({ detail: 'Review the current skipped items.' }) }
      state.job = { ...state.job, status: 'running', stage: 'activating', can_activate: false, can_rollback: false, updated_at: Math.floor(Date.now() / 1000) }
      if (state.job.stage_progress) state.job.stage_progress = stageProgress('activate')
      await state.activateGate
      if (state.dropActivateResponse) { res.statusCode = 504; return send({ detail: 'The proxy lost the accepted activation response.' }) }
      return send({ job: state.job })
    }
    if (req.url === `${base}/rehearse`) {
      if (state.acceptRehearsalBeforeResponse) state.job = { job_id: 'accepted-test-fixture', status: 'running', stage: 'revalidating', mode: 'rehearsal', plan_fingerprint: state.plan, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) }
      await state.rehearsalGate
      if (state.dropRehearsalResponse) { res.statusCode = 504; return send({ detail: 'The proxy did not return the accepted test response.' }) }
      if (state.acceptRehearsalBeforeResponse) return send({ job: state.job })
      if (state.stale) { res.statusCode = 409; return send({ detail: 'Preview expired. https://example.invalid/.ids/private?token=hidden' }) }
      state.job = state.rehearsalFailed
        ? { job_id: 'restored-rehearsal-fixture', status: 'failed_restored', mode: 'rehearsal', plan_fingerprint: state.plan || 'plan-rclone', error: state.rehearsalFailureError || 'Import failed; the original source and consumers were restored.', result: { source_restored: true } }
        : { job_id: 'rehearsal-fixture', status: 'rehearsed', mode: 'rehearsal', plan_fingerprint: state.plan || 'plan-rclone', result: { validated: true }, ...(state.importReport ? { import_report: state.importReport } : {}) }
      if (state.reclaimSourceSpace) state.job.source_storage = { mode: 'archive_recovery', reclaim_source_space: true, rollback_requires_archive: true, ...(state.offloadLegacyBlobs ? { offload_legacy_blobs: true } : {}) }
      if (state.rehearsalPreviewExpiry) state.job.preview_expires_at = state.rehearsalPreviewExpiry
      if (state.queueCount !== undefined) state.job.source_queue = { policy: state.omitQueuedDownloads ? 'omit_from_v2' : 'require_empty', observed_count: state.capturedQueueCount ?? state.queueCount, observed_at: Math.floor(Date.now() / 1000), observation: 'captured', omitted_count: state.omitQueuedDownloads ? (state.capturedQueueCount ?? state.queueCount) : 0, source_queue_preserved: true, private_ids: ['queue-private-fixture-id'], private_digest: 'queue-private-digest' }
      return send({ job: state.job })
    }
    if (req.url === `${base}/start`) { state.job = { job_id: 'cutover-fixture', status: 'running', mode: 'cutover', stage: 'importing', message: 'Contained import is running', progress: 40 }; return send({ job: state.job }) }
    if (req.url === `${base}/cancel`) {
      if (state.cancelRejected) { res.statusCode = 409; return send({ detail: 'The native owner is being reconciled. Refresh the retained migration job before retrying.' }) }
      state.job = { ...state.job, cancel_requested: true, can_cancel: false, can_rollback: false, actions: { cancel: false, rollback: false }, ...(state.job.status === 'stage_retry_required' ? {} : { stage: 'rolling_back' }), message: 'Stopping the native worker before source restoration.' }
      return send({ job: state.job })
    }
    if (req.url === `${base}/retry-stage`) {
      if (body.job_id !== state.job?.job_id || body.confirmation !== state.job?.confirmation_texts?.retry_stage || state.job?.status !== 'stage_retry_required') { res.statusCode = 409; return send({ detail: 'The paused step changed; review its current authorization.' }) }
      state.job = { ...state.job, status: 'running', error: '', can_retry_stage: false, actions: { ...state.job.actions, retry_stage: false },
        stage_retry: { ...state.job.stage_retry, state: 'retrying' }, stage_progress: stageProgress('save_recovery') }
      if (state.stageRetryFailsAgain) { state.job = stageRetryJob(state.job.stage_retry.attempt + 1); state.stageRetryFailsAgain = false }
      if (state.dropStageRetryResponse) { res.statusCode = 504; return send({ detail: 'The proxy lost the accepted retry response.' }) }
      return send({ job: state.job })
    }
    if (req.url === `${base}/retry-consumers`) {
      if (state.retryRejected) { res.statusCode = 409; return send({ detail: 'The owned v2 runtime could not yet be verified. Keep its retained data.' }) }
      state.job = { ...state.job, status: 'recovery_required', recovery_kind: 'v2_consumers', activation_committed: true, consumer_recovery: { ...state.job.consumer_recovery, ready: true }, can_finish_consumer_recovery: true }
      return send({ job: state.job })
    }
    if (req.url === `${base}/finish-consumer-recovery`) {
      if (body.acknowledge_pending_consumers !== true) { res.statusCode = 409; return send({ detail: 'Review the pending consumers before finishing.' }) }
      state.job = { ...state.job, status: 'completed', stage: 'completed', can_retry_consumers: false, can_finish_consumer_recovery: false, result: { ...state.job.result, validated: true, generation_2_started: true } }
      return send({ job: state.job })
    }
    if (req.url === `${base}/rollback`) {
      if (state.job.rollback_requires_discard_ack === true && body.acknowledge_discard_v2_writes !== true) { res.statusCode = 409; return send({ detail: 'Acknowledge discarding v2 writes before rollback.' }) }
      state.job = { ...state.job, status: 'rolled_back', stage: 'rolled_back', can_cancel: false, can_rollback: false, actions: { cancel: false, rollback: false }, result: { source_restored: true } }; return send({ job: state.job })
    }
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
      await state.pgStatusGate
      if (state.pgOffline) { res.statusCode = 503; return send({ detail: 'Native state unavailable' }) }
      return send({ protocol: 1, provider: state.pgProvider ?? (state.pgJob?.status === 'completed' ? 'postgres' : 'sqlite'), job: state.pgJob, ready: true, actions: { start: !state.pgJob || state.pgJob.status === 'cancelled', cutover: state.syncing && state.pgJob?.status !== 'completed', cancel: state.pgJob?.status === 'copying', rollback: state.pgJob?.status === 'completed' }, confirmation_texts: { cutover: 'SWITCH TO POSTGRESQL', cancel: 'EMPTY MIGRATION TARGET', rollback: 'RESTORE SQLITE SNAPSHOT' } })
    }
    if (req.url === `${base}/postgres/preview`) {
      if (state.pgPreviewError) { res.statusCode = 409; return send({ detail: state.pgPreviewError }) }
      return send({ protocol: 1, ready: true, preview_token: 'private-pg-preview', expires_at: Math.floor(Date.now() / 1000) + 300, confirmation_text: 'COPY TO NEW POSTGRESQL DATABASE', current: { provider: 'sqlite' }, target: { provider: 'postgres', host: 'db.example.invalid', database: 'infinidysk_v2' }, target_identity: { system_identifier: 'fixture-cluster', database_oid: 12345, schema: 'public' } })
    }
    if (req.url === `${base}/postgres/start`) { state.pgJob = { job_id: 'pg-fixture', status: 'copying', message: 'Native copy running' }; return send({ job: state.pgJob }) }
    if (req.url === `${base}/postgres/cutover`) { state.pgJob = { ...state.pgJob, status: 'completed', can_rollback: true }; return send({ job: state.pgJob }) }
    if (state.bootstrap) return send(req.url.includes('/logs') ? { logs: [] } : {})
    res.statusCode = 404; send({ detail: 'Unknown fixture route' })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { state, completePreview: () => {
    state.previewTask = { ...state.previewTask, status: 'completed', stage: 'completed', updated_at: Date.now() / 1000, can_cancel: false, preview_available: true,
      preview: majorPreview(state.previewTask.options) }
    return state.previewTask
  }, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
const acknowledgeMajor = async page => {
  for (const key of ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream']) await page.getByTestId(`v2-ack-${key}`).check()
  await page.getByTestId('v2-confirmation').fill('MIGRATE INFINIDYSK TO V2')
}
const observeMigrationStatusStarts = () => {
  window.fixtureMigrationStatusStarts = []
  const record = (method, input) => {
    if (String(method).toUpperCase() !== 'GET') return
    const path = new URL(String(input), location.href).pathname
    if (/^(?:\/api)?\/process\/infinidysk-v2(?:\/postgres)?\/status$/.test(path)) {
      window.fixtureMigrationStatusStarts.push({ path, visibility: document.visibilityState })
    }
  }
  const requests = new WeakMap()
  const open = XMLHttpRequest.prototype.open
  const send = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    const result = Reflect.apply(open, this, [method, url, ...args])
    requests.set(this, { method, url })
    return result
  }
  XMLHttpRequest.prototype.send = function (...args) {
    const request = requests.get(this)
    if (request) record(request.method, request.url)
    return Reflect.apply(send, this, args)
  }
  const fetch = window.fetch
  window.fetch = function (input, options) {
    record(options?.method || input?.method || 'GET', input?.url || input)
    return Reflect.apply(fetch, this, [input, options])
  }
}
const openMajorFromServiceTools = async (page, origin) => {
  await page.goto(origin + '/services/InfiniDysk')
  await page.getByRole('button', { name: 'Service tools', exact: true }).click()
  await page.getByRole('menuitem').filter({ hasText: 'InfiniDysk 2 migration' }).click()
  await page.getByTestId('v2-panel').waitFor()
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

  test(`${name}: migration preview compares actual added storage work without an invented fastest ranking`, { timeout: 60000 }, async () => {
    const app = await fixture()
    app.state.stagePlan = { ...stageProgress(), current_step_id: null,
      steps: stageProgress().steps.map(step => ({ ...step, state: 'pending' })) }
    app.state.storageWork = storageWork()
    app.state.previewBlockers = ['Resolve this example source check before continuing.']
    app.state.capacity = capacityEstimate(false)
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage()
      await page.goto(app.origin)
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-stages').getByRole('heading', { name: 'Planned migration stages' }).waitFor()
      assert.equal(await page.getByTestId('v2-stage-native_import').getAttribute('data-state'), 'pending')
      assert.equal(await page.evaluate(() => {
        const following = (before, after) => Boolean(document.querySelector('[data-testid="' + before + '"]').compareDocumentPosition(document.querySelector('[data-testid="' + after + '"]')) & Node.DOCUMENT_POSITION_FOLLOWING)
        return following('v2-preview-blockers', 'v2-stages') && following('v2-capacity', 'v2-stages') && following('v2-capacity', 'v2-storage-work')
      }), true, 'Blocking checks and capacity precede optional comparison details')
      const comparison = page.getByTestId('v2-storage-work')
      await comparison.waitFor()
      assert.match(await comparison.innerText(), /No measured fastest-to-slowest order/)
      const keep = page.getByTestId('v2-storage-path-keep_local')
      assert.match(await keep.getByTestId('v2-storage-preparation').innerText(), /120 GiB read.*60 GiB written/)
      const reuse = page.getByTestId('v2-storage-path-reuse_local')
      assert.match(await reuse.getByTestId('v2-storage-preparation').innerText(), /At least 140 GiB read.*0 B written/)
      assert.match(await reuse.getByTestId('v2-storage-restoration').innerText(), /At least 270 GiB read.*60 GiB written/)
      assert.match(await page.getByTestId('v2-storage-path-external_blobs').getByTestId('v2-storage-restoration').innerText(), /At least 270 GiB read.*60 GiB written/)
      assert.equal(await page.getByTestId('v2-storage-details-reuse_local').getAttribute('open'), null)
      await reuse.getByText('Copying, checks and restoration', { exact: true }).click()
      assert.match(await reuse.innerText(), /test migration always restores v1/)
      assert.match(await page.getByTestId('v2-storage-network-note').innerText(), /network storage/)
      app.state.storageWork.paths[0].preparation[0].read_bytes = null
      app.state.storageWork.paths[0].preparation[0].minimum = true
      await page.getByTestId('v2-preview').click()
      await keep.getByTestId('v2-storage-preparation').filter({ hasText: 'not measured read' }).waitFor()
      assert.doesNotMatch(await comparison.innerText(), /At least not measured|Unknown\/s/)
      app.state.storageWork = null; app.state.stagePlan = null
      await page.getByTestId('v2-preview').click()
      await comparison.waitFor({ state: 'hidden' })
      assert.equal(await page.getByTestId('v2-stages').count(), 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: recorded migration stages update automatically and survive review, reload and failure restoration`, { timeout: 60000 }, async () => {
    const app = await fixture()
    app.state.capabilities.infinidysk_v2_prepared_activation = true
    app.state.job = { job_id: 'stage-fixture', mode: 'prepare', prepare_mode: 'migrate', status: 'running', stage: 'importing', stage_progress: stageProgress(), storage_work: storageWork() }
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage()
      await page.goto(app.origin)
      const row = id => page.getByTestId('v2-stage-' + id)
      await row('native_import').filter({ hasText: 'In progress' }).waitFor()
      assert.equal(await row('native_import').getAttribute('aria-current'), 'step')
      assert.equal(await row('source_database').getAttribute('data-state'), 'completed')
      assert.equal(await row('activate').getAttribute('data-state'), 'pending')
      assert.equal(await page.getByTestId('v2-stage-details').getAttribute('open'), null)
      assert.equal(await page.getByTestId('v2-storage-comparison').getAttribute('open'), null)
      assert.equal(await page.getByTestId('v2-storage-work').isVisible(), false)
      app.state.job = { ...app.state.job, status: 'prepared', stage: 'awaiting_activation', result: { validated: true }, stage_progress: stageProgress('review', 'waiting') }
      await row('review').filter({ hasText: 'Waiting for your decision' }).waitFor()
      await page.reload(); await row('review').filter({ hasText: 'Waiting for your decision' }).waitFor()
      assert.equal(await row('activate').getAttribute('data-state'), 'pending')
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
      app.state.majorStatusOffline = true; await page.getByTestId('v2-refresh-status').click()
      await row('review').filter({ hasText: 'Last confirmed: waiting for your decision' }).waitFor()
      assert.equal(await row('review').getAttribute('aria-current'), null)
      assert.equal(await row('native_import').getAttribute('data-state'), 'completed')
      app.state.majorStatusOffline = false
      const failed = stageProgress()
      failed.steps = failed.steps.map(step => ({ ...step, state: step.id === 'native_import' ? 'failed' : step.state === 'pending' ? 'not_run' : step.state }))
      failed.steps.push({ id: 'restore_v1', state: 'running' }); failed.current_step_id = 'restore_v1'
      app.state.job = { ...app.state.job, status: 'rolling_back', stage: 'restoring_archive', stage_progress: failed }
      await page.getByTestId('v2-refresh-status').click(); await row('restore_v1').filter({ hasText: 'In progress' }).waitFor()
      await page.getByRole('heading', { name: 'Recovery', exact: true }).waitFor()
      assert.equal(await row('native_import').getAttribute('data-state'), 'failed')
      app.state.job = { ...app.state.job, status: 'failed_restored', stage: 'failed', error: 'The example imported library check failed.', result: { source_restored: true },
        stage_progress: { ...failed, steps: failed.steps.map(step => step.id === 'restore_v1' ? { ...step, state: 'completed' } : step) } }
      await page.getByTestId('v2-refresh-status').click(); await row('restore_v1').filter({ hasText: 'Completed' }).waitFor()
      assert.equal(await row('activate').getAttribute('data-state'), 'not_run')
      assert.equal(await row('native_import').getAttribute('data-state'), 'failed')
      assert.equal(await page.getByTestId('v2-storage-comparison').getAttribute('open'), null)
      assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-testid="v2-job-failure"]').compareDocumentPosition(document.querySelector('[data-testid="v2-stages"]')) & Node.DOCUMENT_POSITION_FOLLOWING)), true)
      app.state.job = { ...app.state.job, stage_progress: undefined }
      await page.getByTestId('v2-refresh-status').click(); await page.getByTestId('v2-stages-note').filter({ hasText: 'not recorded' }).waitFor()
      assert.equal(await page.getByTestId('v2-stage-list').count(), 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: provider observations remain available after import failure without leaking raw diagnostics`, { timeout: 60000 }, async () => {
    const app = await fixture()
    const observations = { schema_version: 1, final: false, recorded_at: Math.floor(Date.now() / 1000), providers: [
      { provider_ordinal: 1, requests: 1200, bytes_received: 8 * 1024 ** 2, retries: 2,
        failures: { timeout: 2, article_missing: 9, 'private-error-message': 1 }, host: 'private.example.invalid' },
    ], unbound_failures: {} }
    app.state.job = { job_id: 'provider-observations-fixture', mode: 'rehearsal', status: 'running', stage: 'importing', message: 'Importing.', provider_diagnostics: observations }
    let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      const card = page.getByTestId('v2-provider-diagnostics')
      await card.getByText('Provider activity', { exact: true }).waitFor()
      assert.match(await card.innerText(), /1,200 requests/)
      assert.match(await card.innerText(), /Article not found replies: 9/)
      await card.getByText('Connection and protocol errors', { exact: true }).click()
      assert.match(await card.innerText(), /Timed out: 2/)
      assert.match(await card.innerText(), /Counts include attempts recovered/)
      app.state.job = { ...app.state.job, status: 'rolling_back', stage: 'restoring_archive', provider_diagnostics: { ...observations, final: true } }
      await page.getByTestId('v2-refresh-status').click()
      await card.getByText('Retained provider observations', { exact: true }).waitFor()
      app.state.job = { ...app.state.job, status: 'failed_restored', stage: 'failed', result: { source_restored: true }, error: 'Native import has blocking omissions.' }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      assert.match(await card.innerText(), /1,200 requests/)
      assert.doesNotMatch(await page.locator('body').innerText(), /private-error-message|private\.example/)
      app.state.job = { ...app.state.job, provider_diagnostics: undefined }
      await page.getByTestId('v2-refresh-status').click()
      await card.waitFor({ state: 'detached' })
      assert.equal(app.state.calls.some(call => call.method !== 'GET'), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: prepare converts once, retains the same reviewed candidate on reload and explicitly activates without legacy replay`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser; let releasePrepare
    app.state.capabilities.infinidysk_v2_prepared_activation = true
    app.state.previewWarnings = ['Rehearsal can temporarily stop all affected managed consumers and the v1 source.']
    app.state.prepareGate = new Promise(resolve => { releasePrepare = resolve })
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page)
      await page.getByTestId('v2-prepare').waitFor()
      assert.equal(await page.getByTestId('v2-rehearse').count(), 0); assert.equal(await page.getByTestId('v2-start').count(), 0)
      assert.match(await page.getByTestId('v2-prepare-downtime').innerText(), /stay stopped/)
      assert.doesNotMatch(await page.getByTestId('v2-migration-warning').innerText(), /then restores v1/)
      await page.getByTestId('v2-prepare').click()
      await page.getByTestId('v2-request-pending').filter({ hasText: 'Requesting migration preparation' }).waitFor()
      releasePrepare()
      await page.getByTestId('v2-prepared-review').waitFor()
      assert.match(await page.getByTestId('v2-prepared-downtime').innerText(), /remain stopped/)
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
      assert.equal(await page.getByTestId('v2-current-phase').count(), 0)
      assert.equal(await page.getByTestId('v2-job-explanation').count(), 0)
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      assert.equal(await page.getByTestId('v2-activate').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-preview').count(), 0)
      await page.reload(); await page.getByTestId('v2-prepared-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/prepare')).length, 1)
      await page.getByTestId('v2-activate-confirmation').fill('ACTIVATE INFINIDYSK V2 another-job')
      assert.equal(await page.getByTestId('v2-activate').isDisabled(), true)
      await page.getByTestId('v2-activate-confirmation').fill('ACTIVATE INFINIDYSK V2 prepared-fixture')
      app.state.dropActivateResponse = true
      await page.getByTestId('v2-activate').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Activating prepared InfiniDysk 2' }).waitFor()
      assert.equal(app.state.job.job_id, 'prepared-fixture')
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/activate')).length, 1)
      assert.equal(app.state.calls.filter(call => /\/(start|rehearse)$/.test(call.path)).length, 0)
      assert.equal(await page.getByTestId('v2-request-error').count(), 0)
      app.state.generation = '2'; app.state.job = { ...app.state.job, status: 'completed', stage: 'completed', activation_exposed: true, activation_committed: true, result: { validated: true, generation_2_started: true } }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration completed' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/prepare')).length, 1)
    } finally { releasePrepare?.(); await browser?.close(); await app.close() }
  })

  test(`${name}: prepared skip review is current, capability-gated and permits restoring v1 instead of activation`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.infinidysk_v2_prepared_activation = true
    app.state.capabilities.infinidysk_v2_reviewed_skips = true
    app.state.importReport = { ...preparedReport, status: 'review_required', skipped_files: 1, skipped_details_count: 1, reason_count: 1, reasons: [{ reason: 'Unsupported metadata', count: 1 }], skipped: [{ path: '/content/example.mkv', reason: 'Unsupported metadata' }], review_required: true, review_digest: 'a'.repeat(64) }
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page); await page.getByTestId('v2-prepare').click()
      await page.getByTestId('v2-prepared-review').waitFor()
      await page.getByTestId('v2-activate-confirmation').fill(app.state.job.activate_confirmation)
      assert.equal(await page.getByTestId('v2-activate').isDisabled(), true)
      await page.getByTestId('v2-activate-skipped-media').check()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-activate"]').disabled)
      app.state.job = { ...app.state.job, import_report: { ...app.state.job.import_report, review_digest: 'b'.repeat(64) } }
      await page.getByTestId('v2-refresh-status').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-activate-skipped-media"]').checked)
      assert.equal(await page.getByTestId('v2-activate').isDisabled(), true)
      app.state.capabilities.infinidysk_v2_prepared_activation = false
      await page.getByTestId('v2-refresh-status').click(); await page.getByTestId('v2-activate-unsupported').waitFor()
      await page.getByTestId('v2-activate-confirmation').fill(app.state.job.activate_confirmation)
      await page.getByTestId('v2-activate-skipped-media').check()
      assert.equal(await page.getByTestId('v2-activate').isDisabled(), true)
      await page.getByTestId('v2-rollback-confirmation').fill(app.state.job.rollback_confirmation_text)
      await page.getByTestId('v2-rollback').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration rolled back to v1' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/activate')).length, 0)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: prepared provider and unknown omissions allow explicit same-candidate activation without a repeat import`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.infinidysk_v2_prepared_activation = true
    app.state.capabilities.infinidysk_v2_reviewed_skips = true
    const reasons = ['segment sizes unknown: provider unavailable', 'segment sizes unknown: timed out waiting for the server', 'Unrecognized native skip reason']
    app.state.importReport = { ...preparedReport, status: 'review_required', skipped_files: 3, skipped_details_count: 3, reason_count: 3,
      reasons: reasons.map(reason => ({ reason, count: 1 })), skipped: reasons.map((reason, index) => ({ path: `/content/missing-${index}.mkv`, reason })), review_required: true, review_digest: 'c'.repeat(64) }
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page); await page.getByTestId('v2-prepare').click()
      await page.getByTestId('v2-prepared-omissions').filter({ hasText: '3 items are missing from the prepared v2 library' }).waitFor()
      await page.getByTestId('v2-omission-review').filter({ hasText: 'Accepting the omissions does not retry or repair them' }).waitFor()
      await page.getByText('Skipped paths and reasons', { exact: true }).click()
      for (const [index, reason] of reasons.entries()) await page.getByText(`/content/missing-${index}.mkv · ${reason}`, { exact: true }).waitFor()
      await page.getByTestId('v2-activate-confirmation').fill(app.state.job.activate_confirmation)
      assert.equal(await page.getByTestId('v2-activate').isDisabled(), true)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/activate')).length, 0)
      await page.getByTestId('v2-activate-skipped-media').check()
      await page.getByTestId('v2-activate').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Activating prepared' }).waitFor()
      app.state.job = { ...app.state.job, status: 'completed', stage: 'completed', result: { validated: true, generation_2_started: true } }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration completed' }).waitFor()
      const activate = app.state.calls.find(call => call.path.endsWith('/activate')).body
      assert.equal(activate.skip_review_digest, 'c'.repeat(64))
      assert.equal(activate.acknowledgements.skipped_media, true)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/prepare')).length, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rehearse') || call.path.endsWith('/start')).length, 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: accepted preparation survives a lost response and polls to review without automatic activation`, { timeout: 60000 }, async () => {
    const app = await fixture(); let browser; let releaseActivation
    app.state.capabilities.infinidysk_v2_prepared_activation = true
    app.state.prepareRunning = true; app.state.dropPrepareResponse = true
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click(); await acknowledgeMajor(page); await page.getByTestId('v2-prepare').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Preparing InfiniDysk 2' }).waitFor()
      assert.equal(await page.getByTestId('v2-request-error').count(), 0)
      app.state.job = { ...app.state.job, status: 'prepared', stage: 'awaiting_activation', result: { validated: true }, can_activate: true, can_rollback: true }
      await page.getByTestId('v2-prepared-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/activate')).length, 0)
      await page.getByTestId('v2-activate-confirmation').fill(app.state.job.activate_confirmation)
      app.state.majorStatusOffline = true
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-request-error').filter({ hasText: 'Fixture migration status unavailable' }).waitFor()
      assert.equal(await page.getByTestId('v2-activate').isDisabled(), true)
      app.state.majorStatusOffline = false
      await page.getByTestId('v2-refresh-status').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-activate"]').disabled)
      app.state.activateGate = new Promise(resolve => { releaseActivation = resolve })
      await page.getByTestId('v2-activate').click()
      await page.getByTestId('v2-request-pending').filter({ hasText: 'Requesting candidate activation' }).waitFor()
      releaseActivation()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Activating prepared InfiniDysk 2' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/prepare')).length, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/activate')).length, 1)
    } finally { releaseActivation?.(); await browser?.close(); await app.close() }
  })

  test(`${name}: fresh preparation activates only the explicit fresh candidate without requiring an import report`, { timeout: 60000 }, async () => {
    const app = await fixture('fresh'); let browser
    app.state.capabilities.infinidysk_v2_prepared_activation = true; app.state.omitPreparedReport = true
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click()
      for (const key of ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream']) await page.getByTestId(`v2-ack-${key}`).check()
      await page.getByTestId('v2-confirmation').fill('INSTALL INFINIDYSK V2')
      await page.getByTestId('v2-prepare').click(); await page.getByTestId('v2-prepared-review').waitFor()
      assert.match(await page.getByTestId('v2-job-summary').innerText(), /fresh installation/)
      assert.match(await page.getByTestId('v2-rollback').innerText(), /Restore previous setup/)
      await page.getByTestId('v2-activate-confirmation').fill(app.state.job.activate_confirmation)
      await page.getByTestId('v2-activate').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Activating prepared InfiniDysk 2' }).waitFor()
      assert.equal(app.state.calls.filter(call => /\/(start|rehearse)$/.test(call.path)).length, 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': current scan estimates stay phase-bound and unknown observations never imply a finish time', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    const now = Math.floor(Date.now() / 1000)
    const scan = { scan_id: 'a1b2c3_1', phase_sequence: 1, phase: 'source_data', entries_processed: 1000, entries_total: 10000, total_is_estimate: true, logical_bytes_processed: 1024 ** 3, elapsed_seconds: 30, rate_entries_per_second: 100, estimated_remaining_seconds: 90, estimate_scope: 'current_scan', updated_at: now, complete: false }
    const running = 'An InfiniDysk 2 operation is already running. Its status is shown below.'
    app.state.job = { job_id: 'scan-fixture', status: 'running', mode: 'rehearsal', stage: 'revalidating', created_at: now - 120, updated_at: now, scan_progress: scan, message: 'Measuring retained source files before pausing applications.' }
    app.state.blockers = [running, 'Fixture independent policy blocker']
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-scan-eta').filter({ hasText: /About 2m.*remaining in this scan/ }).waitFor()
      assert.match(await page.getByTestId('v2-scan-count').innerText(), /1,000 of about 10,000/)
      assert.match(await page.getByTestId('v2-scan-rate').innerText(), /100 entries\/s/)
      assert.match(await page.getByTestId('v2-scan-progress').innerText(), /full-operation finish estimate is not available/)
      await page.getByTestId('v2-running-admission').waitFor()
      assert.equal(await page.getByText(running, { exact: true }).count(), 0)
      await page.getByText('Fixture independent policy blocker', { exact: true }).waitFor()
      const change = async (patch, countText) => {
        app.state.job = { ...app.state.job, scan_progress: { ...scan, updated_at: Math.floor(Date.now() / 1000), ...patch } }
        await page.getByTestId('v2-refresh-status').click()
        await page.getByTestId('v2-scan-count').filter({ hasText: countText }).waitFor()
        assert.equal(await page.getByTestId('v2-scan-eta').count(), 0)
      }
      await change({ entries_processed: 1100, entries_total: null, estimated_remaining_seconds: null }, '1,100')
      assert.match(await page.getByTestId('v2-scan-estimate-note').innerText(), /total file count is not known/)
      await change({ entries_processed: 10001 }, '10,001')
      assert.match(await page.getByTestId('v2-scan-estimate-note').innerText(), /grown beyond/)
      await change({ entries_processed: 1300, updated_at: now - 60 }, '1,300')
      assert.match(await page.getByTestId('v2-scan-estimate-note').innerText(), /No recent scan measurements/)
      await change({ entries_processed: 1400, rate_entries_per_second: 0 }, '1,400')
      await change({ scan_id: 'a1b2c3_2', phase_sequence: 2, phase: 'source_runtime', entries_processed: 1, entries_total: null, logical_bytes_processed: 4096, elapsed_seconds: 1, rate_entries_per_second: null, estimated_remaining_seconds: null }, /^Entries inspected: 1$/)
      assert.match(await page.getByTestId('v2-scan-progress').innerText(), /retained v1 application files/)
      app.state.majorStatusOffline = true; await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-request-error').filter({ hasText: 'Fixture migration status unavailable' }).waitFor()
      assert.equal(await page.getByTestId('v2-scan-eta').count(), 0)
      app.state.majorStatusOffline = false
      app.state.job = { ...app.state.job, stage: 'importing', scan_progress: scan }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-current-phase').filter({ hasText: 'Importing into InfiniDysk 2' }).waitFor()
      assert.equal(await page.getByTestId('v2-scan-progress').count(), 0)
      app.state.job = { ...app.state.job, status: 'recovery_required', recovery_required: true }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByText(running, { exact: true }).waitFor()
      assert.equal(await page.getByTestId('v2-running-admission').count(), 0)
      app.state.job = { job_id: 'old-api-scan', status: 'running', mode: 'rehearsal', stage: 'revalidating', message: 'Legacy backend is checking retained source files.' }
      app.state.blockers = []; await page.getByTestId('v2-refresh-status').click()
      await page.getByText('Legacy backend is checking retained source files.', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('v2-scan-progress').count(), 0)
      assert.equal(app.state.calls.some(call => call.method !== 'GET'), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': queued downloads require an explicit reviewed omission and report the captured outcome', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.infinidysk_v2_queue_omission = true; app.state.queueCount = 13
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      const choice = page.getByTestId('v2-omit-queued-downloads')
      await choice.waitFor(); assert.equal(await choice.isChecked(), false)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await page.getByText('The source queue contains 13 queued downloads. Finish them or explicitly continue without queued downloads.', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      assert.equal(Object.hasOwn(app.state.calls.filter(c => c.path.endsWith('/preview')).at(-1).body, 'omit_queued_downloads'), false)
      await choice.check(); assert.equal(await page.getByTestId('v2-review').count(), 0, 'Changing queue policy invalidates its old review')
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(app.state.calls.filter(c => c.path.endsWith('/preview')).at(-1).body.omit_queued_downloads, true)
      assert.equal(await page.getByText('The source queue contains 13 queued downloads. Finish them or explicitly continue without queued downloads.', { exact: true }).count(), 0)
      assert.match(await page.getByTestId('v2-review').getByTestId('v2-source-queue-observed').innerText(), /13/)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-queue-choice').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/queue-omission-review-' + name + '.png', fullPage: true })
      }
      await acknowledgeMajor(page); app.state.capturedQueueCount = 13
      await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration passed' }).waitFor()
      await page.getByTestId('v2-source-queue-omitted').filter({ hasText: 'Excluded from this v2 import: 13 queued downloads.' }).waitFor()
      await page.getByTestId('v2-start').click({ trial: true, timeout: 10000 })
      assert.equal(await page.getByTestId('v2-start').isDisabled(), false)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-source-queue-omitted').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/queue-omission-result-' + name + '.png', fullPage: true })
      }
      assert.doesNotMatch(await page.locator('body').innerText(), /queue-private-fixture-id|queue-private-digest/)
      await choice.uncheck()
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      assert.equal(await page.getByTestId('v2-start').count(), 0, 'An omission rehearsal cannot authorize the default queue policy after its review is cleared')
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(Object.hasOwn(app.state.calls.filter(c => c.path.endsWith('/preview')).at(-1).body, 'omit_queued_downloads'), false)
      assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      assert.equal(app.state.generation, '1')
      assert.deepEqual(app.state.calls.filter(c => c.method !== 'GET').map(c => c.path), ['/api/process/infinidysk-v2/preview', '/api/process/infinidysk-v2/preview', '/api/process/infinidysk-v2/rehearse', '/api/process/infinidysk-v2/preview'])
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': queue omission capability loss removes a stale choice and never sends an unsupported option', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.capabilities.infinidysk_v2_queue_omission = true; app.state.queueCount = 13
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-omit-queued-downloads').check()
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(app.state.calls.filter(c => c.path.endsWith('/preview')).at(-1).body.omit_queued_downloads, true)
      for (const value of ['true', undefined, false]) {
        if (value === undefined) delete app.state.capabilities.infinidysk_v2_queue_omission
        else app.state.capabilities.infinidysk_v2_queue_omission = value
        await page.getByTestId('v2-refresh-status').click()
        await page.getByTestId('v2-omit-queued-downloads').waitFor({ state: 'detached' })
        assert.equal(await page.getByTestId('v2-omit-queued-downloads').count(), 0)
        await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
        assert.equal(Object.hasOwn(app.state.calls.filter(c => c.path.endsWith('/preview')).at(-1).body, 'omit_queued_downloads'), false)
        assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      }
      assert.equal(app.state.calls.some(c => c.method !== 'GET' && !c.path.endsWith('/preview')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': migration IO progress stays bound to its pass and integrity details never expose input paths', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    const now = () => Math.floor(Date.now() / 1000)
    const observed = (phase, unit, processed, total, patch = {}) => ({ phase_id: 'io-fixture-' + phase, phase, unit, processed, total, total_is_estimate: false, elapsed_seconds: 30, rate_per_second: unit === 'bytes' ? 8.125 * 1024 ** 2 : 100, estimated_remaining_seconds: total !== null && total > processed ? Math.ceil((total - processed) / (unit === 'bytes' ? 8.125 * 1024 ** 2 : 100)) : null, updated_at: now(), complete: false, ...patch })
    app.state.job = { job_id: 'io-fixture', mode: 'rehearsal', status: 'running', stage: 'archiving', created_at: now() - 120, updated_at: now(), io_progress: observed('archive_write', 'bytes', 1024 ** 3, 10 * 1024 ** 3, { total_is_estimate: true }) }
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-io-eta').filter({ hasText: /remaining in this (?:pass|phase)/ }).waitFor()
      assert.match(await page.getByTestId('v2-io-count').innerText(), /1(?:\.0+)? GiB/)
      assert.match(await page.getByTestId('v2-io-count').innerText(), /(?:about|approx|estimate)/i)
      assert.match(await page.getByTestId('v2-io-rate').innerText(), /8\.13 MiB\/s/)
      assert.doesNotMatch(await page.getByTestId('v2-io-rate').innerText(), /Unknown/)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/fractional-byte-rate-' + name + '.png', fullPage: true })
      assert.match(await page.getByTestId('v2-io-progress').innerText(), /full.operation finish estimate is not available/i)
      const change = async (stage, value) => {
        app.state.job = { ...app.state.job, stage, io_progress: value, updated_at: now() }
        await page.getByTestId('v2-refresh-status').click()
      }
      await change('archiving', observed('archive_write', 'bytes', 1024, 10240, { rate_per_second: 102.4, estimated_remaining_seconds: 90 }))
      await page.getByTestId('v2-io-rate').filter({ hasText: '102.4 B/s' }).waitFor()
      await change('archiving', observed('archive_write', 'bytes', 1024, 10240, { rate_per_second: 0.25, estimated_remaining_seconds: 36864 }))
      await page.getByTestId('v2-io-rate').filter({ hasText: '0.25 B/s' }).waitFor()
      await page.getByTestId('v2-io-eta').waitFor()
      await change('archiving', observed('archive_write', 'bytes', 1024, 10240, { rate_per_second: null, estimated_remaining_seconds: null }))
      await page.getByTestId('v2-io-estimate-note').filter({ hasText: /not available/ }).waitFor()
      assert.equal(await page.getByTestId('v2-io-rate').count(), 0)
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      await change('preparing_blob_staging', observed('blob_metadata', 'entries', 200, 1000, { rate_per_second: 0.125, estimated_remaining_seconds: 6400 }))
      await page.getByTestId('v2-io-rate').filter({ hasText: '0.13 entries/s' }).waitFor()
      await change('snapshotting', observed('source_fingerprint', 'bytes', 512 * 1024 ** 2, 2 * 1024 ** 3))
      await page.getByTestId('v2-io-count').filter({ hasText: /512(?:\.0+)? MiB/ }).waitFor()
      assert.match(await page.getByTestId('v2-io-progress').innerText(), /Fingerprinting the retained source data/)
      await change('preparing_blob_staging', observed('blob_metadata', 'entries', 1200, 10000, { elapsed_seconds: 2, rate_per_second: null, estimated_remaining_seconds: null }))
      await page.getByTestId('v2-io-count').filter({ hasText: '1,200' }).waitFor()
      assert.equal(await page.getByTestId('v2-io-rate').count(), 0)
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      assert.doesNotMatch(await page.getByTestId('v2-io-progress').innerText(), /GiB|MiB\/s/)
      await change('verifying_blob_staging', observed('blob_verify_staged', 'bytes', 2 * 1024 ** 3, 10 * 1024 ** 3))
      await page.getByTestId('v2-io-count').filter({ hasText: /2(?:\.0+)? GiB/ }).waitFor()
      await page.getByTestId('v2-io-eta').waitFor()
      await change('verifying_blob_staging', observed('blob_verify_source', 'entries', 4000, 10000, { rate_per_second: null, estimated_remaining_seconds: null }))
      await page.getByTestId('v2-io-count').filter({ hasText: '4,000' }).waitFor()
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      assert.doesNotMatch(await page.getByTestId('v2-io-progress').innerText(), /GiB|MiB\/s/)
      await change('staging_blobs', observed('blob_copy', 'bytes', 3 * 1024 ** 3, null))
      await page.getByTestId('v2-io-count').filter({ hasText: /3(?:\.0+)? GiB/ }).waitFor()
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      await change('staging_blobs', observed('blob_copy', 'bytes', 4 * 1024 ** 3, 10 * 1024 ** 3, { updated_at: now() - 60 }))
      await page.getByTestId('v2-io-count').filter({ hasText: /4(?:\.0+)? GiB/ }).waitFor()
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      await change('staging_blobs', observed('blob_copy', 'bytes', 11 * 1024 ** 3, 10 * 1024 ** 3))
      await page.getByTestId('v2-io-count').filter({ hasText: /11(?:\.0+)? GiB/ }).waitFor()
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      app.state.majorStatusOffline = true; await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-request-error').filter({ hasText: 'Fixture migration status unavailable' }).waitFor()
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      app.state.majorStatusOffline = false
      await change('importing', observed('blob_copy', 'bytes', 10 * 1024 ** 3, 10 * 1024 ** 3, { complete: true }))
      await page.getByTestId('v2-current-phase').filter({ hasText: 'Importing into InfiniDysk 2' }).waitFor()
      assert.equal(await page.getByTestId('v2-io-progress').count(), 0)
      app.state.job = { ...app.state.job, status: 'rolling_back', import_progress: { stage: 'done', processed: 10, total: 10, elapsed_seconds: 60 } }
      await change('restoring_archive', observed('archive_restore', 'bytes', 3 * 1024 ** 3, 10 * 1024 ** 3))
      await page.getByTestId('v2-io-count').filter({ hasText: /3(?:\.0+)? GiB/ }).waitFor()
      assert.equal(await page.getByTestId('v2-import-progress').count(), 0, 'Retained native completion must not describe current archive restoration')
      assert.equal(await page.getByTestId('v2-retained-native-progress').count(), 1)
      assert.doesNotMatch(await page.getByTestId('v2-io-progress').innerText(), /100%/)
      app.state.job = { ...app.state.job, status: 'failed_restored', stage: 'failed', error: 'A recorded migration input file changed.', result: { source_restored: true },
        input_integrity: { code: 'recorded_entry_changed', side: 'staged', entry_type: 'file', changed_fields: ['ctime_ns'], path_digest: 'd'.repeat(64), path: '/private/fixture-secret/blob.bin', expected: 'private-original-value', actual: 'private-changed-value' } }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      await page.getByTestId('v2-input-integrity').waitFor()
      assert.match(await page.getByTestId('v2-input-integrity-side').innerText(), /staged|external/i)
      assert.match(await page.getByTestId('v2-input-integrity-changes').innerText(), /Filesystem change time/)
      assert.match(await page.getByTestId('v2-input-integrity-reference').innerText(), /dddddddd/)
      assert.doesNotMatch(await page.locator('body').innerText(), /fixture-secret|private-original-value|private-changed-value|\/private\//)
      assert.equal(await page.getByTestId('v2-io-progress').count(), 0)
      app.state.job = { job_id: 'old-api-io', mode: 'rehearsal', status: 'running', stage: 'staging_blobs', message: 'Legacy backend is copying retained input.' }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByText('Legacy backend is copying retained input.', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('v2-io-progress').count(), 0)
      assert.equal(app.state.calls.some(call => call.method !== 'GET'), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': automatic job polling follows a held accepted test and phase changes without replay', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser, release
    app.state.acceptRehearsalBeforeResponse = true; app.state.dropRehearsalResponse = true
    app.state.rehearsalGate = new Promise(resolve => { release = resolve })
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage()
      await page.addInitScript(observeMigrationStatusStarts)
      await page.goto(app.origin); await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await acknowledgeMajor(page); await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration is running' }).waitFor()
      assert.equal(await page.getByTestId('v2-request-pending').count(), 0, 'Status can confirm an accepted job while POST is held')
      app.state.blockers = ['A major migration is active or needs recovery review.', 'Fixture independent policy blocker']
      app.state.job = { ...app.state.job, stage: 'postgres_snapshot', snapshot_progress: { phase: 'source_inventory', table: 'HistoryItems', table_index: 5, table_count: 7, rows: 37000, elapsed_seconds: 24 } }
      await page.getByTestId('v2-snapshot-progress').filter({ hasText: 'Table 5 of 7' }).waitFor()
      assert.match(await page.getByTestId('v2-snapshot-progress').innerText(), /37,000/)
      assert.equal(await page.getByTestId('v2-recovery-unavailable').count(), 0)
      app.state.job = { ...app.state.job, stage: 'postgres_restore_verification', snapshot_progress: { ...app.state.job.snapshot_progress, phase: 'restore_verification', restore_phase: 'restoring_database' } }
      await page.getByTestId('v2-current-phase').filter({ hasText: 'Testing PostgreSQL recovery' }).waitFor()
      assert.doesNotMatch(await page.getByTestId('v2-snapshot-progress').innerText(), /Table 5 of 7|37,000/, 'Restore does not reuse stale source table counters')
      await page.getByTestId('v2-running-admission').waitFor()
      assert.equal(await page.getByText('A major migration is active or needs recovery review.', { exact: true }).count(), 0)
      await page.getByText('Fixture independent policy blocker', { exact: true }).waitFor()
      app.state.job = { ...app.state.job, stage: 'importing', progress: 100 }
      await page.getByTestId('v2-current-phase').filter({ hasText: 'Importing into InfiniDysk 2' }).waitFor()
      assert.equal(await page.getByTestId('v2-snapshot-progress').count(), 0)
      assert.equal(await page.getByTestId('v2-job').locator('progress').getAttribute('value'), null)
      await page.evaluate(() => { window.fixtureHidden = true; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.fixtureHidden ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
      // Drain the admitted refresh, then measure browser request starts. Node
      // arrival counts also include unrelated status calls and can increase
      // when an earlier request arrives after this visibility boundary.
      await page.evaluate(() => window.fixtureRefreshSettled())
      const count = await page.evaluate(() => window.fixtureMigrationStatusStarts.length)
      assert.ok(count > 0, 'The browser observer must see migration status reads before checking the pause')
      await delay(2300)
      assert.equal(await page.evaluate(() => window.fixtureMigrationStatusStarts.length), count, 'Hidden pages must not start more migration status reads')
      app.state.job = { ...app.state.job, stage: 'validating' }
      await page.evaluate(() => { window.fixtureHidden = false; document.dispatchEvent(new Event('visibilitychange')) })
      await page.getByTestId('v2-current-phase').filter({ hasText: 'Checking the imported installation' }).waitFor()
      app.state.job = { ...app.state.job, status: 'failed_restored', stage: 'failed', result: { source_restored: true }, error: 'Fixture independent snapshot failure' }
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      release(); await delay(200)
      assert.equal(await page.getByTestId('v2-request-error').count(), 0)
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
      await page.getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      app.state.job = { ...app.state.job, error: 'Fixture result rechecked on reopen' }
      await page.evaluate(() => window.fixtureOpen())
      await page.getByTestId('v2-job-failure').filter({ hasText: 'Fixture result rechecked on reopen' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rehearse')).length, 1)
    } finally { release?.(); await browser?.close(); await app.close() }
  })

  test(name + ': a dropped test response clears only for a matching new durable job without retry', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser; app.state.dropRehearsalResponse = true
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage()
      await page.goto(app.origin); await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await acknowledgeMajor(page); await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-request-error').filter({ hasText: 'The proxy did not return' }).waitFor()
      app.state.job = { job_id: 'discovered-test', mode: 'rehearsal', status: 'running', stage: 'snapshotting', plan_fingerprint: 'different-plan' }
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration is running' }).waitFor()
      assert.equal(await page.getByTestId('v2-request-error').count(), 1)
      app.state.job = { ...app.state.job, plan_fingerprint: app.state.plan }
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-request-error"]'))
      app.state.job = { ...app.state.job, status: 'recovery_required', recovery_required: true }
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration recovery needs review' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rehearse')).length, 1)
      assert.equal(app.state.calls.some(call => /\/(rollback|cancel)$/.test(call.path)), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': late old-session test completion cannot replace newer request feedback', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser, releaseOld, releaseNew
    app.state.rehearsalGate = new Promise(resolve => { releaseOld = resolve })
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage()
      await page.goto(app.origin); await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      await acknowledgeMajor(page); await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-request-pending-heading').filter({ hasText: 'Requesting test migration' }).waitFor()
      await page.evaluate(() => window.fixtureReset())
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-preview"]').disabled)
      app.state.syncPreviewGate = new Promise(resolve => { releaseNew = resolve })
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-request-pending-heading').filter({ hasText: 'Requesting migration preview' }).waitFor()
      app.state.stale = true; releaseOld(); await delay(200)
      assert.match(await page.getByTestId('v2-request-pending-heading').innerText(), /Requesting migration preview/)
      assert.equal(await page.getByTestId('v2-request-error').count(), 0)
      releaseNew(); await page.getByTestId('v2-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rehearse')).length, 1)
    } finally { releaseOld?.(); releaseNew?.(); await browser?.close(); await app.close() }
  })

  test(name + ': intentional migration requests reveal focused feedback without polling scroll theft and restored results are terminal', { timeout: 60000 }, async () => {
    const app = await fixture()
    Object.assign(app.state.capabilities, storageCapabilities, { infinidysk_v2_low_space_migration: true, infinidysk_v2_external_blob_staging: true, infinidysk_v2_async_preview: true })
    app.state.capacity = stagedCapacityEstimate(); app.state.rehearsalFailed = true
    let browser, releasePreview, releaseRehearsal
    app.state.previewStartGate = new Promise(resolve => { releasePreview = resolve })
    app.state.rehearsalGate = new Promise(resolve => { releaseRehearsal = resolve })
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1000, height: 650 }, reducedMotion: 'reduce' })
      await page.goto(app.origin)
      // The component harness has no Tailwind sheet. Supply only the modal's
      // production geometry here; packaged tests cover its actual appearance.
      await page.addStyleTag({ content: '[data-testid="v2-panel"]{position:fixed;inset:0;overflow-y:auto;padding:16px;box-sizing:border-box}[data-testid="v2-panel"]>div{max-width:800px;margin:auto}p,fieldset,label{margin-block:16px}label{display:block}' })
      await page.getByTestId('backup-storage-selection').selectOption('@default')
      await page.getByTestId('v2-offload-legacy-blobs').check()
      await page.locator('input[value="fuse"]').check()
      await page.getByTestId('v2-panel').evaluate(panel => {
        window.fixtureScrolls = []
        const original = panel.scrollTo.bind(panel)
        panel.scrollTo = options => { window.fixtureScrolls.push(options); original(options) }
      })
      await page.getByTestId('v2-preview').scrollIntoViewIfNeeded()
      assert.ok(await page.getByTestId('v2-panel').evaluate(element => element.scrollTop) > 0)
      await page.getByTestId('v2-preview').click()
      const pending = page.getByTestId('v2-request-pending-heading')
      await pending.filter({ hasText: 'Requesting migration preview' }).waitFor()
      await page.waitForFunction(() => document.activeElement?.dataset.testid === 'v2-request-pending-heading'
        && document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().bottom <= innerHeight)
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      assert.equal(await page.evaluate(() => window.fixtureScrolls.at(-1).behavior), 'auto')
      releasePreview()
      await page.getByTestId('v2-preview-status').filter({ hasText: 'Inspecting v1 state' }).waitFor()
      await page.getByTestId('v2-preview').scrollIntoViewIfNeeded()
      const anchorTop = await page.getByTestId('v2-preview').evaluate(element => element.getBoundingClientRect().top)
      const calls = await page.evaluate(() => window.fixtureScrolls.length)
      const polled = page.waitForResponse(response => response.url().includes('/preview/task/'))
      await polled
      assert.ok(Math.abs(await page.getByTestId('v2-preview').evaluate(element => element.getBoundingClientRect().top) - anchorTop) < 2, 'Background polling preserves the visible reader position despite normal scroll anchoring')
      assert.equal(await page.evaluate(() => window.fixtureScrolls.length), calls, 'Polling does not call intentional-action scrolling')
      app.completePreview()
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-review').waitFor()
      await acknowledgeMajor(page)
      await page.getByTestId('v2-ack-archive_recovery').check()
      await page.getByTestId('v2-ack-external_blob_staging').check()
      await page.getByTestId('v2-rehearse').scrollIntoViewIfNeeded()
      assert.ok(await page.getByTestId('v2-panel').evaluate(element => element.scrollTop) > 0)
      await page.getByTestId('v2-rehearse').click()
      await pending.filter({ hasText: 'Requesting test migration' }).waitFor()
      await page.waitForFunction(() => document.activeElement?.dataset.testid === 'v2-request-pending-heading'
        && document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().bottom <= innerHeight)
      assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      releaseRehearsal()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      await page.waitForFunction(() => document.activeElement?.dataset.testid === 'v2-job-heading'
        && document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().bottom <= innerHeight)
      assert.match(await page.getByTestId('v2-job-summary').innerText(), /restored.*v1/i)
      assert.match(await page.getByTestId('v2-job-next').innerText(), /Nothing retries automatically/)
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
      assert.equal(await page.getByTestId('v2-archive-recovery-state').count(), 0)
      assert.equal(await page.getByTestId('v2-recovery-unavailable').count(), 0)
      assert.equal(await page.getByTestId('v2-preview-status').count(), 0, 'A completed preview is historical after a test was admitted')
      assert.equal(await page.getByTestId('v2-job-details').getAttribute('open'), null)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rehearse')).length, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/start') && !call.path.includes('/preview/')).length, 0)
      app.state.previewStartGate = new Promise(resolve => { releasePreview = resolve })
      await page.getByTestId('v2-preview').click()
      await pending.waitFor()
      const beforeManualScroll = await page.evaluate(() => window.fixtureScrolls.length)
      await page.getByTestId('v2-panel').dispatchEvent('wheel', { deltaY: 500 })
      releasePreview()
      await page.getByTestId('v2-preview-status').waitFor()
      assert.equal(await page.evaluate(() => window.fixtureScrolls.length), beforeManualScroll, 'A user scroll during admission relinquishes completion viewport ownership')
    } finally { releasePreview?.(); releaseRehearsal?.(); await browser?.close(); await app.close() }
  })

  test(name + ': async preview Refresh recovers a lost response and retained result without another scan', { timeout: 60000 }, async () => {
    const app = await fixture()
    Object.assign(app.state.capabilities, storageCapabilities, { infinidysk_v2_low_space_migration: true, infinidysk_v2_external_blob_staging: true, infinidysk_v2_async_preview: true })
    app.state.dropPreviewStartResponse = true; app.state.previewStatusOffline = true; app.state.capacity = stagedCapacityEstimate()
    let browser, releaseRefresh
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('backup-storage-selection').selectOption('@default')
      await page.locator('input[value="fuse"]').check()
      await page.getByTestId('v2-offload-legacy-blobs').check()
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-preview-error').filter({ hasText: 'HTTP 503' }).waitFor()
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      assert.doesNotMatch(await page.locator('body').innerText(), /fixture-secret|private response/)
      const posted = app.state.calls.filter(call => call.path.endsWith('/preview/start'))
      assert.equal(posted.length, 1)
      assert.equal(posted[0].body.backup_destination_id, '@default')
      assert.equal(posted[0].body.offload_legacy_blobs, true); assert.equal(posted[0].body.mount_backend, 'fuse')
      app.completePreview(); app.state.previewStatusOffline = false
      app.state.capabilitiesGate = new Promise(resolve => { releaseRefresh = resolve })
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-refresh-feedback').filter({ hasText: 'Refreshing migration status' }).waitFor()
      assert.equal(await page.getByTestId('v2-refresh-status').isDisabled(), true)
      releaseRefresh()
      await page.getByTestId('v2-review').waitFor()
      await page.getByTestId('v2-refresh-feedback').filter({ hasText: 'Preview ready for review' }).waitFor()
      assert.equal(await page.getByTestId('v2-preview-error').count(), 0)
      assert.equal(await page.locator('input[value="fuse"]').isChecked(), true)
      assert.equal(await page.getByTestId('v2-offload-legacy-blobs').isChecked(), true)
      await page.reload(); await page.getByTestId('v2-review').waitFor()
      assert.equal(await page.getByTestId('backup-storage-selection').inputValue(), '@default')
      assert.equal(await page.getByTestId('v2-ack-backup').isChecked(), false)
      assert.equal(await page.getByTestId('v2-confirmation').inputValue(), '')
      assert.doesNotMatch(await page.evaluate(() => JSON.stringify(sessionStorage)), /private-fixture-preview|fixture-secret/)
      await page.locator('input[value="rclone"]').check()
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-refresh-feedback').filter({ hasText: 'Status refreshed' }).waitFor()
      assert.equal(await page.locator('input[value="rclone"]').isChecked(), true, 'Refresh preserves deliberately changed choices')
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      app.state.job = { job_id: 'real-migration', status: 'running', mode: 'rehearsal', stage: 'quiescing', message: 'Managed services are stopping.' }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job').filter({ hasText: 'Managed services are stopping' }).waitFor()
      assert.equal(await page.getByTestId('v2-preview-status').count(), 0, 'A stale read-only preview cannot describe a real migration')
      assert.doesNotMatch(await page.getByTestId('v2-panel').innerText(), /no backup or migration has started/i)
      assert.equal(app.state.previewScans, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview/start')).length, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview')).length, 0)
      assert.equal(app.state.calls.filter(call => /\/(start|rehearse)$/.test(call.path) && !call.path.endsWith('/preview/start')).length, 0)
    } finally { releaseRefresh?.(); await browser?.close(); await app.close() }
  })

  test(name + ': async preview cancellation is observable beyond a minute and reload never starts another scan', { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.capabilities.infinidysk_v2_async_preview = true; app.state.previewElapsed = 125
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-preview-status').filter({ hasText: 'Elapsed: 2m' }).waitFor()
      assert.match(await page.getByTestId('v2-preview-status').innerText(), /services keep running/)
      assert.equal(await page.getByTestId('v2-preview-status').locator('progress').getAttribute('value'), null, 'No invented percentage')
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      await page.getByTestId('v2-preview-cancel').click()
      await page.getByTestId('v2-preview-status').filter({ hasText: 'Stopping the preview scan safely' }).waitFor()
      assert.equal(await page.getByTestId('v2-preview-cancel').count(), 0)
      await page.reload(); await page.getByTestId('v2-preview-status').filter({ hasText: 'Stopping the preview scan safely' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview/start')).length, 1)
      assert.equal(app.state.calls.filter(call => call.path.includes('/preview/task/') && call.path.endsWith('/cancel')).length, 1)
      app.state.previewTask = { ...app.state.previewTask, status: 'cancelled', updated_at: Date.now() / 1000, can_cancel: false }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-preview-status').filter({ hasText: 'Migration preview cancelled' }).waitFor()
      assert.equal(await page.getByTestId('v2-preview').isEnabled(), true)
      assert.equal(app.state.previewScans, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': legacy preview failure identifies HTTP context and Refresh has visible feedback', { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.previewHttpFailure = 500
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-preview').click()
      await page.getByRole('alert').filter({ hasText: 'HTTP 500' }).waitFor()
      assert.match(await page.getByRole('alert').innerText(), /\/api\/process\/infinidysk-v2\/preview/)
      assert.doesNotMatch(await page.locator('body').innerText(), /fixture-secret|<html>|private response/)
      app.state.previewHttpFailure = null
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-refresh-feedback').filter({ hasText: 'Status refreshed' }).waitFor()
      assert.equal(await page.getByRole('alert').count(), 0)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.includes('/preview/task') || call.path.endsWith('/preview/start')).length, 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: DUMB step retry keeps completed stages, requires a fresh decision and can restore v1 instead`, { timeout: 60000 }, async () => {
    const app = await fixture(); Object.assign(app.state.capabilities, stageRetryCapabilities, { infinidysk_v2_cancel: true })
    app.state.job = stageRetryJob(); app.state.blockers = ['An InfiniDysk 2 operation is already running. Its status is shown below.']
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration paused' }).waitFor()
      await page.getByTestId('v2-stage-retry-details').filter({ hasText: 'Verify the recovery archive' }).waitFor()
      assert.equal((await page.getByTestId('v2-stage-retry-details').innerText()).includes('fixture-secret'), false)
      assert.match(await page.getByTestId('v2-stage-check_plan').innerText(), /Completed/)
      assert.match(await page.getByTestId('v2-stage-save_recovery').innerText(), /Paused — decision required/)
      assert.equal(await page.locator('[data-testid="v2-job"] progress').count(), 0)
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-retry-stage').isEnabled(), true)
      assert.match(await page.getByTestId('v2-running-admission').innerText(), /paused for your decision/)
      const firstPhrase = app.state.job.confirmation_texts.retry_stage
      assert.equal(await page.getByTestId('v2-stage-retry').locator('input').count(), 0)
      assert.equal((await page.getByTestId('v2-panel').innerText()).includes(firstPhrase), false, 'The retry authorization is internal to the explicit click')
      await page.getByTestId('v2-retry-stage').click()
      await page.getByTestId('v2-stage-save_recovery').filter({ hasText: 'In progress' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).length, 1)
      assert.deepEqual(app.state.calls.find(call => call.path.endsWith('/retry-stage')).body, { job_id: 'paused-step-fixture', confirmation: firstPhrase })
      assert.equal(app.state.job.job_id, 'paused-step-fixture')
      app.state.job = stageRetryJob(2); await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-stage-retry-details').filter({ hasText: 'Pause 2' }).waitFor()
      assert.equal(await page.getByTestId('v2-retry-stage').isEnabled(), true)
      await page.reload(); await page.getByTestId('v2-stage-retry').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).length, 1, 'Reload only observes the paused job')
      const secondPhrase = app.state.job.confirmation_texts.retry_stage
      assert.notEqual(secondPhrase, firstPhrase)
      await page.getByTestId('v2-retry-stage').click()
      await page.getByTestId('v2-stage-save_recovery').filter({ hasText: 'In progress' }).waitFor()
      assert.deepEqual(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).map(call => call.body.confirmation), [firstPhrase, secondPhrase])
      app.state.job = stageRetryJob(3); await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-stage-retry-details').filter({ hasText: 'Pause 3' }).waitFor()
      await page.getByTestId('v2-cancel-confirmation').fill(app.state.job.cancel_confirmation_text)
      await page.getByTestId('v2-cancel').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Restoration requested' }).waitFor()
      assert.match(await page.getByTestId('v2-job-summary').innerText(), /has not yet begun restoring/)
      assert.equal(await page.getByTestId('v2-stage-retry').count(), 0)
      app.state.job = { ...app.state.job, status: 'rolling_back', stage: 'rolling_back' }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Restoring previous installation' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/cancel')).length, 1)
      assert.equal(app.state.calls.some(call => /\/(prepare|rehearse|start|rollback)$/.test(call.path)), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: DUMB step retry loses stale authorization and reconciles an accepted timeout without replay`, { timeout: 60000 }, async () => {
    const app = await fixture(); Object.assign(app.state.capabilities, stageRetryCapabilities, { infinidysk_v2_cancel: true })
    app.state.job = stageRetryJob()
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-stage-retry').waitFor()
      app.state.majorStatusOffline = true; await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-stage-retry-unconfirmed').waitFor()
      assert.equal(await page.getByTestId('v2-retry-stage').isDisabled(), true)
      app.state.majorStatusOffline = false; app.state.capabilities.infinidysk_v2_stage_retry = false
      await page.getByTestId('v2-refresh-status').click(); await page.getByTestId('v2-stage-retry-unsupported').waitFor()
      assert.equal(await page.getByTestId('v2-retry-stage').isDisabled(), true)
      app.state.capabilities.infinidysk_v2_stage_retry = true
      await page.getByTestId('v2-refresh-status').click()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-retry-stage"]')?.disabled === false)
      app.state.dropStageRetryResponse = true; await page.getByTestId('v2-retry-stage').click()
      await page.getByTestId('v2-stage-save_recovery').filter({ hasText: 'In progress' }).waitFor()
      assert.equal(await page.getByTestId('v2-stage-retry').count(), 0)
      assert.equal(await page.getByTestId('v2-request-error').count(), 0, 'Durable accepted attempt settles the lost response')
      await page.reload(); await page.getByTestId('v2-stage-save_recovery').filter({ hasText: 'In progress' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).length, 1)
      app.state.job = stageRetryJob(2); await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-stage-retry-details').filter({ hasText: 'Pause 2' }).waitFor()
      app.state.stageRetryFailsAgain = true
      await page.getByTestId('v2-retry-stage').click()
      await page.getByTestId('v2-stage-retry-details').filter({ hasText: 'Pause 3' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-retry-stage"]')?.disabled === false)
      assert.equal(await page.getByTestId('v2-request-error').count(), 0, 'A newer pause confirms the old retry was accepted without claiming success')
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).length, 2, 'No automatic replay after the step fails again')
      await page.getByTestId('v2-retry-stage').click()
      await page.getByTestId('v2-stage-save_recovery').filter({ hasText: 'In progress' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).length, 3)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).at(-1).body.confirmation, 'RETRY INFINIDYSK V2 STAGE paused-step-fixture nonce-3')
      assert.equal(app.state.calls.some(call => /\/(prepare|rehearse|start|rollback|cancel)$/.test(call.path)), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: v2 service recovery verifies an unready target and preserves reviewed pending services without restoring v1`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.generation = '2'; Object.assign(app.state.capabilities, consumerCapabilities, { infinidysk_v2_cancel: true })
    app.state.job = { ...consumerRecoveryJob(), status: 'interrupted', recovery_kind: 'v2_activation', activation_committed: false, can_finish_consumer_recovery: false, can_cancel: true, can_rollback: true, actions: { cancel: true, rollback: true } }
    app.state.job.consumer_recovery.ready = false
    let browser, releaseRecoveryRefresh
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-job-explanation').filter({ hasText: 'may contain new writes' }).waitFor()
      await page.getByTestId('v2-consumer-pending').filter({ hasText: 'Example Prowlarr' }).waitFor()
      assert.equal((await page.getByTestId('v2-consumer-failures').innerText()).includes('fixture-secret'), false)
      assert.equal(await page.getByTestId('v2-cancel').count(), 0)
      assert.equal(await page.getByTestId('v2-rollback').count(), 0, 'Conflicting legacy permissions cannot restore an exposed target')
      assert.match(await page.getByTestId('v2-retry-consumers').innerText(), /Verify\/restart v2/)
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-finish-consumers').count(), 0)
      await page.goto(`${app.origin}/?postgres`)
      await page.getByTestId('v2-pg-major-recovery').waitFor()
      assert.equal(await page.getByTestId('v2-pg-preview').isDisabled(), true)
      await page.goto(app.origin)
      await page.getByTestId('v2-retry-consumers-confirmation').fill('wrong')
      assert.equal(await page.getByTestId('v2-retry-consumers').isDisabled(), true)
      await page.getByTestId('v2-retry-consumers-confirmation').fill(app.state.job.confirmation_texts.retry_consumers)
      app.state.retryRejected = true; await page.getByTestId('v2-retry-consumers').click()
      await page.getByRole('alert').filter({ hasText: 'could not yet be verified' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-consumers')).length, 1)
      app.state.pgStatusGate = new Promise(resolve => { releaseRecoveryRefresh = resolve })
      const reconciling = page.waitForRequest(request => request.url().endsWith('/postgres/status'))
      app.state.retryRejected = false; await page.getByTestId('v2-retry-consumers').click()
      await reconciling
      await page.getByTestId('v2-job-explanation').filter({ hasText: 'cutover is retained' }).waitFor()
      await page.getByTestId('v2-finish-consumers-confirmation').fill(app.state.job.confirmation_texts.finish_consumer_recovery)
      assert.equal(await page.getByTestId('v2-finish-consumers').isDisabled(), true)
      await page.getByTestId('v2-finish-consumers-ack').check()
      assert.equal(await page.getByTestId('v2-finish-consumers').isDisabled(), true, 'The completed retry must reconcile status before another mutation')
      const reconciled = page.waitForResponse(response => response.url().endsWith('/postgres/status'))
      releaseRecoveryRefresh()
      await reconciled
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-finish-consumers-confirmation"]')?.value === ''
        && document.querySelector('[data-testid="v2-finish-consumers-ack"]')?.checked === false)
      await page.getByTestId('v2-finish-consumers-confirmation').fill(app.state.job.confirmation_texts.finish_consumer_recovery)
      await page.getByTestId('v2-finish-consumers-ack').check()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-finish-consumers"]')?.disabled === false)
      const refreshed = page.waitForResponse(response => response.url().endsWith('/postgres/status'))
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await refreshed
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-finish-consumers"]')?.disabled === false)
      assert.equal(await page.getByTestId('v2-finish-consumers-ack').isChecked(), true, 'Identical polling preserves review')
      assert.equal(await page.getByTestId('v2-finish-consumers').isEnabled(), true)
      app.state.job.consumer_recovery.pending.push('Example Plex')
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-consumer-pending').filter({ hasText: 'Example Plex' }).waitFor()
      assert.equal(await page.getByTestId('v2-finish-consumers-ack').isChecked(), false, 'Changed scope requires renewed review')
      assert.equal(await page.getByTestId('v2-finish-consumers-confirmation').inputValue(), '')
      app.state.capabilities.infinidysk_v2_consumer_recovery = false
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-consumer-recovery-unsupported').waitFor()
      assert.equal(await page.getByTestId('v2-retry-consumers').count(), 0)
      assert.equal(await page.getByTestId('v2-finish-consumers').count(), 0)
      app.state.capabilities.infinidysk_v2_consumer_recovery = true
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-finish-consumers-ack').check()
      await page.getByTestId('v2-finish-consumers-confirmation').fill(app.state.job.confirmation_texts.finish_consumer_recovery)
      await page.getByTestId('v2-finish-consumers').click()
      await page.getByTestId('v2-consumer-pending').filter({ hasText: 'Left stopped by review' }).waitFor()
      assert.equal(app.state.calls.find(call => call.path.endsWith('/finish-consumer-recovery')).body.acknowledge_pending_consumers, true)
      await page.reload()
      await page.getByTestId('v2-job-explanation').filter({ hasText: 'accepted that the listed pending services remain stopped' }).waitFor()
      assert.equal(await page.getByTestId('v2-finish-consumers').count(), 0)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-consumers')).length, 2, 'No replay after navigation or reload')
      assert.equal(app.state.calls.some(call => /\/(start|rehearse|cancel|rollback)$/.test(call.path)), false)
    } finally { releaseRecoveryRefresh?.(); await browser?.close(); await app.close() }
  })

  test(`${name}: manual rollback of a completed exposed target requires reviewed v2 write loss`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.generation = '2'; Object.assign(app.state.capabilities, consumerCapabilities, { infinidysk_v2_cancel: true })
    app.state.job = { ...consumerRecoveryJob(), status: 'completed', can_retry_consumers: false, can_finish_consumer_recovery: false, can_rollback: true, rollback_requires_discard_ack: true, rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 consumer-recovery-fixture' }
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-rollback-confirmation').fill(app.state.job.rollback_confirmation_text)
      assert.equal(await page.getByTestId('v2-rollback').isDisabled(), true)
      await page.getByTestId('v2-rollback-discard-ack').check()
      assert.equal(await page.getByTestId('v2-rollback').isEnabled(), true)
      assert.equal(await page.getByTestId('v2-cancel').count(), 0)
      app.state.job.rollback_requires_discard_ack = undefined
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-rollback').waitFor({ state: 'hidden' })
      app.state.job.rollback_requires_discard_ack = true
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-rollback-discard-ack').waitFor()
      assert.equal(await page.getByTestId('v2-rollback-discard-ack').isChecked(), false)
      await page.getByTestId('v2-rollback-discard-ack').check()
      await page.getByTestId('v2-rollback').click()
      await page.getByTestId('v2-job').filter({ hasText: 'rolled back' }).waitFor()
      assert.equal(app.state.calls.find(call => call.path.endsWith('/rollback')).body.acknowledge_discard_v2_writes, true)
      assert.equal(await page.getByTestId('v2-consumer-results').count(), 0)
      await page.reload()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 1)
    } finally { await browser?.close(); await app.close() }
  })

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
      await page.getByText('This preview has expired.', { exact: false }).waitFor()
      releaseRehearsal()
      await page.getByTestId('v2-job').filter({ hasText: 'Test migration passed' }).waitFor()
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
      await page.getByTestId('v2-job').filter({ hasText: 'rolled back' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 1)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: old APIs explain unavailable cancellation and confirmed orphan recovery remains visible`, { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.job = { job_id: 'legacy-worker-fixture', status: 'running', stage: 'importing', can_rollback: false }; let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration is running' }).waitFor()
      assert.equal(await page.getByTestId('v2-recovery-unavailable').count(), 0, 'Confirmed running work is not an unavailable recovery action')
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

  test(`${name}: native omissions require exact report review while explicit backend blockers stay blocked`, { timeout: 60000 }, async () => {
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

  test(`${name}: external legacy blob staging needs both consents and cannot silently downgrade or survive capability loss`, { timeout: 60000 }, async () => {
    const app = await fixture(); Object.assign(app.state.capabilities, storageCapabilities, { infinidysk_v2_low_space_migration: true, infinidysk_v2_external_blob_staging: true }); let browser
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-offload-legacy-blobs').waitFor()
      assert.equal(await page.getByTestId('v2-retain-source-space').isChecked(), true)
      assert.equal(await page.getByTestId('backup-storage-manage').evaluate(element => element.open), false)
      const offload = page.getByTestId('v2-offload-legacy-blobs')
      await offload.check()
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      await page.getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-source-storage-review').filter({ hasText: 'Legacy blobs will move' }).waitFor()
      const submitted = app.state.calls.filter(call => call.path === '/api/process/infinidysk-v2/preview').at(-1).body
      assert.equal(submitted.offload_legacy_blobs, true)
      assert.equal(submitted.reclaim_source_space, true)
      assert.equal(submitted.backup_destination_id, 'archive')
      assert.match(await page.getByTestId('v2-source-storage-review').innerText(), /recovery archive and working legacy files/)
      await acknowledgeMajor(page)
      await page.getByTestId('v2-ack-archive_recovery').check()
      assert.equal(await page.getByTestId('v2-rehearse').isDisabled(), true)
      await page.getByTestId('v2-ack-external_blob_staging').check()
      assert.equal(await page.getByTestId('v2-rehearse').innerText(), 'Test migration')
      await page.getByTestId('v2-rehearse').click()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-start"]')?.disabled === false)
      assert.equal(await page.getByTestId('v2-external-input-recovery').count(), 0, 'A passed test is not an outstanding external-input recovery')
      await page.getByTestId('v2-reclaim-source-space').check()
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      const reuse = app.state.calls.filter(call => call.path === '/api/process/infinidysk-v2/preview').at(-1).body
      assert.equal(reuse.reclaim_source_space, true)
      assert.equal(reuse.offload_legacy_blobs, undefined)
      assert.equal(await page.getByTestId('v2-ack-external_blob_staging').count(), 0)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      await offload.check(); app.state.dropOffloadEcho = true
      await page.getByTestId('v2-preview').click()
      await page.getByRole('alert').filter({ hasText: 'did not confirm the selected local-space' }).waitFor()
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      app.state.capabilities.infinidysk_v2_external_blob_staging = false
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'cannot confirm moving the legacy blobs' }).waitFor()
      assert.equal(await offload.isChecked(), true)
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      await page.getByTestId('v2-retain-source-space').check()
      assert.equal(await offload.count(), 0)
      assert.equal(await page.getByTestId('v2-preview').isEnabled(), true)
      assert.equal(app.state.calls.some(call => /\/(start|rollback|cancel)$/.test(call.path)), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': automatic restoration explains current work without attributing a user rollback request', { timeout: 60000 }, async () => {
    const app = await fixture(); let browser
    app.state.job = { job_id: 'automatic-restore-fixture', mode: 'rehearsal', status: 'rolling_back', stage: 'restoring_source', cancel_requested: false,
      error: 'The native import did not pass acceptance.', recovery_required: true, can_rollback: false, can_cancel: false }
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Restoring previous installation' }).waitFor()
      assert.equal(await page.getByTestId('v2-job-summary').innerText(), 'DUMB is restoring the previous installation. Restoration is not yet complete.')
      assert.match(await page.getByTestId('v2-job-failure').innerText(), /Earlier error.*native import did not pass acceptance/s)
      assert.doesNotMatch(await page.getByTestId('v2-job').innerText(), /rollback you requested/)
      assert.equal(app.state.calls.filter(call => call.method === 'POST').length, 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': admitted exposed rollback shows active restoration instead of historical consumer recovery', { timeout: 60000 }, async () => {
    const app = await fixture(); app.state.generation = '2'; Object.assign(app.state.capabilities, consumerCapabilities)
    app.state.job = { ...consumerRecoveryJob(), status: 'rolling_back', stage: 'restoring_source', recovery_required: true, progress: 100,
      message: 'Historical consumer recovery message.', error: 'Retained earlier service failure.',
      source_storage: { mode: 'archive_recovery', rollback_requires_archive: true, offload_legacy_blobs: true } }
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Restoring previous installation' }).waitFor()
      assert.match(await page.getByTestId('v2-job-summary').innerText(), /not yet complete/)
      assert.equal(await page.getByTestId('v2-job').locator('progress').getAttribute('value'), null, 'Old completed progress is not current rollback progress')
      assert.equal(await page.getByTestId('v2-job-explanation').count(), 0)
      assert.equal(await page.getByTestId('v2-consumer-recovery').count(), 0)
      assert.equal(await page.getByTestId('v2-consumer-results').count(), 0)
      assert.equal(await page.getByTestId('v2-recovery-unavailable').count(), 0)
      assert.match(await page.getByTestId('v2-archive-recovery-state').innerText(), /until this operation finishes/)
      assert.equal(await page.getByText('Historical consumer recovery message.', { exact: true }).isVisible(), false)
      assert.doesNotMatch(await page.getByTestId('v2-panel').innerText(), /waiting for an explicit recovery action|Retry pending consumers|listed pending services remain stopped/)
      for (const status of ['recovery_required', 'interrupted']) {
        app.state.job = { ...app.state.job, status }
        await page.getByTestId('v2-refresh-status').click()
        await page.getByTestId('v2-job-heading').filter({ hasText: 'service recovery needs review' }).waitFor()
        assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
        await page.getByTestId('v2-consumer-recovery').waitFor()
      }
      assert.equal(app.state.calls.some(call => ['rollback', 'retry-consumers', 'finish-consumer-recovery', 'cancel'].some(action => call.path.endsWith('/' + action))), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': snapshot before offload keeps active instructions separate from held external recovery', { timeout: 60000 }, async () => {
    const app = await fixture()
    app.state.job = { job_id: 'snapshot-before-offload', mode: 'rehearsal', status: 'running', stage: 'postgres_snapshot', message: 'Creating the source snapshot.',
      source_storage: { mode: 'archive_recovery', rollback_requires_archive: true, offload_legacy_blobs: true } }
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      const card = page.getByTestId('v2-archive-recovery-state')
      await card.waitFor()
      assert.match(await card.innerText(), /until this operation finishes/)
      assert.doesNotMatch(await card.innerText(), /job moved|offered recovery action|reconnect|Do not delete/i)
      assert.equal(await page.getByTestId('v2-external-input-recovery').count(), 0)
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 1)
      app.state.job = { ...app.state.job, status: 'recovery_required', recovery_required: true }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-external-input-recovery').filter({ hasText: 'reconnect' }).waitFor()
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: missing external input recovery survives reload without automatically restoring or changing storage`, { timeout: 60000 }, async () => {
    const app = await fixture(); Object.assign(app.state.capabilities, storageCapabilities, { infinidysk_v2_low_space_migration: true, infinidysk_v2_external_blob_staging: true })
    app.state.job = { job_id: 'external-recovery-fixture', mode: 'rehearsal', status: 'recovery_required', stage: 'restoring_source', error: 'External input mount is missing. api_key=fixture-secret',
      can_rollback: true, rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 external-recovery-fixture',
      source_storage: { mode: 'archive_recovery', reclaim_source_space: true, rollback_requires_archive: true, offload_legacy_blobs: true } }
    let browser
    try {
      browser = await type.launch({ headless: true }); const page = await browser.newPage(); await page.goto(app.origin)
      await page.getByTestId('v2-external-input-recovery').filter({ hasText: 'reconnect it' }).waitFor()
      assert.match(await page.getByTestId('v2-external-input-recovery').innerText(), /Keep the same migration backup location connected/)
      assert.match(await page.getByTestId('v2-external-input-recovery').innerText(), /Do not delete or re-register/)
      assert.equal((await page.getByTestId('v2-job').innerText()).includes('fixture-secret'), false)
      assert.equal(await page.getByTestId('v2-rollback').isDisabled(), true)
      await page.reload()
      await page.getByTestId('v2-external-input-recovery').waitFor()
      assert.equal(await page.getByTestId('v2-rollback').isDisabled(), true)
      assert.equal(app.state.calls.some(call => /\/(start|rehearse|rollback|cancel|profiles|default)$/.test(call.path)), false)
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
      assert.equal(await page.getByTestId('v2-archive-recovery-state').count(), 0, 'A passed test must not request an already finished restoration')
      await page.getByTestId('v2-retain-source-space').check()
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
      await page.getByTestId('v2-retain-source-space').click()
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
      assert.equal(await page.getByTestId('v2-offload-legacy-blobs').count(), 0)
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
      assert.match(await target.innerText(), /require a sign-in after the upgrade/)
      await target.getByText('Why sign-in is required', { exact: true }).click()
      assert.match(await target.innerText(), /stored policy unchanged/)
      assert.equal(await target.locator('input, select, button').count(), 0)
      app.state.generation = '2'; app.state.currentAuthPolicy = policy
      await page.reload()
      const current = page.getByTestId('v2-compatibility-auth-current')
      await current.waitFor()
      assert.match(await current.innerText(), /requires a sign-in/)
      await current.getByText('Why sign-in is required', { exact: true }).click()
      assert.match(await current.innerText(), /cannot relax this launch requirement/)
      assert.equal(await current.locator('input, select, button').count(), 0)
      delete app.state.currentAuthPolicy
      await page.reload()
      await page.getByText('InfiniDysk 2 is already selected.', { exact: false }).waitFor()
      assert.equal(await page.getByTestId('v2-compatibility-auth-current').count(), 0)
    } finally { await browser?.close(); await app.close() }
  })

  test(`${name}: packaged post-start walkthrough resumes retained setup through real Nuxt routes and API operations`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture('fresh'); app.state.bootstrap = true
    app.state.capabilities.setup_arrangements = true
    app.state.onboardingCompleted = true
    app.state.services = [{ process_name: 'Plex', config_key: 'plex', config: { enabled: true } }]
    app.state.setupRun = {
      run_id: 'packaged-setup-run', status: 'waiting_input', values: {}, checks: [],
      services: [{ id: 'plex', service_key: 'plex', process_name: 'Plex', status: 'running' }],
      arrangement_schema: { fields: [] },
      actions: [{ id: 'plex::account', service_key: 'plex', source: 'plex', label: 'Connect your Plex account', automation: 'manual', required: true,
        execution: 'waiting_input', verification: 'not_checked', ui_url: '/services/Plex', reason: 'Finish your account setup in Plex.',
        instructions: ['Open Plex in a new tab.', 'Sign in and create your first library.', 'Return to DUMB to record what you completed.'] }],
    }
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening')
    const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser; let child; let output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-2000) })
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Built frontend exited: ${output}`)
        try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break } } catch {}
        await delay(100)
      }
      assert.equal(ready, true, 'Built frontend must become ready')
      browser = await type.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      const origin = `http://127.0.0.1:${port}`
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      await Promise.all([
        page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/process\/setup\/runs\/[^/]+\/(?:actions\/|recheck$)/.test(new URL(response.url()).pathname)),
        page.goto(origin + '/setup-connections'),
      ])
      await page.getByRole('heading', { name: 'Connect your apps', exact: true }).waitFor()
      const guide = page.locator('[data-setup-walkthrough]')
      const current = guide.locator('[data-setup-walkthrough-action="plex::account"]')
      await current.getByRole('heading', { name: 'Connect your Plex account', exact: true }).waitFor()
      const initialPosts = app.state.calls.filter(call => call.method === 'POST' && call.path.startsWith('/api/process/setup/'))
      assert.ok(initialPosts.length > 0, 'Opening the real guide must refresh app schema through a read-only recheck')
      assert.equal(initialPosts.every(call => call.path.endsWith('/recheck') || call.body?.operation === 'recheck'), true)
      assert.equal(app.state.setupRun.actions[0].execution, 'waiting_input', 'Reading and rechecking cannot confirm a manual task')
      assert.equal(await current.locator('[data-setup-walkthrough-instructions] > li').count(), 3)
      await guide.getByRole('button', { name: 'Pause walkthrough', exact: true }).click()
      await guide.waitFor({ state: 'detached' })
      await page.reload()
      const resume = page.getByRole('button', { name: 'Resume guided setup', exact: true })
      await resume.waitFor()
      assert.equal(await guide.count(), 0, 'Reloading the dedicated page must respect an explicitly paused walkthrough')
      const paused = await page.evaluate(() => JSON.parse(localStorage.getItem('dumb.setup.walkthrough.v1')))
      assert.equal(paused.paused, true)
      assert.equal(paused.activeActionId, 'plex::account')
      await resume.click()
      await current.getByRole('heading', { name: 'Connect your Plex account', exact: true }).waitFor()
      assert.equal(await current.getAttribute('data-setup-walkthrough-action'), 'plex::account', 'Resuming keeps the retained action cursor')
      const appLink = current.getByRole('link', { name: 'Open app in a new tab', exact: true })
      assert.equal(await appLink.getAttribute('target'), '_blank')
      const popupPromise = page.waitForEvent('popup')
      await appLink.click()
      const popup = await popupPromise
      await popup.waitForURL(origin + '/services/Plex')
      await popup.locator('p').filter({ hasText: /^Plex$/ }).waitFor()
      await popup.getByRole('button', { name: 'Service tools', exact: true }).waitFor()
      assert.notEqual(new URL(popup.url()).pathname, '/onboarding', 'Native setup must remain accessible after the onboarding handoff')
      await popup.close()
      await current.getByRole('button', { name: 'I completed this in the app', exact: true }).click()
      await current.getByText('Confirmed by you; not automatically checked', { exact: true }).waitFor()
      assert.equal(app.state.setupRun.actions[0].verification, 'not_checked')
      assert.equal(app.state.setupRun.actions[0].evidence.level, 'user_attested')
      assert.equal(await current.count(), 1, 'The returned confirmation remains visible until the user advances')
      await guide.getByRole('button', { name: 'Next step', exact: true }).click()
      await guide.locator('[data-setup-walkthrough-summary]').waitFor()
      assert.match(await guide.locator('[data-setup-walkthrough-count]').innerText(), /0 checked · 1 confirmed by you · 0 still need attention/)
      assert.match(await guide.locator('[data-setup-walkthrough-confirmations]').innerText(), /separately from automatically checked/)
      await page.goto(origin + '/setup-connections?view=checklist')
      await page.locator('[data-setup-full-checklist]').waitFor()
      assert.equal(await page.locator('[data-setup-walkthrough]').count(), 0)
      assert.equal(new URL(page.url()).pathname, '/setup-connections')
      assert.equal(app.state.calls.some(call => call.method === 'POST' && (call.path === '/api/process/setup/runs' || /start-core-service|setup\/plan/.test(call.path))), false,
        'The saved setup walkthrough must never replay installation or start a new setup run')
      assert.deepEqual(errors, [])
    } finally {
      await browser?.close()
      if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
      await app.close()
    }
  })

  test(`${name}: packaged fresh installation notices respect service selection and keep onboarding navigation clickable`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture('fresh'); app.state.bootstrap = true
    app.state.capabilities.optional_only_onboarding = true
    app.state.onboardingCatalog = [{ key: 'infinidysk', name: 'InfiniDysk', dependencies: ['rclone'], service_options: {}, debrid_providers: [], description: 'Usenet library mounting.' }]
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening')
    const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser; let child; let output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-2000) })
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Built frontend exited: ${output}`)
        try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break } } catch {}
        await delay(100)
      }
      assert.equal(ready, true, 'Built frontend must become ready')
      browser = await type.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1150, height: 650 } })
      const theme = name === 'chromium' ? 'light' : 'retro'
      await page.addInitScript(value => localStorage.setItem('dmbdb.appearance.theme', value), theme)
      const origin = `http://127.0.0.1:${port}`
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      const openRoute = async path => {
        await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === '/api/process/infinidysk-v2/status'),
          page.waitForResponse(response => new URL(response.url()).pathname === '/api/process/processes'),
          page.goto(origin + path),
        ])
        await page.getByRole('heading', { name: path === '/onboarding' ? 'Onboarding Wizard' : path === '/setup-connections' ? 'Connect your apps' : 'Service Dashboard', exact: true }).waitFor()
      }
      const assertClickable = async button => {
        await button.scrollIntoViewIfNeeded()
        assert.equal(await button.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return target === element || element.contains(target)
        }), true, 'The real notice must not cover onboarding navigation')
        await button.click({ trial: true })
      }
      await openRoute('/')
      assert.equal(await page.getByTestId('v2-open-major').count(), 0, 'An absent service must not advertise an optional fresh installation')
      assert.equal(await page.getByTestId('v2-upgrade-invitation').count(), 0)
      app.state.services = [{ process_name: 'InfiniDysk', config_key: 'infinidysk', config: { enabled: false } }]
      await openRoute('/')
      assert.equal(await page.getByTestId('v2-open-major').count(), 0, 'A disabled service must not advertise an optional fresh installation')
      assert.equal(await page.getByTestId('v2-upgrade-invitation').count(), 0)
      app.state.services[0].config.enabled = true
      await openRoute('/')
      assert.equal(await page.getByTestId('v2-open-major').count(), 0, 'Enabling InfiniDysk must not advertise an optional fresh installation')
      assert.equal(await page.getByTestId('v2-upgrade-invitation').count(), 0)
      await openMajorFromServiceTools(page, origin)
      assert.match(await page.getByTestId('v2-panel').innerText(), /Fresh installation/)
      await page.getByTestId('v2-panel').getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      app.state.majorMode = 'migrate'
      app.state.services[0].config.enabled = false
      await openRoute('/')
      assert.equal(await page.getByTestId('v2-upgrade-invitation').count(), 0, 'A disabled v1 service must not receive an upgrade invitation')
      app.state.services[0].config.enabled = true
      await openRoute('/')
      const invitation = page.getByTestId('v2-upgrade-invitation')
      const invitationKey = 'dumb.infinidyskV2.upgradeInvitation.v1'
      await invitation.waitFor()
      await openRoute('/setup-connections')
      assert.equal(await invitation.count(), 0, 'Optional upgrade invitations must not interrupt the post-install connection walkthrough')
      await openRoute('/')
      await invitation.waitFor()
      for (const paragraph of await invitation.locator('p').all()) await assertReadable(paragraph, `${theme} optional upgrade invitation`)
      for (const action of ['v2-review-upgrade', 'v2-remind-tomorrow', 'v2-remind-week', 'v2-dismiss-upgrade']) await assertReadable(page.getByTestId(action), `${theme} ${action}`)
      await page.getByTestId('v2-review-upgrade').click()
      await page.getByTestId('v2-panel').waitFor()
      await page.getByTestId('v2-panel').getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      await page.getByTestId('v2-remind-tomorrow').click()
      await invitation.waitFor({ state: 'detached' })
      const tomorrow = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), invitationKey)
      assert.equal(tomorrow.dismissed, false)
      assert.ok(tomorrow.snoozedUntil > Date.now() / 1000)
      await openRoute('/')
      assert.equal(await invitation.count(), 0, 'A timed reminder must stay hidden after reload')
      const expireReminder = () => page.evaluate(key => {
        const preference = JSON.parse(localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ ...preference, snoozedUntil: 1 }))
      }, invitationKey)
      await expireReminder(); await openRoute('/')
      await invitation.waitFor()
      await page.getByTestId('v2-remind-week').click()
      await invitation.waitFor({ state: 'detached' })
      const week = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), invitationKey)
      assert.equal(week.dismissed, false)
      assert.ok(week.snoozedUntil > tomorrow.snoozedUntil)
      await openRoute('/')
      assert.equal(await invitation.count(), 0)
      await expireReminder()
      app.state.generation = '2'
      await openRoute('/')
      assert.equal(await invitation.count(), 0, 'A generation 2 installation must not receive a v1 upgrade invitation')
      app.state.generation = '1'
      await openRoute('/')
      await invitation.waitFor()
      await page.getByTestId('v2-dismiss-upgrade').click()
      await invitation.waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).dismissed, invitationKey), true)
      await openRoute('/')
      assert.equal(await invitation.count(), 0, 'Permanent dismissal must survive reload')
      app.state.job = { job_id: 'dismissed-invitation-fixture', mode: 'rehearsal', status: 'running', stage: 'importing', can_cancel: false, created_at: Math.floor(Date.now() / 1000) }
      await openRoute('/')
      await page.getByTestId('v2-open-major').filter({ hasText: 'Open progress / recovery' }).waitFor()
      assert.equal(await invitation.count(), 0)
      app.state.job = null
      // Begin an independent onboarding scenario without the previous active
      // job's deliberately retained browser recovery reference.
      await page.evaluate(key => {
        localStorage.removeItem(key)
        sessionStorage.removeItem('dumb.infinidyskV2.jobs.v1')
      }, invitationKey)
      app.state.onboardingCompleted = false
      await openRoute('/onboarding')
      await page.getByRole('heading', { name: 'Guided setup', exact: true }).waitFor()
      assert.equal(await page.getByTestId('v2-open-major').count(), 0, 'Onboarding must not display the optional installation offer')
      assert.equal(await invitation.count(), 0, 'Onboarding must not advertise an optional v1 upgrade')
      const skip = page.getByRole('button', { name: 'Skip Onboarding', exact: true })
      const next = page.getByRole('button', { name: 'Next', exact: true })
      await assertClickable(skip); await assertClickable(next)
      await next.click()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      app.state.services[0].config.enabled = false
      app.state.job = { job_id: 'onboarding-notice-fixture', mode: 'rehearsal', status: 'running', stage: 'importing', message: 'Testing the retained installation.', can_cancel: false, created_at: Math.floor(Date.now() / 1000) }
      await openRoute('/onboarding')
      await page.getByTestId('v2-open-major').filter({ hasText: 'Open progress / recovery' }).waitFor()
      await assertClickable(skip); await assertClickable(next)
      await page.getByTestId('v2-open-major').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration is running' }).waitFor()
      await page.getByTestId('v2-panel').getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      await skip.click()
      await page.waitForURL(origin + '/')
      assert.equal(app.state.calls.some(call => call.path === '/api/config/onboarding-completed' && call.method === 'POST'), true)
      assert.equal(app.state.calls.some(call => /infinidysk-v2\/(preview|prepare|start|rehearse|cancel|activate|rollback)/.test(call.path) && call.method === 'POST'), false, 'Notice visibility and onboarding navigation cannot mutate the migration')
    } finally {
      await browser?.close()
      if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
      await app.close()
    }
  })

  test(`${name}: packaged prepared review keeps downtime and same-candidate activation readable after reload`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 60000 }, async () => {
    const app = await fixture(); app.state.bootstrap = true
    app.state.capabilities.infinidysk_v2_prepared_activation = true
    app.state.capabilities.startup_lifecycle = true
    app.state.startup = { phase: 'recovery_required', maintenance_kind: 'infinidysk_prepared', terminal: true, expected_services: ['DUMB API', 'DUMB Frontend'], services: {}, failures: {} }
    app.state.services = [{ process_name: 'Example Sonarr', config_key: 'sonarr', config: { enabled: true } }]
    app.state.serviceStatuses = { 'Example Sonarr': 'stopped' }
    app.state.job = { job_id: 'prepared-visual-fixture', mode: 'prepare', prepare_mode: 'migrate', status: 'prepared', stage: 'awaiting_activation', can_activate: true, can_rollback: true,
      stage_progress: stageProgress('review', 'waiting'), storage_work: storageWork(),
      activate_confirmation: 'ACTIVATE INFINIDYSK V2 prepared-visual-fixture', rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 prepared-visual-fixture',
      affected_services: ['Example Sonarr'], result: { validated: true }, import_report: preparedReport,
      created_at: Math.floor(Date.now() / 1000) - 7200, updated_at: Math.floor(Date.now() / 1000),
      provider_diagnostics: { schema_version: 1, final: true, providers: [
        { provider_ordinal: 1, requests: 1200, bytes_received: 8 * 1024 ** 2, retries: 2, failures: { timeout: 2, article_missing: 9 } },
      ], unbound_failures: {} } }
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening')
    const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser; let child; let output = ''
    try {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DUMB_API_URL: app.origin, DMB_API_URL: app.origin, DUMB_TRAEFIK_URL: app.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-2000) })
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Built frontend exited: ${output}`)
        try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break } } catch {}
        await delay(100)
      }
      assert.equal(ready, true, 'Built frontend must become ready')
      browser = await type.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1150, height: 1000 } })
      const origin = `http://127.0.0.1:${port}`
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      const theme = name === 'chromium' ? 'light' : 'retro'
      await page.addInitScript(value => localStorage.setItem('dmbdb.appearance.theme', value), theme)
      await page.goto(origin)
      await page.getByTestId('v2-open-major').filter({ hasText: 'Review and activate' }).waitFor()
      const startup = page.locator('[data-startup-status]')
      await startup.getByRole('heading', { name: 'InfiniDysk migration maintenance' }).waitFor()
      assert.equal(await startup.evaluate(element => element.classList.contains('startup-status-error')), false)
      await assertReadable(startup.locator('p').first(), theme + ' typed prepared maintenance notice')
      await page.getByTestId('v2-open-major').click(); await page.getByTestId('v2-prepared-review').waitFor()
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
      for (const id of ['v2-job-summary', 'v2-prepared-downtime']) await assertReadable(page.getByTestId(id), theme + ' ' + id)
      const retainedPreparedJob = structuredClone(app.state.job)
      Object.assign(app.state.capabilities, stageRetryCapabilities, { infinidysk_v2_cancel: true })
      app.state.job = stageRetryJob()
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-stage-retry').waitFor()
      for (const viewport of [{ width: 1150, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport)
        await assertReadable(page.getByTestId('v2-stage-retry-details'), theme + ' paused DUMB step details')
        await assertReadable(page.getByTestId('v2-job-next'), theme + ' paused DUMB step choices')
        assert.equal(await page.getByTestId('v2-stage-retry').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
      }
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
      await page.getByTestId('v2-retry-stage').click()
      await page.getByTestId('v2-stage-save_recovery').filter({ hasText: 'In progress' }).waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/retry-stage')).length, 1)
      assert.equal(app.state.job.job_id, 'paused-step-fixture')
      app.state.job = retainedPreparedJob
      await page.getByTestId('v2-refresh-status').click(); await page.getByTestId('v2-prepared-review').waitFor()
      const tracker = page.getByTestId('v2-stages')
      await tracker.waitFor()
      assert.equal(await page.getByTestId('v2-storage-comparison').getAttribute('open'), null)
      for (const viewport of [{ width: 1150, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport)
        await assertReadable(page.getByTestId('v2-stage-review').locator('.v2-stage-label'), theme + ' review stage')
        await assertReadable(page.getByTestId('v2-stage-review').locator('.v2-stage-state'), theme + ' review status')
        assert.equal(await tracker.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Stage list fits the viewport')
        await tracker.scrollIntoViewIfNeeded()
        if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/migration-stages-' + name + '-' + viewport.width + '.png' })
        const details = page.getByTestId('v2-storage-comparison')
        if (await details.getAttribute('open') === null) await details.locator('summary').first().click()
        const comparison = page.getByTestId('v2-storage-work')
        await assertReadable(comparison.locator('h4'), theme + ' storage work heading')
        await assertReadable(page.getByTestId('v2-storage-path-reuse_local').getByTestId('v2-storage-preparation'), theme + ' storage work counters')
        assert.equal(await comparison.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Storage comparison fits the viewport')
        await page.getByTestId('v2-storage-path-reuse_local').scrollIntoViewIfNeeded()
        if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/migration-storage-' + name + '-' + viewport.width + '.png' })
        await details.locator('summary').first().click()
      }
      await page.setViewportSize({ width: 1150, height: 1000 })
      const providers = page.getByTestId('v2-provider-diagnostics')
      await providers.getByText('Retained provider observations', { exact: true }).waitFor()
      await assertReadable(providers.locator('h4'), theme + ' retained provider heading')
      await assertReadable(providers.getByTestId('v2-provider-row').locator('p').first(), theme + ' provider counters')
      await providers.getByText('Connection and protocol errors', { exact: true }).click()
      await assertReadable(providers.getByText('Timed out: 2', { exact: true }), theme + ' provider error category')
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await providers.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/provider-observations-' + name + '.png' })
      await page.getByTestId('v2-prepared-review').scrollIntoViewIfNeeded()
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/prepared-review-' + name + '.png' })
      await page.getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      await page.reload(); await page.getByTestId('v2-open-major').filter({ hasText: 'Review and activate' }).waitFor()
      await page.getByTestId('v2-open-major').click(); await page.getByTestId('v2-prepared-review').waitFor()
      assert.equal(app.state.calls.filter(call => /\/(prepare|activate|start|rehearse)$/.test(call.path)).length, 0)
      await page.getByTestId('v2-activate-confirmation').fill(app.state.job.activate_confirmation)
      await page.getByTestId('v2-activate').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Activating prepared InfiniDysk 2' }).waitFor()
      assert.equal(app.state.job.job_id, 'prepared-visual-fixture')
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/activate')).length, 1)
      app.state.generation = '2'; app.state.job = { ...app.state.job, status: 'completed', stage: 'completed', stage_progress: stageProgress('resume_services', 'completed'), activation_exposed: true, activation_committed: true, result: { validated: true, generation_2_started: true, restart_required: true } }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-next').filter({ hasText: 'Restart DUMB once' }).waitFor()
      await assertReadable(page.getByTestId('v2-job-next'), theme + ' explicit final restart instruction')
      app.state.generation = '1'; app.state.job = { ...app.state.job, status: 'rolling_back', stage: 'restoring_source', stage_progress: recoveryStageProgress(), activation_exposed: false, activation_committed: false, cancel_requested: false, result: {}, error: 'The owned activation check failed.' }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Restoring previous installation' }).waitFor()
      assert.equal(await page.getByTestId('v2-job-summary').innerText(), 'DUMB is restoring the previous installation. Restoration is not yet complete.')
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/rollback')).length, 0)
      app.state.job = { ...app.state.job, status: 'failed_restored', stage: 'failed', stage_progress: recoveryStageProgress('completed'), result: { source_restored: true, restart_required: true }, error: 'The owned activation check failed; the retained v1 source was restored.' }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration failed; v1 restored' }).waitFor()
      await page.getByTestId('v2-job-next').filter({ hasText: 'Restart DUMB once' }).waitFor()
      assert.equal(await page.getByTestId('v2-storage-comparison').getAttribute('open'), null)
      assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-testid="v2-job-failure"]').compareDocumentPosition(document.querySelector('[data-testid="v2-stages"]')) & Node.DOCUMENT_POSITION_FOLLOWING)), true)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-job-failure').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/migration-failure-' + name + '.png' })
      }
      app.state.job = { ...app.state.job, status: 'cancelled', error: null }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Migration cancelled; v1 restored' }).waitFor()
      await page.getByTestId('v2-job-next').filter({ hasText: 'Restart DUMB once' }).waitFor()
      app.state.job = { ...app.state.job, result: { source_restored: true } }
      await page.getByTestId('v2-refresh-status').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-job-next"]')?.textContent.includes('Restart DUMB'))
      app.state.job = null; app.state.stagePlan = { ...stageProgress(), current_step_id: null,
        steps: stageProgress().steps.map(step => ({ ...step, state: 'pending' })) }
      app.state.storageWork = storageWork(); app.state.capacity = capacityEstimate(false)
      app.state.previewBlockers = ['Resolve this example source check before continuing.']
      await page.getByTestId('v2-refresh-status').click(); await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-preview-blockers').waitFor()
      const positions = await page.getByTestId('v2-review').evaluate(review => Object.fromEntries(
        ['v2-preview-blockers', 'v2-capacity', 'v2-stages', 'v2-storage-work'].map(id => [id, review.querySelector('[data-testid="' + id + '"]').getBoundingClientRect().top])))
      assert.ok(positions['v2-preview-blockers'] < positions['v2-stages'] && positions['v2-capacity'] < positions['v2-stages'] && positions['v2-capacity'] < positions['v2-storage-work'], JSON.stringify(positions))
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-preview-blockers').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/migration-preview-blockers-' + name + '.png' })
      }
    } finally {
      await browser?.close()
      if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
      await app.close()
    }
  })

  test(`${name}: production dashboard keeps migration review and recovery readable in light appearances`, { skip: process.env.DUMB_TEST_BUILT !== '1', timeout: 90000 }, async () => {
    const app = await fixture('fresh'); app.state.bootstrap = true
    app.state.services = [{ process_name: 'InfiniDysk', config_key: 'infinidysk', config: { enabled: true } }, { process_name: 'Example Sonarr', config_key: 'sonarr', config: { enabled: true } }, { process_name: 'Example PostgreSQL', config_key: 'postgres', config: { enabled: true } }]
    app.state.installedSource = { schema_version: 1, repository: 'nicocapalbo/dmbdb', source_kind: 'branch', requested_ref: 'dev', commit_sha: 'a'.repeat(40), package_version: frontendPackageVersion }
    const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening')
    const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
    let browser; let child; let output = ''; let releaseTestRequest; let releasePreviewRequest
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
      assert.equal(await page.getByTestId('v2-open-major').count(), 0)
      await openMajorFromServiceTools(page, uiOrigin)
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
      Object.assign(app.state.capabilities, consumerCapabilities)
      app.state.generation = '2'; app.state.job = consumerRecoveryJob(); app.state.blockers = []
      await page.reload(); await page.getByTestId('v2-open-major').click()
      await assertReadable(page.getByTestId('v2-job-explanation'), `${theme} retained v2 recovery instructions`)
      await assertReadable(page.getByTestId('v2-consumer-failures').locator('li').first(), `${theme} retained consumer failure`)
      await assertReadable(page.getByTestId('v2-finish-consumers-ack').locator('..'), `${theme} stopped consumers acknowledgement`)
      await page.getByTestId('v2-finish-consumers-ack').check()
      await page.getByTestId('v2-finish-consumers-confirmation').fill(app.state.job.confirmation_texts.finish_consumer_recovery)
      await page.getByTestId('v2-finish-consumers').click()
      await page.getByTestId('v2-consumer-pending').filter({ hasText: 'Left stopped by review' }).waitFor()
      await page.getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      await page.reload()
      await assertReadable(page.getByTestId('v2-open-major').locator('..').locator('p').first().filter({ hasText: 'services left stopped' }), `${theme} persistent stopped consumers notice`)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/finish-consumer-recovery')).length, 1)
      app.state.job.consumer_recovery.pending = []; app.state.job.consumer_recovery.failed = []; app.state.job.consumer_recovery.resumed.push('Example Sonarr', 'Example Prowlarr')
      Object.assign(app.state.job, { can_rollback: true, rollback_requires_discard_ack: true, rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 consumer-recovery-fixture' })
      await page.reload()
      await page.getByTestId('v2-open-major').locator('..').locator('p').first().filter({ hasText: 'cutover completed' }).waitFor()
      await page.getByTestId('v2-open-major').click()
      await page.getByRole('heading', { name: 'Service recovery results', exact: true }).waitFor()
      await assertReadable(page.getByTestId('v2-rollback-discard-ack').locator('..'), `${theme} v2 write loss acknowledgement`)
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
      await openMajorFromServiceTools(page, uiOrigin)
      await page.getByTestId('backup-storage').waitFor()
      await assertReadable(page.getByTestId('backup-storage').getByText('Migration recovery archives may use network storage.', { exact: false }), `${theme} network archive limits`)
      Object.assign(app.state.capabilities, { infinidysk_v2_low_space_migration: true, infinidysk_v2_external_blob_staging: true })
      app.state.majorMode = 'migrate'; app.state.capacity = stagedCapacityEstimate()
      app.state.previewWarnings = [
        'The native beta import can read NNTP and requires a real contained rehearsal.',
        'Keep independent backups. Rollback returns to retained v1 data and never merges later v2 writes.',
        'Timezone, existing library paths and outputs are preserved; OIDC must be explicitly verified.',
        'Rehearsal can temporarily stop all affected managed consumers and the v1 source.',
        'Fixture additional provider notice',
      ]
      // Keep the explicitly opened dialog. Retained operation status stays
      // separate from the optional v1 upgrade invitation. Refresh the fixture's
      // new mode in place.
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('backup-storage-selection').selectOption('archive')
      await page.getByTestId('v2-offload-legacy-blobs').check()
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-capacity-projection-note').waitFor()
      assert.equal(await page.getByTestId('backup-storage-manage').evaluate(element => element.open), false)
      assert.match(await page.getByTestId('v2-capacity').innerText(), /Observed free space now/)
      assert.match(await page.getByTestId('v2-capacity').innerText(), /Expected local space released/)
      const capacityRows = page.getByTestId('v2-capacity-filesystem')
      assert.match(await capacityRows.nth(0).innerText(), /Filesystem 1 · Before moving legacy files/)
      assert.match(await capacityRows.nth(2).innerText(), /Filesystem 1 · After freeing local space/)
      await assertReadable(page.getByTestId('v2-offload-storage-explanation'), `${theme} external input explanation`)
      await assertReadable(page.getByTestId('v2-capacity-projection-note'), `${theme} projected capacity explanation`)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.setViewportSize({ width: 1440, height: 1280 })
        await page.getByTestId('v2-panel').evaluate(element => { element.scrollTop = 0 })
        await page.screenshot({ path: `${process.env.DUMB_MIGRATION_SCREENSHOT_DIR}/migration-choices-${name}.png` })
        await page.getByTestId('v2-capacity').scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${process.env.DUMB_MIGRATION_SCREENSHOT_DIR}/migration-capacity-${name}.png` })
      }
      Object.assign(app.state.capabilities, { infinidysk_v2_async_preview: true })
      app.state.previewElapsed = 125
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-refresh-feedback').filter({ hasText: 'Status refreshed' }).waitFor()
      await page.getByTestId('backup-storage-selection').selectOption('@default')
      await page.locator('input[value="fuse"]').check()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      app.state.previewStartGate = new Promise(resolve => { releasePreviewRequest = resolve })
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-request-pending-heading').filter({ hasText: 'Requesting migration preview' }).waitFor()
      await page.waitForFunction(() => document.activeElement?.dataset.testid === 'v2-request-pending-heading'
        && document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().bottom <= innerHeight)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/preview-request-pending-' + name + '.png' })
      releasePreviewRequest()
      await page.getByTestId('v2-preview-status').filter({ hasText: 'Elapsed: 2m' }).waitFor()
      await page.getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      await page.getByTestId('v2-open-preview').waitFor()
      await assertReadable(page.getByTestId('v2-open-preview').locator('..').locator('p').first(), theme + ' global read-only preview notice')
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/async-preview-notice-' + name + '.png' })
      await page.getByTestId('v2-open-preview').click()
      await page.getByTestId('v2-preview-status').waitFor()
      await assertReadable(page.getByTestId('v2-preview-status').locator('p').first(), theme + ' read-only preview status')
      assert.equal(await page.getByTestId('v2-preview').isDisabled(), true)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-panel').evaluate(element => { element.scrollTop = 0 })
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/async-preview-progress-' + name + '.png' })
      }
      app.completePreview()
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-refresh-feedback').filter({ hasText: 'Preview ready for review' }).waitFor()
      await page.getByTestId('v2-review').waitFor()
      await assertReadable(page.getByTestId('v2-refresh-feedback'), theme + ' refreshed preview result')
      assert.equal(app.state.previewScans, 1)
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview/start')).length, 1)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-review').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/async-preview-refreshed-' + name + '.png' })
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await acknowledgeMajor(page)
      await page.getByTestId('v2-ack-archive_recovery').check()
      await page.getByTestId('v2-ack-external_blob_staging').check()
      app.state.rehearsalFailed = true
      app.state.rehearsalFailureError = 'The PostgreSQL source snapshot could not be exported. v1 was restored; review the retained job before another test.'
      app.state.rehearsalGate = new Promise(resolve => { releaseTestRequest = resolve })
      await page.getByTestId('v2-rehearse').click()
      const pendingHeading = page.getByTestId('v2-request-pending-heading')
      await pendingHeading.filter({ hasText: 'Requesting test migration' }).waitFor()
      await page.waitForFunction(() => document.activeElement?.dataset.testid === 'v2-request-pending-heading'
        && document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().bottom <= innerHeight)
      await assertReadable(page.getByTestId('v2-request-pending').locator('p').first(), theme + ' pending test request')
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/test-request-pending-' + name + '.png' })
      releaseTestRequest()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      await assertReadable(page.getByTestId('v2-job-summary'), theme + ' restored test result')
      await assertReadable(page.getByTestId('v2-job-failure').locator('p'), theme + ' snapshot failure')
      assert.equal(await page.getByTestId('v2-job').locator('progress').count(), 0)
      assert.equal(await page.getByTestId('v2-preview-status').count(), 0)
      assert.equal(await page.getByTestId('v2-archive-recovery-state').count(), 0)
      assert.equal(await page.getByTestId('v2-recovery-unavailable').count(), 0)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/test-failed-restored-' + name + '.png' })
      app.state.generation = '2'
      app.state.job = { ...consumerRecoveryJob(), status: 'rolling_back', stage: 'restoring_source', recovery_required: true, progress: 100,
        source_storage: { mode: 'archive_recovery', rollback_requires_archive: true, offload_legacy_blobs: true } }
      await page.getByTestId('v2-refresh-status').click()
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Restoring previous installation' }).waitFor()
      await assertReadable(page.getByTestId('v2-job-summary'), theme + ' active restoration result')
      assert.equal(await page.getByTestId('v2-consumer-recovery').count(), 0)
      assert.equal(await page.getByTestId('v2-job').locator('progress').getAttribute('value'), null)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-job-heading').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/rollback-running-' + name + '.png' })
      }
      await page.evaluate(() => {
        const status = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('status')
        status.applyPayload({ type: 'status', processes: ['Example Sonarr', 'Example PostgreSQL'].map(process_name => ({ process_name, status: 'running', healthy: true, health_status: 'healthy' })) })
      })
      const sidebarSonarr = page.locator('[data-service-name="Example Sonarr"]').first()
      const sidebarDatabase = page.locator('[data-service-name="Example PostgreSQL"]').first()
      await sidebarSonarr.locator('.bg-emerald-400').waitFor({ state: 'attached' })
      app.state.generation = '1'; app.state.blockers = []
      // This is a separate job scenario. Do not let the preceding preview's
      // fractional timestamp sort after the synthetic 125-second-old job.
      app.state.previewTask = null
      app.state.serviceStatuses = { 'Example Sonarr': 'stopped', 'Example PostgreSQL': 'running' }
      app.state.job = { job_id: 'snapshot-observation', mode: 'rehearsal', status: 'running', stage: 'postgres_snapshot', created_at: Math.floor(Date.now() / 1000) - 125, updated_at: Math.floor(Date.now() / 1000), affected_services: ['Example Sonarr'], snapshot_progress: { phase: 'source_inventory', table: 'HistoryItems', table_index: 5, table_count: 7, rows: 37000, elapsed_seconds: 24 } }
      await page.getByTestId('v2-snapshot-progress').filter({ hasText: 'Table 5 of 7' }).waitFor()
      await sidebarSonarr.locator('.bg-slate-500').waitFor({ state: 'attached' })
      assert.equal(await sidebarDatabase.locator('.bg-emerald-400').count(), 1)
      await assertReadable(page.getByTestId('v2-snapshot-progress').locator('p').first(), theme + ' PostgreSQL snapshot progress')
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-job-heading').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/snapshot-progress-' + name + '.png' })
      }
      assert.equal(await page.getByTestId('v2-recovery-unavailable').count(), 0)
      app.state.job = { ...app.state.job, stage: 'postgres_restore_verification', snapshot_progress: { ...app.state.job.snapshot_progress, phase: 'restore_verification', restore_phase: 'restoring_database' } }
      await page.getByTestId('v2-current-phase').filter({ hasText: 'Testing PostgreSQL recovery' }).waitFor()
      assert.doesNotMatch(await page.getByTestId('v2-snapshot-progress').innerText(), /Table 5 of 7|37,000/)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/snapshot-restore-progress-' + name + '.png' })
      app.state.serviceStatusOffline = ['Example Sonarr']; app.state.job = { ...app.state.job, stage: 'snapshotting' }
      await page.waitForFunction(() => !document.querySelector('[data-service-name="Example Sonarr"] .bg-slate-500') && !document.querySelector('[data-service-name="Example Sonarr"] .bg-emerald-400'))
      assert.equal(await sidebarDatabase.locator('.bg-emerald-400').count(), 1)
      app.state.serviceStatusOffline = []; app.state.serviceStatuses['Example Sonarr'] = 'running'
      app.state.job = { ...app.state.job, status: 'failed_restored', stage: 'failed', result: { source_restored: true } }
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      await sidebarSonarr.locator('.bg-emerald-400').waitFor({ state: 'attached' })
      assert.equal(await page.getByTestId('v2-snapshot-progress').count(), 0)
      const scanNow = Math.floor(Date.now() / 1000)
      app.state.job = { job_id: 'scan-estimate-visual', status: 'running', mode: 'rehearsal', stage: 'revalidating', created_at: scanNow - 120, updated_at: scanNow,
        scan_progress: { scan_id: 'a1b2c3_1', phase_sequence: 1, phase: 'source_data', entries_processed: 1000, entries_total: 10000, total_is_estimate: true, logical_bytes_processed: 1024 ** 3, elapsed_seconds: 30, rate_entries_per_second: 100, estimated_remaining_seconds: 90, estimate_scope: 'current_scan', updated_at: scanNow, complete: false } }
      app.state.blockers = ['An InfiniDysk 2 operation is already running. Its status is shown below.']
      await page.getByTestId('v2-scan-eta').filter({ hasText: /About 2m.*remaining in this scan/ }).waitFor()
      await page.getByTestId('v2-running-admission').waitFor()
      for (const id of ['v2-scan-count', 'v2-scan-rate', 'v2-scan-eta']) await assertReadable(page.getByTestId(id), theme + ' ' + id)
      assert.equal(await page.getByTestId('v2-recovery-unavailable').count(), 0)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-job-heading').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/scan-estimate-' + name + '.png' })
      }
      app.state.job = { ...app.state.job, scan_progress: { ...app.state.job.scan_progress, scan_id: 'a1b2c3_2', phase_sequence: 2, phase: 'source_runtime', entries_processed: 10, entries_total: null, logical_bytes_processed: 65536, rate_entries_per_second: null, estimated_remaining_seconds: null, elapsed_seconds: 3, updated_at: Math.floor(Date.now() / 1000) } }
      await page.getByTestId('v2-scan-estimate-note').filter({ hasText: 'Measuring the current pace' }).waitFor()
      assert.equal(await page.getByTestId('v2-scan-eta').count(), 0)
      await assertReadable(page.getByTestId('v2-scan-estimate-note'), theme + ' unavailable scan estimate')
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/scan-estimate-unavailable-' + name + '.png' })
      const ioNow = Math.floor(Date.now() / 1000)
      // This separate long-running operation was admitted after its reviewed
      // preview. Preserve that ordering when its terminal result is observed.
      if (app.state.previewTask?.status === 'completed') {
        app.state.previewTask = { ...app.state.previewTask, created_at: ioNow - 1800, updated_at: ioNow - 1740,
          preview: { ...app.state.previewTask.preview, expires_at: ioNow - 1440 } }
      }
      app.state.serviceStatuses['Example Sonarr'] = 'stopped'
      const io = (phase, unit, processed, total, patch = {}) => ({ phase_id: 'visual-' + phase, phase, unit, processed, total, total_is_estimate: false, elapsed_seconds: 45, rate_per_second: unit === 'bytes' ? 8 * 1024 ** 2 : 100, estimated_remaining_seconds: total !== null && total > processed ? Math.ceil((total - processed) / (unit === 'bytes' ? 8 * 1024 ** 2 : 100)) : null, updated_at: Math.floor(Date.now() / 1000), complete: false, ...patch })
      app.state.job = { job_id: 'io-visual', mode: 'rehearsal', status: 'running', stage: 'archiving', created_at: ioNow - 1500, updated_at: ioNow, affected_services: ['Example Sonarr'],
        io_progress: io('archive_write', 'bytes', 24 * 1024 ** 3, 64 * 1024 ** 3, { total_is_estimate: true }), snapshot_progress: { phase: 'snapshot_receipt', restore_phase: 'verifying_database', rows: 37000 } }
      // Reconnect normally to this independent long-running operation. The
      // previous scenario's accepted preview observation must not be rewound.
      await page.reload()
      await page.getByTestId('v2-open-major').click()
      await page.getByTestId('v2-panel').waitFor()
      // This HTTP fixture has no WebSocket server. Restore only the unaffected
      // service's ordinary global observation; Sonarr comes from its real GET.
      await page.evaluate(() => {
        const status = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('status')
        status.applyPayload({ type: 'status', processes: [{ process_name: 'Example PostgreSQL', status: 'running', healthy: true, health_status: 'healthy' }] })
      })
      await sidebarDatabase.locator('.bg-emerald-400').waitFor({ state: 'attached' })
      await page.getByTestId('v2-io-count').filter({ hasText: /24(?:\.0+)? GiB/ }).waitFor()
      await page.getByTestId('v2-io-eta').waitFor()
      await sidebarSonarr.locator('.bg-slate-500').waitFor({ state: 'attached' })
      assert.equal(await sidebarDatabase.locator('.bg-emerald-400').count(), 1)
      assert.equal(await page.getByTestId('v2-snapshot-progress').count(), 0)
      assert.doesNotMatch(await page.locator('body').innerText(), /Comparing the restored database with the snapshot/)
      assert.equal(await page.getByTestId('v2-scan-progress').count(), 0)
      for (const id of ['v2-io-count', 'v2-io-rate', 'v2-io-eta']) await assertReadable(page.getByTestId(id), theme + ' ' + id)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) {
        await page.getByTestId('v2-job-heading').scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/io-archive-progress-' + name + '.png' })
      }
      app.state.job = { ...app.state.job, stage: 'preparing_blob_staging', io_progress: io('blob_metadata', 'entries', 120000, 320000, { elapsed_seconds: 3, rate_per_second: null, estimated_remaining_seconds: null }) }
      await page.getByTestId('v2-io-count').filter({ hasText: '120,000' }).waitFor()
      assert.equal(await page.getByTestId('v2-io-eta').count(), 0)
      await assertReadable(page.getByTestId('v2-io-estimate-note'), theme + ' IO estimate fallback')
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/io-metadata-progress-' + name + '.png' })
      app.state.job = { ...app.state.job, stage: 'verifying_blob_staging', io_progress: io('blob_verify_staged', 'bytes', 40 * 1024 ** 3, 60 * 1024 ** 3) }
      await page.getByTestId('v2-io-count').filter({ hasText: /40(?:\.0+)? GiB/ }).waitFor()
      await page.getByTestId('v2-io-eta').waitFor()
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/io-readback-progress-' + name + '.png' })
      app.state.blockers = []
      app.state.serviceStatuses['Example Sonarr'] = 'running'
      app.state.job = { ...app.state.job, status: 'failed_restored', stage: 'failed', error: 'A recorded migration input file changed.', result: { source_restored: true },
        input_integrity: { code: 'recorded_entry_changed', side: 'staged', entry_type: 'file', changed_fields: ['ctime_ns'], path_digest: 'd'.repeat(64), path: '/private/fixture-secret/blob.bin' } }
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      await page.getByTestId('v2-input-integrity').waitFor()
      await sidebarSonarr.locator('.bg-emerald-400').waitFor({ state: 'attached' })
      assert.equal(await page.getByTestId('v2-running-admission').count(), 0)
      assert.equal(await page.getByText('An InfiniDysk 2 operation is already running. Its status is shown below.', { exact: true }).count(), 0)
      assert.equal(await page.getByTestId('v2-io-progress').count(), 0)
      assert.doesNotMatch(await page.locator('body').innerText(), /fixture-secret|\/private\//)
      for (const id of ['v2-input-integrity-side', 'v2-input-integrity-changes', 'v2-input-integrity-reference']) await assertReadable(page.getByTestId(id), theme + ' ' + id)
      if (process.env.DUMB_MIGRATION_SCREENSHOT_DIR) await page.screenshot({ path: process.env.DUMB_MIGRATION_SCREENSHOT_DIR + '/input-integrity-failed-' + name + '.png' })

    } finally {
      releaseTestRequest?.()
      releasePreviewRequest?.()
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
      assert.match(await page.getByTestId('v2-backup-storage-review').innerText(), /working v2 database.*stay local/)
      await acknowledgeMajor(page); await page.getByTestId('v2-rehearse').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="v2-start"]').disabled)
      await selector.selectOption('@default')
      assert.equal(await page.getByTestId('v2-review').count(), 0)
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      assert.equal(await page.getByTestId('v2-ack-backup').isChecked(), false)
      assert.equal(await page.getByTestId('backup-storage-manage').evaluate(element => element.open), false)
      await page.getByText('Manage backup locations', { exact: true }).click()
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
      for (const text of ['Retained backups · Candidate installation', '150 GiB', '100 GiB', '50 GiB', '10 GiB', 'Estimates are not a reservation']) assert.ok(summary.includes(text), text)
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
      await page.getByTestId('v2-job').filter({ hasText: 'Test migration passed' }).waitFor()
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
      await page.getByTestId('v2-job-heading').filter({ hasText: 'Test migration failed; v1 restored' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-preview"]')?.disabled === false)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      const previews = app.state.calls.filter(call => call.path.endsWith('/preview')).length
      app.state.rehearsalFailed = false
      await page.getByTestId('v2-preview').click(); await page.getByTestId('v2-review').waitFor()
      assert.equal(app.state.calls.filter(call => call.path.endsWith('/preview')).length, previews + 1)
      assert.equal(await page.getByTestId('v2-ack-backup').isChecked(), false)
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      await acknowledgeMajor(page); await page.getByTestId('v2-rehearse').click()
      await page.getByTestId('v2-job').filter({ hasText: 'Test migration passed' }).waitFor()
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
      assert.equal(await page.getByTestId('v2-pg-current-provider').count(), 0, 'Unconfirmed native status cannot identify the active provider')
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

  test(`${name}: native PG preview explains existing SQLite and an unprepared destination without starting a move`, { timeout: 60000 }, async () => {
    const app = await fixture('postgres'); let browser
    app.state.pgPreviewError = 'The PostgreSQL destination database does not exist. Create a new empty database with C collation before preview; choosing managed PostgreSQL only reuses its connection settings.'
    try {
      browser = await type.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(`${app.origin}/?postgres`)
      await page.getByTestId('v2-pg-current-provider').filter({ hasText: 'Current provider: SQLite' }).waitFor()
      const prerequisites = page.getByTestId('v2-pg-destination-prerequisites')
      assert.match(await prerequisites.innerText(), /dedicated, empty database with C collation/)
      assert.match(await prerequisites.innerText(), /does not create one/)
      assert.match(await prerequisites.innerText(), /inherits the cluster locale/)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/postgres/preview')), false, 'Opening the form does not provision or preview a destination')
      app.state.pgProvider = 'constructor'
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-pg-current-provider').waitFor({ state: 'detached' })
      app.state.pgProvider = 'sqlite'
      await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
      await page.getByTestId('v2-pg-current-provider').filter({ hasText: 'SQLite' }).waitFor()
      await page.getByTestId('v2-pg-preview').click()
      await page.getByRole('alert').filter({ hasText: app.state.pgPreviewError }).waitFor()
      assert.equal(await page.getByTestId('v2-pg-start').count(), 0)
      assert.match(await page.getByTestId('v2-pg-current-provider').innerText(), /SQLite/)
      assert.equal(app.state.calls.some(call => /\/postgres\/(start|cutover|cancel|rollback)$/.test(call.path)), false)
      app.state.pgPreviewError = ''
      await page.getByTestId('v2-pg-database').fill('another_empty_database')
      await page.getByTestId('v2-pg-preview').click()
      await page.getByTestId('v2-review').waitFor()
      assert.equal(await page.getByRole('alert').count(), 0)
      assert.equal(await page.getByTestId('v2-pg-start').isDisabled(), true, 'A new successful preview still requires independent review and confirmation')
    } finally { await browser?.close(); await app.close() }
  })
}
