import test from 'node:test'
import assert from 'node:assert/strict'
import { createInstallationBackupController, initialInstallationBackupState } from '../helper/installationBackupController.js'
import { installationBackupCancelReady, installationJob } from '../helper/installationBackups.js'
import { installationBackupsRepository } from '../services/installationBackups.js'
import { installationBackupJobProgress } from '../helper/installationBackupActivity.js'
const caps = { installation_backup: true, installation_backup_protocol: 1, installation_backup_cancellation: true, installation_backup_phase_progress: true }
const job = changes => ({ job_id: 'backup_one', job_type: 'installation_backup', status: 'running', stage: 'archiving', can_cancel: true, cancel_requested: false, updated_at: 100, ...changes })
const fixture = (overrides = {}) => {
  const state = { value: { ...initialInstallationBackupState(), capabilities: caps, confirmed: true, job: job() } }
  const calls = [], notices = []
  const repository = { capabilities: async () => caps, status: async () => ({ protocol: 1, job: job() }), cancel: async id => { calls.push(id); return { protocol: 1, job: job({ can_cancel: false, cancel_requested: true, updated_at: 101 }) } }, job: async () => ({ protocol: 1, job: job({ status: 'cancelled', stage: 'cancelled', can_cancel: false, updated_at: 102 }) }), ...overrides }
  return { state, calls, notices, controller: createInstallationBackupController({ state, repository, notify: n => notices.push(n) }) }
}

test('real backup cancellation is strict capability and active-job gated and never calls restore or rollback', async () => {
  for (const changes of [{ capabilities: { ...caps, installation_backup_cancellation: false } }, { capabilities: { ...caps, installation_backup_cancellation: 'true' } }, { job: job({ job_type: 'installation_restore' }) }, { job: job({ status: 'completed' }) }, { job: job({ can_cancel: false }) }, { job: job({ cancel_requested: true }) }]) {
    const f = fixture(); Object.assign(f.state.value, changes); assert.equal(installationBackupCancelReady(f.state.value), false); assert.equal(await f.controller.cancel(), false); assert.deepEqual(f.calls, [])
  }
  const f = fixture(); assert.equal(await f.controller.cancel(), true); assert.deepEqual(f.calls, ['backup_one'])
  assert.equal(f.state.value.job.status, 'running'); assert.equal(f.state.value.job.cancel_requested, true)
  assert.equal(await f.controller.cancel(), false); await f.controller.poll(); assert.equal(f.state.value.job.status, 'cancelled'); assert.equal(installationJob(f.state.value.job).status, 'cancelled')
})

test('a lost cancellation response retains job identity and uncertainty until fresh status confirms it', async () => {
  const f = fixture({ cancel: async () => { throw new Error('Connection lost') } })
  assert.equal(await f.controller.cancel(), false); assert.equal(f.state.value.cancelUncertain, true); assert.equal(f.state.value.job.job_id, 'backup_one'); assert.equal(f.state.value.job.status, 'running')
  await f.controller.poll(); assert.equal(f.state.value.cancelUncertain, false); assert.equal(f.state.value.job.status, 'cancelled')
})

test('late polling cannot revoke a confirmed cancellation or replace a newer job observation', async () => {
  let release
  const f = fixture({ job: () => new Promise(resolve => { release = resolve }) })
  const pending = f.controller.poll(); await f.controller.cancel()
  release({ protocol: 1, job: job() }); await pending
  assert.equal(f.state.value.job.cancel_requested, true); assert.equal(f.state.value.job.can_cancel, false); assert.equal(f.state.value.job.updated_at, 101)
})

