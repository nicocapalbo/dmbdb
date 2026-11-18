import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2ActivateReady, infinidyskV2PreparedActivationSupported, infinidyskV2PreparedSession } from '../helper/infinidyskV2Prepared.js'
import { infinidyskV2JobPresentation, infinidyskV2ReviewNotes, infinidyskV2CheckText } from '../helper/infinidyskV2Presentation.js'
import { infinidyskV2MutationObserved } from '../helper/infinidyskV2Status.js'
import { infinidyskV2JobExplanation, isInfiniDyskV2JobActive } from '../helper/infinidyskV2.js'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { infinidyskV2Repository } from '../services/infinidyskV2.js'

const caps = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1, infinidysk_v2_prepared_activation: true, infinidysk_v2_reviewed_skips: true }
const accepted = { status: 'accepted', imported_files: 2, skipped_files: 0, review_required: false, reasons: [], skipped: [], blocking_reasons: [], reason_count: 0, skipped_details_count: 0, reasons_truncated: false, skipped_details_truncated: false }
const skipped = { ...accepted, status: 'review_required', skipped_files: 1, skipped_details_count: 1, reason_count: 1, reasons: [{ reason: 'Unsupported metadata', count: 1 }], skipped: [{ path: '/content/example.mkv', reason: 'Unsupported metadata' }], review_required: true, review_digest: 'a'.repeat(64) }
const prepared = () => ({ job_id: 'prepared-fixture', mode: 'prepare', prepare_mode: 'migrate', status: 'prepared', stage: 'awaiting_activation', result: { validated: true }, can_activate: true, can_rollback: true, activate_confirmation: 'ACTIVATE INFINIDYSK V2 prepared-fixture', rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 prepared-fixture', import_report: accepted, plan_fingerprint: 'reviewed-plan' })
const ready = (job = prepared(), overrides = {}) => infinidyskV2ActivateReady({ capabilities: caps, confirmed: true, busy: false, job, confirmation: job.activate_confirmation, ...overrides })
const controller = (repository, stored = {}) => {
  const state = { value: initialInfiniDyskV2State() }
  const storage = { value: JSON.stringify(stored), getItem() { return this.value }, setItem(key, value) { this.value = value } }
  return { state, storage, ...createInfiniDyskV2Controller({ state, repository, storage }) }
}

test('prepared activation requires strict capability and an exact confirmed current candidate', () => {
  assert.equal(infinidyskV2PreparedActivationSupported(caps), true)
  assert.equal(ready(), true)
  for (const value of [undefined, false, 'true', 1]) assert.equal(infinidyskV2PreparedActivationSupported({ ...caps, infinidysk_v2_prepared_activation: value }), false)
  for (const change of [{ prepare_mode: undefined }, { mode: 'rehearsal' }, { status: 'rehearsed' }, { stage: 'validating' }, { can_activate: 'true' }, { result: {} }, { activate_confirmation: 'ACTIVATE WRONG' }, { activation_exposed: true }, { recovery_required: true }, { cancel_requested: true }, { import_report: undefined }, { import_report: { ...accepted, status: 'blocked' } }]) assert.equal(ready({ ...prepared(), ...change }), false, JSON.stringify(change))
  for (const change of [{ confirmed: false }, { busy: true }, { confirmation: 'ACTIVATE INFINIDYSK V2 different-job' }, { capabilities: {} }]) assert.equal(ready(prepared(), change), false)
})

test('fresh preparation can omit an import report only with the explicit fresh mode', () => {
  assert.equal(ready({ ...prepared(), prepare_mode: 'fresh', import_report: undefined }), true)
  assert.equal(ready({ ...prepared(), prepare_mode: 'migrate', import_report: undefined }), false)
  assert.equal(ready({ ...prepared(), prepare_mode: 'fresh', import_report: {} }), false)
})

test('skipped items need current report acknowledgement and explicit skip-review support', () => {
  const job = { ...prepared(), import_report: skipped }
  assert.equal(ready(job), false)
  assert.equal(ready(job, { acknowledgeSkippedMedia: true }), true)
  assert.equal(ready(job, { acknowledgeSkippedMedia: 'true' }), false)
  assert.equal(ready(job, { acknowledgeSkippedMedia: true, capabilities: { ...caps, infinidysk_v2_reviewed_skips: undefined } }), false)
})

test('prepared presentation is a held active session without spinner, stale ETA or implied recovery', () => {
  const job = prepared()
  assert.equal(infinidyskV2PreparedSession(job), true)
  assert.equal(isInfiniDyskV2JobActive(job), true)
  const view = infinidyskV2JobPresentation(job)
  assert.equal(view.state, 'prepared'); assert.equal(view.active, true); assert.equal(view.showProgress, false)
  assert.match(view.message, /same converted candidate/)
  assert.match(view.next, /apps remain stopped|Closing this panel does not resume services/)
  assert.doesNotMatch(view.title, /recovery|failed|running/i)
  assert.match(infinidyskV2JobExplanation(job), /affected services remain stopped/)
  assert.equal(infinidyskV2JobPresentation({ ...job, status: 'recovery_required', recovery_required: true }).state, 'recovery')
  assert.match(infinidyskV2JobPresentation({ ...job, status: 'running', stage: 'activating' }).title, /Activating prepared/)
})

test('only explicit completion or verified restoration requests a final control-plane restart', () => {
  for (const status of ['completed', 'rolled_back']) {
    const view = infinidyskV2JobPresentation({ ...prepared(), status, result: { validated: true, source_restored: status === 'rolled_back', restart_required: true } })
    assert.match(view.next, /Restart DUMB once/)
  }
  for (const status of ['failed_restored', 'cancelled']) {
    assert.match(infinidyskV2JobPresentation({ ...prepared(), status, result: { source_restored: true, restart_required: true } }).next, /Restart DUMB once/)
    for (const source_restored of [false, undefined, 'true']) assert.doesNotMatch(infinidyskV2JobPresentation({ ...prepared(), status, result: { source_restored, restart_required: true } }).next, /Restart DUMB/)
    assert.doesNotMatch(infinidyskV2JobPresentation({ ...prepared(), status, result: { source_restored: true } }).next, /Restart DUMB/)
    assert.doesNotMatch(infinidyskV2JobPresentation({ ...prepared(), status, activation_exposed: true, result: { source_restored: true, restart_required: true } }).next, /Restart DUMB/)
  }
  for (const restart_required of [false, undefined, 'true']) assert.doesNotMatch(infinidyskV2JobPresentation({ ...prepared(), status: 'completed', result: { restart_required } }).next, /Restart DUMB/)
  assert.doesNotMatch(infinidyskV2JobPresentation({ ...prepared(), result: { validated: true, restart_required: true } }).next, /Restart DUMB/)
})

test('capability-selected preparation review never promises automatic v1 restoration', () => {
  const preview = { rehearsal_required: true, warnings: ['Rehearsal can temporarily stop all affected managed consumers and the v1 source.', 'The native beta import can read NNTP and requires a real contained rehearsal.'] }
  const notes = infinidyskV2ReviewNotes(preview, { prepared: true })
  assert.match(notes.important[0].message, /stay stopped/)
  assert.doesNotMatch(notes.important[0].message, /then restores v1/)
  assert.match(infinidyskV2CheckText({ name: 'contained_native_import', status: 'required' }, null, true), /explicit activation/)
  assert.match(infinidyskV2ReviewNotes(preview).important[0].message, /then restores v1/)
})

test('lost admission responses reconcile preparation and activation without treating the old prepared state as activation', () => {
  const request = { kind: 'major', action: 'prepare', status: 'uncertain', previous_job_id: null, plan_fingerprint: 'reviewed-plan' }
  assert.equal(infinidyskV2MutationObserved(request, prepared()), true)
  const activation = { ...request, action: 'activate', previous_job_id: prepared().job_id }
  assert.equal(infinidyskV2MutationObserved(activation, prepared()), false)
  assert.equal(infinidyskV2MutationObserved(activation, { ...prepared(), status: 'running', stage: 'activating' }), true)
  assert.equal(infinidyskV2MutationObserved(activation, { ...prepared(), status: 'completed', activation_committed: true }), true)
  assert.equal(infinidyskV2MutationObserved(activation, { ...prepared(), job_id: 'another-job', status: 'running', stage: 'activating' }), false)
})

test('prepare and activate repository routes stay in the dedicated namespace', async () => {
  const calls = []
  const repository = infinidyskV2Repository({ post: async (...args) => { calls.push(args); return { data: { job: prepared() } } } })
  await repository.prepare({ preview_token: 'private-review' }); await repository.activate({ job_id: prepared().job_id })
  assert.deepEqual(calls.map(row => row[0]), ['/api/process/infinidysk-v2/prepare', '/api/process/infinidysk-v2/activate'])
})

test('reload discovers prepared session and guarded activation settles a lost response by GET only', async () => {
  let job = prepared(), posts = 0
  const repo = { capabilities: async () => caps, status: async () => ({ protocol: 1, runtime_generation: '1', job }), activate: async payload => { posts++; assert.equal(payload.job_id, job.job_id); job = { ...job, status: 'running', stage: 'activating', can_activate: false }; throw { code: 'ECONNABORTED' } } }
  const app = controller(repo, { major: job.job_id })
  await app.refresh()
  assert.equal(app.state.value.majorJob.status, 'prepared')
  const result = await app.mutate('major', 'activate', { job_id: job.job_id, confirmation: job.activate_confirmation })
  assert.equal(result.reconciled, true); assert.equal(posts, 1)
  assert.equal(app.state.value.majorMutation.status, 'confirmed')
  assert.deepEqual(JSON.parse(app.storage.value), { major: job.job_id, postgres: null })
  assert.equal(app.storage.value.includes('ACTIVATE'), false)
})

test('activation rejects stale job, status, capability and skip digest before any POST', async () => {
  let posts = 0
  const job = { ...prepared(), import_report: skipped }
  const app = controller({ capabilities: async () => caps, status: async () => ({ protocol: 1, job }), activate: async () => { posts++ } })
  await app.refresh()
  const body = { job_id: job.job_id, confirmation: job.activate_confirmation, acknowledgements: { skipped_media: true }, skip_review_digest: 'b'.repeat(64) }
  await assert.rejects(app.mutate('major', 'activate', body), /current report/)
  await assert.rejects(app.mutate('major', 'activate', { ...body, skip_review_digest: skipped.review_digest, job_id: 'different' }), /exact prepared candidate/)
  app.state.value.capabilities = { ...caps, infinidysk_v2_prepared_activation: false }
  await assert.rejects(app.mutate('major', 'activate', { ...body, skip_review_digest: skipped.review_digest }), /exact prepared candidate/)
  assert.equal(posts, 0)
})
