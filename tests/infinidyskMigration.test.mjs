import test from 'node:test'
import assert from 'node:assert/strict'

import {
  INFINIDYSK_MIGRATION_CLEANUP_CONFIRMATION,
  isActiveInfiniDyskMigrationJob,
  isInfiniDyskMigrationCleanupAvailable,
  isInfiniDyskMigrationCleanupReady,
  normalizeInfiniDyskMigrationJob,
  reconcileInfiniDyskTerminalJob,
  resolveInfiniDyskPostgresMigrationGate,
} from '../helper/infinidyskMigration.js'

test('empty and malformed job responses are treated as no migration job', () => {
  assert.equal(normalizeInfiniDyskMigrationJob(null), null)
  assert.equal(normalizeInfiniDyskMigrationJob({}), null)
  assert.equal(normalizeInfiniDyskMigrationJob([]), null)
  assert.equal(normalizeInfiniDyskMigrationJob({ job_id: 'job-only' }), null)
  assert.equal(normalizeInfiniDyskMigrationJob({ status: 'completed' }), null)
})

test('valid persisted migration jobs pass through normalization', () => {
  const job = { job_id: 'job-complete', status: 'completed', progress: 100 }

  assert.equal(normalizeInfiniDyskMigrationJob(job), job)
})

test('active InfiniDysk migration jobs remain eligible for a later terminal announcement', () => {
  const job = { job_id: 'job-running', status: 'running' }

  assert.equal(isActiveInfiniDyskMigrationJob(job), true)
  assert.deepEqual(reconcileInfiniDyskTerminalJob(job), {
    acknowledgedJobId: null,
    announce: false,
  })
})

test('initial discovery acknowledges a persisted completed job without reopening its popup', () => {
  const job = { job_id: 'job-complete', status: 'completed' }
  const discovered = reconcileInfiniDyskTerminalJob(job, {
    announcementsEnabled: false,
    acknowledgedJobId: null,
  })

  assert.deepEqual(discovered, {
    acknowledgedJobId: 'job-complete',
    announce: false,
  })

  assert.deepEqual(reconcileInfiniDyskTerminalJob(job, {
    announcementsEnabled: true,
    acknowledgedJobId: discovered.acknowledgedJobId,
  }), {
    acknowledgedJobId: 'job-complete',
    announce: false,
  })
})

test('an active job that becomes terminal announces once in the observing browser', () => {
  const job = { job_id: 'job-new', status: 'failed_rolled_back' }
  const first = reconcileInfiniDyskTerminalJob(job, {
    announcementsEnabled: true,
    acknowledgedJobId: 'job-older',
  })

  assert.deepEqual(first, {
    acknowledgedJobId: 'job-new',
    announce: true,
  })
  assert.equal(reconcileInfiniDyskTerminalJob(job, {
    announcementsEnabled: true,
    acknowledgedJobId: first.acknowledgedJobId,
  }).announce, false)
})

test('migration cleanup is capability-gated, needs no persisted job, and is unavailable while active or finalized', () => {
  const migration = { cleanup_available: true, cleanup_finalized: false }

  assert.equal(isInfiniDyskMigrationCleanupAvailable(migration, false), false)
  assert.equal(isInfiniDyskMigrationCleanupAvailable(migration, true), true)
  assert.equal(isInfiniDyskMigrationCleanupAvailable(
    migration,
    true,
    { job_id: 'job-running', status: 'running' },
  ), false)
  assert.equal(isInfiniDyskMigrationCleanupAvailable({
    cleanup_available: false,
    cleanup_finalized: false,
  }, true), false)
  assert.equal(isInfiniDyskMigrationCleanupAvailable({
    cleanup_available: true,
    cleanup_finalized: true,
  }, true), false)
})

test('migration cleanup requires a fresh preview, both acknowledgements, and exact confirmation', () => {
  const ready = {
    preview: { available: true, preview_token: 'short-lived-token' },
    confirmation: INFINIDYSK_MIGRATION_CLEANUP_CONFIRMATION,
    acknowledgeValidation: true,
    acknowledgeRollbackLoss: true,
  }

  assert.equal(isInfiniDyskMigrationCleanupReady(ready), true)
  assert.equal(isInfiniDyskMigrationCleanupReady({ ...ready, preview: null }), false)
  assert.equal(isInfiniDyskMigrationCleanupReady({
    ...ready,
    preview: { available: true, preview_token: '' },
  }), false)
  assert.equal(isInfiniDyskMigrationCleanupReady({
    ...ready,
    confirmation: 'remove infinidysk migration data',
  }), false)
  assert.equal(isInfiniDyskMigrationCleanupReady({
    ...ready,
    acknowledgeValidation: false,
  }), false)
  assert.equal(isInfiniDyskMigrationCleanupReady({
    ...ready,
    acknowledgeRollbackLoss: false,
  }), false)
})

test('PostgreSQL migration stays blocked until namespace status and job recovery state are resolved', () => {
  const base = {
    migrationCapability: true,
    migrationJobsCapability: true,
    statusResolved: true,
    jobResolved: true,
    migration: { status: 'pending', eligible: true },
    job: null,
  }

  assert.equal(resolveInfiniDyskPostgresMigrationGate().state, 'unsupported')
  assert.equal(resolveInfiniDyskPostgresMigrationGate({
    ...base,
    statusResolved: false,
  }).state, 'checking')
  assert.equal(resolveInfiniDyskPostgresMigrationGate({
    ...base,
    statusResolved: false,
    error: 'status unavailable',
  }).state, 'unavailable')
  assert.equal(resolveInfiniDyskPostgresMigrationGate(base).state, 'namespace_required')
  assert.equal(resolveInfiniDyskPostgresMigrationGate({
    ...base,
    migration: { status: 'compatibility_completed' },
    job: { job_id: 'job-running', status: 'running' },
  }).state, 'active')
  assert.equal(resolveInfiniDyskPostgresMigrationGate({
    ...base,
    migration: { status: 'compatibility_completed' },
    job: { job_id: 'job-interrupted', status: 'interrupted' },
  }).state, 'recovery')
  assert.equal(resolveInfiniDyskPostgresMigrationGate({
    ...base,
    migrationJobsCapability: false,
  }).state, 'unsupported')
})

test('PostgreSQL migration is allowed only after an accepted namespace terminal state', () => {
  for (const status of ['not_needed', 'compatibility_completed', 'completed']) {
    assert.deepEqual(resolveInfiniDyskPostgresMigrationGate({
      migrationCapability: true,
      migrationJobsCapability: true,
      statusResolved: true,
      jobResolved: true,
      migration: { status },
      job: status === 'completed'
        ? { job_id: 'job-complete', status: 'completed' }
        : null,
    }), { allowed: true, state: 'ready', reason: '' })
  }

  assert.equal(resolveInfiniDyskPostgresMigrationGate({
    migrationCapability: true,
    migrationJobsCapability: true,
    statusResolved: true,
    jobResolved: true,
    migration: { status: 'compatibility_completed' },
    job: { job_id: 'job-rolled-back', status: 'failed_rolled_back' },
  }).allowed, true)
})
