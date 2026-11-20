import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2StageRetry, infinidyskV2StageRetryReady, infinidyskV2StageRetrySupported } from '../helper/infinidyskV2StageRetry.js'
import { infinidyskV2JobExplanation, isInfiniDyskV2JobActive } from '../helper/infinidyskV2.js'
import { infinidyskV2JobPresentation } from '../helper/infinidyskV2Presentation.js'
import { infinidyskV2Stages } from '../helper/infinidyskV2Stages.js'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { infinidyskV2Repository } from '../services/infinidyskV2.js'

const baseCapabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1 }
const capabilities = { ...baseCapabilities, infinidysk_v2_stage_retry: true, infinidysk_v2_stage_retry_protocol: 1 }
const paused = () => ({
  job_id: 'paused-fixture', mode: 'prepare', prepare_mode: 'migrate', status: 'stage_retry_required', stage: 'verifying_archive', cancel_requested: false,
  can_retry_stage: true, actions: { retry_stage: true }, confirmation_texts: { retry_stage: 'RETRY INFINIDYSK V2 STAGE paused-fixture fresh-nonce' },
  stage_retry: { protocol: 1, operation: 'verify_archive', stage: 'verifying_archive', label: 'Verify the recovery archive', attempt: 1, state: 'waiting', failed_at: 1700000000, message: 'Storage read could not finish.' },
})
const controllerFor = overrides => {
  const state = { value: initialInfiniDyskV2State() }
  const repository = { capabilities: async () => capabilities, status: async () => ({ protocol: 1, runtime_generation: '1', job: null }), ...overrides }
  return { state, ...createInfiniDyskV2Controller({ state, repository }) }
}

test('DUMB step retry requires a current typed capability, exact job, operation and backend phrase', () => {
  const job = paused(), input = { capabilities, confirmed: true, busy: false, job, confirmation: job.confirmation_texts.retry_stage }
  assert.equal(infinidyskV2StageRetrySupported(capabilities), true)
  assert.equal(infinidyskV2StageRetryReady(input), true)
  for (const change of [{ capabilities: baseCapabilities }, { capabilities: { ...capabilities, infinidysk_v2_stage_retry: 'true' } },
    { capabilities: { ...capabilities, infinidysk_v2_stage_retry_protocol: '1' } }, { confirmed: false }, { busy: true }, { confirmation: 'old-nonce' },
    { job: { ...job, can_retry_stage: 'true' } }, { job: { ...job, actions: { retry_stage: false } } },
    { job: { ...job, status: 'running' } }, { job: { ...job, cancel_requested: true } }, { job: { ...job, cancel_requested: undefined } },
    { job: { ...job, activation_exposed: true } }, { job: { ...job, cleanup: { state: 'deleting' } } },
    { job: { ...job, stage_retry: { ...job.stage_retry, state: 'retrying' } } }, { job: { ...job, stage: 'importing' } },
    { job: { ...job, confirmation_texts: {} } }]) assert.equal(infinidyskV2StageRetryReady({ ...input, ...change }), false)
  for (const change of [{ protocol: '1' }, { stage: undefined }, { stage: '../escape' }, { attempt: '1' }, { attempt: 0 }, { failed_at: -1 }, { state: 'future' }, { label: '' }, { message: {} }]) {
    assert.equal(infinidyskV2StageRetry({ ...job, stage_retry: { ...job.stage_retry, ...change } }), null)
  }
})

