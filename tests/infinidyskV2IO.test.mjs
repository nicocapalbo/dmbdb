import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2IOProgress, infinidyskV2IOEstimateText, infinidyskV2InputIntegrity, formatInfiniDyskV2IORate } from '../helper/infinidyskV2IO.js'
import { infinidyskV2SnapshotProgress } from '../helper/infinidyskV2Status.js'

const diagnostic = (changes = {}) => ({ code: 'recorded_entry_changed', side: 'staged', path_digest: 'a'.repeat(64),
  entry_type: 'file', changed_fields: ['ctime_ns'], ...changes })

test('input diagnostics identify the safe side and changed check without exposing raw paths or values', () => {
  const result = infinidyskV2InputIntegrity(diagnostic({ path: '/private/library/example.bin', before: 'private-before', after: 'private-after' }))
  assert.equal(result.sideLabel, 'Staged working copy'); assert.equal(result.entryType, 'file')
  assert.deepEqual(result.changes, ['Filesystem change time']); assert.equal(result.reference, 'a'.repeat(64))
  assert.doesNotMatch(JSON.stringify(result), /private|example.bin|before|after/)
  const source = infinidyskV2InputIntegrity(diagnostic({ side: 'source', entry_type: 'directory', changed_fields: ['inode', 'mode', 'inode'] }))
  assert.equal(source.sideLabel, 'Retained v1 input'); assert.equal(source.entryType, 'directory')
  assert.deepEqual(source.changes, ['File identity', 'Type or permissions'])
})

test('a real content mismatch remains distinct from a metadata-only mismatch', () => {
  const result = infinidyskV2InputIntegrity(diagnostic({ code: 'input_content_mismatch', changed_fields: ['sha256', 'size'] }))
  assert.match(result.label, /content did not match/)
  assert.deepEqual(result.changes, ['Content hash', 'Size'])
})

test('missing or unsupported diagnostic metadata leaves the existing authored error as the fallback', () => {
  for (const value of [null, undefined, [], {}, diagnostic({ code: 'constructor' }), diagnostic({ side: 'external-url' }),
    diagnostic({ entry_type: 'symlink' }), diagnostic({ path_digest: '/private/path' }), diagnostic({ path_digest: 'a'.repeat(63) }),
    diagnostic({ changed_fields: [] }), diagnostic({ changed_fields: ['raw_path'] }), diagnostic({ changed_fields: [{ type: 'ctime_ns' }] }),
    diagnostic({ changed_fields: Array(9).fill('ctime_ns') })]) assert.equal(infinidyskV2InputIntegrity(value), null)
})

test('a retained PostgreSQL snapshot never borrows a restore substep from a different phase', () => {
  for (const phase of ['source_connection', 'source_inventory', 'snapshot_export', 'backup_tool', 'native_staging',
    'dump_storage', 'database_dump', 'source_cleanup', 'snapshot_receipt']) {
    assert.equal(infinidyskV2SnapshotProgress({ phase, restore_phase: 'verifying_database' }).restoreLabel, undefined)
  }
  assert.match(infinidyskV2SnapshotProgress({ phase: 'restore_verification', restore_phase: 'verifying_database' }).restoreLabel, /Comparing/)
})

const now = 1_800_000_000_000
const context = { active: true, confirmed: true, stage: 'archiving', now }
const metric = (changes = {}) => ({ phase_id: 'a1b2c3_1', phase: 'archive_write', unit: 'bytes', processed: 1024,
  total: 10240, total_is_estimate: true, elapsed_seconds: 30, rate_per_second: 102.4,
  estimated_remaining_seconds: 90, updated_at: now / 1000, complete: false, ...changes })
const io = (value = metric(), options = {}) => infinidyskV2IOProgress(value, { ...context, ...options })

test('a known current-phase byte total supports only a scoped measured pace and rounded ETA', () => {
  const result = io(metric({ overall_eta_seconds: 9000, percent: 80, path: '/private/file' }))
  assert.equal(result.stage, 'archiving'); assert.equal(result.unit, 'bytes')
  assert.equal(result.processed, 1024); assert.equal(result.total, 10240)
  assert.equal(result.totalIsEstimate, true); assert.equal(result.rate, 102.4)
  assert.equal(result.remainingSeconds, 120); assert.equal(result.estimateState, 'ready')
  assert.equal(result.overall_eta_seconds, undefined); assert.equal(result.percent, undefined); assert.equal(result.path, undefined)
  assert.equal(io(metric({ estimated_remaining_seconds: 12 })).remainingSeconds, 15)
})