test('a full refresh begun before cancellation cannot revoke its newer acknowledgment', async () => {
  let releaseStatus
  const f = fixture({ status: () => new Promise(resolve => { releaseStatus = resolve }) })
  const refresh = f.controller.refresh()
  for (let i = 0; i < 5 && !releaseStatus; i++) await Promise.resolve()
  assert.equal(typeof releaseStatus, 'function')
  assert.equal(await f.controller.cancel(), true)
  releaseStatus({ protocol: 1, job: job() }); await refresh
  assert.equal(f.state.value.job.cancel_requested, true); assert.equal(f.state.value.job.can_cancel, false)
  assert.equal(f.state.value.job.updated_at, 101); assert.equal(f.state.value.status.job.cancel_requested, true)
  assert.equal(f.state.value.status.job.can_cancel, false)
})

test('late cancellation errors preserve a newer confirmed terminal or recovery result', async () => {
  for (const status of ['cancelled', 'completed', 'failed', 'recovery_required']) {
    let rejectCancel
    const current = job({ status, stage: status, can_cancel: false, updated_at: 102 })
    const f = fixture({ cancel: () => new Promise((resolve, reject) => { rejectCancel = reject }), job: async () => ({ protocol: 1, job: current }) })
    const pending = f.controller.cancel(); await f.controller.poll()
    assert.equal(f.state.value.job.status, status); assert.equal(f.state.value.confirmed, true)
    rejectCancel({ response: { status: 409, data: { detail: 'Backup no longer accepts cancellation' } } }); await pending
    assert.equal(f.state.value.job.status, status); assert.equal(f.state.value.confirmed, true)
    assert.equal(f.state.value.cancelUncertain, false); assert.equal(f.state.value.error, '')
  }
})

test('cancellation repository uses the exact bounded job route with an empty body', async () => {
  const calls = []; const client = { post: async (...args) => { calls.push(args); return { data: { protocol: 1 } } } }
  const repository = installationBackupsRepository(client); await repository.cancel('backup_one')
  assert.deepEqual(calls[0], ['/api/process/installation-backups/jobs/backup_one/cancel', {}, { timeout: 30000 }])
  for (const id of ['../other', 'a/b', '', 'bad\n']) assert.throws(() => repository.cancel(id))
})

test('phase percentages require measured totals and never invent a whole-backup percentage', () => {
  const measured = installationBackupJobProgress(job({ progress: { stage: 'archiving', percent_scope: 'phase', entries: 2, total_entries: 4, logical_bytes: 1024, bytes_processed: 1100, percent: 50, percent_basis: 'entries' } }), caps)
  assert.equal(installationBackupJobProgress(job({ progress: { stage: 'archiving', percent_scope: 'phase', entries: 2, total_entries: 4, percent: 50, percent_basis: 'entries' } }), {}).percent, null)
  assert.equal(measured.percent, 50); assert.equal(measured.total_entries, 4)
  const logical = installationBackupJobProgress(job({ progress: { stage: 'archiving', percent_scope: 'phase', entries: 2, logical_bytes: 512, total_logical_bytes: 1024, bytes_processed: 700, percent: 50, percent_basis: 'bytes' } }), caps)
  assert.equal(logical.percent, 50); assert.equal(logical.total_bytes, null); assert.equal(logical.total_logical_bytes, 1024)
  const verification = installationBackupJobProgress(job({ stage: 'verifying', progress: { stage: 'verifying', percent_scope: 'phase', bytes_processed: 8192, total_bytes: 8192, percent: 100, percent_basis: 'bytes' } }), caps)
  assert.equal(verification.percent, 100); assert.equal(verification.bytes_label, 'Archive stream read')
  assert.equal(installationBackupJobProgress(job({ stage: 'resuming', progress: { stage: 'verifying', percent_scope: 'phase', bytes_processed: 8192, total_bytes: 8192, percent: 100, percent_basis: 'bytes' } }), caps).percent, null)
  for (const progress of [{ entries: 2, percent: 50, percent_basis: 'entries' }, { entries: 2, total_entries: 0, percent: 50, percent_basis: 'entries' }, { entries: 2, total_entries: 4, percent: 101, percent_basis: 'entries' }, { entries: 2, total_entries: 4, percent: '50', percent_basis: 'entries' }]) assert.equal(installationBackupJobProgress(job({ progress }), caps).percent, null)
})
