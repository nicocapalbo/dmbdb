import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskCompatibilityAuthRequired } from '../helper/infinidyskV2.js'
import {
  apiVersionSupportsInfiniDyskV2, formatInfiniDyskV2Bytes, infinidyskRcloneOptimizerAllowed, infinidyskV2AcknowledgementsReady, infinidyskV2Capacity,
  infinidyskV2ConfigChangeReason, infinidyskV2InventoryRows, infinidyskV2MajorReady,
  infinidyskV2NeedsAttention, infinidyskV2NoticeVisible, infinidyskV2PreviewFresh, infinidyskV2RenewedPreview, infinidyskV2Selection,
  infinidyskV2Support, infinidyskV2LowSpaceSupported, infinidyskV2SourceStorageMatches, infinidyskV2AcknowledgementKeys, infinidyskV2ImportReport, infinidyskV2SkipReviewReady, infinidyskV2ErrorText, infinidyskV2CancelReady, infinidyskV2CancelSupported, infinidyskV2ImportProgress, infinidyskV2JobExplanation, normalizeInfiniDyskV2Job, safeInfiniDyskV2Text, infinidyskV2CleanupReady, infinidyskV2CleanupSupported, isInfiniDyskV2JobActive,
} from '../helper/infinidyskV2.js'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { infinidyskV2Repository } from '../services/infinidyskV2.js'
import { resolveConfiguredSourceTarget } from '../helper/configuredSourceTarget.js'

const capabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1, infinidysk_v2_postgres: true }
const preview = { protocol: 1, ready: true, preview_token: 'private-preview', plan_fingerprint: 'public-plan', confirmation_text: 'MIGRATE InfiniDysk', expires_at: 2000000000, required_acknowledgements: ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream'], rehearsal_required: true }
const acknowledgements = { backup: true, downtime: true, beta: true, oidc_policy: true, downstream: true }
const rehearsalJob = { job_id: 'rehearsal-1', status: 'rehearsed', mode: 'rehearsal', plan_fingerprint: 'public-plan', result: { validated: true } }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('compatibility authentication notice requires the explicit enforced policy and stays read-only metadata', () => {
  const policy = { enforced: true, mode: 'required', reason: 'legacy_compatibility_listener' }
  assert.equal(infinidyskCompatibilityAuthRequired({ compatibility_auth_policy: policy }), true)
  for (const changed of [{ enforced: false }, { enforced: 'true' }, { mode: null }, { mode: 'local' }, { reason: null }]) assert.equal(infinidyskCompatibilityAuthRequired({ compatibility_auth_policy: { ...policy, ...changed } }), false)
  assert.equal(infinidyskCompatibilityAuthRequired({}), false)
  assert.equal(infinidyskCompatibilityAuthRequired(null), false)
})
const makeController = (overrides = {}, stored = {}) => {
  const state = { value: initialInfiniDyskV2State() }
  const storage = { value: JSON.stringify(stored), getItem() { return this.value }, setItem(key, value) { this.value = value }, removeItem() { this.value = null } }
  const repository = { capabilities: async () => capabilities, status: async () => ({ protocol: 1, runtime_generation: '1', job: null }), ...overrides }
  return { state, storage, repository, ...createInfiniDyskV2Controller({ state, repository, storage }) }
}

test('strict API SemVer rejects unknown, old, malformed and floor prereleases', () => {
  for (const value of [null, 2.24, '', '2.23.99', '2.24', 'v2.24.0', '02.24.0', '2.24.0-beta.6', '2.24.0-01', '2.24.0garbage', ' 2.24.0']) assert.equal(apiVersionSupportsInfiniDyskV2(value), false, String(value))
  for (const value of ['2.24.0', '2.24.0+build.1', '2.24.1', '2.25.0-beta.1', '3.0.0']) assert.equal(apiVersionSupportsInfiniDyskV2(value), true, value)
})

test('capability booleans and protocol never coerce or borrow frontend/process versions', () => {
  assert.deepEqual(infinidyskV2Support(capabilities), { runtime: true, migration: true, postgres: true })
  for (const changed of [{ api_version: undefined }, { api_version: '2.23.0' }, { infinidysk_v2: 'true' }, { infinidysk_v2_migration_protocol: '1' }, { infinidysk_v2_migration_protocol: 2 }]) assert.equal(infinidyskV2Support({ ...capabilities, ...changed }).migration, false)
  assert.equal(infinidyskV2Support({ ...capabilities, infinidysk_v2_postgres: 'true' }).postgres, false)
  assert.equal(infinidyskV2Support({ DUMB_VERSION: '2.24.0', appVersion: '9.0.0' }).runtime, false)
})

test('migration preserves the current owner and always keeps import strategy separate', () => {
  assert.deepEqual(infinidyskV2Selection({ mode: 'migrate', current: { mount_backend: 'rclone' } }), { mode: 'migrate', mount_backend: 'rclone', import_strategy: 'preserve' })
  assert.equal(infinidyskV2Selection({ current: { mount_backend: 'fuse' } }).mount_backend, 'fuse')
  assert.equal(infinidyskV2Selection({ mode: 'fresh' }, 'fuse').mode, 'fresh')
})

test('local storage reuse requires explicit migration and archive capabilities', () => {
  const caps = { ...capabilities, infinidysk_v2_low_space_migration: true, infinidysk_v2_migration_backup_storage: true, backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['infinidysk_v2_archive'] }
  const status = { mode: 'migrate', runtime_generation: '1' }
  assert.equal(infinidyskV2LowSpaceSupported(caps, status), true)
  for (const change of [{ infinidysk_v2_low_space_migration: undefined }, { infinidysk_v2_low_space_migration: 'true' }, { infinidysk_v2_migration_backup_storage: false }, { backup_storage_protocol: '1' }, { backup_storage_kinds: [] }, { api_version: '2.23.0' }]) assert.equal(infinidyskV2LowSpaceSupported({ ...caps, ...change }, status), false)
  for (const change of [{ mode: 'fresh' }, { runtime_generation: '2' }, { mode: undefined }]) assert.equal(infinidyskV2LowSpaceSupported(caps, { ...status, ...change }), false)
})

test('reviewed source storage never silently changes the requested recovery policy', () => {
  const source_storage = { mode: 'archive_recovery', reclaim_source_space: true, rollback_requires_archive: true }
  const selected = { ...preview, source_storage, backup_storage: { mode: 'cold_archive' }, required_acknowledgements: [...preview.required_acknowledgements, 'archive_recovery'] }
  assert.equal(infinidyskV2SourceStorageMatches(selected, true), true)
  assert.equal(infinidyskV2SourceStorageMatches(preview, false), true, 'Older backend previews remain compatible with the default')
  assert.equal(infinidyskV2SourceStorageMatches(selected, false), false)
  for (const change of [{ source_storage: undefined }, { source_storage: { ...source_storage, reclaim_source_space: 'true' } }, { source_storage: { ...source_storage, rollback_requires_archive: false } }, { backup_storage: { mode: 'local_tree' } }, { required_acknowledgements: preview.required_acknowledgements }]) assert.equal(infinidyskV2SourceStorageMatches({ ...selected, ...change }, true), false)
  assert.equal(infinidyskV2SourceStorageMatches({ source_storage: { mode: 'retain_local', reclaim_source_space: false, rollback_requires_archive: false } }, false), true)
  assert.equal(infinidyskV2AcknowledgementsReady(selected, acknowledgements), false)
  assert.equal(infinidyskV2AcknowledgementsReady(selected, { ...acknowledgements, archive_recovery: true }), true)
  assert.deepEqual(infinidyskV2AcknowledgementKeys({ required_acknowledgements: ['archive_recovery', 'archive_recovery'] }), [])
  assert.deepEqual(infinidyskV2AcknowledgementKeys({ required_acknowledgements: ['unknown'] }), [])
})

const reviewedImport = {
  status: 'review_required', imported_files: 100, skipped_files: 1,
  reasons: [{ reason: 'Example excluded metadata', count: 1 }], skipped: [{ path: '/content/example.mkv', reason: 'Example excluded metadata' }],
  review_digest: 'a'.repeat(64), review_required: true, blocking_reasons: [],
  skipped_details_truncated: false, reasons_truncated: false, skipped_details_count: 1, reason_count: 1,
}

test('native skip review requires complete typed summary, explicit capability and per-report acknowledgement', () => {
  const caps = { ...capabilities, infinidysk_v2_reviewed_skips: true }
  const report = infinidyskV2ImportReport(reviewedImport)
  assert.equal(report.valid, true)
  assert.equal(infinidyskV2SkipReviewReady(caps, report, true), true)
  assert.equal(infinidyskV2SkipReviewReady(capabilities, report, true), false)
  assert.equal(infinidyskV2SkipReviewReady(caps, report, false), false)
  assert.equal(infinidyskV2SkipReviewReady(capabilities, null, false), true, 'Older zero-skip APIs stay compatible')
  assert.equal(infinidyskV2SkipReviewReady(caps, null, true), false, 'New backends must provide their reviewed report even when a job claims validation')
  for (const change of [{ skipped_files: '1' }, { review_digest: 'invalid' }, { blocking_reasons: ['Provider recovery unavailable'] }, { skipped: [] }, { reasons: [] }, { review_required: false }, { status: 'unknown' }, { skipped_details_count: 2 }, { reason_count: 2 }]) {
    const result = infinidyskV2ImportReport({ ...reviewedImport, ...change })
    assert.equal(result.valid, false)
    assert.equal(infinidyskV2SkipReviewReady(caps, result, true), false)
  }
  const blocked = infinidyskV2ImportReport({ ...reviewedImport, status: 'blocked', review_required: false, blocking_reasons: ['Metadata recovery needs provider access'] })
  assert.equal(blocked.valid, true)
  assert.equal(infinidyskV2SkipReviewReady(caps, blocked, true), false)
  const truncated = infinidyskV2ImportReport({ ...reviewedImport, skipped_files: 201, reasons: [{ reason: 'Example excluded metadata', count: 201 }], skipped: Array.from({ length: 200 }, (_, index) => ({ path: `/content/example-${index}.mkv`, reason: 'Example excluded metadata' })), skipped_details_count: 201, skipped_details_truncated: true })
  assert.equal(truncated.valid, true)
  assert.equal(truncated.truncated, true)
  assert.equal(infinidyskV2SkipReviewReady(caps, truncated, true), true, 'The digest binds the full list, available through the native report endpoint')
})

test('native text report requests still show bounded JSON API errors without exposing arbitrary bodies', () => {
  assert.equal(infinidyskV2ErrorText({ response: { data: JSON.stringify({ detail: 'Report unavailable https://example.invalid/?token=hidden' }) } }), 'Report unavailable [URL omitted]')
  for (const data of ['private raw response', JSON.stringify({ detail: 'secret' }).padEnd(16001, ' ')]) assert.match(infinidyskV2ErrorText({ response: { data } }), /could not be confirmed/)
})

test('optimizer keeps v1 compatibility but never sends v2 through legacy SQL and trace tools', () => {
  const legacy = { rclone_optimizer_infinidysk: true }
  const modern = { ...capabilities, ...legacy, infinidysk_v2_rclone_optimizer: false }
  assert.equal(infinidyskRcloneOptimizerAllowed(legacy, null), true)
  assert.equal(infinidyskRcloneOptimizerAllowed(modern, null), false)
  assert.equal(infinidyskRcloneOptimizerAllowed(modern, { runtime_generation: '1' }, true), true)
  const native = { runtime_generation: '2', current: { mount_backend: 'rclone' } }
  assert.equal(infinidyskRcloneOptimizerAllowed(modern, native, true), false)
  assert.equal(infinidyskRcloneOptimizerAllowed({ ...modern, infinidysk_v2_rclone_optimizer: true }, native, true), true)
  assert.equal(infinidyskRcloneOptimizerAllowed({ ...modern, infinidysk_v2_rclone_optimizer: true }, { ...native, current: { mount_backend: 'fuse' } }, true), false)
  assert.equal(infinidyskRcloneOptimizerAllowed({ ...modern, infinidysk_v2_rclone_optimizer: true }, native, false), false)
})

test('cutover needs a fresh fully acknowledged preview and matching successful rehearsal', () => {
  const input = { preview, confirmation: preview.confirmation_text, acknowledgements, job: rehearsalJob, rehearsalJob, now: 1900000000000 }
  assert.equal(infinidyskV2MajorReady(input), true)
  for (const changed of [{ rehearsalJob: null }, { rehearsalJob: { ...rehearsalJob, plan_fingerprint: 'other-plan' } }, { rehearsalJob: { ...rehearsalJob, result: { validated: false } } }, { confirmation: 'wrong' }, { now: 2100000000000 }, { acknowledgements: { ...acknowledgements, backup: false } }, { job: { job_id: 'running', status: 'running' } }]) assert.equal(infinidyskV2MajorReady({ ...input, ...changed }), false)
  for (const status of ['completed', 'failed_restored', 'failed', 'running', 'cancelled', 'unknown-new-phase']) assert.equal(infinidyskV2MajorReady({ ...input, rehearsalJob: { ...rehearsalJob, status } }), false, status)
  assert.equal(infinidyskV2MajorReady({ ...input, rehearsalJob: { ...rehearsalJob, mode: 'cutover' } }), false)
  assert.equal(infinidyskV2MajorReady({ ...input, job: { ...rehearsalJob, cleanup: { state: 'verifying' } } }), false)
  assert.equal(infinidyskV2PreviewFresh({ ...preview, expires_at: null }), false)
  assert.equal(infinidyskV2AcknowledgementsReady({ ...preview, required_acknowledgements: ['unknown'] }, { unknown: true }), false)
})

test('a long successful rehearsal can adopt only its exact backend-renewed preview expiry', () => {
  const now = 1900000000000, expired = { ...preview, expires_at: now / 1000 - 1 }
  const job = { ...rehearsalJob, preview_expires_at: now / 1000 + 1800 }
  const renewed = infinidyskV2RenewedPreview(expired, job, now)
  assert.equal(infinidyskV2PreviewFresh(expired, now), false)
  assert.equal(infinidyskV2PreviewFresh(renewed, now), true)
  assert.deepEqual(renewed, { ...expired, expires_at: job.preview_expires_at })
  assert.equal(renewed.preview_token, expired.preview_token)
  for (const change of [{ status: 'running' }, { status: 'cancelled' }, { status: 'failed_restored' }, { mode: 'cutover' }, { plan_fingerprint: 'other' }, { result: { validated: false } }, { preview_expires_at: String(job.preview_expires_at) }, { preview_expires_at: NaN }, { preview_expires_at: now / 1000 - 2 }]) assert.equal(infinidyskV2RenewedPreview(expired, { ...job, ...change }, now), expired)
  assert.equal(infinidyskV2RenewedPreview({ ...expired, ready: false }, job, now).ready, false)
  assert.equal(infinidyskV2RenewedPreview(renewed, job, now), renewed, 'Repeated status polling does not alter the same reviewed preview')
})

test('unknown job phases remain blocking and recovery does not disappear with capabilities', () => {
  assert.equal(infinidyskV2NeedsAttention({ job_id: 'job-1', status: 'unknown-new-phase' }), true)
  assert.equal(infinidyskV2NeedsAttention({ job_id: 'job-1', status: 'failed', recovery_required: true }), true)
  assert.equal(infinidyskV2NeedsAttention({ job_id: 'job-1', status: 'completed' }), false)
  assert.equal(normalizeInfiniDyskV2Job({ job_id: '../other', status: 'running' }), null)
  assert.equal(normalizeInfiniDyskV2Job({ job: rehearsalJob }), rehearsalJob)
})

test('backend rehearsal outcomes are terminal while recovery and cleanup still block', () => {
  for (const status of ['rehearsed', 'failed_restored']) {
    const job = { ...rehearsalJob, status }
    assert.equal(isInfiniDyskV2JobActive(job), false)
    assert.equal(infinidyskV2NeedsAttention(job), false)
    assert.equal(infinidyskV2NeedsAttention({ ...job, recovery_required: true }), true)
    assert.equal(isInfiniDyskV2JobActive({ ...job, cleanup: { state: 'deleting' } }), true)
  }
})

const cancellable = { job_id: 'active-import', status: 'running', stage: 'importing', can_cancel: true, cancel_requested: false, cancel_confirmation_text: 'CANCEL INFINIDYSK V2 active-import', actions: { cancel: true, rollback: false } }

test('cooperative cancellation requires explicit capability and current job authorization independently of new-work admission', () => {
  const caps = { ...capabilities, infinidysk_v2_cancel: true }
  const input = { capabilities: caps, confirmed: true, busy: false, job: cancellable, confirmation: cancellable.cancel_confirmation_text }
  assert.equal(infinidyskV2CancelSupported(caps), true)
  assert.equal(infinidyskV2CancelReady(input), true)
  assert.equal(infinidyskV2NeedsAttention(cancellable), true, 'New work remains blocked while guarded cancellation is allowed')
  for (const change of [{ capabilities }, { capabilities: { ...caps, infinidysk_v2_cancel: 'true' } }, { confirmed: false }, { busy: true }, { confirmation: 'wrong' }, { job: { ...cancellable, cancel_requested: true } }, { job: { ...cancellable, cancel_requested: 'false' } }, { job: { ...cancellable, cancel_requested: undefined } }, { job: { ...cancellable, status: 'completed' } }, { job: { ...cancellable, can_cancel: false, actions: { cancel: false } } }, { job: { ...cancellable, cancel_confirmation_text: 'CANCEL another-job' } }, { job: { ...cancellable, cleanup: { state: 'deleting' } } }]) assert.equal(infinidyskV2CancelReady({ ...input, ...change }), false)
  assert.equal(isInfiniDyskV2JobActive({ ...cancellable, status: 'cancelled', cancel_requested: true, result: { source_restored: true } }), false)
  assert.match(infinidyskV2JobExplanation({ ...cancellable, message: 'Contained native stage: done' }), /not yet completed acceptance or recovery/)
  assert.match(infinidyskV2JobExplanation({ ...cancellable, stage: 'validating' }), /checking the report and retained identities/)
  assert.match(infinidyskV2JobExplanation({ ...cancellable, stage: 'rolling_back' }), /restoring the retained source/)
  assert.match(infinidyskV2JobExplanation({ ...cancellable, cancel_requested: true }), /Cancellation was requested/)
  assert.match(infinidyskV2JobExplanation({ ...cancellable, status: 'recovery_required', cancel_requested: true }), /needs recovery review/)
  assert.match(infinidyskV2JobExplanation({ ...cancellable, status: 'cancelled', cancel_requested: true, result: { source_restored: true } }), /cancellation finished/)
})

test('controller never submits stale, unadvertised or already-requested cancellation', async () => {
  let caps = { ...capabilities, infinidysk_v2_cancel: true }, currentJob = { ...cancellable }, calls = 0
  const controller = makeController({ capabilities: async () => caps, status: async () => ({ protocol: 1, runtime_generation: '1', job: currentJob }), cancel: async () => { calls++; currentJob = { ...currentJob, cancel_requested: true, can_cancel: false, actions: { cancel: false } }; return { job: currentJob } } })
  await controller.refresh()
  await assert.rejects(controller.mutate('major', 'cancel', { job_id: 'other-job', confirmation: cancellable.cancel_confirmation_text }), /exact migration job/)
  caps = capabilities; await controller.refresh()
  await assert.rejects(controller.mutate('major', 'cancel', { job_id: currentJob.job_id, confirmation: cancellable.cancel_confirmation_text }), /cancellation authorization/)
  assert.equal(calls, 0)
  caps = { ...capabilities, infinidysk_v2_cancel: true }; await controller.refresh()
  await controller.mutate('major', 'cancel', { job_id: currentJob.job_id, confirmation: cancellable.cancel_confirmation_text })
  assert.equal(calls, 1)
  await assert.rejects(controller.mutate('major', 'cancel', { job_id: currentJob.job_id, confirmation: cancellable.cancel_confirmation_text }), /cancellation authorization/)
  assert.equal(calls, 1)
})

test('a late accepted cancellation preserves terminal restored wording through reconciliation and reload', async () => {
  let currentJob = { ...cancellable }
  const repository = {
    capabilities: async () => ({ ...capabilities, infinidysk_v2_cancel: true }),
    status: async () => ({ protocol: 1, runtime_generation: '1', job: currentJob }),
    cancel: async () => {
      currentJob = { ...currentJob, status: 'failed_restored', stage: 'failed', cancel_requested: true, can_cancel: false, actions: { cancel: false }, result: { source_restored: true, validated: false } }
      return { job: currentJob }
    },
  }
  const controller = makeController(repository)
  await controller.refresh()
  await controller.mutate('major', 'cancel', { job_id: currentJob.job_id, confirmation: currentJob.cancel_confirmation_text })
  const restored = controller.state.value.majorJob
  assert.equal(controller.state.value.busy, false)
  assert.equal(restored.cancel_requested, true)
  assert.equal(isInfiniDyskV2JobActive(restored), false)
  assert.match(infinidyskV2JobExplanation(restored), /original service was restored/)
  assert.doesNotMatch(infinidyskV2JobExplanation(restored), /Cancellation was requested|must stop|before this job releases/)
  assert.equal(infinidyskV2MajorReady({ preview, confirmation: preview.confirmation_text, acknowledgements, job: restored, rehearsalJob: restored, now: 1900000000000 }), false)
  const reloaded = makeController(repository, JSON.parse(controller.storage.value))
  await reloaded.refresh()
  assert.equal(infinidyskV2JobExplanation(reloaded.state.value.majorJob), infinidyskV2JobExplanation(restored))
  for (const source_restored of [false, undefined, 'true']) assert.match(infinidyskV2JobExplanation({ ...restored, result: { source_restored } }), /Cancellation was requested/)
})

test('observed native progress exposes only typed available counts without inventing totals or deadlines', () => {
  const progress = infinidyskV2ImportProgress({ stage: 'files', processed: 2, total: 5990, elapsed_seconds: 901, provider_connections: 0, provider_requests: 0, password: 'hidden', url: 'https://example.invalid/?token=hidden' })
  assert.equal(progress.stage, 'files')
  assert.deepEqual(progress.rows.map(row => row.value), [2, 5990, 901, 0, 0])
  assert.doesNotMatch(JSON.stringify(progress), /hidden|https:/)
  assert.deepEqual(infinidyskV2ImportProgress({ processed: 2 }), { stage: '', rows: [{ key: 'processed', label: 'Processed records', value: 2 }] })
  for (const invalid of [null, [], {}, { stage: 'https://example.invalid' }, { total: '12' }, { elapsed_seconds: -1 }, { processed: 0.5 }, { provider_connections: Infinity }]) assert.equal(infinidyskV2ImportProgress(invalid), null)
})

test('native cleanup reminders remain visible without blocking the usable SQLite source', () => {
  const job = { job_id: 'cancelled-copy', status: 'cancelled', cleanup_required: true }
  assert.equal(infinidyskV2NoticeVisible(job), true)
  assert.equal(infinidyskV2NeedsAttention(job), false)
  assert.equal(infinidyskV2AcknowledgementsReady(preview, { ...acknowledgements, downstream: false }), false)
})

test('display helpers omit URLs, credentials and nested secret inventories', () => {
  assert.equal(safeInfiniDyskV2Text('Failed https://example.invalid/.ids/token?key=secret password=hunter2'), 'Failed [URL omitted] password=[redacted]')
  assert.deepEqual(infinidyskV2InventoryRows({ symlinks: 12, stream_urls: ['secret'], credentials: 'secret' }), [{ label: 'symlinks', value: '12' }])
})

const capacity = {
  status: 'insufficient', complete: true, estimated: true, reserved: false, observed_at: 2000000000,
  source: { entries: 350000, logical_bytes: 64 * 1024 ** 3, root_count: 1 },
  filesystems: [{ id: 'filesystem_1', roles: ['retained_backup', 'candidate'], base_required_bytes: 140 * 1024 ** 3, safety_margin_bytes: 10 * 1024 ** 3, required_bytes: 150 * 1024 ** 3, free_bytes: 100 * 1024 ** 3, shortfall_bytes: 50 * 1024 ** 3, sufficient: false }],
}

test('capacity shows one shared filesystem estimate with its included margin and shortfall', () => {
  const result = infinidyskV2Capacity(capacity)
  assert.equal(result.status, 'insufficient')
  assert.deepEqual(result.source, capacity.source)
  assert.equal(result.filesystems.length, 1)
  assert.deepEqual(result.filesystems[0].roles, ['Retained backups', 'Candidate installation'])
  assert.equal(formatInfiniDyskV2Bytes(result.filesystems[0].required_bytes), '150 GiB')
  assert.equal(formatInfiniDyskV2Bytes(result.filesystems[0].free_bytes), '100 GiB')
  assert.equal(formatInfiniDyskV2Bytes(result.filesystems[0].shortfall_bytes), '50 GiB')
  const sufficient = infinidyskV2Capacity({ ...capacity, status: 'sufficient', filesystems: [{ ...capacity.filesystems[0], free_bytes: 200 * 1024 ** 3, shortfall_bytes: 0, sufficient: true }] })
  assert.equal(sufficient.status, 'sufficient')
  assert.equal(formatInfiniDyskV2Bytes(sufficient.filesystems[0].shortfall_bytes), '0 B')
})

test('capacity remains optional and incomplete or malformed estimates never become zero or success', () => {
  assert.equal(infinidyskV2Capacity(undefined), null)
  for (const changed of [null, false, [], {}, { ...capacity, complete: false }, { ...capacity, status: 'unavailable' }, { ...capacity, status: 'sufficient' }, { ...capacity, reserved: true }, { ...capacity, source: { ...capacity.source, entries: null } }, { ...capacity, filesystems: [] }]) {
    const result = infinidyskV2Capacity(changed)
    assert.equal(result.status, 'unavailable')
    assert.equal(result.source, null)
    for (const row of result.filesystems) assert.equal(formatInfiniDyskV2Bytes(row.required_bytes), 'Unknown')
  }
  for (const invalid of [null, '0', -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = infinidyskV2Capacity({ ...capacity, filesystems: [{ ...capacity.filesystems[0], free_bytes: invalid }] })
    assert.equal(result.status, 'unavailable')
    assert.equal(result.filesystems[0].free_bytes, null)
    assert.equal(formatInfiniDyskV2Bytes(invalid), 'Unknown')
  }
  for (const change of [{ required_bytes: 1 }, { shortfall_bytes: 0 }, { sufficient: true }]) {
    assert.equal(infinidyskV2Capacity({ ...capacity, filesystems: [{ ...capacity.filesystems[0], ...change }] }).status, 'unavailable')
  }
})

test('capacity only exposes allowlisted numeric fields and role labels', () => {
  const result = infinidyskV2Capacity({ ...capacity, password: 'fixture-secret', filesystems: [{ ...capacity.filesystems[0], id: 'https://example.invalid/?token=hidden', roles: ['candidate', 'candidate', 'toString', 'password=hidden'], locations: ['/config/migrations/private'], url: 'postgres://fixture:secret@example.invalid/db' }] })
  assert.equal(result.filesystems[0].label, 'Filesystem 1')
  assert.deepEqual(result.filesystems[0].roles, ['Candidate installation'])
  assert.doesNotMatch(JSON.stringify(result), /hidden|fixture-secret|migrations|postgres:\/\//)
})

test('cleanup needs its own capability, completed v2 job, exact preview and all human validations', () => {
  const caps = { ...capabilities, infinidysk_v2_cleanup: true, infinidysk_v2_cleanup_protocol: 1 }
  const input = { capabilities: caps, status: { runtime_generation: '2' }, job: { job_id: 'cutover-1', status: 'completed', can_cleanup: true }, preview: { ...preview, job_id: 'cutover-1', targets: [{ path: '/example/v1', entries: 4, logical_bytes: 1024, reclaim_estimate_bytes: 1024 }], kept_backups: [{ role: 'archive', reference: 'dumb-backup://archive/namespace/artifact', kept: true }], blockers: [], rollback_will_be_retired: true, acknowledgements_required: ['playback', 'test_import', 'rollback_retirement'] }, confirmation: preview.confirmation_text, acknowledgements: { playback: true, test_import: true, rollback_retirement: true }, now: 1900000000000 }
  assert.equal(infinidyskV2CleanupReady(input), true)
  assert.equal(infinidyskV2CleanupSupported(capabilities), false)
  for (const change of [{ targets: [] }, { kept_backups: [] }, { targets: [{ path: '/example/v1', entries: null, logical_bytes: 0, reclaim_estimate_bytes: 0 }] }]) assert.equal(infinidyskV2CleanupReady({ ...input, preview: { ...input.preview, ...change } }), false)
  for (const backup of [{ role: '', path: '/example/backup', kept: true }, { role: 'backup', path: '/example/backup', kept: false }, { role: 'backup', path: 'relative', kept: true }, { role: 'backup', kept: true }, { role: 'backup', reference: 'https://example.invalid/backup', kept: true }]) assert.equal(infinidyskV2CleanupReady({ ...input, preview: { ...input.preview, kept_backups: [backup] } }), false)
  assert.equal(infinidyskV2CleanupReady({ ...input, preview: { ...input.preview, kept_backups: [{ role: 'backup', path: '/example/retained', kept: true }] } }), true)
  assert.equal(infinidyskV2CleanupReady({ ...input, preview: { ...input.preview, blockers: ['Contradictory backend blocker'] } }), false)
  for (const changed of [{ capabilities: { ...caps, infinidysk_v2_cleanup_protocol: '1' } }, { status: { runtime_generation: '1' } }, { job: { ...input.job, status: 'failed' } }, { preview: { ...input.preview, job_id: 'other-job' } }, { now: 2100000000000 }, { confirmation: 'wrong' }, { acknowledgements: { ...input.acknowledgements, playback: false } }, { acknowledgements: { ...input.acknowledgements, test_import: false } }, { acknowledgements: { ...input.acknowledgements, rollback_retirement: false } }]) assert.equal(infinidyskV2CleanupReady({ ...input, ...changed }), false)
  for (const state of ['queued', 'verifying', 'retiring', 'deleting']) {
    const job = { ...input.job, cleanup: { state } }
    assert.equal(isInfiniDyskV2JobActive(job), true)
    assert.equal(infinidyskV2NeedsAttention(job), true)
    assert.equal(infinidyskV2CleanupReady({ ...input, job }), false)
  }
  assert.equal(isInfiniDyskV2JobActive({ ...input.job, cleanup: { state: 'completed' }, can_rollback: false }), false)
  assert.equal(infinidyskV2NeedsAttention({ ...input.job, can_rollback: false, rollback_retired: true, cleanup: { state: 'failed' } }), true)
})

test('controller refuses cleanup on old capabilities even when migration itself is supported', async () => {
  let calls = 0
  const controller = makeController({ cleanup: async () => { calls++ } })
  await controller.refresh()
  await assert.rejects(controller.mutate('major', 'cleanup', {}), /guarded cleanup/)
  assert.equal(calls, 0)
})

test('generation changes use the guarded wizard and v2 source targets ignore dormant v1 pins', () => {
  assert.match(infinidyskV2ConfigChangeReason({}, { runtime_generation: '2' }), /migration/)
  assert.equal(infinidyskV2ConfigChangeReason({}, { runtime_generation: '1' }), '')
  assert.equal(resolveConfiguredSourceTarget({ runtime_generation: '2', v2_release_version: 'v2.0.0-beta.6', release_version_enabled: false, branch_enabled: true, branch: 'v1' }, 'infinidysk').value, 'v2.0.0-beta.6')
})

test('dedicated API client never falls back to v1 mutation endpoints', async () => {
  const seen = []
  const client = infinidyskV2Repository({ get: async url => { seen.push(url); return { data: {} } }, post: async (url, body) => { seen.push(url); return { data: body } } })
  await client.preview({ mount_backend: 'rclone' }); await client.rehearse({}); await client.start({}); await client.job('job-1'); await client.rollback({}); await client.cancel({})
  await client.report('job-1')
  await client.postgresStatus(); await client.postgresPreview({ target: { use_managed_postgres: true } }); await client.postgresStart({}); await client.postgresCutover({}); await client.postgresCancel({}); await client.postgresRollback({})
  assert.equal(seen.every(url => url.startsWith('/api/process/infinidysk-v2/')), true)
  const unavailable = infinidyskV2Repository({ post: async () => { throw { response: { status: 404 } } } })
  await assert.rejects(unavailable.start({}))
})

test('old backends do not probe or mutate unsupported workflows', async () => {
  let calls = 0
  const controller = makeController({ capabilities: async () => ({}), status: async () => { calls++; return {} }, start: async () => { calls++ } })
  await controller.refresh()
  await assert.rejects(controller.mutate('major', 'start', {}))
  assert.equal(calls, 0)
})

test('reload reattaches remembered jobs even when mutation capabilities are unavailable', async () => {
  const job = { job_id: 'remembered-1', status: 'failed', recovery_required: true }
  const controller = makeController({ capabilities: async () => ({}), status: async () => ({ protocol: 1, job }) }, { major: job.job_id })
  await controller.refresh()
  assert.equal(controller.state.value.majorJob.job_id, job.job_id)
  assert.equal(infinidyskV2NeedsAttention(controller.state.value.majorJob), true)
  await assert.rejects(controller.mutate('major', 'rollback', {}))
  assert.deepEqual(JSON.parse(controller.storage.value), { major: job.job_id, postgres: null })
})

test('concurrent refresh and duplicate submissions cannot create duplicate jobs', async () => {
  const gate = deferred()
  let calls = 0
  const job = { job_id: 'one-job', status: 'running' }
  const controller = makeController({ start: async () => { calls++; await gate.promise; return { job } }, status: async () => ({ protocol: 1, job: calls ? job : null }) })
  await controller.refresh()
  const first = controller.mutate('major', 'start', {})
  await assert.rejects(controller.mutate('major', 'start', {}))
  await controller.refresh()
  gate.resolve()
  await first
  assert.equal(calls, 1)
  assert.equal(controller.state.value.majorJob.job_id, 'one-job')
  assert.equal(controller.state.value.busy, false)
})

test('unavailable recovery endpoints retain a visible saved job identity', async () => {
  const controller = makeController({ capabilities: async () => ({}), status: async () => { throw { response: { status: 404 } } } }, { major: 'retained-unconfirmed' })
  await controller.refresh()
  assert.equal(controller.state.value.majorJob.job_id, 'retained-unconfirmed')
  assert.equal(controller.state.value.majorJob.status, 'unconfirmed')
  assert.equal(infinidyskV2NeedsAttention(controller.state.value.majorJob), true)
  assert.match(controller.state.value.error, /could not be confirmed/)
})

test('failed status refresh revokes prior mutation authorization without hiding jobs', async () => {
  let failed = false
  const job = { job_id: 'retained-job', status: 'running' }
  const controller = makeController({ status: async () => { if (failed) throw new Error('offline'); return { protocol: 1, job } } })
  await controller.refresh()
  assert.equal(controller.state.value.majorStatusConfirmed, true)
  failed = true; await controller.refresh()
  assert.equal(controller.state.value.majorStatusConfirmed, false)
  assert.equal(controller.state.value.majorJob.job_id, job.job_id)
  await assert.rejects(controller.mutate('major', 'rollback', {}), /Refresh/)
})

test('normal polling retains resolved UI visibility while mutations wait for the current read', async () => {
  const gate = deferred(); let reads = 0; let mutations = 0
  const controller = makeController({
    status: async () => { reads++; if (reads === 2) await gate.promise; return { protocol: 1, runtime_generation: '1', job: null } },
    preview: async () => { mutations++; return {} },
  })
  await controller.refresh()
  const polling = controller.refresh()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(controller.state.value.majorStatusConfirmed, true)
  const submitting = controller.mutate('major', 'preview', {})
  assert.equal(mutations, 0)
  gate.resolve(); await polling; await submitting
  assert.equal(mutations, 1)
  assert.equal(controller.state.value.majorStatusConfirmed, true)
})

test('uncertain POST refreshes the durable job instead of replaying the mutation', async () => {
  let calls = 0
  const job = { job_id: 'started-despite-timeout', status: 'running' }
  const controller = makeController({ start: async () => { calls++; throw new Error('timeout') }, status: async () => ({ protocol: 1, job: calls ? job : null }) })
  await controller.refresh()
  await assert.rejects(controller.mutate('major', 'start', {}))
  assert.equal(calls, 1)
  assert.equal(controller.state.value.majorJob.job_id, job.job_id)
  assert.equal(controller.storage.value.includes('preview'), false)
})

test('auth reset cannot be undone by a late status response', async () => {
  const gate = deferred()
  const controller = makeController({ status: async () => { await gate.promise; return { protocol: 1, job: { job_id: 'old-user-job', status: 'running' } } } })
  const refreshing = controller.refresh()
  await new Promise(resolve => setImmediate(resolve))
  controller.reset(); gate.resolve(); await refreshing
  assert.deepEqual(controller.state.value, initialInfiniDyskV2State())
  assert.equal(controller.storage.value, null)
})
