import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createInstallationBackupController, initialInstallationBackupState } from '../helper/installationBackupController.js'
import { installationBlocked, installationPreviewReady } from '../helper/installationBackups.js'
import { backupPreviewActive, backupPreviewDuration, backupPreviewElapsed, backupPreviewEnvelope, backupPreviewStatusSupported } from '../helper/installationBackupProgress.js'
import { installationBackupsRepository } from '../services/installationBackups.js'

const caps = { installation_backup: true, installation_backup_protocol: 1, installation_backup_preview_status: true }
const review = () => ({ protocol: 1, ready: true, preview_token: 'reviewed-token', expires_at: Date.now() / 1000 + 900, confirmation_text: 'REVIEW EXAMPLE', inventory: { roots: [{ path: '/config' }], excluded: [] }, blockers: [], required_acknowledgements: ['downtime', 'secrets', 'external_state'], capacity: { status: 'sufficient', complete: true, estimated: true, reserved: false, source: { entries: 100, logical_bytes: 1024, root_count: 1 }, filesystems: [{ id: 'filesystem_1', roles: ['cold_archive'], base_required_bytes: 1, safety_margin_bytes: 1, required_bytes: 2, free_bytes: 1024, shortfall_bytes: 0, sufficient: true }] } })
const operation = (status = 'running', changes = {}) => ({ preview_id: 'preview_one', kind: 'backup', destination_id: 'archive', status, stage: 'inventory', message: 'Inspecting managed state', started_at: Date.now() / 1000 - 80, updated_at: Date.now() / 1000, last_progress_at: Date.now() / 1000, completed_at: status === 'running' ? null : Date.now() / 1000, elapsed_seconds: 80, entries: 2213066, logical_bytes: 1000000, roots_completed: 1, root_count: 61, current_root: { id: 'application', path: '/data/application', kind: 'directory', roles: ['managed_state'] }, cancel_requested: status === 'cancelling', result: status === 'completed' ? review() : null, expires_at: Date.now() / 1000 + 900, ...changes })
const envelope = (preview, controller_session = 'controller_one') => ({ protocol: 1, controller_session, preview })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const fixture = (overrides = {}, retained) => {
  const notifications = [], calls = []
  const status = { current: envelope(null) }
  const repository = { capabilities: async () => caps, status: async () => ({ protocol: 1, job: null, recovery_required: false }),
    preview: async body => { calls.push(['preview', body]); return review() },
    previewStatus: async id => { calls.push(['status', id]); return status.current },
    cancelPreview: async id => { calls.push(['cancel', id]); return envelope(operation('cancelling')) },
    start: async () => ({ protocol: 1, job: { job_id: 'job_one', job_type: 'installation_backup', status: 'queued' } }), ...overrides }
  const state = retained || ref(initialInstallationBackupState())
  const controller = createInstallationBackupController({ state, repository, notify: value => notifications.push(value) })
  return { state, repository, controller, status, notifications, calls }
}
const acknowledgements = { downtime: true, secrets: true, external_state: true }

test('preview progress protocol and identities fail closed; elapsed uses observed time without a runtime ceiling', () => {
  assert.equal(backupPreviewStatusSupported({ installation_backup_preview_status: 'true' }), false)
  assert.equal(backupPreviewStatusSupported(caps), true)
  assert.equal(backupPreviewActive(operation('cancelling')), true)
  for (const invalid of [{}, { ...envelope(null), controller_session: '' }, envelope(operation('unknown')), envelope(operation('running', { preview_id: '../other' }))]) assert.throws(() => backupPreviewEnvelope(invalid), /confirm|unknown/)
  const start = 1700000000
  assert.equal(backupPreviewElapsed({ previewOperation: operation('running', { started_at: start, elapsed_seconds: 2 }) }, (start + 90000) * 1000), 90000)
  assert.equal(backupPreviewElapsed({ previewOperation: operation('completed', { started_at: start, elapsed_seconds: 100 }) }, (start + 90000) * 1000), 100)
  assert.equal(backupPreviewDuration(90000), '25h 0m 0s')
})

test('pending POST polls real counters, blocks duplicate previews and notifies completion once', async () => {
  const pending = deferred(), f = fixture({ preview: body => { f.calls.push(['preview', body]); return pending.promise } })
  await f.controller.refresh()
  const submitted = f.controller.preview('backup', { destination_id: 'archive' })
  f.status.current = envelope(operation())
  await f.controller.pollPreview()
  assert.equal(f.state.value.previewOperation.entries, 2213066)
  assert.equal(f.state.value.busy, true)
  assert.equal(await f.controller.preview('backup', { destination_id: 'other' }), false)
  assert.equal(f.calls.filter(row => row[0] === 'preview').length, 1)
  f.status.current = envelope(operation('completed'))
  await f.controller.pollPreview()
  assert.equal(f.state.value.backupPreview.preview_token, 'reviewed-token')
  assert.equal(f.state.value.busy, false)
  pending.resolve(review()); await submitted
  await f.controller.pollPreview()
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0].title, 'Backup preview complete')
  assert.equal(f.calls.some(row => row[0] === 'start'), false)
})

