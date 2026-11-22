import test from 'node:test'
import assert from 'node:assert/strict'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { infinidyskV2PostgresProgress } from '../helper/infinidyskV2PostgresProgress.js'

const capabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1, infinidysk_v2_postgres: true }
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const job = { job_id: 'native-pg-job', operation: 'infinidysk_v2_postgres', preview_id: 'opaque-review-id', status: 'starting', stage: 'backup' }
const fixture = (overrides = {}, stored = '{}') => {
  const state = { value: initialInfiniDyskV2State() }
  const storage = { data: stored, getItem() { return this.data }, setItem(key, value) { this.data = value }, removeItem() { this.data = null } }
  const repository = { capabilities: async () => capabilities, status: async () => ({ protocol: 1, runtime_generation: '2' }),
    postgresStatus: async () => ({ protocol: 1, provider: 'sqlite', job: null, actions: { start: true } }), ...overrides }
  return { state, storage, repository, ...createInfiniDyskV2Controller({ state, repository, storage }) }
}

test('fresh reload discovers the database job independently of a held major status request', async () => {
  const gate = deferred()
  let reads = 0
  const app = fixture({ status: async () => gate.promise, postgresStatus: async () => { reads++; return { protocol: 1, job, provider: 'sqlite' } } })
  await app.refresh({ force: true, postgresOnly: true }); await tick()
  assert.equal(app.state.value.majorStatusConfirmed, false)
  assert.equal(app.state.value.postgresJob.job_id, job.job_id)
  assert.equal(app.state.value.postgresStatusConfirmed, true)
  const before = reads
  await app.refresh({ force: true, postgresOnly: true })
  assert.ok(reads > before, 'A later database Refresh does not wait behind the held major request')
  gate.resolve({ protocol: 1, runtime_generation: '2' }); await app.refresh()
})

test('database-only discovery preserves an older major recovery reference before its slow initial read finishes', async () => {
  const gate = deferred()
  const app = fixture({ status: async () => gate.promise }, JSON.stringify({ major: 'retained-major', postgres: null }))
  await app.refresh({ force: true, postgresOnly: true })
  assert.equal(JSON.parse(app.storage.data).major, 'retained-major')
  gate.resolve({ protocol: 1, runtime_generation: '2', job: { job_id: 'retained-major', status: 'completed' } })
  await app.refresh()
})

test('a lost start response is reconciled only against its new exact preview identity, without replaying Start', async () => {
  let calls = 0
  const app = fixture({ postgresStart: async () => { calls++; throw { code: 'ECONNABORTED' } },
    postgresStatus: async () => ({ protocol: 1, provider: 'sqlite', job: calls ? job : null }) })
  await app.refresh()
  const result = await app.mutate('postgres', 'postgresStart', { preview_token: 'secret-token', password: 'secret-password' }, { preview_id: job.preview_id })
  assert.equal(result.reconciled, true)
  assert.equal(app.state.value.postgresMutation.status, 'confirmed')
  assert.equal(app.state.value.busy, false)
  assert.equal(calls, 1)
  assert.deepEqual(JSON.parse(app.storage.data), { major: null, postgres: job.job_id })
  assert.doesNotMatch(JSON.stringify(app.state.value.postgresMutation) + app.storage.data, /secret-token|secret-password/)
})

test('uncertain starts survive reload without tokens and block another Start until exact durable evidence arrives', async () => {
  let calls = 0, observed = null
  const repository = { postgresStart: async () => { calls++; throw { code: 'ERR_NETWORK' } }, postgresStatus: async () => ({ protocol: 1, provider: 'sqlite', job: observed }) }
  const first = fixture(repository); await first.refresh()
  await assert.rejects(first.mutate('postgres', 'postgresStart', { preview_token: 'secret' }, { preview_id: job.preview_id }))
  const saved = JSON.parse(first.storage.data)
  assert.equal(saved.postgres_request.preview_id, job.preview_id)
  assert.doesNotMatch(first.storage.data, /secret|preview_token|password/)
  const reloaded = fixture(repository, first.storage.data); await reloaded.refresh({ force: true, postgresOnly: true })
  await assert.rejects(reloaded.mutate('postgres', 'postgresStart', {}), /still unconfirmed/)
  assert.equal(calls, 1)
  observed = { ...job, preview_id: 'unrelated-review' }; await reloaded.refresh({ force: true })
  assert.equal(reloaded.state.value.postgresMutation.status, 'uncertain', 'Another job is displayed but cannot acknowledge this request')
  observed = job; await reloaded.refresh({ force: true })
  assert.equal(reloaded.state.value.postgresMutation.status, 'confirmed')
  assert.equal(JSON.parse(reloaded.storage.data).postgres_request, undefined)
})

