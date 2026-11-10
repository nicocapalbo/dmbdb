import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { backupError, installationBackupSupported, installationBlocked, installationPreviewReady, installationRollbackReady } from '../helper/installationBackups.js'
import { createInstallationBackupController, initialInstallationBackupState } from '../helper/installationBackupController.js'
import { installationBackupsRepository } from '../services/installationBackups.js'

const caps = { installation_backup: true, installation_backup_protocol: 1 }
const capacity = { status: 'sufficient', complete: true, estimated: true, reserved: false, source: { entries: 4, logical_bytes: 1024, root_count: 1 }, filesystems: [{ id: 'filesystem_1', roles: ['cold_archive'], base_required_bytes: 1024, safety_margin_bytes: 1024, required_bytes: 2048, free_bytes: 4096, shortfall_bytes: 0, sufficient: true }] }
const preview = mode => ({ protocol: 1, ready: true, preview_token: 'private-preview', expires_at: Date.now() / 1000 + 120, confirmation_text: mode === 'restore' ? 'RESTORE EXAMPLE' : 'BACK UP EXAMPLE', inventory: { roots: [{ id: 'config', path: '/config', kind: 'directory', roles: ['configuration'], entries: 4, logical_bytes: 1024 }], excluded: [{ reason: 'External state' }] }, capacity, backup: mode === 'restore' ? { schema_version: 1, verified: true, sha256: 'a'.repeat(64), archive_path: '/mnt/backups/installation.tar' } : undefined, blockers: [], warnings: [], required_acknowledgements: mode === 'restore' ? ['downtime', 'replace_state', 'external_state'] : ['downtime', 'secrets', 'external_state'] })
const job = (status = 'queued') => ({ job_id: 'job_example', job_type: 'installation_backup', status, stage: 'snapshot', can_rollback: false })
const fixture = overrides => {
  const calls = []
  const repository = { capabilities: async () => caps, status: async () => ({ protocol: 1, job: null, recovery_required: false, scope: {}, schedule: { enabled: false, destination_id: '', interval_hours: 24, keep_last: 7 } }), catalog: async id => { calls.push(['catalog', id]); return { protocol: 1, artifacts: [] } }, preview: async body => { calls.push(['preview', body]); return preview('backup') }, restorePreview: async body => { calls.push(['restorePreview', body]); return preview('restore') }, start: async body => { calls.push(['start', body]); return { protocol: 1, job: job() } }, restoreStart: async body => { calls.push(['restoreStart', body]); return { protocol: 1, job: { ...job(), job_type: 'installation_restore' } } }, job: async () => ({ protocol: 1, job: job('completed') }), saveSchedule: async body => { calls.push(['schedule', body]); return { protocol: 1, schedule: body } }, rollback: async (id, confirmation) => { calls.push(['rollback', id, confirmation]); return { protocol: 1, job: { ...job('rolled_back'), job_type: 'installation_restore' } } }, ...overrides }
  const state = ref(initialInstallationBackupState())
  return { calls, repository, state, controller: createInstallationBackupController({ state, repository }) }
}
const accepted = mode => Object.fromEntries(preview(mode).required_acknowledgements.map(key => [key, true]))

test('capabilities fail closed and unsupported backends receive no installation requests', async () => {
  for (const value of [{}, { ...caps, installation_backup: 'true' }, { ...caps, installation_backup_protocol: '1' }]) {
    assert.equal(installationBackupSupported(value), false)
    let statusCalls = 0
    const f = fixture({ capabilities: async () => value, status: async () => { statusCalls++; return {} } })
    await f.controller.refresh(); await f.controller.preview('backup', { destination_id: 'archive' })
    assert.equal(statusCalls, 0); assert.equal(f.calls.length, 0)
  }
})