test('new panel controller reattaches to retained operation and restores review without replaying POST', async () => {
  const first = fixture()
  first.status.current = envelope(operation())
  await first.controller.refresh()
  const second = fixture({}, first.state)
  second.status.current = envelope(operation('completed'))
  await second.controller.refresh()
  assert.equal(second.state.value.backupPreview.preview_token, 'reviewed-token')
  assert.equal(second.calls.filter(row => row[0] === 'preview').length, 0)
  const third = fixture({}, second.state)
  third.status.current = second.status.current
  await third.controller.refresh()
  assert.equal(third.notifications.length, 0)
  assert.equal(installationPreviewReady({ state: third.state.value, preview: third.state.value.backupPreview, mode: 'backup', confirmation: '', acknowledgements: {} }), false)
})

test('lost POST and status responses retain uncertainty until backend status confirms lifecycle', async () => {
  const pending = deferred(), f = fixture({ preview: () => pending.promise })
  await f.controller.refresh()
  const submitted = f.controller.preview('backup', { destination_id: 'archive' })
  f.repository.previewStatus = async () => { throw new Error('Network Error') }
  await f.controller.pollPreview()
  assert.equal(f.state.value.previewUncertain, true)
  assert.equal(installationBlocked(f.state.value), true)
  pending.reject(new Error('Network Error')); await submitted
  assert.equal(f.state.value.busy, true)
  assert.match(f.state.value.previewStatusError, /may still be scanning/)
  f.repository.previewStatus = async () => envelope(operation())
  await f.controller.pollPreview()
  assert.equal(f.state.value.previewUncertain, false)
  assert.equal(f.state.value.busy, true)
  f.repository.previewStatus = async () => envelope(operation('completed'))
  await f.controller.pollPreview()
  assert.equal(f.state.value.busy, false)
  assert.equal(f.state.value.confirmed, true)
})

test('cancellation stays active until backend cleanup confirms cancelled, with no automatic backup', async () => {
  const f = fixture()
  f.status.current = envelope(operation())
  await f.controller.refresh()
  assert.equal(await f.controller.cancelPreview(), true)
  assert.equal(f.state.value.previewOperation.status, 'cancelling')
  assert.equal(f.state.value.busy, true)
  assert.equal(await f.controller.cancelPreview(), false)
  assert.equal(f.calls.filter(row => row[0] === 'cancel').length, 1)
  f.status.current = envelope(operation('cancelled'))
  await f.controller.pollPreview()
  assert.equal(f.state.value.busy, false)
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(f.notifications.at(-1).title, 'Backup preview cancelled')
})

test('review invalidation never detaches active lifecycle or prevents cancellation settlement', async () => {
  for (const terminal of ['completed', 'cancelled']) {
    const f = fixture()
    f.status.current = envelope(operation())
    await f.controller.refresh(); f.controller.invalidate()
    await f.controller.cancelPreview()
    assert.equal(f.state.value.previewOperation.status, 'cancelling')
    f.status.current = envelope(operation(terminal))
    await f.controller.pollPreview()
    assert.equal(f.state.value.busy, false)
    assert.equal(f.state.value.backupPreview, null)
  }
})

test('backend controller restart invalidates previous review and ignores the old POST result', async () => {
  const pending = deferred(), f = fixture({ preview: () => pending.promise })
  await f.controller.refresh()
  const submitted = f.controller.preview('backup', { destination_id: 'archive' })
  f.status.current = envelope(operation())
  await f.controller.pollPreview()
  f.status.current = envelope(null, 'controller_two')
  await f.controller.pollPreview()
  assert.equal(f.state.value.backupPreview, null)
  assert.match(f.state.value.error, /interrupted.*restarted/)
  pending.resolve(review()); await submitted
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(f.state.value.busy, false)
})

test('a consumed or expired retained result clears review instead of resurrecting its token', async () => {
  const f = fixture()
  f.status.current = envelope(operation('completed')); await f.controller.refresh()
  assert.ok(f.state.value.backupPreview)
  f.status.current = envelope(operation('completed', { result: null }))
  await f.controller.pollPreview()
  assert.equal(f.state.value.backupPreview, null)
  assert.match(f.state.value.error, /expired|consumed/)
  assert.equal(f.state.value.busy, false)
})