test('paused work retains the live session and earlier completed stages without an active progress or ETA', () => {
  const job = paused(), view = infinidyskV2JobPresentation(job)
  assert.equal(view.state, 'stage_retry'); assert.equal(view.active, true); assert.equal(view.paused, true); assert.equal(view.showProgress, false)
  assert.match(view.message, /v1 has not been restored/)
  assert.match(infinidyskV2JobExplanation(job), /retained the completed work/)
  const stopping = infinidyskV2JobPresentation({ ...job, cancel_requested: true })
  assert.equal(stopping.state, 'cancelling'); assert.equal(stopping.showProgress, false)
  assert.match(stopping.message, /has not yet begun restoring/)
  const fresh = { ...job, prepare_mode: 'fresh' }
  assert.doesNotMatch(infinidyskV2JobPresentation(fresh).next, /v1/)
  assert.match(infinidyskV2JobExplanation(fresh), /restore the previous setup/)
  assert.equal(isInfiniDyskV2JobActive(job), true)
  assert.equal(infinidyskV2JobPresentation({ ...job, activation_exposed: true }).state, 'recovery')
  const journal = { protocol: 1, tracking: 'recorded', current_step_id: 'save_recovery', steps: [
    { id: 'check_plan', state: 'completed' }, { id: 'save_recovery', state: 'failed' }, { id: 'native_import', state: 'pending' },
  ] }
  const stages = infinidyskV2Stages(journal, { job })
  assert.deepEqual(stages.steps.map(step => step.state), ['completed', 'failed', 'pending'])
  assert.equal(stages.steps[1].statusLabel, 'Paused — decision required')
  assert.match(stages.note, /Completed stages are retained/)
  assert.match(infinidyskV2Stages(journal, { job: { ...fresh, cancel_requested: true } }).note, /restoring the previous setup/)
})

test('controller opts in only new migration mutations with the supported step retry protocol', async () => {
  let caps = capabilities, calls = [], job = null
  const controller = controllerFor({ capabilities: async () => caps,
    status: async () => ({ protocol: 1, runtime_generation: '1', job }),
    rehearse: async payload => { calls.push(payload); job = { job_id: 'test-fixture', mode: 'rehearsal', status: 'failed_restored' }; return { job } },
    start: async payload => { calls.push(payload); job = { job_id: 'start-fixture', mode: 'cutover', status: 'failed_restored' }; return { job } },
    prepare: async payload => { calls.push(payload); job = { job_id: 'prepare-fixture', mode: 'prepare', status: 'failed_restored' }; return { job } },
  })
  await controller.refresh()
  await controller.mutate('major', 'rehearse', { preview_token: 'reviewed' })
  assert.deepEqual(calls[0], { preview_token: 'reviewed', pause_on_stage_error: true })
  caps = { ...capabilities, infinidysk_v2_stage_retry_protocol: '1' }; await controller.refresh()
  await controller.mutate('major', 'start', { preview_token: 'reviewed', pause_on_stage_error: true })
  assert.deepEqual(calls[1], { preview_token: 'reviewed' }, 'Capability loss cannot keep an earlier opt-in')
  caps = { ...capabilities, infinidysk_v2_prepared_activation: true }; await controller.refresh()
  await controller.mutate('major', 'prepare', { preview_token: 'reviewed' })
  assert.deepEqual(calls[2], { preview_token: 'reviewed', pause_on_stage_error: true })
})

test('controller refuses stale paused authorization and never sends retry to another job or provider', async () => {
  let job = paused(), caps = capabilities, calls = [], offline = false
  const controller = controllerFor({ capabilities: async () => caps,
    status: async () => { if (offline) throw new Error('offline'); return { protocol: 1, runtime_generation: '1', job } },
    retryStage: async payload => { calls.push(payload); job = { ...job, status: 'running', can_retry_stage: false, stage_retry: { ...job.stage_retry, state: 'retrying' } }; return { job } },
  })
  await controller.refresh()
  const payload = { job_id: job.job_id, confirmation: job.confirmation_texts.retry_stage }
  await assert.rejects(controller.mutate('major', 'retryStage', { ...payload, job_id: 'another-job' }), /exact paused migration step/)
  await assert.rejects(controller.mutate('postgres', 'retryStage', payload), /before changing the database provider/)
  caps = baseCapabilities; await controller.refresh()
  await assert.rejects(controller.mutate('major', 'retryStage', payload), /retry authorization/)
  caps = capabilities; offline = true; await controller.refresh()
  await assert.rejects(controller.mutate('major', 'retryStage', payload), /retry authorization/)
  offline = false; job.confirmation_texts.retry_stage = 'RETRY INFINIDYSK V2 STAGE paused-fixture new-nonce'; await controller.refresh()
  await assert.rejects(controller.mutate('major', 'retryStage', payload), /retry authorization/)
  assert.equal(calls.length, 0)
  await controller.mutate('major', 'retryStage', { ...payload, confirmation: job.confirmation_texts.retry_stage })
  assert.equal(calls.length, 1); assert.equal(controller.state.value.majorJob.job_id, payload.job_id)
  await assert.rejects(controller.mutate('major', 'retryStage', payload), /retry authorization/)
  assert.equal(calls.length, 1)
})

