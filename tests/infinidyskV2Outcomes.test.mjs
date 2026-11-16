import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2JobPresentation as present, infinidyskV2PreviewDuration as duration, infinidyskV2PreviewIsLatest as latest } from '../helper/infinidyskV2Presentation.js'

test('a failed test shows restored v1 only with explicit restoration proof and no exposure', () => {
  const job = { status: 'failed_restored', stage: 'failed', mode: 'rehearsal', progress: 100, result: { source_restored: true }, cancel_requested: true }
  const before = JSON.stringify(job), result = present(job)
  assert.equal(result.state, 'restored')
  assert.match(result.title, /Test migration failed; v1 restored/)
  assert.equal(result.active, false); assert.equal(result.showProgress, false)
  assert.match(result.next, /Nothing retries automatically/)
  assert.equal(JSON.stringify(job), before)
  for (const change of [{ result: {} }, { result: { source_restored: 'true' } }]) assert.notEqual(present({ ...job, ...change }).state, 'restored')
  for (const change of [{ activation_exposed: true }, { recovery_required: true }]) assert.equal(present({ ...job, ...change }).state, 'recovery')
})

test('test success and actual upgrade completion have distinct actions and no active progress', () => {
  const rehearsal = present({ mode: 'rehearsal', status: 'rehearsed', result: { validated: true } }, { runtimeGeneration: '1' })
  assert.equal(rehearsal.state, 'test_passed'); assert.match(rehearsal.message, /upgrade has not started/)
  assert.match(rehearsal.next, /Start migration/); assert.equal(rehearsal.showProgress, false)
  const cutover = present({ mode: 'cutover', status: 'completed', result: { generation_2_started: true } }, { runtimeGeneration: '2' })
  assert.equal(cutover.state, 'completed'); assert.match(cutover.message, /InfiniDysk 2 is selected/)
  assert.equal(cutover.showProgress, false)
})

test('retained operation evidence wins over a changed current form mode', () => {
  const proof = { status: 'failed_restored', result: { source_restored: true } }
  assert.match(present({ ...proof, mode: 'rehearsal' }, { currentMode: 'fresh' }).title, /v1 restored/)
  assert.doesNotMatch(present({ ...proof, mode: 'fresh' }, { currentMode: 'migrate' }).title, /v1/)
  assert.doesNotMatch(present({ ...proof, mode: 'cutover' }, { currentMode: 'migrate' }).title, /v1/)
  assert.match(present(proof, { currentMode: 'migrate' }).title, /v1 restored/)
})

test('major rollback uses its verified result while incomplete or unknown results stay conservative', () => {
  const proven = present({ status: 'rolled_back', mode: 'cutover', result: { validated: true, reverse_copy_performed: false }, activation_exposed: true })
  assert.equal(proven.state, 'restored'); assert.equal(proven.showProgress, false)
  assert.notEqual(present({ status: 'rolled_back', mode: 'cutover', result: {} }).state, 'restored')
  assert.equal(present({ status: 'future_state', stage: 'importing', progress: 100 }).state, 'unknown')
  assert.equal(present({ status: 'future_state' }).showProgress, false)
})

test('native PostgreSQL states never claim a v1 upgrade or ongoing recovery from an available rollback action', () => {
  for (const status of ['starting', 'copying', 'syncing', 'cutover', 'rolling_back']) assert.equal(present({ status }, { kind: 'database' }).active, true)
  const completed = present({ status: 'completed', can_rollback: true }, { kind: 'database' })
  assert.equal(completed.state, 'completed'); assert.doesNotMatch(completed.title, /v1|InfiniDysk 2/)
  assert.equal(completed.showProgress, false)
  const cancelled = present({ status: 'cancelled', cleanup_required: true }, { kind: 'database' })
  assert.match(cancelled.message, /SQLite remains active/); assert.equal(cancelled.active, false)
  assert.match(present({ status: 'rolled_back' }, { kind: 'database' }).title, /SQLite snapshot restored/)
})

