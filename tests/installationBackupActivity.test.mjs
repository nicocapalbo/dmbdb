import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createInstallationBackupActivity, initialInstallationBackupActivity, installationBackupActivityView } from '../helper/installationBackupActivity.js'

const caps = { installation_backup: true, installation_backup_protocol: 1 }
const job = (status = 'running', changes = {}) => ({ job_id: 'installation_one', job_type: 'installation_backup', status, stage: 'archiving', message: 'Writing verified installation archive', created_at: 1700000000, started_at: 1700000002, updated_at: 1700000100, ...changes })
const fixture = overrides => {
  const state = ref(initialInstallationBackupActivity()), notifications = [], calls = []
  const response = { current: { protocol: 1, job: null } }
  const repository = { capabilities: async () => { calls.push('capabilities'); return caps }, status: async () => { calls.push('status'); return response.current }, job: async id => { calls.push(['job', id]); return { protocol: 1, job: job('completed') } }, ...overrides }
  const controller = createInstallationBackupActivity({ state, repository, notify: value => notifications.push(value) })
  return { state, notifications, calls, response, repository, controller }
}
test('unsupported backends receive no backup activity status requests', async () => {
  const f = fixture({ capabilities: async () => ({ ...caps, installation_backup: false }) })
  await f.controller.refresh()
  assert.equal(f.calls.includes('status'), false)
  assert.equal(installationBackupActivityView(f.state.value).visible, false)
})
test('manual and scheduled jobs are discovered without any Settings panel or local start', async () => {
  for (const origin of ['manual', 'scheduled']) {
    const f = fixture(); f.response.current.job = job('running', { origin })
    await f.controller.refresh()
    const view = installationBackupActivityView(f.state.value, 1700000110000)
    assert.equal(view.visible, true); assert.equal(view.active, true); assert.equal(view.elapsed, '1m 48s')
    assert.match(view.title, /backup running/)
  }
})
test('first contact failure does not invent a running backup, but known active state survives connection loss', async () => {
  const f = fixture({ status: async () => { throw new Error('Network Error') } })
  await f.controller.refresh()
  assert.equal(installationBackupActivityView(f.state.value).visible, false)
  f.repository.status = async () => ({ protocol: 1, job: job() })
  await f.controller.refresh()
  f.repository.status = async () => { throw new Error('Network Error') }
  await f.controller.refresh()
  const view = installationBackupActivityView(f.state.value)
  assert.equal(view.visible, true); assert.equal(view.uncertain, true)
  assert.equal(f.state.value.job.job_id, 'installation_one')
  assert.match(view.title, /may still be running/)
})
test('missing current job requires exact terminal confirmation; missing exact state retains the warning', async () => {
  const f = fixture()
  f.response.current.job = job(); await f.controller.refresh()
  f.response.current.job = null
  f.repository.job = async () => { throw { response: { status: 404, data: { detail: 'The retained job was not found.' } } } }
  await f.controller.refresh()
  assert.equal(f.state.value.job.job_id, 'installation_one')
  assert.equal(installationBackupActivityView(f.state.value).uncertain, true)
})
test('exact completed result confirms completion once even after current status drops its active job', async () => {
  const f = fixture()
  f.response.current.job = job(); await f.controller.refresh()
  f.response.current.job = null
  await f.controller.refresh()
  assert.equal(installationBackupActivityView(f.state.value).visible, false)
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0].title, 'Installation backup complete')
  await f.controller.refresh()
  assert.equal(f.notifications.length, 1)
})
test('newer active job remains visible while the exact prior terminal result is notified', async () => {
  const f = fixture()
  f.response.current.job = job(); await f.controller.refresh()
  f.response.current.job = job('running', { job_id: 'installation_two' })
  await f.controller.refresh()
  assert.equal(f.state.value.job.job_id, 'installation_two')
  assert.equal(installationBackupActivityView(f.state.value).active, true)
  assert.equal(f.notifications[0].title, 'Installation backup complete')
})
test('exact recovery state remains attention instead of appearing as a running or finished backup', async () => {
  const f = fixture({ job: async () => ({ protocol: 1, job: job('recovery_required') }) })
  f.response.current.job = job(); await f.controller.refresh()
  f.response.current.job = null
  await f.controller.refresh()
  const view = installationBackupActivityView(f.state.value)
  assert.equal(view.visible, true); assert.equal(view.active, false); assert.equal(view.recovery, true)
  assert.match(view.title, /recovery requires attention/)
})
test('restore completion never emits a backup-complete toast', async () => {
  const f = fixture()
  f.response.current.job = job('running', { job_type: 'installation_restore' }); await f.controller.refresh()
  f.response.current.job = job('completed', { job_type: 'installation_restore', restart_required: true }); await f.controller.refresh()
  assert.equal(f.notifications.length, 0)
  assert.equal(installationBackupActivityView(f.state.value).restart, true)
})
test('preparation is visible after reload and actual durable job takes priority during handoff', async () => {
  const f = fixture()
  f.response.current = { protocol: 1, job: null, preparation: { stage: 'checking_capacity', message: 'Rechecking coverage before stopping services', started_at: 1700000000 } }
  await f.controller.refresh()
  let view = installationBackupActivityView(f.state.value, 1700000120000)
  assert.equal(view.preparing, true); assert.equal(view.elapsed, '2m 0s')
  f.response.current.job = job(); await f.controller.refresh()
  view = installationBackupActivityView(f.state.value)
  assert.equal(view.preparing, false); assert.equal(view.active, true)
})
test('401 and 403 clear private activity and suppress polling until authentication is explicitly reset', async () => {
  for (const code of [401, 403]) {
    const f = fixture()
    f.response.current.job = job(); await f.controller.refresh()
    let failures = 0
    f.repository.status = async () => { failures++; throw { response: { status: code, data: { detail: 'Not authorized' } } } }
    await f.controller.refresh(); await f.controller.refresh()
    assert.equal(failures, 1)
    assert.equal(f.state.value.job, null)
    assert.equal(f.state.value.authorizationRejected, true)
    assert.equal(installationBackupActivityView(f.state.value).visible, false)
    f.controller.reset()
    f.repository.status = async () => ({ protocol: 1, job: job() })
    await f.controller.refresh()
    assert.equal(f.state.value.job.job_id, 'installation_one')
  }
})
test('auth reset prevents a stale in-flight status response from restoring private job metadata', async () => {
  let finish
  const f = fixture({ status: () => new Promise(resolve => { finish = resolve }) })
  const pending = f.controller.refresh()
  await Promise.resolve(); await Promise.resolve()
  f.controller.reset()
  finish({ protocol: 1, job: job() }); await pending
  assert.equal(f.state.value.job, null)
  assert.equal(f.state.value.resolved, false)
})

