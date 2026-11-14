import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createInstallationBackupController, initialInstallationBackupState } from '../helper/installationBackupController.js'
import { installationBackupDirectConsent, installationBackupDirectReady, installationBackupDirectSupported, installationBlocked } from '../helper/installationBackups.js'
import { installationBackupsRepository } from '../services/installationBackups.js'

const caps = { installation_backup: true, installation_backup_protocol: 1, installation_backup_direct_start: true }
const consent = { confirmation_text: 'BACK UP DUMB INSTALLATION', required_acknowledgements: ['downtime', 'secrets', 'external_state'] }
const accepted = { downtime: true, secrets: true, external_state: true }
const input = { destination_id: 'archive', compression: 'none', confirmation: consent.confirmation_text, acknowledgements: accepted }
const job = (changes = {}) => ({ job_id: 'new_job', job_type: 'installation_backup', status: 'queued', stage: 'queued', created_at: Date.now() / 1000, updated_at: Date.now() / 1000, ...changes })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const fixture = (overrides = {}) => {
  const calls = []
  const observed = { job: null }
  const repository = { capabilities: async () => caps, status: async () => ({ protocol: 1, job: observed.job, recovery_required: false, direct_start: consent }),
    startDirect: async body => { calls.push(body); return { protocol: 1, job: job({ request_id: body.request_id }) } }, ...overrides }
  const state = ref(initialInstallationBackupState())
  const controller = createInstallationBackupController({ state, repository })
  return { calls, observed, repository, state, controller }
}
const preview = () => ({ protocol: 1, ready: true, preview_token: 'reviewed-token', expires_at: Date.now() / 1000 + 900, confirmation_text: consent.confirmation_text,
  inventory: { roots: [{ path: '/config' }], excluded: [] }, blockers: [], required_acknowledgements: consent.required_acknowledgements,
  capacity: { status: 'sufficient', complete: true, estimated: true, reserved: false, source: { entries: 1, logical_bytes: 1, root_count: 1 },
    filesystems: [{ id: 'filesystem_1', roles: ['cold_archive'], base_required_bytes: 1, safety_margin_bytes: 1, required_bytes: 2, free_bytes: 4096, shortfall_bytes: 0, sufficient: true }] } })

test('direct backups require strict backend support, current consent, explicit destination and all acknowledgements', async () => {
  const f = fixture(); await f.controller.refresh()
  const ready = { state: f.state.value, destination: 'archive', compression: 'none', confirmation: consent.confirmation_text, acknowledgements: accepted }
  assert.equal(installationBackupDirectReady(ready), true)
  for (const capabilities of [{}, { ...caps, installation_backup_direct_start: false }, { ...caps, installation_backup_direct_start: 'true' }]) {
    assert.equal(installationBackupDirectSupported(capabilities), false)
    f.state.value.capabilities = capabilities
    assert.equal(await f.controller.startDirect(input), false)
  }
  f.state.value.capabilities = caps
  for (const direct_start of [null, {}, { ...consent, confirmation_text: 'OTHER' }, { ...consent, required_acknowledgements: ['downtime', 'secrets', 'unknown'] }]) {
    f.state.value.status.direct_start = direct_start
    assert.equal(installationBackupDirectConsent(f.state.value), null)
    assert.equal(await f.controller.startDirect(input), false)
  }
  f.state.value.status.direct_start = consent
  for (const changed of [{ destination_id: '' }, { destination_id: '../archive' }, { confirmation: 'wrong' }, { acknowledgements: { downtime: true } }, { compression: 'zstd' }]) assert.equal(await f.controller.startDirect({ ...input, ...changed }), false)
  assert.equal(f.calls.length, 0)
})

test('direct start submits one correlated durable request without a preview or filesystem estimate', async () => {
  const f = fixture(); await f.controller.refresh()
  assert.equal(await f.controller.startDirect(input), true)
  assert.equal(f.calls.length, 1)
  assert.match(f.calls[0].request_id, /^[0-9a-f]{32}$/)
  assert.deepEqual(Object.keys(f.calls[0]).sort(), ['acknowledgements', 'compression', 'confirmation', 'destination_id', 'request_id'])
  assert.deepEqual(f.calls[0].acknowledgements, accepted)
  assert.equal(f.state.value.job.request_id, f.calls[0].request_id)
  assert.equal(f.state.value.startAttempt.confirmed_job_id, 'new_job')
  assert.equal(f.state.value.backupPreview, null)
})