test('legacy previews without a correlation identity can settle after explicit cancellation without a permanent browser hold', async () => {
  let current = null, starts = 0
  const app = fixture({ postgresStart: async () => { starts++; throw { code: 'ETIMEDOUT' } },
    postgresStatus: async () => ({ protocol: 1, provider: 'sqlite', job: current, actions: { start: !current || current.status === 'cancelled' } }),
    postgresPreview: async () => ({ protocol: 1, ready: true }),
  })
  await app.refresh()
  await assert.rejects(app.mutate('postgres', 'postgresStart', {}))
  current = { ...job, preview_id: undefined }; await app.refresh({ force: true })
  assert.equal(app.state.value.postgresMutation.status, 'uncertain')
  current = { ...current, status: 'cancelled', recovery_required: false }; await app.refresh({ force: true })
  assert.equal(app.state.value.postgresMutation.status, 'settled')
  assert.equal(JSON.parse(app.storage.data).postgres_request, undefined)
  assert.equal((await app.mutate('postgres', 'postgresPreview', {})).ready, true)
  assert.equal(starts, 1, 'Settlement never resubmits Start')
})

test('forced status reads remain available during held Start and cannot be regressed by its old response', async () => {
  const gate = deferred(); let current = null, calls = 0
  const app = fixture({ postgresStart: async () => { calls++; await gate.promise; return { job } }, postgresStatus: async () => ({ protocol: 1, job: current }) })
  await app.refresh()
  const submitting = app.mutate('postgres', 'postgresStart', {}, { preview_id: job.preview_id }); await tick()
  current = { ...job, status: 'syncing', stage: 'syncing' }; await app.refresh({ force: true })
  assert.equal(app.state.value.busy, true)
  assert.equal(app.state.value.postgresJob.status, 'syncing')
  gate.resolve(); await submitting
  assert.equal(app.state.value.postgresJob.status, 'syncing')
  assert.equal(calls, 1)
})

test('native table counters retain zero, reject null/coerced totals and never imply overall completion', () => {
  const current = { ...job, status: 'copying', stage: 'copying', updated_at: 100,
    progress: { done: 0, total: 259532, table: 'blobs', pending_changes: 0 } }
  const result = infinidyskV2PostgresProgress(current, { confirmed: true, now: 100000 })
  assert.equal(result.unit, 'rows'); assert.equal(result.done, 0); assert.equal(result.pendingChanges, 0)
  assert.equal(result.table, 'blobs'); assert.equal(result.percent, 0)
  assert.equal(result.remainingSeconds, undefined)
  const invalid = infinidyskV2PostgresProgress({ ...current, progress: { done: null, total: '259532', pending_changes: null, table: 'password=secret' } })
  assert.equal(invalid.done, undefined); assert.equal(invalid.total, undefined); assert.equal(invalid.pendingChanges, undefined); assert.equal(invalid.table, undefined)
})

test('snapshot counts and ETA stay phase-scoped and estimates stop when status is stale or unconfirmed', () => {
  const snapshot = { ...job, updated_at: 100, progress: { unit: 'pages', done: 20, total: 100, elapsed_seconds: 15, rate_per_second: 4, eta_seconds: 20 } }
  assert.equal(infinidyskV2PostgresProgress(snapshot, { confirmed: true, now: 100000 }).remainingSeconds, 20)
  assert.equal(infinidyskV2PostgresProgress(snapshot, { confirmed: false, now: 100000 }).rate, undefined)
  assert.equal(infinidyskV2PostgresProgress(snapshot, { confirmed: true, now: 131000 }).remainingSeconds, undefined)
  const validation = infinidyskV2PostgresProgress({ ...snapshot, stage: 'backup_validation', progress: { ...snapshot.progress, elapsed_seconds: 24 } }, { confirmed: true, now: 100000 })
  assert.equal(validation.unit, null); assert.equal(validation.done, undefined); assert.equal(validation.percent, undefined)
  assert.equal(validation.elapsedSeconds, 24); assert.equal(validation.remainingSeconds, undefined)
  const overrun = infinidyskV2PostgresProgress({ ...snapshot, progress: { ...snapshot.progress, done: 101 } }, { confirmed: true, now: 100000 })
  assert.equal(overrun.percent, undefined); assert.equal(overrun.remainingSeconds, undefined)
})