test('optional job progress is numeric, phase-relative and absent on legacy records', async () => {
  const { installationBackupJobProgress } = await import('../helper/installationBackupActivity.js')
  assert.equal(installationBackupJobProgress(job()), null)
  const inventory = installationBackupJobProgress(job('running', { stage: 'inventorying', progress: { entries: 2213066, logical_bytes: 1e9 } }))
  assert.equal(inventory.entries_label, 'Entries inspected')
  const archiving = installationBackupJobProgress(job('running', { stage: 'archiving', progress: { bytes_processed: 5000 } }))
  assert.equal(archiving.bytes_label, 'Archive stream written')
  const verifying = installationBackupJobProgress(job('running', { stage: 'verifying', progress: { bytes_processed: 6000, entries: -1, logical_bytes: '6000' } }))
  assert.equal(verifying.bytes_label, 'Archive stream read')
  assert.equal(verifying.entries, null)
  assert.equal(verifying.logical_bytes, null)
})
test('retained recovery survives repeated empty status and clears after an exact rollback receipt', async () => {
  const f = fixture({ job: async () => ({ protocol: 1, job: job('recovery_required') }) })
  f.response.current.job = job(); await f.controller.refresh()
  f.response.current.job = null; await f.controller.refresh(); await f.controller.refresh()
  assert.equal(installationBackupActivityView(f.state.value).displayJob.status, 'recovery_required')
  f.repository.job = async () => ({ protocol: 1, job: job('rolled_back') })
  await f.controller.refresh()
  assert.equal(installationBackupActivityView(f.state.value).visible, false)
})
