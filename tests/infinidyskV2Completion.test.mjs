import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INFINIDYSK_V2_COMPLETION_STORAGE_KEY,
  infinidyskV2CompletionDismissed,
  infinidyskV2CompletionDismissible,
  normalizeInfiniDyskV2CompletionPreference,
} from '../helper/infinidyskV2Completion.js'

const emptyPreference = { major: null, postgres: null }
const completedJob = changes => ({ job_id: 'completed-cutover_1', status: 'completed', mode: 'cutover', ...changes })
const dismissible = changes => infinidyskV2CompletionDismissible({ job: completedJob(), confirmed: true, ...changes })
const consumer = changes => ({ ready: true, pending: [], failed: [], resumed: ['Example Radarr'], ...changes })

test('completion preferences keep only two bounded opaque workflow identities', () => {
  assert.equal(typeof INFINIDYSK_V2_COMPLETION_STORAGE_KEY, 'string')
  assert.ok(INFINIDYSK_V2_COMPLETION_STORAGE_KEY.length > 0)
  assert.notEqual(INFINIDYSK_V2_COMPLETION_STORAGE_KEY, 'dumb.infinidyskV2.jobs.v1', 'Dismissing a notice must not overwrite recovery references')
  assert.notEqual(INFINIDYSK_V2_COMPLETION_STORAGE_KEY, 'dumb.infinidyskV2.upgradeInvitation.v1', 'Completion dismissal must stay separate from the upgrade invitation')
  const preference = Object.freeze({ major: 'migration_A-1', postgres: 'database_B-2', preview_token: 'discard', result: { secret: 'discard' } })
  assert.deepEqual(normalizeInfiniDyskV2CompletionPreference(preference), { major: 'migration_A-1', postgres: 'database_B-2' })
  assert.deepEqual(Object.keys(preference), ['major', 'postgres', 'preview_token', 'result'])
  assert.deepEqual(normalizeInfiniDyskV2CompletionPreference({ major: 'a', postgres: 'Z'.repeat(160) }), { major: 'a', postgres: 'Z'.repeat(160) })
})

test('malformed stored preferences and individual IDs never suppress an unrelated completion', () => {
  for (const preference of [undefined, null, false, true, 1, '', 'invalid JSON', '{"major":"saved"}', [], [{ major: 'saved' }], {}]) {
    assert.deepEqual(normalizeInfiniDyskV2CompletionPreference(preference), emptyPreference)
  }
  for (const identity of [undefined, null, false, 1, '', 'has spaces', '../foreign', 'key:instance', 'a'.repeat(161), 'job\nnext', 'job\x00next', 'job\x7f', [], {}]) {
    assert.deepEqual(normalizeInfiniDyskV2CompletionPreference({ major: identity, postgres: 'other-valid' }), { major: null, postgres: 'other-valid' })
    assert.deepEqual(normalizeInfiniDyskV2CompletionPreference({ major: 'other-valid', postgres: identity }), { major: 'other-valid', postgres: null })
  }
})

test('confirmed completed jobs can dismiss optional rollback and cleanup offers', () => {
  assert.equal(dismissible(), true)
  assert.equal(dismissible({ job: completedJob({ can_rollback: true, rollback_available: true, can_cleanup: true, actions: { rollback: true, cleanup: true } }) }), true)
  for (const mutation of [undefined, null, { status: 'confirmed' }, { status: 'rejected' }]) assert.equal(dismissible({ mutation }), true)
  for (const job_id of ['a', 'A'.repeat(160), 'completed-migration_123']) assert.equal(dismissible({ job: completedJob({ job_id }) }), true)
})

test('unknown, active, prepared, paused and recovery states cannot be dismissed as completion', () => {
  for (const confirmed of [undefined, null, false, 1, 'true']) assert.equal(dismissible({ confirmed }), false)
  for (const busy of [true, 1, 'true', {}]) assert.equal(dismissible({ busy }), false)
  for (const status of ['queued', 'running', 'importing', 'validating', 'prepared', 'stage_retry_required', 'rolling_back', 'recovery_required', 'interrupted', 'unconfirmed', 'rehearsed', 'failed_restored', 'failed', 'cancelled', 'rolled_back', 'COMPLETED', '', null]) {
    assert.equal(dismissible({ job: completedJob({ status }) }), false, String(status))
  }
  for (const job of [undefined, null, false, 'completed', [], {}, completedJob({ job_id: '' }), completedJob({ job_id: '../foreign' }), completedJob({ job_id: 'a'.repeat(161) })]) assert.equal(dismissible({ job }), false)
})

test('pending, uncertain or malformed mutation state keeps the operation notice visible', () => {
  for (const mutation of [{ status: 'pending' }, { status: 'uncertain' }, { status: 'running' }, { status: 'unknown' }, { status: '' }, { status: null }, {}, [], false, 'confirmed']) {
    assert.equal(dismissible({ mutation }), false)
  }
})