test('real job state takes priority over a retained completed preview and emits no false safety toast', async () => {
  const f = fixture({ status: async () => ({ protocol: 1, job: { job_id: 'job_one', job_type: 'installation_backup', status: 'running' } }) })
  f.status.current = envelope(operation('completed'))
  await f.controller.refresh()
  assert.equal(f.state.value.job.status, 'running')
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(f.state.value.previewOperation, null)
  assert.equal(f.notifications.length, 0)
})

test('late changed-session preview response cannot erase uncertain actual-start state', async () => {
  const f = fixture({ start: async () => { throw new Error('Network Error') } })
  f.status.current = envelope(operation('completed')); await f.controller.refresh()
  const late = deferred()
  f.repository.previewStatus = () => late.promise
  const polling = f.controller.pollPreview()
  assert.equal(await f.controller.start('backup', 'REVIEW EXAMPLE', acknowledgements), false)
  const error = f.state.value.error
  assert.equal(f.state.value.startUncertain, true)
  late.resolve(envelope(operation('completed', { preview_id: 'preview_other' }), 'controller_two')); await polling
  assert.equal(f.state.value.confirmed, false)
  assert.equal(f.state.value.startUncertain, true)
  assert.equal(f.state.value.error, error)
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(f.notifications.length, 1)
})

test('preview routes bind exact safe operation identity and never add a scan runtime timeout', async () => {
  const calls = [], client = { get: async (...args) => { calls.push(['get', ...args]); return { data: envelope(null) } }, post: async (...args) => { calls.push(['post', ...args]); return { data: envelope(null) } } }
  const repository = installationBackupsRepository(client)
  await repository.previewStatus('preview_one')
  await repository.cancelPreview('preview_one')
  await repository.preview({ destination_id: 'archive' })
  assert.deepEqual(calls[0], ['get', '/api/process/installation-backups/preview/status', { params: { preview_id: 'preview_one' }, timeout: 30000 }])
  assert.equal(calls[1][1], '/api/process/installation-backups/preview/preview_one/cancel')
  assert.equal(calls[2][3].timeout, 0)
  for (const id of ['../other', 'a/b', '', null]) {
    assert.throws(() => repository.previewStatus(id), /Invalid backup preview/)
    assert.throws(() => repository.cancelPreview(id), /Invalid backup preview/)
  }
})

test('fractional backend timestamps display normally and rollback is available only after active stages finish', async () => {
  const { backupTime, installationRollbackAvailable } = await import('../helper/installationBackups.js')
  assert.notEqual(backupTime(1700000000.125), 'Not recorded')
  for (const value of [NaN, Infinity, -1, '1700000000']) assert.equal(backupTime(value), 'Not recorded')
  for (const status of ['queued', 'running', 'rolled_back']) assert.equal(installationRollbackAvailable({ status, can_rollback: true }), false)
  for (const status of ['completed', 'failed', 'recovery_required']) assert.equal(installationRollbackAvailable({ status, can_rollback: true }), true)
})

test('a late cancelled POST error cannot make a confirmed cancelled preview uncertain again', async () => {
  const pending = deferred(), f = fixture({ preview: () => pending.promise })
  await f.controller.refresh()
  const submitted = f.controller.preview('backup', { destination_id: 'archive' })
  f.status.current = envelope(operation())
  await f.controller.pollPreview()
  f.status.current = envelope(operation('cancelled'))
  await f.controller.pollPreview()
  pending.reject({ response: { status: 409, data: { detail: 'Backup preview cancelled' } } })
  await submitted
  assert.equal(f.state.value.previewUncertain, false)
  assert.equal(f.state.value.busy, false)
  assert.equal(f.state.value.confirmed, true)
  assert.equal(f.notifications.at(-1).title, 'Backup preview cancelled')
})

test('older same-operation progress never regresses counters, stage or cancellation state', async () => {
  const f = fixture()
  f.status.current = envelope(operation('running', { updated_at: 200, entries: 5000 }))
  await f.controller.refresh()
  f.status.current = envelope(operation('running', { updated_at: 100, entries: 1, stage: 'checking_storage' }))
  await f.controller.pollPreview()
  assert.equal(f.state.value.previewOperation.entries, 5000)
  assert.equal(f.state.value.previewOperation.stage, 'inventory')
})

test('old-session poll from an unmounted panel cannot replace a newer controller-session result', async () => {
  const first = fixture()
  first.status.current = envelope(operation()); await first.controller.refresh()
  const delayed = deferred()
  first.repository.previewStatus = () => delayed.promise
  const oldPoll = first.controller.pollPreview()
  const next = fixture({}, first.state)
  next.status.current = envelope(null, 'controller_two')
  await next.controller.refresh()
  delayed.resolve(envelope(operation())); await oldPoll
  assert.equal(first.state.value.previewControllerSession, 'controller_two')
  assert.equal(first.state.value.previewOperation, null)
  assert.equal(first.state.value.backupPreview, null)
})

