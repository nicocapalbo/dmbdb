import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isActivePostgresMigrationJob,
  isSuccessfulPostgresCutover,
  postgresMigrationStatusTone,
  resolveInfiniDyskPostgresRecovery,
} from '../helper/postgresMigration.js'

test('PostgreSQL migration keeps every backend active status polling', () => {
  for (const status of ['queued', 'running', 'finalizing', 'rolling_back']) {
    assert.equal(isActivePostgresMigrationJob({ status }), true, status)
  }
  assert.equal(isActivePostgresMigrationJob({ status: 'completed' }), false)
  assert.equal(isActivePostgresMigrationJob({ status: 'interrupted' }), false)
})

test('only a validated completed cutover refreshes the process config', () => {
  assert.equal(isSuccessfulPostgresCutover({
    status: 'completed',
    mode: 'cutover',
    result: { validated: true },
  }), true)
  assert.equal(isSuccessfulPostgresCutover({
    status: 'completed',
    mode: 'rehearsal',
    result: { validated: true },
  }), false)
  assert.equal(isSuccessfulPostgresCutover({
    status: 'completed',
    mode: 'cutover',
    result: { validated: false },
  }), false)
})

test('unsafe PostgreSQL recovery statuses use the danger presentation', () => {
  for (const status of ['failed', 'interrupted', 'rollback_failed']) {
    assert.equal(postgresMigrationStatusTone(status), 'danger', status)
  }
  assert.equal(postgresMigrationStatusTone('failed_rolled_back'), 'warning')
  assert.equal(postgresMigrationStatusTone('completed'), 'success')
})

test('InfiniDysk rollback failure distinguishes retry-safe and manual-attention recovery', () => {
  const retrySafe = resolveInfiniDyskPostgresRecovery({
    service_key: 'infinidysk',
    status: 'rollback_failed',
    rollback: { retry_safe: true },
  })
  assert.equal(retrySafe.state, 'retry_safe')
  assert.match(retrySafe.message, /retry the guarded rollback/i)

  const manualAttention = resolveInfiniDyskPostgresRecovery({
    service_key: 'infinidysk',
    status: 'rollback_failed',
    rollback: { retry_safe: false },
  })
  assert.equal(manualAttention.state, 'manual_attention')
  assert.match(manualAttention.message, /frozen/i)
  assert.match(manualAttention.message, /do not retry/i)
})

test('InfiniDysk interrupted or failed cutover retains guarded rollback guidance', () => {
  for (const status of ['interrupted', 'failed']) {
    const recovery = resolveInfiniDyskPostgresRecovery({
      service_key: 'infinidysk',
      status,
      rollback_available: true,
    })
    assert.equal(recovery.state, 'guarded_rollback')
    assert.match(recovery.message, /preserved SQLite rollback/i)
  }

  assert.equal(resolveInfiniDyskPostgresRecovery({
    service_key: 'sonarr',
    status: 'interrupted',
    rollback_available: true,
  }), null)
  assert.equal(resolveInfiniDyskPostgresRecovery({
    service_key: 'infinidysk',
    status: 'failed_rolled_back',
  }), null)
})
