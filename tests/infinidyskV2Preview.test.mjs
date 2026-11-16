import test from 'node:test'
import assert from 'node:assert/strict'
import { createInfiniDyskV2PreviewController, initialInfiniDyskV2PreviewState, infinidyskV2AsyncPreviewSupported, infinidyskV2PreviewBlocked, infinidyskV2PreviewOptions, normalizeInfiniDyskV2PreviewTask } from '../helper/infinidyskV2Preview.js'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { infinidyskV2Repository } from '../services/infinidyskV2.js'

const base = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1 }
const capabilities = { ...base, infinidysk_v2_async_preview: true }
const options = { mode: 'migrate', mount_backend: 'fuse', import_strategy: 'preserve', backup_destination_id: '@default', reclaim_source_space: true, offload_legacy_blobs: true }
const id = 'a'.repeat(32), otherId = 'b'.repeat(32), requestId = 'c'.repeat(32)
const result = { protocol: 1, ready: true, preview_token: 'private-preview-token', plan_fingerprint: 'plan', expires_at: 2000000000 }
const task = changes => ({ task_id: id, request_id: requestId, status: 'running', stage: 'inventory', message: 'Inspecting source state', options,
  options_fingerprint: 'f'.repeat(64), created_at: 1900000000, updated_at: 1900000001,
  can_cancel: true, cancel_requested: false, preview_available: false, preview: null, ...changes })
const completed = changes => task({ status: 'completed', updated_at: 1900000002, can_cancel: false, preview_available: true, preview: result, ...changes })
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const setup = repository => {
  const state = { value: { ...initialInfiniDyskV2PreviewState(), capabilities, majorStatusConfirmed: true, majorJob: null, busy: false } }
  return { state, ...createInfiniDyskV2PreviewController({ state, repository }) }
}

test('async preview requires the explicit current capability and exact safe options', () => {
  assert.equal(infinidyskV2AsyncPreviewSupported(capabilities), true)
  for (const change of [{ infinidysk_v2_async_preview: 'true' }, { infinidysk_v2_async_preview: undefined }, { api_version: '2.23.0' }, { infinidysk_v2_migration: false }]) assert.equal(infinidyskV2AsyncPreviewSupported({ ...capabilities, ...change }), false)
  assert.equal(infinidyskV2PreviewOptions(options).backup_destination_id, '@default')
  for (const change of [{ mode: 'fresh' }, { reclaim_source_space: false }, { backup_destination_id: '' }, { import_strategy: 'replace' }, { offload_legacy_blobs: 'true' }]) assert.equal(infinidyskV2PreviewOptions({ ...options, ...change }), null)
  assert.equal(normalizeInfiniDyskV2PreviewTask(completed()).preview.preview_token, result.preview_token)
  for (const change of [{ task_id: '../private' }, { status: 'unknown' }, { options_fingerprint: 'bad' }, { created_at: '1900000000' }, { preview: { protocol: 2 }, preview_available: true }]) assert.equal(normalizeInfiniDyskV2PreviewTask(completed(change)), null)
  assert.equal(normalizeInfiniDyskV2PreviewTask(task({ preview: result })).preview, null, 'Progress responses cannot expose an incomplete review')
})

test('legacy scan has no client total deadline while async admission and polling stay bounded', async () => {
  const calls = []
  const client = { post: async (...args) => { calls.push(['post', ...args]); return { data: {} } }, get: async (...args) => { calls.push(['get', ...args]); return { data: {} } } }
  const repo = infinidyskV2Repository(client)
  await repo.preview(options); await repo.previewStart({ ...options, request_id: requestId }); await repo.previewTask(); await repo.previewTask(id); await repo.cancelPreview(id)
  assert.equal(calls[0][3].timeout, 0)
  assert.equal(calls[1][3].timeout, 30000)
  assert.equal(calls[2][1], '/api/process/infinidysk-v2/preview/task')
  assert.equal(calls[3][1], '/api/process/infinidysk-v2/preview/task/' + id)
  assert.equal(calls[3][2].timeout, 15000)
  assert.equal(calls[4][3].timeout, 30000)
  for (const invalid of ['../private', '', 123, 'a'.repeat(161)]) {
    assert.throws(() => repo.previewTask(invalid)); assert.throws(() => repo.cancelPreview(invalid))
  }
  assert.equal(calls.length, 5)
})