test('pending direct admission ignores old history and unrelated requests, then polling settles an older timeout', async () => {
  const pending = deferred(), f = fixture({ startDirect: body => { f.calls.push(body); return pending.promise } })
  f.observed.job = job({ job_id: 'old_job', status: 'completed', created_at: 100, updated_at: 101 })
  await f.controller.refresh()
  const submitted = f.controller.startDirect(input)
  const request_id = f.calls[0].request_id
  await f.controller.pollStatus()
  assert.equal(f.state.value.confirmed, false)
  assert.equal(f.state.value.job.job_id, 'old_job')
  assert.equal(await f.controller.startDirect(input), false)
  f.observed.job = job({ request_id: 'f'.repeat(32) })
  await f.controller.pollStatus()
  assert.equal(f.state.value.startAttempt.confirmed_job_id, null)
  f.observed.job = job({ request_id })
  await f.controller.pollStatus()
  assert.equal(f.state.value.job.request_id, request_id)
  assert.equal(f.state.value.busy, false)
  assert.equal(f.state.value.confirmed, true)
  pending.reject({ response: { status: 504, data: { detail: 'Proxy timeout' } } })
  assert.equal(await submitted, true)
  assert.equal(f.state.value.startUncertain, false)
  assert.equal(f.state.value.error, '')
  assert.equal(f.calls.length, 1)
})

test('lost direct response reconnects by request identity and never replays the POST', async () => {
  const f = fixture({ startDirect: async body => { f.calls.push(body); throw { response: { status: 504, data: { detail: 'Proxy timeout' } } } } })
  await f.controller.refresh()
  assert.equal(await f.controller.startDirect(input), false)
  assert.equal(f.state.value.startUncertain, true)
  await f.controller.pollStatus()
  assert.equal(installationBlocked(f.state.value), true)
  assert.equal(await f.controller.startDirect(input), false)
  f.observed.job = job({ request_id: f.calls[0].request_id })
  await f.controller.pollStatus()
  assert.equal(f.state.value.startUncertain, false)
  assert.equal(f.state.value.confirmed, true)
  assert.equal(f.calls.length, 1)
})

test('an old completed job cannot clear uncertain reviewed admission or resurrect its consumed preview', async () => {
  const f = fixture({ start: async () => { throw new Error('Network Error') } })
  f.observed.job = job({ job_id: 'old_job', status: 'completed', created_at: 100, updated_at: 101 })
  await f.controller.refresh()
  f.state.value.backupPreview = preview()
  assert.equal(await f.controller.start('backup', consent.confirmation_text, accepted), false)
  await f.controller.refresh()
  assert.equal(f.state.value.startUncertain, true)
  assert.equal(f.state.value.confirmed, false)
  assert.match(f.state.value.error, /request may have reached DUMB/)
  assert.equal(f.state.value.backupPreview, null)
  f.observed.job = job()
  await f.controller.pollStatus()
  assert.equal(f.state.value.startUncertain, false)
  assert.equal(f.state.value.job.job_id, 'new_job')
})

test('a stale status result cannot erase a newer correlated admission or its cancellation', async () => {
  const pendingStart = deferred(), stale = deferred()
  const f = fixture({ startDirect: body => { f.calls.push(body); return pendingStart.promise } })
  await f.controller.refresh()
  const submitted = f.controller.startDirect(input)
  f.repository.status = () => stale.promise
  const pendingStatus = f.controller.pollStatus()
  pendingStart.resolve({ protocol: 1, job: job({ request_id: f.calls[0].request_id, cancel_requested: true }) })
  assert.equal(await submitted, true)
  stale.resolve({ protocol: 1, job: job({ job_id: 'old_job', status: 'completed', created_at: 100 }), direct_start: consent })
  await pendingStatus
  assert.equal(f.state.value.job.job_id, 'new_job')
  assert.equal(f.state.value.job.cancel_requested, true)
  assert.equal(f.state.value.confirmed, true)
})