test('preview admission requires complete capacity, reviewed coverage, fresh token, exact text and every acknowledgement', () => {
  const state = { ...initialInstallationBackupState(), capabilities: caps, confirmed: true, status: { recovery_required: false } }
  const p = preview('backup'), input = { state, preview: p, mode: 'backup', confirmation: p.confirmation_text, acknowledgements: accepted('backup') }
  assert.equal(installationPreviewReady(input), true)
  for (const changed of [{ ready: false }, { blockers: ['A foreign mount is present'] }, { expires_at: 1 }, { capacity: undefined }, { inventory: { roots: [], excluded: [] } }, { required_acknowledgements: ['downtime', 'secrets', 'unknown'] }]) assert.equal(installationPreviewReady({ ...input, preview: { ...p, ...changed } }), false)
  assert.equal(installationPreviewReady({ ...input, confirmation: 'wrong' }), false)
  assert.equal(installationPreviewReady({ ...input, acknowledgements: { downtime: true } }), false)
  assert.equal(installationPreviewReady({ ...input, state: { ...state, status: { recovery_required: true } } }), false)
  assert.equal(installationBlocked({ ...state, status: { job: job() } }), true)
  const restore = preview('restore'), restoreInput = { ...input, mode: 'restore', preview: restore, confirmation: restore.confirmation_text, acknowledgements: accepted('restore') }
  assert.equal(installationPreviewReady(restoreInput), true)
  assert.equal(installationPreviewReady({ ...restoreInput, preview: { ...restore, backup: undefined } }), false)
  assert.equal(installationPreviewReady({ ...restoreInput, preview: { ...restore, backup: { ...restore.backup, verified: false } } }), false)
})

test('selection changes discard in-flight previews and start never reuses an invalidated token', async () => {
  let resolve
  const f = fixture({ preview: () => new Promise(done => { resolve = done }) })
  await f.controller.refresh()
  const pending = f.controller.preview('backup', { destination_id: 'archive' })
  f.controller.invalidate(); resolve(preview('backup')); await pending
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(await f.controller.start('backup', 'BACK UP EXAMPLE', accepted('backup')), false)
  assert.equal(f.calls.length, 0)
})

test('manual backup starts only after review and sends no configuration, credentials or implicit destination', async () => {
  const f = fixture(); await f.controller.refresh()
  assert.equal(await f.controller.preview('backup', { destination_id: '' }), false)
  assert.equal(f.calls.length, 0)
  await f.controller.preview('backup', { destination_id: '@default' })
  assert.equal(await f.controller.start('backup', 'BACK UP EXAMPLE', accepted('backup')), true)
  assert.deepEqual(f.calls[1], ['start', { preview_token: 'private-preview', confirmation: 'BACK UP EXAMPLE', acknowledgements: accepted('backup') }])
  assert.equal(f.state.value.job.status, 'queued'); assert.equal(f.state.value.backupPreview, null)
})

test('fresh-container restore previews exactly one mounted file and never starts automatically', async () => {
  const f = fixture(); await f.controller.refresh()
  for (const payload of [{ archive_path: 'relative.tar' }, { archive_path: '//server/archive.tar' }, { archive_path: '/mnt/a.tar\n' }, { reference: 'dumb-backup://archive/a/b', archive_path: '/mnt/a.tar' }]) assert.equal(await f.controller.preview('restore', payload), false)
  assert.equal(f.calls.length, 0)
  await f.controller.preview('restore', { archive_path: '/mnt/backups/installation.tar' })
  assert.deepEqual(f.calls, [['restorePreview', { archive_path: '/mnt/backups/installation.tar' }]])
  assert.equal(await f.controller.start('restore', 'RESTORE EXAMPLE', { downtime: true }), false)
  assert.equal(await f.controller.start('restore', 'RESTORE EXAMPLE', accepted('restore')), true)
})

test('catalog queries require explicit destinations and late responses cannot replace the newly selected catalog', async () => {
  const pending = new Map(), f = fixture({ catalog: id => new Promise(done => pending.set(id, done)) })
  await f.controller.refresh(); await f.controller.catalog(''); assert.equal(pending.size, 0)
  const a = f.controller.catalog('a'), b = f.controller.catalog('b')
  const artifact = id => ({ reference: `dumb-backup://${id}/scope/archive`, artifact_kind: 'installation_backup', artifact_id: id, verified: true })
  pending.get('b')({ protocol: 1, artifacts: [artifact('b')] }); await b
  pending.get('a')({ protocol: 1, artifacts: [artifact('a')] }); await a
  assert.equal(f.state.value.artifacts[0].artifact_id, 'b')
})