test('one acknowledged read-only task blocks duplicate admission without holding the UI busy for its scan', async () => {
  const gate = deferred(); let calls = 0, submitted
  const app = setup({ previewStart: async value => { calls++; submitted = value; await gate.promise; return { protocol: 1, task: task({ request_id: value.request_id }) } } })
  const first = app.prepareMajorPreview(options)
  assert.equal(app.state.value.busy, true); assert.equal(app.state.value.majorPreviewPending, true)
  await assert.rejects(app.prepareMajorPreview(options), /already running/)
  gate.resolve(); await first
  assert.equal(calls, 1); assert.match(submitted.request_id, /^[a-f0-9]{32}$/)
  assert.equal(app.state.value.busy, false); assert.equal(infinidyskV2PreviewBlocked(app.state.value), true)
  await assert.rejects(app.prepareMajorPreview(options), /already running/)
})

test('lost POST acknowledgement reconnects a completed request without another POST or persisted token', async () => {
  let calls = 0, submitted
  const app = setup({
    previewStart: async value => { calls++; submitted = value; throw { code: 'ECONNABORTED' } },
    previewTask: async () => ({ protocol: 1, task: completed({ request_id: submitted.request_id }) }),
  })
  await app.prepareMajorPreview(options)
  assert.equal(calls, 1); assert.equal(app.state.value.majorPreviewConfirmed, true)
  assert.equal(app.state.value.majorPreviewUncertain, false)
  assert.equal(app.state.value.majorPreviewTask.preview.preview_token, result.preview_token)
})

test('an older terminal task cannot settle uncertain admission and explicit retry reuses its request identity', async () => {
  const requests = [], scans = new Set()
  const app = setup({
    previewStart: async value => {
      requests.push(value.request_id); scans.add(value.request_id)
      if (requests.length === 1) throw { code: 'ERR_NETWORK' }
      return { protocol: 1, task: completed({ request_id: value.request_id }) }
    },
    previewTask: async () => ({ protocol: 1, task: completed({ task_id: otherId, request_id: 'd'.repeat(32) }) }),
  })
  await app.prepareMajorPreview(options)
  assert.equal(app.state.value.majorPreviewUncertain, true)
  assert.equal(app.state.value.majorPreviewTask, null)
  await assert.rejects(app.prepareMajorPreview(options), /uncertain/)
  await app.prepareMajorPreview(options, { retry: true })
  assert.deepEqual(requests, [requests[0], requests[0]]); assert.equal(scans.size, 1)
  assert.equal(app.state.value.majorPreviewConfirmed, true)
})

for (const acceptedNonce of [requestId, null]) test('known equal-options task with ' + (acceptedNonce ? 'another nonce' : 'no nonce') + ' reconnects only through GET after completion', async () => {
  let posts = 0, reads = 0
  const app = setup({
    previewStart: async () => { posts++; return { protocol: 1, task: task({ request_id: acceptedNonce }) } },
    previewTask: async () => { reads++; throw { code: 'ERR_NETWORK' } },
  })
  await app.prepareMajorPreview(options)
  assert.equal(app.state.value.majorPreviewRequest?.request_id ?? null, acceptedNonce)
  app.observeMajorPreview(completed({ request_id: acceptedNonce }))
  await app.pollMajorPreview()
  assert.equal(app.state.value.majorPreviewUncertain, true)
  await app.prepareMajorPreview(options, { retry: true })
  assert.equal(posts, 1)
  assert.equal(reads, 2)
  assert.equal(app.state.value.majorPreviewTask.task_id, id)
})

test('ordinary omitted defaults produce the exact same first and explicit retry payload', async () => {
  const bodies = [], ordinary = { mode: 'migrate', mount_backend: 'rclone', import_strategy: 'preserve' }
  const app = setup({
    previewStart: async body => {
      bodies.push(body)
      if (bodies.length === 1) throw { code: 'ECONNABORTED' }
      return { protocol: 1, task: completed({ request_id: body.request_id, options: body }) }
    },
    previewTask: async () => ({ protocol: 1, task: null }),
  })
  await app.prepareMajorPreview(ordinary)
  assert.equal(app.state.value.majorPreviewUncertain, true)
  await app.prepareMajorPreview(ordinary, { retry: true })
  assert.deepEqual(bodies[0], bodies[1])
  assert.equal(bodies[0].backup_destination_id, '')
  assert.equal(bodies[0].reclaim_source_space, false)
  assert.equal(bodies[0].offload_legacy_blobs, false)
  assert.equal(app.state.value.majorPreviewTask.preview_available, true)
})