test('a late start timeout cannot revoke admission when later status contact has failed', async () => {
  const pending = deferred(), f = fixture({ startDirect: body => { f.calls.push(body); return pending.promise } })
  await f.controller.refresh(); const submitted = f.controller.startDirect(input)
  f.observed.job = job({ request_id: f.calls[0].request_id }); await f.controller.pollStatus()
  f.repository.status = async () => { throw new Error('Newer status failure') }
  await f.controller.pollStatus()
  assert.equal(f.state.value.confirmed, false)
  pending.reject(new Error('Older start response timeout')); assert.equal(await submitted, true)
  assert.equal(f.state.value.startUncertain, false)
  assert.match(f.state.value.error, /Newer status failure/)
})

test('direct repository uses the fixed authenticated route and a bounded admission request', async () => {
  const calls = [], repo = installationBackupsRepository({ post: async (...args) => { calls.push(args); return { data: { protocol: 1 } } } })
  await repo.startDirect(input)
  assert.deepEqual(calls, [['/api/process/installation-backups/start-direct', input, { timeout: 30000 }]])
})


test('a mismatched direct acknowledgement remains uncertain until its exact durable request is observed', async () => {
  const f = fixture({ startDirect: async body => { f.calls.push(body); return { protocol: 1, job: job({ request_id: 'f'.repeat(32) }) } } })
  await f.controller.refresh()
  assert.equal(await f.controller.startDirect(input), false)
  assert.equal(f.state.value.startUncertain, true)
  assert.equal(f.state.value.job, null)
  assert.match(f.state.value.error, /did not match/)
  f.observed.job = job({ request_id: f.calls[0].request_id })
  await f.controller.pollStatus()
  assert.equal(f.state.value.startUncertain, false)
  assert.equal(f.calls.length, 1)
})


for (const outcome of ['error', 'success']) {
  test('an older ordinary job poll ' + outcome + ' cannot replace a newer confirmed direct admission', async () => {
    const older = deferred()
    const f = fixture({ job: () => older.promise })
    f.observed.job = job({ job_id: 'old_job', status: 'running', created_at: 100, updated_at: 101 })
    await f.controller.refresh()
    const polling = f.controller.poll()
    f.observed.job = { ...f.observed.job, status: 'completed' }
    await f.controller.refresh()
    assert.equal(await f.controller.startDirect(input), true)
    assert.equal(f.state.value.job.job_id, 'new_job')
    if (outcome === 'error') older.reject(new Error('Old job poll failed'))
    else older.resolve({ protocol: 1, job: job({ job_id: 'old_job', status: 'running', created_at: 100, updated_at: 101 }) })
    await polling
    assert.equal(f.state.value.job.job_id, 'new_job')
    assert.equal(f.state.value.confirmed, true)
    assert.equal(f.state.value.error, '')
    assert.equal(f.state.value.startAttempt.confirmed_job_id, 'new_job')
  })
}

for (const outcome of ['error', 'success']) {
  test('an older ordinary poll ' + outcome + ' cannot revoke a newer cancellation for the same job', async () => {
    const older = deferred()
    const f = fixture({ job: () => older.promise })
    await f.controller.refresh(); await f.controller.startDirect(input)
    const polling = f.controller.poll()
    f.observed.job = { ...f.state.value.job, status: 'cancelled', cancel_requested: true, updated_at: f.state.value.job.updated_at + 1 }
    await f.controller.pollStatus()
    if (outcome === 'error') older.reject(new Error('Old active-job poll failed'))
    else older.resolve({ protocol: 1, job: { ...f.observed.job, status: 'running', cancel_requested: false, updated_at: f.observed.job.updated_at - 1 } })
    await polling
    assert.equal(f.state.value.job.status, 'cancelled')
    assert.equal(f.state.value.job.cancel_requested, true)
    assert.equal(f.state.value.confirmed, true)
    assert.equal(f.state.value.error, '')
  })
}


