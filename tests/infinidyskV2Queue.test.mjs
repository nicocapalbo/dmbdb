import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2QueueOmissionCapability, infinidyskV2QueueOmissionSupported, infinidyskV2QueueFields, infinidyskV2SourceQueue, infinidyskV2SourceQueueMatches } from '../helper/infinidyskV2Queue.js'
import { infinidyskV2PreviewOptions, infinidyskV2PreviewOptionsMatch, createInfiniDyskV2PreviewController, initialInfiniDyskV2PreviewState } from '../helper/infinidyskV2Preview.js'
import { infinidyskV2CheckText, infinidyskV2JobLabel } from '../helper/infinidyskV2Presentation.js'

const capabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true,
  infinidysk_v2_migration_protocol: 1, infinidysk_v2_async_preview: true, infinidysk_v2_queue_omission: true }
const status = { mode: 'migrate', runtime_generation: '1' }
const options = { mode: 'migrate', mount_backend: 'rclone', import_strategy: 'preserve' }
const queue = (patch = {}) => ({ policy: 'omit_from_v2', observed_count: 4, observed_at: 1900000000,
  observation: 'live', omitted_count: null, source_queue_preserved: true, ...patch })
const task = body => ({ task_id: 'a'.repeat(32), request_id: body.request_id, status: 'running',
  options: body, options_fingerprint: 'b'.repeat(64), created_at: 1900000000, updated_at: 1900000001,
  can_cancel: true, cancel_requested: false, preview_available: false, preview: null })
const setup = repository => {
  const state = { value: { ...initialInfiniDyskV2PreviewState(), capabilities, majorStatusConfirmed: true, busy: false, majorJob: null } }
  return { state, ...createInfiniDyskV2PreviewController({ state, repository }) }
}

test('whole-queue omission needs the strict advertised capability and a v1 migration', () => {
  assert.equal(infinidyskV2QueueOmissionCapability(capabilities), true)
  assert.equal(infinidyskV2QueueOmissionSupported(capabilities, status), true)
  assert.deepEqual(infinidyskV2QueueFields(capabilities, status, true), { omit_queued_downloads: true })
  assert.deepEqual(infinidyskV2QueueFields(capabilities, status, false), {})
  for (const change of [{ infinidysk_v2_queue_omission: undefined }, { infinidysk_v2_queue_omission: 'true' },
    { infinidysk_v2_queue_omission: false }, { api_version: '2.23.0' }, { infinidysk_v2_migration: false }]) {
    assert.equal(infinidyskV2QueueOmissionSupported({ ...capabilities, ...change }, status), false)
    assert.deepEqual(infinidyskV2QueueFields({ ...capabilities, ...change }, status, true), {})
  }
  for (const value of [null, {}, { ...status, mode: 'fresh' }, { ...status, runtime_generation: '2' }]) {
    assert.equal(infinidyskV2QueueOmissionSupported(capabilities, value), false)
    assert.deepEqual(infinidyskV2QueueFields(capabilities, value, true), {})
  }
})

test('queue choice is part of reviewed options while default requests omit the additive field', () => {
  assert.equal(Object.hasOwn(infinidyskV2PreviewOptions(options), 'omit_queued_downloads'), false)
  assert.equal(Object.hasOwn(infinidyskV2PreviewOptions({ ...options, omit_queued_downloads: false }), 'omit_queued_downloads'), false)
  const selected = infinidyskV2PreviewOptions({ ...options, omit_queued_downloads: true })
  assert.equal(selected.omit_queued_downloads, true)
  assert.equal(infinidyskV2PreviewOptionsMatch(options, selected), false)
  assert.equal(infinidyskV2PreviewOptionsMatch(options, { ...options, omit_queued_downloads: false }), true)
  assert.equal(infinidyskV2PreviewOptions({ ...options, omit_queued_downloads: 'true' }), null)
  assert.equal(infinidyskV2PreviewOptions({ ...options, mode: 'fresh', omit_queued_downloads: true }), null)
})