test('reload discovers the retained result through GET and consumed/expired previews stay unavailable', async () => {
  let posts = 0, current = completed()
  const app = setup({ previewTask: async () => ({ protocol: 1, task: current }), previewStart: async () => { posts++ } })
  await app.pollMajorPreview()
  assert.equal(posts, 0); assert.equal(app.state.value.majorPreviewTask.preview_available, true)
  for (const reason of ['consumed', 'expired']) {
    current = completed({ updated_at: current.updated_at + 1, preview_available: false, preview_unavailable_reason: reason, preview: null })
    await app.pollMajorPreview()
    assert.equal(app.state.value.majorPreviewTask.preview, null)
    assert.equal(app.state.value.majorPreviewTask.preview_unavailable_reason, reason)
  }
  current = null; await app.pollMajorPreview()
  assert.equal(app.state.value.majorPreviewTask, null); assert.equal(app.state.value.majorPreviewUncertain, false)
})

test('late running polls cannot replace completed tasks or silently change their option identity', async () => {
  const gate = deferred()
  const app = setup({ previewTask: async () => { await gate.promise; return { protocol: 1, task: task() } } })
  app.observeMajorPreview(task())
  const polling = app.pollMajorPreview()
  app.observeMajorPreview(completed()); gate.resolve(); await polling
  assert.equal(app.state.value.majorPreviewTask.status, 'completed')
  assert.throws(() => app.observeMajorPreview(completed({ options_fingerprint: 'e'.repeat(64) })), /identity changed/)
  assert.equal(app.state.value.majorPreviewTask.status, 'completed')
})

test('an old task poll rejection cannot revoke a newly admitted task or its positive proof', async () => {
  const held = deferred()
  const app = setup({
    previewTask: async () => held.promise,
    previewStart: async body => ({ protocol: 1, task: completed({ task_id: otherId, request_id: body.request_id }) }),
  })
  app.observeMajorPreview(completed())
  const oldPoll = app.pollMajorPreview()
  await app.prepareMajorPreview(options)
  assert.equal(app.state.value.majorPreviewTask.task_id, otherId)
  held.reject({ code: 'ERR_NETWORK' }); await oldPoll
  assert.equal(app.state.value.majorPreviewConfirmed, true)
  assert.equal(app.state.value.majorPreviewUncertain, false)
  assert.equal(app.state.value.majorPreviewError, '')
})

test('an old poll failure cannot revoke newer terminal proof for the same task', async () => {
  const held = deferred()
  const app = setup({ previewTask: async () => held.promise })
  app.observeMajorPreview(task())
  const oldPoll = app.pollMajorPreview()
  app.observeMajorPreview(completed())
  held.reject({ code: 'ERR_NETWORK' }); await oldPoll
  assert.equal(app.state.value.majorPreviewTask.status, 'completed')
  assert.equal(app.state.value.majorPreviewConfirmed, true)
  assert.equal(app.state.value.majorPreviewUncertain, false)
})

test('a late cancellation failure cannot poison a newer task or clear its pending cancellation', async () => {
  const oldCancel = deferred(), newCancel = deferred()
  const app = setup({
    previewStart: async body => ({ protocol: 1, task: task({ task_id: otherId, request_id: body.request_id }) }),
    cancelPreview: async taskId => taskId === id ? oldCancel.promise : newCancel.promise,
  })
  app.observeMajorPreview(task())
  const oldRequest = app.cancelMajorPreview()
  app.observeMajorPreview(completed())
  await app.prepareMajorPreview(options)
  const newRequest = app.cancelMajorPreview()
  assert.equal(app.state.value.majorPreviewCancelPending, true)
  oldCancel.reject({ code: 'ERR_NETWORK' }); await oldRequest
  assert.equal(app.state.value.majorPreviewTask.task_id, otherId)
  assert.equal(app.state.value.majorPreviewConfirmed, true)
  assert.equal(app.state.value.majorPreviewUncertain, false)
  assert.equal(app.state.value.majorPreviewCancelPending, true)
  newCancel.resolve({ protocol: 1, task: { ...app.state.value.majorPreviewTask, cancel_requested: true, can_cancel: false } })
  await newRequest
  assert.equal(app.state.value.majorPreviewCancelPending, false)
})