for (const outcome of ['error', 'success']) {
  test('an older manual refresh ' + outcome + ' cannot unconfirm a newer direct start', async () => {
    const older = deferred(), started = deferred(), f = fixture()
    await f.controller.refresh()
    f.repository.status = () => { started.resolve(); return older.promise }
    const refreshing = f.controller.refresh(); await started.promise
    assert.equal(await f.controller.startDirect(input), true)
    if (outcome === 'error') older.reject(new Error('Older refresh failed'))
    else older.resolve({ protocol: 1, job: job({ job_id: 'old_job', status: 'completed', created_at: 100 }), direct_start: consent })
    await refreshing
    assert.equal(f.state.value.job.job_id, 'new_job')
    assert.equal(f.state.value.confirmed, true)
    assert.equal(f.state.value.error, '')
  })

  test('an older manual refresh ' + outcome + ' cannot revoke a newer cancellation', async () => {
    const older = deferred(), started = deferred(), f = fixture()
    await f.controller.refresh(); await f.controller.startDirect(input)
    const active = f.state.value.job
    let reads = 0
    f.repository.status = () => { if (++reads === 1) { started.resolve(); return older.promise } return Promise.resolve({ protocol: 1, job: { ...active, status: 'cancelled', cancel_requested: true, updated_at: active.updated_at + 1 }, direct_start: consent }) }
    const refreshing = f.controller.refresh(); await started.promise
    await f.controller.pollStatus()
    if (outcome === 'error') older.reject(new Error('Older refresh failed'))
    else older.resolve({ protocol: 1, job: active, direct_start: consent })
    await refreshing
    assert.equal(f.state.value.job.status, 'cancelled')
    assert.equal(f.state.value.confirmed, true)
    assert.equal(f.state.value.error, '')
  })

  test('an older admission status ' + outcome + ' cannot revoke a newer exact job observation', async () => {
    const older = deferred(), f = fixture()
    await f.controller.refresh(); await f.controller.startDirect(input)
    const active = f.state.value.job
    f.repository.status = () => older.promise
    const reading = f.controller.pollStatus()
    f.repository.job = async () => ({ protocol: 1, job: { ...active, status: 'cancelled', cancel_requested: true, updated_at: active.updated_at + 1 } })
    await f.controller.poll()
    if (outcome === 'error') older.reject(new Error('Older admission status failed'))
    else older.resolve({ protocol: 1, job: active, direct_start: consent })
    await reading
    assert.equal(f.state.value.job.status, 'cancelled')
    assert.equal(f.state.value.confirmed, true)
    assert.equal(f.state.value.error, '')
  })

  test('an older retained-job lookup ' + outcome + ' cannot replace a newly accepted backup', async () => {
    const older = deferred(), f = fixture({ job: () => older.promise })
    await f.controller.refresh()
    const reading = f.controller.loadJob('old_job')
    assert.equal(await f.controller.startDirect(input), true)
    if (outcome === 'error') older.reject(new Error('Older lookup failed'))
    else older.resolve({ protocol: 1, job: job({ job_id: 'old_job', status: 'completed', created_at: 100 }) })
    assert.equal(await reading, false)
    assert.equal(f.state.value.job.job_id, 'new_job')
    assert.equal(f.state.value.confirmed, true)
    assert.equal(f.state.value.error, '')
  })
}

test('a catalog failure remains separate from confirmed durable backup admission', async () => {
  const older = deferred(), f = fixture({ catalog: () => older.promise })
  await f.controller.refresh()
  const listing = f.controller.catalog('archive')
  assert.equal(await f.controller.startDirect(input), true)
  older.reject(new Error('Archive catalog unavailable'))
  await listing
  assert.match(f.state.value.catalogError, /catalog unavailable/)
  assert.equal(f.state.value.confirmed, true)
  assert.equal(f.state.value.error, '')
  assert.equal(f.state.value.job.job_id, 'new_job')
})


for (const knownId of [true, false]) {
  test('confirmed fast-failed admission retires automatic old previews with ' + (knownId ? 'known' : 'unknown') + ' preview identity', async () => {
    let observedPreview = null, previewReads = 0
    const f = fixture({
      capabilities: async () => ({ ...caps, installation_backup_preview_status: true }),
      previewStatus: async () => { previewReads++; return { protocol: 1, controller_session: 'controller_one', preview: observedPreview } },
      startDirect: async body => { f.calls.push(body); f.observed.job = job({ request_id: body.request_id, status: 'failed', errors: ['Insufficient cold backup space'] }); return { protocol: 1, job: f.observed.job } },
    })
    await f.controller.refresh()
    const old = { preview_id: 'old_preview', kind: 'backup', destination_id: 'archive', status: 'completed', started_at: Date.now() / 1000 - 100, expires_at: Date.now() / 1000 + 100, result: null }
    if (knownId) f.state.value.previewOperation = old
    assert.equal(await f.controller.startDirect(input), true)
    observedPreview = old
    const before = previewReads
    await f.controller.refresh(); await f.controller.pollPreview()
    assert.equal(previewReads, before)
    assert.equal(f.state.value.job.status, 'failed')
    assert.deepEqual(f.state.value.job.errors, ['Insufficient cold backup space'])
    assert.equal(f.state.value.error, '')
    assert.equal(f.state.value.previewOperation, null)
    assert.equal(f.state.value.backupPreview, null)
  })
}