test('preparation after a hard reload takes priority over a retained completed preview', async () => {
  const f = fixture({ status: async () => ({ protocol: 1, job: null, preparation: { stage: 'checking_capacity', started_at: Date.now() / 1000 } }) })
  f.status.current = envelope(operation('completed'))
  await f.controller.refresh()
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(f.notifications.length, 0)
  assert.equal(installationBlocked(f.state.value), true)
})

test('a late preview poll failure cannot unconfirm an accepted archive job', async () => {
  const f = fixture()
  f.status.current = envelope(operation('completed')); await f.controller.refresh()
  const delayed = deferred()
  f.repository.previewStatus = () => delayed.promise
  const polling = f.controller.pollPreview()
  assert.equal(await f.controller.start('backup', 'REVIEW EXAMPLE', acknowledgements), true)
  delayed.reject(new Error('Network Error')); await polling
  assert.equal(f.state.value.job.job_id, 'job_one')
  assert.equal(f.state.value.confirmed, true)
  assert.equal(f.state.value.previewUncertain, false)
})

test('restore path admission accepts ordinary backup paths and rejects actual newline and DEL bytes', async () => {
  const restored = []
  const f = fixture({ capabilities: async () => ({ ...caps, installation_backup_preview_status: false }), restorePreview: async body => { restored.push(body); return { ...review(), backup: { verified: true } } } })
  await f.controller.refresh()
  assert.equal(await f.controller.preview('restore', { archive_path: '/backup/archive.tar' }), true)
  for (const path of ['/backup/archive.tar\n', '/backup/archive.tar\x7f']) assert.equal(await f.controller.preview('restore', { archive_path: path }), false)
  assert.equal(restored.length, 1)
})

test('a retained old receipt cannot unlock a newer POST before its operation is visible', async () => {
  const pending = deferred(), f = fixture({ preview: () => pending.promise })
  f.status.current = envelope(operation('completed')); await f.controller.refresh()
  const submitted = f.controller.preview('backup', { destination_id: 'other' })
  await f.controller.pollPreview()
  assert.equal(f.state.value.busy, true)
  assert.equal(f.state.value.backupPreview, null)
  f.status.current = envelope(operation('running', { preview_id: 'preview_two', destination_id: 'other' }))
  await f.controller.pollPreview()
  assert.equal(f.state.value.previewOperation.preview_id, 'preview_two')
  f.status.current = envelope(operation('completed', { preview_id: 'preview_two', destination_id: 'other' }))
  pending.resolve(review()); await submitted
  assert.equal(f.state.value.busy, false)
  assert.equal(f.state.value.previewOperation.preview_id, 'preview_two')
})

test('legacy restart stage is acknowledged only by terminal state and both explicit false flags', async () => {
  const { installationJobDisplay, installationRestartRequired } = await import('../helper/installationBackups.js')
  const job = { job_id: 'backup_session', job_type: 'installation_backup', status: 'rolled_back', stage: 'restart_required', restart_required: false, result: { restart_required: false }, errors: ['Previous backup failure'] }
  const original = JSON.stringify(job)
  assert.equal(installationRestartRequired(job), false)
  assert.deepEqual(installationJobDisplay(job), { statusLabel: 'Recovery complete', stageLabel: 'Backup recovery complete', message: 'Original application data remains in place; backup recovery is complete.', historicalErrors: true })
  assert.equal(JSON.stringify(job), original)
  for (const [top, nested] of [[undefined, undefined], [false, undefined], [undefined, false], [true, false], [false, true], [true, true]]) {
    const pending = { ...job, restart_required: top, result: { restart_required: nested } }
    assert.equal(installationRestartRequired(pending), true)
    assert.notEqual(installationJobDisplay(pending).statusLabel, 'Recovery complete')
  }
  const restore = { ...job, job_type: 'installation_restore' }
  assert.equal(installationJobDisplay(restore).stageLabel, 'Restart complete')
  assert.equal(installationJobDisplay(restore).statusLabel, 'rolled back')
  assert.equal(installationJobDisplay(restore).historicalErrors, false)
  const active = { ...job, status: 'running', stage: 'failed', can_rollback: true }
  assert.equal(installationJobDisplay(active).statusLabel, 'running')
  assert.equal(installationJobDisplay(active).stageLabel, 'failed')
  assert.equal(installationJobDisplay(active).historicalErrors, false)
})