test('every IO phase is bound to its authored stage and unit', () => {
  const pairs = {
    source_fingerprint: ['snapshotting', 'bytes'],
    archive_inventory: ['archive_inventory', 'entries'], archive_write: ['archiving', 'bytes'],
    archive_readback: ['verifying_archive', 'bytes'], archive_recheck: ['verifying_archive', 'bytes'],
    archive_restore: ['restoring_archive', 'bytes'], restore_metadata: ['restoring_metadata', 'entries'],
    restore_verify: ['verifying_restored_source', 'bytes'], blob_copy: ['staging_blobs', 'bytes'],
    blob_metadata: ['preparing_blob_staging', 'entries'], blob_verify_staged: ['verifying_blob_staging', 'bytes'],
    blob_verify_source: ['verifying_blob_staging', 'entries'], blob_release: ['releasing_local_blobs', 'entries'],
    blob_verify_input: ['verifying_blob_input', 'bytes'], blob_cleanup: ['cleaning_blob_staging', 'entries'],
  }
  for (const [phase, [stage, unit]] of Object.entries(pairs)) {
    const result = io(metric({ phase, unit }), { stage })
    assert.equal(result.stage, stage); assert.equal(result.unit, unit); assert.equal(result.estimateState, 'ready')
    assert.equal(io(metric({ phase, unit: unit === 'bytes' ? 'entries' : 'bytes' }), { stage }), null)
    const later = io(metric({ phase, unit }), { stage: 'importing' })
    assert.equal(later.estimateState, 'inactive'); assert.equal(later.rate, undefined); assert.equal(later.remainingSeconds, undefined)
  }
})

test('copy, metadata, readback and repeated verification passes reset independently', () => {
  assert.equal(io().remainingSeconds, 120)
  const next = io(metric({ phase_id: 'a1b2c3_2', phase: 'blob_metadata', unit: 'entries', processed: 0,
    total: 3000, elapsed_seconds: 0, rate_per_second: null, estimated_remaining_seconds: null }), { stage: 'preparing_blob_staging' })
  assert.equal(next.processed, 0); assert.equal(next.unit, 'entries'); assert.equal(next.rate, undefined)
  assert.equal(next.remainingSeconds, undefined); assert.equal(next.estimateState, 'warming')
  const verify = io(metric({ phase_id: 'a1b2c3_3', phase: 'blob_verify_staged', processed: 12,
    elapsed_seconds: 1, rate_per_second: null, estimated_remaining_seconds: null }), { stage: 'verifying_blob_staging' })
  assert.match(verify.label, /Reading back/); assert.equal(verify.remainingSeconds, undefined)
  const recheck = io(metric({ phase_id: 'a1b2c3_4', phase: 'archive_recheck', processed: 0, elapsed_seconds: 0,
    rate_per_second: null, estimated_remaining_seconds: null }), { stage: 'verifying_archive' })
  assert.notEqual(recheck.phaseId, verify.phaseId); assert.equal(recheck.processed, 0); assert.equal(recheck.remainingSeconds, undefined)
})

test('unknown or malformed totals never invent a remaining time or a total percentage', () => {
  for (const total of [null, undefined, '10240', -1, Number.MAX_SAFE_INTEGER + 1]) {
    const result = io(metric({ total }))
    assert.equal(result.total, undefined); assert.equal(result.remainingSeconds, undefined)
    assert.equal(result.estimateState, 'unknown_total'); assert.equal(result.percent, undefined)
  }
  const exact = io(metric({ total_is_estimate: false }))
  assert.equal(exact.totalIsEstimate, false)
})

test('stale measurements and lost confirmation hide pace and ETA while retaining reported work', () => {
  for (const updated_at of [now / 1000 - 31, now / 1000 + 6, null, '1800000000', NaN]) {
    const result = io(metric({ updated_at }))
    assert.equal(result.processed, 1024); assert.equal(result.rate, undefined); assert.equal(result.remainingSeconds, undefined)
    assert.equal(result.estimateState, 'stale')
  }
  const result = io(metric(), { confirmed: false })
  assert.equal(result.estimateState, 'unconfirmed'); assert.equal(result.remainingSeconds, undefined); assert.equal(result.rate, undefined)
  assert.equal(io(metric({ updated_at: now / 1000 - 30 })).estimateState, 'ready')
  assert.equal(io(metric(), { now: now + 31000 }).estimateState, 'stale')
})