test('recovery, restart and required cleanup flags fail closed without coercion', () => {
  for (const field of ['recovery_required', 'restart_required', 'staging_cleanup_required', 'cleanup_required']) {
    for (const value of [undefined, null, false]) assert.equal(dismissible({ job: completedJob({ [field]: value }) }), true, `${field} ${String(value)}`)
    for (const value of [true, 0, 1, '', 'false', 'true', [], {}]) assert.equal(dismissible({ job: completedJob({ [field]: value }) }), false, `${field} ${String(value)}`)
  }
  for (const value of [undefined, null, false]) assert.equal(dismissible({ job: completedJob({ result: { restart_required: value } }) }), true)
  for (const value of [true, 0, 'false', 'true', [], {}]) assert.equal(dismissible({ job: completedJob({ result: { restart_required: value } }) }), false)
})

test('only absent, not-requested or completed old-file cleanup allows dismissal', () => {
  for (const cleanup of [undefined, null, { state: 'not_requested' }, { state: 'completed' }]) assert.equal(dismissible({ job: completedJob({ cleanup }) }), true)
  for (const state of ['queued', 'verifying', 'retiring', 'deleting', 'failed', 'running', 'interrupted', 'unknown', '', false, null, undefined]) assert.equal(dismissible({ job: completedJob({ cleanup: { state } }) }), false, String(state))
  for (const cleanup of [false, 1, 'completed', []]) assert.equal(dismissible({ job: completedJob({ cleanup }) }), false)
})

test('completed consumer results must be recognized, valid and free of pending or failed apps', () => {
  for (const recovery_kind of ['v2_activation', 'v2_consumers']) {
    assert.equal(dismissible({ job: completedJob({ recovery_kind, consumer_recovery: consumer() }) }), true)
    assert.equal(dismissible({ job: completedJob({ recovery_kind, consumer_recovery: consumer({ ready: false }) }) }), true, 'A finished job is separate from later live service health')
    for (const consumer_recovery of [undefined, null, {}, consumer({ ready: 'true' }), consumer({ pending: null }), consumer({ resumed: ['duplicate', 'duplicate'] }), consumer({ failed: [{}] })]) assert.equal(dismissible({ job: completedJob({ recovery_kind, consumer_recovery }) }), false)
    for (const consumer_recovery of [consumer({ pending: ['Example Sonarr'] }), consumer({ failed: [{ process_name: 'Example Sonarr', reason_code: 'start_failed', message: 'The retained app did not start.' }] })]) {
      assert.equal(dismissible({ job: completedJob({ recovery_kind, consumer_recovery, result: { pending_consumers_acknowledged: true } }) }), false, 'Even acknowledged stopped apps remain visible under this completion policy')
    }
  }
  for (const recovery_kind of [undefined, null, '', 'v2_unknown', 'v1_restore']) assert.equal(dismissible({ job: completedJob({ recovery_kind, consumer_recovery: consumer() }) }), false)
  assert.equal(dismissible({ job: completedJob({ recovery_kind: null, consumer_recovery: null }) }), true, 'Legacy null metadata represents no consumer recovery record')
})

test('dismissal matches only the current eligible identity in the selected workflow', () => {
  const job = Object.freeze(completedJob({ can_rollback: true, updated_at: 100 }))
  const preference = Object.freeze({ major: job.job_id, postgres: 'different-database' })
  const input = { job, confirmed: true, preference, kind: 'major' }
  assert.equal(infinidyskV2CompletionDismissed(input), true)
  assert.equal(infinidyskV2CompletionDismissed({ ...input, job: { ...job, updated_at: 200, message: 'Refreshed observation' } }), true, 'Routine polling must not invalidate a completion dismissal')
  assert.equal(infinidyskV2CompletionDismissed({ ...input, job: { ...job, job_id: 'new-migration' } }), false)
  assert.equal(infinidyskV2CompletionDismissed({ ...input, kind: 'postgres' }), false)
  assert.equal(infinidyskV2CompletionDismissed({ ...input, preference: { postgres: job.job_id }, kind: 'postgres' }), true)
  for (const kind of [undefined, null, '', 'unknown', 'constructor', '__proto__']) assert.equal(infinidyskV2CompletionDismissed({ ...input, kind }), false)
  for (const preference of [undefined, null, [], false, { major: 'different-migration' }]) assert.equal(infinidyskV2CompletionDismissed({ ...input, preference }), false)
})

test('a dismissed ID resurfaces immediately when the same job needs work or confirmation', () => {
  const job = completedJob()
  const input = { job, confirmed: true, preference: { major: job.job_id }, kind: 'major' }
  assert.equal(infinidyskV2CompletionDismissed(input), true)
  for (const changes of [{ confirmed: false }, { busy: true }, { mutation: { status: 'pending' } }, { mutation: { status: 'uncertain' } }]) assert.equal(infinidyskV2CompletionDismissed({ ...input, ...changes }), false)
  for (const changes of [{ status: 'recovery_required' }, { recovery_required: true }, { result: { restart_required: true } }, { cleanup: { state: 'deleting' } }, { cleanup: { state: 'failed' } }, { staging_cleanup_required: true }, { cleanup_required: true }, { recovery_kind: 'v2_consumers', consumer_recovery: consumer({ pending: ['Example Sonarr'] }) }]) {
    assert.equal(infinidyskV2CompletionDismissed({ ...input, job: { ...job, ...changes } }), false)
  }
  assert.deepEqual(input.preference, { major: job.job_id }, 'Resurfacing work must not erase or rewrite stored preferences')
})