test('active work and explicit recovery holds have different progress behavior', () => {
  for (const status of ['queued', 'running', 'quiescing', 'snapshotting', 'rehearsing', 'importing', 'validating', 'cutover']) assert.equal(present({ status, mode: 'rehearsal' }).showProgress, true)
  const held = present({ status: 'recovery_required', mode: 'rehearsal' })
  assert.equal(held.state, 'recovery'); assert.equal(held.showProgress, false)
  const exposed = present({ status: 'interrupted', activation_exposed: true })
  assert.equal(exposed.state, 'recovery'); assert.match(exposed.title, /InfiniDysk 2 service recovery/)
})

test('completed preview duration stays fixed while active elapsed time continues', () => {
  const task = { status: 'running', created_at: 1000, updated_at: 1125 }
  assert.deepEqual(duration(task, null, 1150000), { seconds: 150, finished: false })
  for (const status of ['completed', 'failed', 'interrupted', 'cancelled']) {
    assert.deepEqual(duration({ ...task, status }, null, 1150000), { seconds: 125, finished: true })
    assert.deepEqual(duration({ ...task, status }, null, 9000000), { seconds: 125, finished: true })
  }
  assert.equal(duration({ ...task, status: 'completed', updated_at: NaN }, null, 1150000), null)
})

test('newer jobs supersede preview status, while explicit later preview intent resolves same-second ambiguity', () => {
  const job = { job_id: 'job-a', status: 'failed_restored', created_at: 2000 }
  assert.equal(latest({ task_id: 'old', status: 'completed', created_at: 1999 }, job), false)
  assert.equal(latest({ task_id: 'old', status: 'completed', created_at: 2000 }, job), false)
  assert.equal(latest({ task_id: 'new', status: 'completed', created_at: 2001 }, job), true)
  const intent = { job_id: 'job-a', previous_task_id: 'old' }
  assert.equal(latest({ task_id: 'new', status: 'completed', created_at: 2000 }, job, intent), true)
  assert.equal(latest({ task_id: 'old', status: 'completed', created_at: 1999 }, job, intent), false)
  assert.equal(latest({ task_id: 'new', status: 'completed' }, { ...job, created_at: null }), false)
})

test('accepted native rollback remains active while its recovery ownership flag is retained', () => {
  const job = { operation: 'infinidysk_v2_postgres', status: 'rolling_back', stage: 'rollback', recovery_required: true }
  assert.equal(present(job, { kind: 'database' }).state, 'rolling_back')
  assert.equal(present(job, { kind: 'database' }).showProgress, true)
  assert.doesNotMatch(present(job, { kind: 'database' }).message, /waiting for an explicit/)
  assert.equal(present({ ...job, status: 'recovery_required' }, { kind: 'database' }).state, 'recovery')
  assert.equal(present({ ...job, activation_exposed: true }).state, 'rolling_back')
})

test('an admitted exposed major rollback remains active despite retained consumer and recovery fields', () => {
  const job = { mode: 'cutover', status: 'rolling_back', stage: 'restoring_source', activation_exposed: true, activation_committed: true, recovery_required: true,
    recovery_kind: 'v2_consumers', consumer_recovery: { ready: false, failed: [], pending: [], resumed: ['Example Consumer'] } }
  const value = present(job)
  assert.equal(value.state, 'rolling_back'); assert.equal(value.active, true); assert.equal(value.showProgress, true)
  assert.equal(value.title, 'Restoring previous installation')
  assert.match(value.message, /not yet complete/)
  assert.doesNotMatch(value.message, /waiting for an explicit|source was restored/)
  for (const status of ['recovery_required', 'interrupted']) {
    assert.equal(present({ ...job, status }).state, 'recovery')
    assert.equal(present({ ...job, status }).active, false)
  }
})

test('preflight failure needs explicit untouched-source proof and cannot hide an exposed or held source', () => {
  const job = { status: 'failed', mode: 'rehearsal', result: { source_untouched: true, source_restored: false } }
  assert.equal(present(job).state, 'source_untouched')
  assert.match(present(job).message, /did not pause your services/)
  assert.equal(present(job).showProgress, false)
  for (const source_untouched of [false, 'true', null]) assert.notEqual(present({ ...job, result: { source_untouched } }).state, 'source_untouched')
  for (const extra of [{ activation_exposed: true }, { recovery_required: true }]) assert.equal(present({ ...job, ...extra }).state, 'recovery')
})