test('schedules are explicit and validated; recovery rollback uses only server-authored confirmation', async () => {
  const f = fixture(); await f.controller.refresh(); assert.equal(f.calls.length, 0)
  assert.equal(await f.controller.saveSchedule({ enabled: true, destination_id: '', interval_hours: 24, keep_last: 7 }), false)
  assert.equal(await f.controller.saveSchedule({ enabled: true, destination_id: 'archive', interval_hours: 0, keep_last: 7 }), false)
  const schedule = { enabled: true, destination_id: 'archive', interval_hours: 24, keep_last: 7 }
  assert.equal(await f.controller.saveSchedule(schedule), true)
  f.state.value.job = { ...job('recovery_required'), job_type: 'installation_restore', can_rollback: true, rollback_confirmation_text: 'RESTORE ORIGINAL EXAMPLE STATE' }
  f.state.value.status.recovery_required = true
  f.state.value.status.job = f.state.value.job
  assert.equal(installationRollbackReady(f.state.value, 'ROLL BACK job_example'), false)
  assert.equal(await f.controller.rollback('RESTORE ORIGINAL EXAMPLE STATE'), true)
  assert.deepEqual(f.calls.at(-1), ['rollback', 'job_example', 'RESTORE ORIGINAL EXAMPLE STATE'])
})

test('lost active-job state and polling failures preserve recovery evidence and block new operations', async () => {
  const f = fixture(); await f.controller.refresh(); f.state.value.job = job('running')
  await f.controller.refresh()
  assert.equal(f.state.value.job.status, 'running'); assert.equal(f.state.value.confirmed, false)
  assert.match(f.state.value.error, /previously recorded job/)
})

test('an ingress disconnect after submission retains uncertainty and prevents blind duplicate starts', async () => {
  let starts = 0
  const f = fixture({ start: async () => { starts++; throw new Error('Network Error') } })
  await f.controller.refresh(); await f.controller.preview('backup', { destination_id: 'archive' })
  assert.equal(await f.controller.start('backup', 'BACK UP EXAMPLE', accepted('backup')), false)
  assert.equal(f.state.value.confirmed, false)
  assert.match(f.state.value.error, /request may have reached DUMB/)
  assert.match(f.state.value.error, /direct frontend\/API access/)
  assert.equal(await f.controller.start('backup', 'BACK UP EXAMPLE', accepted('backup')), false)
  assert.equal(starts, 1)
})

test('actionable backend errors retain safe codes and blockers without echoing credentials or validation inputs', () => {
  const value = backupError({ response: { data: { detail: { code: 'mount_changed', message: 'Selected mount changed; refresh destination registration.', blockers: ['password=secret https://example.invalid/private'] } } } })
  assert.match(value, /mount_changed/); assert.match(value, /refresh destination registration/); assert.doesNotMatch(value, /secret|example.invalid/)
  assert.equal(backupError({ response: { data: { detail: [{ loc: ['body', 'destination_id'], msg: 'Field required', input: 'private' }] } } }), 'body.destination_id: Field required')
})

test('client uses fixed authenticated routes and safely bounded job identities', async () => {
  const calls = [], client = Object.fromEntries(['get', 'post', 'put'].map(method => [method, async (...args) => { calls.push([method, ...args]); return { data: { protocol: 1 } } }]))
  const repo = installationBackupsRepository(client)
  await repo.capabilities(); await repo.status(); await repo.catalog('@default'); await repo.restorePreview({ archive_path: '/mnt/a.tar' }); await repo.saveSchedule({ enabled: false }); await repo.rollback('job_example', 'SERVER TEXT')
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['get', '/api/process/capabilities'], ['get', '/api/process/installation-backups/status'], ['get', '/api/process/installation-backups/catalog'], ['post', '/api/process/installation-backups/restore/preview'], ['put', '/api/process/installation-backups/schedule'], ['post', '/api/process/installation-backups/jobs/job_example/rollback']])
  assert.equal(calls.find(call => call[1].endsWith('/restore/preview'))[3].timeout, 0)
  assert.equal(calls.find(call => call[1].endsWith('/status'))[2].timeout, 30000)
  assert.throws(() => repo.job('../foreign'), /Invalid backup job/)
})
