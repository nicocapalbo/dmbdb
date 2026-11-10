import test from 'node:test'
import assert from 'node:assert/strict'
import {
  apiVersionSupportsInfiniDyskV2, formatInfiniDyskV2Bytes, infinidyskRcloneOptimizerAllowed, infinidyskV2AcknowledgementsReady, infinidyskV2Capacity,
  infinidyskV2ConfigChangeReason, infinidyskV2InventoryRows, infinidyskV2MajorReady,
  infinidyskV2NeedsAttention, infinidyskV2NoticeVisible, infinidyskV2PreviewFresh, infinidyskV2Selection,
  infinidyskV2Support, normalizeInfiniDyskV2Job, safeInfiniDyskV2Text,
} from '../helper/infinidyskV2.js'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { infinidyskV2Repository } from '../services/infinidyskV2.js'
import { resolveConfiguredSourceTarget } from '../helper/configuredSourceTarget.js'

const capabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1, infinidysk_v2_postgres: true }
const preview = { protocol: 1, ready: true, preview_token: 'private-preview', plan_fingerprint: 'public-plan', confirmation_text: 'MIGRATE InfiniDysk', expires_at: 2000000000, required_acknowledgements: ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream'], rehearsal_required: true }
const acknowledgements = { backup: true, downtime: true, beta: true, oidc_policy: true, downstream: true }
const rehearsalJob = { job_id: 'rehearsal-1', status: 'completed', mode: 'rehearsal', plan_fingerprint: 'public-plan', result: { validated: true } }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
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
  const input = { preview, confirmation: preview.confirmation_text, acknowledgements, rehearsalJob, now: 1900000000000 }
  assert.equal(infinidyskV2MajorReady(input), true)
  for (const changed of [{ rehearsalJob: null }, { rehearsalJob: { ...rehearsalJob, plan_fingerprint: 'other-plan' } }, { rehearsalJob: { ...rehearsalJob, result: { validated: false } } }, { confirmation: 'wrong' }, { now: 2100000000000 }, { acknowledgements: { ...acknowledgements, backup: false } }, { job: { job_id: 'running', status: 'running' } }]) assert.equal(infinidyskV2MajorReady({ ...input, ...changed }), false)
  assert.equal(infinidyskV2PreviewFresh({ ...preview, expires_at: null }), false)
  assert.equal(infinidyskV2AcknowledgementsReady({ ...preview, required_acknowledgements: ['unknown'] }, { unknown: true }), false)
})

test('unknown job phases remain blocking and recovery does not disappear with capabilities', () => {
  assert.equal(infinidyskV2NeedsAttention({ job_id: 'job-1', status: 'unknown-new-phase' }), true)
  assert.equal(infinidyskV2NeedsAttention({ job_id: 'job-1', status: 'failed', recovery_required: true }), true)
  assert.equal(infinidyskV2NeedsAttention({ job_id: 'job-1', status: 'completed' }), false)
  assert.equal(normalizeInfiniDyskV2Job({ job_id: '../other', status: 'running' }), null)
  assert.equal(normalizeInfiniDyskV2Job({ job: rehearsalJob }), rehearsalJob)
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

test('generation changes use the guarded wizard and v2 source targets ignore dormant v1 pins', () => {
  assert.match(infinidyskV2ConfigChangeReason({}, { runtime_generation: '2' }), /migration/)
  assert.equal(infinidyskV2ConfigChangeReason({}, { runtime_generation: '1' }), '')
  assert.equal(resolveConfiguredSourceTarget({ runtime_generation: '2', v2_release_version: 'v2.0.0-beta.6', release_version_enabled: false, branch_enabled: true, branch: 'v1' }, 'infinidysk').value, 'v2.0.0-beta.6')
})

test('dedicated API client never falls back to v1 mutation endpoints', async () => {
  const seen = []
  const client = infinidyskV2Repository({ get: async url => { seen.push(url); return { data: {} } }, post: async (url, body) => { seen.push(url); return { data: body } } })
  await client.preview({ mount_backend: 'rclone' }); await client.rehearse({}); await client.start({}); await client.job('job-1'); await client.rollback({})
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
