import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2Stages } from '../helper/infinidyskV2Stages.js'

const progress = (changes = {}) => ({ protocol: 1, tracking: 'recorded',
  steps: [{ id: 'check_plan', state: 'completed', started_at: 100, completed_at: 110 },
    { id: 'native_import', state: 'running', started_at: 110 },
    { id: 'validate_import', state: 'pending' }], current_step_id: 'native_import', ...changes })

test('migration stages use only backend recorded completion and safe authored descriptions', () => {
  const result = infinidyskV2Stages(progress({ path: '/private/library', percent: 90 }))
  assert.deepEqual(result.steps.map(step => step.state), ['completed', 'running', 'pending'])
  assert.equal(result.steps[0].elapsedSeconds, 10)
  assert.equal(result.steps[1].elapsedSeconds, undefined)
  assert.equal(result.steps[1].statusLabel, 'In progress')
  assert.match(result.steps[1].label, /InfiniDysk 2/)
  assert.equal(result.currentId, 'native_import')
  assert.doesNotMatch(JSON.stringify(result), /private|percent/)
})

test('prepared review is waiting for a decision and activation stays queued', () => {
  const result = infinidyskV2Stages(progress({ steps: [
    { id: 'validate_import', state: 'completed' }, { id: 'review', state: 'waiting' },
    { id: 'activate', state: 'pending' }, { id: 'resume_services', state: 'pending' },
  ], current_step_id: 'review' }), { job: { mode: 'prepare', status: 'prepared' } })
  assert.deepEqual(result.steps.map(step => step.statusLabel), ['Completed', 'Waiting for your decision', 'Queued', 'Queued'])
  assert.match(result.steps[1].detail, /affected apps stay stopped/)
  assert.equal(result.percent, undefined)
})

test('failure retains completed work, not-run future steps and a separate recovery branch', () => {
  const value = progress({ steps: [{ id: 'save_recovery', state: 'completed' },
    { id: 'native_import', state: 'failed' }, { id: 'activate', state: 'not_run' },
    { id: 'restore_v1', state: 'running' }], current_step_id: 'restore_v1' })
  const recovering = infinidyskV2Stages(value, { job: { mode: 'prepare', status: 'rolling_back' } })
  assert.equal(recovering.recovery, true)
  assert.deepEqual(recovering.steps.map(step => step.state), ['completed', 'failed', 'not_run', 'running'])
  value.steps[3].state = 'completed'
  const restored = infinidyskV2Stages(value, { job: { mode: 'prepare', status: 'failed_restored' } })
  assert.equal(restored.steps[1].state, 'failed')
  assert.equal(restored.steps[2].state, 'not_run')
  assert.equal(restored.steps[3].state, 'completed')
})

test('restoration is a planned part of a test rather than candidate activation', () => {
  const result = infinidyskV2Stages(progress({ steps: [{ id: 'native_import', state: 'completed' },
    { id: 'restore_v1', state: 'running' }, { id: 'cleanup_test', state: 'pending' }], current_step_id: 'restore_v1' }),
  { job: { mode: 'rehearsal' } })
  assert.equal(result.recovery, false)
  assert.equal(result.steps.some(step => step.id === 'activate'), false)
})

test('legacy and malformed journals never infer earlier completed stages from order or terminal status', () => {
  for (const value of [null, {}, progress({ protocol: 2 }), progress({ tracking: 'legacy' }),
    progress({ steps: [] }), progress({ steps: [{ id: 'constructor', state: 'completed' }] }),
    progress({ steps: [{ id: 'native_import', state: 'constructor' }] }), progress({ current_step_id: 'unrecognized' }),
    progress({ steps: Array(17).fill({ id: 'check_plan', state: 'completed' }) }),
    progress({ steps: [{ id: 'check_plan', state: 'completed' }, { id: 'check_plan', state: 'completed' }] })]) {
    const result = infinidyskV2Stages(value, { job: { status: 'completed', stage: 'validating' } })
    assert.equal(result.recorded, false)
    assert.deepEqual(result.steps, [])
    assert.match(result.note, /not recorded/)
    assert.equal(infinidyskV2Stages(value, { preview: true }), null)
  }
})

test('reloading needs no browser history and a lost status confirmation freezes the recorded view', () => {
  const journal = progress()
  assert.deepEqual(infinidyskV2Stages(JSON.parse(JSON.stringify(journal))), infinidyskV2Stages(journal))
  const frozen = infinidyskV2Stages(journal, { confirmed: false })
  assert.match(frozen.note, /last confirmed/)
  assert.equal(frozen.steps[1].statusLabel, 'Last confirmed: in progress')
  assert.deepEqual(frozen.steps.map(step => step.state), ['completed', 'running', 'pending'])
})

test('planned optional steps come only from the server plan and stage timestamps never create progress', () => {
  const value = progress({ steps: [{ id: 'source_database', state: 'pending', started_at: -1, completed_at: Infinity },
    { id: 'pause_services', state: 'interrupted', started_at: 100, completed_at: 90 }], current_step_id: null })
  const result = infinidyskV2Stages(value, { preview: true })
  assert.match(result.note, /planned/)
  assert.equal(result.steps[0].startedAt, undefined)
  assert.equal(result.steps[1].elapsedSeconds, undefined)
  assert.equal(result.steps[1].statusLabel, 'Interrupted')
  assert.equal(result.steps.some(step => step.id === 'review'), false)
})

test('fresh installation stages never claim a v1 library is being converted', () => {
  const result = infinidyskV2Stages(progress(), { job: { mode: 'prepare', prepare_mode: 'fresh' } })
  assert.equal(result.steps[1].label, 'Prepare InfiniDysk 2')
  assert.match(result.steps[1].detail, /no v1 library to convert/)
})