test('warming, zero pace and incomplete estimates do not imply a finish time', () => {
  for (const changes of [{ elapsed_seconds: 9 }, { processed: 0 }, { rate_per_second: 0 }, { rate_per_second: null },
    { rate_per_second: '102.4' }, { rate_per_second: Infinity }, { rate_per_second: NaN }, { rate_per_second: -1 },
    { estimated_remaining_seconds: 0 }, { estimated_remaining_seconds: null }, { estimated_remaining_seconds: '90' },
    { estimated_remaining_seconds: -1 }]) assert.equal(io(metric(changes)).remainingSeconds, undefined)
  assert.equal(io(metric({ elapsed_seconds: 9 })).estimateState, 'warming')
})

test('reaching or overrunning a reported total is not a claim that the operation finished', () => {
  const atTotal = io(metric({ processed: 10240 }))
  assert.equal(atTotal.complete, false); assert.equal(atTotal.estimateState, 'at_total')
  assert.equal(atTotal.rate, undefined); assert.equal(atTotal.remainingSeconds, undefined)
  assert.match(infinidyskV2IOEstimateText('at_total'), /Final checks/)
  const overrun = io(metric({ processed: 10241 }))
  assert.equal(overrun.processed, 10241); assert.equal(overrun.estimateState, 'overrun')
  assert.equal(overrun.rate, undefined); assert.equal(overrun.remainingSeconds, undefined)
})

test('completed, terminal and mismatched observations never present a live ETA', () => {
  for (const options of [{ active: false }, { stage: 'postgres_snapshot' }]) {
    const result = io(metric(), options)
    assert.equal(result.estimateState, 'inactive'); assert.equal(result.rate, undefined); assert.equal(result.remainingSeconds, undefined)
  }
  const result = io(metric({ complete: true }))
  assert.equal(result.estimateState, 'complete'); assert.equal(result.rate, undefined); assert.equal(result.remainingSeconds, undefined)
})

test('older APIs and unsupported IO metadata retain the existing job-message fallback', () => {
  for (const value of [null, undefined, [], {}, metric({ phase_id: '/private/path' }), metric({ phase: 'constructor' }),
    metric({ phase: 'unknown_phase' }), metric({ processed: '1024' }), metric({ processed: -1 }),
    metric({ elapsed_seconds: -1 }), metric({ complete: 'false' }), metric({ total_is_estimate: 'true' }),
    metric({ unit: 'bytes_per_second' })]) assert.equal(infinidyskV2IOProgress(value, context), null)
})


test('measured byte rates accept fractions independently from integer storage counts', () => {
  for (const [rate, expected] of [[102.4, '102.4 B/s'], [1536.5, '1.5 KiB/s'],
    [8.125 * 1024 ** 2, '8.13 MiB/s'], [0.25, '0.25 B/s'], [0.00125, '0.00125 B/s'],
    [0.000001, '1E-6 B/s'], [Number.MIN_VALUE, '5E-324 B/s']]) {
    assert.equal(formatInfiniDyskV2IORate(rate, 'bytes'), expected)
    const progress = io(metric({ rate_per_second: rate }))
    assert.equal(progress.rate, rate); assert.equal(progress.estimateState, 'ready')
    assert.doesNotMatch(formatInfiniDyskV2IORate(progress.rate, progress.unit), /Unknown|undefined|^0 B/)
  }
  assert.equal(io(metric({ processed: 1024.5 })), null)
  assert.equal(io(metric({ total: 10240.5 })).total, undefined)
})

test('positive fractional entry rates remain visible without rounding to zero', () => {
  assert.equal(formatInfiniDyskV2IORate(0.125, 'entries'), '0.13 entries/s')
  assert.equal(formatInfiniDyskV2IORate(1.25, 'entries'), '1.3 entries/s')
})

test('invalid or unavailable pace never produces an Unknown-per-second label or an ETA', () => {
  for (const value of [undefined, null, 0, -1, '102.4', NaN, Infinity, -Infinity, true, {}, []]) {
    assert.equal(formatInfiniDyskV2IORate(value, 'bytes'), '')
    assert.equal(formatInfiniDyskV2IORate(value, 'entries'), '')
    const progress = io(metric({ rate_per_second: value }))
    assert.equal(progress.rate, undefined); assert.equal(progress.remainingSeconds, undefined)
    assert.match(infinidyskV2IOEstimateText(progress.estimateState), /not available/)
  }
  assert.equal(formatInfiniDyskV2IORate(102.4, 'unsupported'), '')
})