test('reload suppresses a preview older than the durable job but a fresh explicit preview remains usable', async () => {
  const now = Date.now() / 1000
  let observedPreview = { preview_id: 'old_preview', kind: 'backup', destination_id: 'archive', status: 'completed', started_at: now - 100, expires_at: now + 100, result: null }
  const f = fixture({
    capabilities: async () => ({ ...caps, installation_backup_preview_status: true }),
    previewStatus: async () => ({ protocol: 1, controller_session: 'controller_one', preview: observedPreview }),
    preview: async () => { const result = preview(); observedPreview = { ...observedPreview, preview_id: 'new_preview', started_at: now + 1, result, expires_at: result.expires_at }; return result },
  })
  f.observed.job = job({ status: 'failed', created_at: now, errors: ['Not enough space'] })
  await f.controller.refresh()
  assert.equal(f.state.value.error, '')
  assert.equal(f.state.value.previewOperation, null)
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive' }), true)
  assert.equal(f.state.value.backupPreview.preview_token, 'reviewed-token')
  assert.equal(f.state.value.previewOperation.preview_id, 'new_preview')
  await f.controller.refresh()
  assert.equal(f.state.value.backupPreview.preview_token, 'reviewed-token')
  assert.equal(f.state.value.error, '')
})

test('a completed admission still allows a genuinely new explicit backup preview', async () => {
  let observedPreview = null
  const f = fixture({
    capabilities: async () => ({ ...caps, installation_backup_preview_status: true }),
    previewStatus: async () => ({ protocol: 1, controller_session: 'controller_one', preview: observedPreview }),
    preview: async () => { const result = preview(); observedPreview = { preview_id: 'new_preview', kind: 'backup', destination_id: 'archive', status: 'completed', started_at: Date.now() / 1000 + 1, expires_at: result.expires_at, result }; return result },
  })
  await f.controller.refresh()
  assert.equal(await f.controller.startDirect(input), true)
  f.observed.job = { ...f.state.value.job, status: 'completed' }
  await f.controller.refresh()
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive' }), true)
  assert.equal(f.state.value.backupPreview.preview_token, 'reviewed-token')
  assert.equal(f.state.value.previewOperation.preview_id, 'new_preview')
  assert.equal(f.state.value.error, '')
})


for (const outcome of ['error', 'success']) {
  test('an older preview POST ' + outcome + ' cannot replace a fast failed admitted backup', async () => {
    const older = deferred()
    let observedPreview = null
    const f = fixture({
      capabilities: async () => ({ ...caps, installation_backup_preview_status: true }),
      previewStatus: async () => ({ protocol: 1, controller_session: 'controller_one', preview: observedPreview }),
      preview: () => older.promise,
      startDirect: async body => { f.calls.push(body); f.observed.job = job({ request_id: body.request_id, status: 'failed', errors: ['Insufficient cold backup space'] }); return { protocol: 1, job: f.observed.job } },
    })
    await f.controller.refresh()
    const pending = f.controller.preview('backup', { destination_id: 'archive' })
    const result = preview()
    observedPreview = { preview_id: 'old_preview', kind: 'backup', destination_id: 'archive', status: 'completed', started_at: Date.now() / 1000 - 1, expires_at: result.expires_at, result }
    await f.controller.pollPreview()
    assert.equal(f.state.value.busy, false)
    assert.equal(await f.controller.startDirect(input), true)
    if (outcome === 'error') older.reject(new Error('Older preview POST failed'))
    else older.resolve(result)
    assert.equal(await pending, false)
    assert.equal(f.state.value.previewRequestPending, false)
    assert.equal(f.state.value.backupPreview, null)
    assert.equal(f.state.value.job.status, 'failed')
    assert.equal(f.state.value.error, '')
  })
}