test('a replaced terminal task reconnects through latest metadata without admitting another scan', async () => {
  const reads = []
  const app = setup({ previewTask: async value => {
    reads.push(value)
    if (value) throw { response: { status: 404 } }
    return { protocol: 1, task: task({ task_id: otherId, request_id: 'd'.repeat(32) }) }
  } })
  app.observeMajorPreview(completed())
  await app.pollMajorPreview()
  assert.deepEqual(reads, [id, undefined])
  assert.equal(app.state.value.majorPreviewTask.task_id, otherId)
  assert.equal(app.state.value.majorPreviewUncertain, false)
})

test('cooperative cancellation is explicit, never repeated by polling and remains guarded after a lost response', async () => {
  let cancellations = 0, current = task()
  const app = setup({
    cancelPreview: async () => { cancellations++; throw { code: 'ERR_NETWORK' } },
    previewTask: async () => ({ protocol: 1, task: current }),
  })
  app.observeMajorPreview(current)
  await app.cancelMajorPreview()
  assert.equal(cancellations, 1); assert.equal(app.state.value.majorPreviewUncertain, true)
  current = task({ status: 'cancelled', updated_at: 1900000003, can_cancel: false })
  await app.pollMajorPreview(); await app.cancelMajorPreview()
  assert.equal(cancellations, 1); assert.equal(app.state.value.majorPreviewUncertain, false)
  assert.equal(app.state.value.majorPreviewTask.status, 'cancelled')
})

test('reset generation fences an in-flight admission from a different session', async () => {
  let generation = 0; const gate = deferred()
  const state = { value: { ...initialInfiniDyskV2PreviewState(), capabilities, majorStatusConfirmed: true, busy: false } }
  const controller = createInfiniDyskV2PreviewController({ state, generation: () => generation, repository: { previewStart: async value => { await gate.promise; return { protocol: 1, task: task({ request_id: value.request_id }) } } } })
  const pending = controller.prepareMajorPreview(options)
  generation++; state.value = { ...initialInfiniDyskV2PreviewState(), capabilities, majorStatusConfirmed: true, busy: false }
  gate.resolve(); await pending
  assert.equal(state.value.majorPreviewTask, null); assert.equal(state.value.majorPreviewPending, false)
})

for (const action of ['cancel', 'rollback']) test('uncertain preview after capability downgrade does not trap exact retained ' + action, async () => {
  const job = action === 'cancel'
    ? { job_id: 'retained', status: 'running', cancel_requested: false, can_cancel: true, actions: { cancel: true }, cancel_confirmation_text: 'CANCEL INFINIDYSK V2 retained' }
    : { job_id: 'retained', status: 'interrupted', can_rollback: true, actions: { rollback: true }, rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 retained' }
  let calls = 0
  const state = { value: initialInfiniDyskV2State() }
  const repository = { capabilities: async () => ({ ...base, infinidysk_v2_cancel: true }), status: async () => ({ protocol: 1, runtime_generation: '1', job }), [action]: async () => { calls++; return { job } } }
  const controller = createInfiniDyskV2Controller({ state, repository })
  state.value.majorPreviewUncertain = true
  await controller.refresh()
  assert.equal(state.value.majorStatusConfirmed, true)
  await controller.mutate('major', action, { job_id: job.job_id, confirmation: job[action === 'cancel' ? 'cancel_confirmation_text' : 'rollback_confirmation_text'] })
  assert.equal(calls, 1)
  await assert.rejects(controller.mutate('major', 'preview', {}), /preview is still running or unconfirmed/)
})

test('malformed preview metadata does not unconfirm independently valid recovery job status', async () => {
  const state = { value: initialInfiniDyskV2State() }
  const job = { job_id: 'retained', status: 'interrupted', can_rollback: true, rollback_confirmation_text: 'ROLLBACK INFINIDYSK V2 retained' }
  let rollbacks = 0
  const controller = createInfiniDyskV2Controller({ state, repository: {
    capabilities: async () => capabilities,
    status: async () => ({ protocol: 1, runtime_generation: '1', job, preview_task: task({ options_fingerprint: 'bad' }) }),
    rollback: async () => { rollbacks++; return { job } },
  } })
  await controller.refresh()
  assert.equal(state.value.majorStatusConfirmed, true); assert.equal(state.value.majorPreviewUncertain, true)
  await controller.mutate('major', 'rollback', { job_id: 'retained', confirmation: job.rollback_confirmation_text })
  assert.equal(rollbacks, 1)
})
