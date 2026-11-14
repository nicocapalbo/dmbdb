import test from 'node:test'
import assert from 'node:assert/strict'
import { installationActivityJob, installationServiceStatus, installationServicesHeld } from '../helper/installationServiceStatus.js'
const job = changes => ({ job_id: 'backup_one', job_type: 'installation_backup', status: 'running', stage: 'archiving', created_at: 100, updated_at: 200, ...changes })
const service = { process_name: 'Example Media', config_key: 'plex' }
const green = { status: 'running', healthy: true, health_status: 'healthy', restart: { scheduled: true } }

test('only explicit stopped identities can replace stale green snapshots with stopped status', () => {
  const held = job({ services_stopped: true, stopped_process_names: [service.process_name] })
  const stopped = installationServiceStatus(held, green, service)
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.healthy, null); assert.equal(stopped.health_status, null); assert.equal(stopped.restart, null)
  for (const altered of [{ services_stopped: 'true' }, { stopped_process_names: ['Other Media'] }, { services_stopped: false }, { stopped_process_names: null }]) {
    assert.equal(installationServiceStatus({ ...held, ...altered }, green, service).status, 'unknown')
  }
  assert.deepEqual(green, { status: 'running', healthy: true, health_status: 'healthy', restart: { scheduled: true } })
})

test('quiescing, resuming and recovery invalidate cached availability while controls stay actual', () => {
  for (const changed of [{ stage: 'quiescing' }, { stage: 'resuming', services_stopped: false }, { status: 'recovery_required' }, { status: 'rolled_back', restart_required: true }]) {
    const held = job(changed)
    assert.equal(installationServicesHeld(held), true)
    assert.equal(installationServiceStatus(held, green, service).status, 'unknown')
    for (const control of [{ process_name: 'DUMB API' }, { process_name: 'DUMB Frontend' }, { process_name: 'Customized control', config_key: 'dumb' }]) assert.equal(installationServiceStatus(held, green, control), green)
  }
  for (const changed of [{ status: 'queued', stage: 'queued' }, { status: 'completed', stage: 'completed' }, { status: 'cancelled', stage: 'cancelled' }]) assert.equal(installationServicesHeld(job(changed)), false)
})

test('current backend observations supersede stale panel jobs without allowing an old lookup to mask a newer operation', () => {
  const local = job({ status: 'running', updated_at: 200 })
  const terminal = job({ status: 'cancelled', updated_at: 300 })
  assert.equal(installationActivityJob({ job: terminal }, { job: local }), terminal)
  const newer = job({ job_id: 'backup_two', created_at: 400, updated_at: 410 })
  assert.equal(installationActivityJob({ job: newer }, { job: local }), newer)
  assert.equal(installationActivityJob({ job: terminal }, { job: newer }), newer)
  assert.equal(installationActivityJob({ job: newer, authorizationRejected: true }, { job: local }), null)
})