test('a lost retry response reconciles only the accepted same attempt and never replays the mutation', async () => {
  for (const state of ['retrying', 'completed']) {
    let job = paused(), calls = 0
    const controller = controllerFor({ status: async () => ({ protocol: 1, runtime_generation: '1', job }), retryStage: async () => {
      calls++; job = { ...job, status: state === 'completed' ? 'prepared' : 'running', stage_retry: { ...job.stage_retry, state } }
      throw { code: 'ECONNABORTED', response: { status: 504 } }
    } })
    await controller.refresh()
    const result = await controller.mutate('major', 'retryStage', { job_id: job.job_id, confirmation: job.confirmation_texts.retry_stage })
    assert.equal(result.reconciled, true); assert.equal(calls, 1)
    await controller.refresh(); assert.equal(calls, 1)
  }
  for (const changed of [{ state: 'waiting' }, { state: 'retrying', attempt: '2' }, { state: 'retrying', operation: 'another_operation' }]) {
    let job = paused(), calls = 0
    const controller = controllerFor({ status: async () => ({ protocol: 1, runtime_generation: '1', job }), retryStage: async () => {
      calls++; job = { ...job, stage_retry: { ...job.stage_retry, ...changed } }; throw { code: 'ECONNABORTED' }
    } })
    await controller.refresh()
    await assert.rejects(controller.mutate('major', 'retryStage', { job_id: job.job_id, confirmation: job.confirmation_texts.retry_stage }))
    assert.equal(controller.state.value.majorMutation.status, 'uncertain'); assert.equal(calls, 1)
  }
})

test('a lost response followed by a newer pause confirms admission and leaves a fresh explicit retry available', async () => {
  for (const operation of ['verify_archive', 'source_fingerprint']) {
    let job = paused(), calls = 0
    const controller = controllerFor({ status: async () => ({ protocol: 1, runtime_generation: '1', job }), retryStage: async () => {
      calls++
      if (calls === 1) {
        job = { ...job, stage: operation === 'verify_archive' ? 'verifying_archive' : 'snapshotting',
          confirmation_texts: { retry_stage: 'RETRY INFINIDYSK V2 STAGE paused-fixture rotated-nonce' },
          stage_retry: { ...job.stage_retry, attempt: 2, operation, stage: operation === 'verify_archive' ? 'verifying_archive' : 'snapshotting', state: 'waiting' } }
        throw { code: 'ECONNABORTED', response: { status: 504 } }
      }
      job = { ...job, status: 'running', can_retry_stage: false, stage_retry: { ...job.stage_retry, state: 'retrying' } }
      return { job }
    } })
    await controller.refresh()
    const oldPhrase = job.confirmation_texts.retry_stage
    const result = await controller.mutate('major', 'retryStage', { job_id: job.job_id, confirmation: oldPhrase })
    assert.equal(result.reconciled, true); assert.equal(calls, 1)
    assert.equal(controller.state.value.majorMutation.status, 'confirmed')
    assert.equal(controller.state.value.majorJob.status, 'stage_retry_required')
    assert.equal(controller.state.value.majorJob.stage_retry.attempt, 2)
    await controller.refresh(); assert.equal(calls, 1, 'Observation never repeats the accepted request')
    await assert.rejects(controller.mutate('major', 'retryStage', { job_id: job.job_id, confirmation: oldPhrase }), /retry authorization/)
    await controller.mutate('major', 'retryStage', { job_id: job.job_id, confirmation: job.confirmation_texts.retry_stage })
    assert.equal(calls, 2, 'Only a new explicit decision retries the latest paused step')
  }
})

test('repository uses only the dedicated DUMB stage retry endpoint', async () => {
  const calls = [], payload = { job_id: 'paused-fixture', confirmation: 'fresh-backend-phrase' }
  const repository = infinidyskV2Repository({ post: async (...args) => { calls.push(args); return { data: { accepted: true } } } })
  assert.deepEqual(await repository.retryStage(payload), { accepted: true })
  assert.deepEqual(calls, [['/api/process/infinidysk-v2/retry-stage', payload, { timeout: 60000 }]])
})