test('reviewed queue policy must match the choice without pinning a changing live count', () => {
  assert.equal(infinidyskV2SourceQueueMatches({}, false), true, 'Older APIs keep the empty-queue policy')
  assert.equal(infinidyskV2SourceQueueMatches({}, true), false)
  assert.equal(infinidyskV2SourceQueueMatches({ source_queue: queue() }, true), true)
  assert.equal(infinidyskV2SourceQueueMatches({ source_queue: queue({ observed_count: 99 }) }, true), true)
  assert.equal(infinidyskV2SourceQueueMatches({ source_queue: queue() }, false), false)
  assert.equal(infinidyskV2SourceQueueMatches({ source_queue: queue({ policy: 'require_empty' }) }, true), false)
  assert.equal(infinidyskV2SourceQueueMatches({ source_queue: queue({ policy: 'require_empty' }) }, false), true)
  assert.equal(infinidyskV2SourceQueueMatches({ source_queue: null }, false), false)
})

test('queue observations expose only bounded counts and preservation proof', () => {
  const result = infinidyskV2SourceQueue(queue({ observation: 'captured', omitted_count: 7,
    download_ids: ['private-id'], title: 'private-title', raw_path: '/private/input' }))
  assert.equal(result.observedCount, 4); assert.equal(result.omittedCount, 7)
  assert.doesNotMatch(JSON.stringify(result), /private|download_ids|title|raw_path/)
  const unavailable = infinidyskV2SourceQueue(queue({ observation: 'unavailable', observed_count: null, observed_at: null }))
  assert.equal(unavailable.observedCount, null)
  for (const patch of [{ policy: 'drop_all' }, { observation: 'unknown' }, { observed_count: '4' },
    { observed_count: -1 }, { omitted_count: 1.5 }, { omitted_count: Number.MAX_SAFE_INTEGER + 1 },
    { observed_at: '1900000000' }, { source_queue_preserved: false }]) assert.equal(infinidyskV2SourceQueue(queue(patch)), null)
})

test('queue review copy describes selected omission and never hides a real failed check', () => {
  const check = { name: 'source_queue', status: 'must_be_empty_after_quiescence' }
  assert.match(infinidyskV2CheckText(check), /Finish or review/)
  assert.match(infinidyskV2CheckText(check, 'omit_from_v2'), /excluded from v2/)
  assert.doesNotMatch(infinidyskV2CheckText(check, 'omit_from_v2'), /must be empty|Finish or review/)
  assert.equal(infinidyskV2CheckText({ ...check, passed: false, message: 'The stopped-source queue check failed.' }, 'omit_from_v2'), 'The stopped-source queue check failed.')
  assert.equal(infinidyskV2JobLabel('preparing_import_database'), 'Preparing the v2 import database')
})

test('an older backend never receives an unsupported true field, including a stale checked selection', async () => {
  let posts = 0, body
  const app = setup({ previewStart: async value => { posts++; body = value; return { protocol: 1, task: task(value) } } })
  app.state.value.capabilities = { ...capabilities, infinidysk_v2_queue_omission: undefined }
  await assert.rejects(app.prepareMajorPreview({ ...options, omit_queued_downloads: true }), /cannot exclude queued downloads/)
  assert.equal(posts, 0)
  await app.prepareMajorPreview({ ...options, omit_queued_downloads: false })
  assert.equal(posts, 1); assert.equal(Object.hasOwn(body, 'omit_queued_downloads'), false)
})

test('a lost omission preview retries the exact same policy and nonce only while supported', async () => {
  const bodies = []
  const app = setup({ previewStart: async body => { bodies.push(body); throw { code: 'ERR_NETWORK' } },
    previewTask: async () => ({ protocol: 1, task: null }) })
  await app.prepareMajorPreview({ ...options, omit_queued_downloads: true })
  await app.prepareMajorPreview({ ...options, omit_queued_downloads: true }, { retry: true })
  assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]); assert.equal(bodies[0].omit_queued_downloads, true)
  app.state.value.capabilities = { ...capabilities, infinidysk_v2_queue_omission: false }
  await assert.rejects(app.prepareMajorPreview({ ...options, omit_queued_downloads: true }, { retry: true }), /cannot exclude queued downloads/)
  assert.equal(bodies.length, 2)
})
