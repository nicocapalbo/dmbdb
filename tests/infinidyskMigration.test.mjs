import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isActiveInfiniDyskMigrationJob,
  normalizeInfiniDyskMigrationJob,
  reconcileInfiniDyskTerminalJob,
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
