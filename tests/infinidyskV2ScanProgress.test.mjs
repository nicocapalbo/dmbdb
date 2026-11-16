import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2RunningBlocker, infinidyskV2ScanProgress, infinidyskV2ScanEstimateText } from '../helper/infinidyskV2Status.js'
import { infinidyskV2JobPresentation } from '../helper/infinidyskV2Presentation.js'

test('only exact established running admission messages become neutral for confirmed active work', () => {
  const known = [
    'A major migration is active or needs recovery review.',
    'An InfiniDysk 2 operation is already running. Its status is shown below.',
  ]
  for (const value of known) {
    assert.equal(infinidyskV2RunningBlocker(value), true)
    assert.equal(infinidyskV2RunningBlocker({ message: value }), true)
    assert.equal(infinidyskV2RunningBlocker(value + ' Additional warning.'), false)
  }
  for (const value of ['A previous migration needs recovery before another can start.', 'Fixture independent blocker', null, {}, { code: known[0] }]) {
    assert.equal(infinidyskV2RunningBlocker(value), false)
  }
  for (const status of ['recovery_required', 'interrupted', 'unconfirmed']) {
    assert.equal(infinidyskV2JobPresentation({ status }).active, false)
  }
})

const now = 1_800_000_000_000
const context = { active: true, confirmed: true, stage: 'revalidating', now }
const scan = (changes = {}) => ({
  scan_id: 'source_data_1', phase: 'source_data', entries_processed: 1000, entries_total: 10000,
  total_is_estimate: true, logical_bytes_processed: 4096000, elapsed_seconds: 30,
  rate_entries_per_second: 100, estimated_remaining_seconds: 90, estimate_scope: 'current_scan',
  updated_at: now / 1000, complete: false, ...changes,
})
const present = (value = scan(), options = {}) => infinidyskV2ScanProgress(value, { ...context, ...options })

test('a measured current scan exposes approximate totals and conservatively rounded remaining time only for this scan', () => {
  const result = present(scan({ password: 'private', overall_eta_seconds: 9000, percent: 50 }))
  assert.equal(result.scanId, 'source_data_1')
  assert.match(result.label, /retained v1 data/)
  assert.equal(result.entries, 1000); assert.equal(result.totalEntries, 10000)
  assert.equal(result.totalIsEstimate, true); assert.equal(result.logicalBytes, 4096000)
  assert.equal(result.rate, 100); assert.equal(result.remainingSeconds, 120)
  assert.equal(result.estimateState, 'ready')
  assert.equal(result.password, undefined); assert.equal(result.overall_eta_seconds, undefined); assert.equal(result.percent, undefined)
  assert.equal(present(scan({ estimated_remaining_seconds: 12 })).remainingSeconds, 15)
})

test('unknown totals still show measured counts and pace without inventing a remaining-time estimate', () => {
  const result = present(scan({ entries_total: null }))
  assert.equal(result.entries, 1000); assert.equal(result.totalEntries, undefined)
  assert.equal(result.rate, 100); assert.equal(result.remainingSeconds, undefined)
  assert.equal(result.estimateState, 'unknown_total')
  assert.match(infinidyskV2ScanEstimateText(result.estimateState), /total file count is not known/)
  for (const entries_total of ['10000', -1, Number.MAX_SAFE_INTEGER + 1]) assert.equal(present(scan({ entries_total })).remainingSeconds, undefined)
})

test('a scan must warm up and provide a positive measured pace plus a valid remaining time', () => {
  for (const changes of [{ elapsed_seconds: 9 }, { entries_processed: 0 }, { entries_total: 0 }, { rate_entries_per_second: 0 },
    { rate_entries_per_second: null }, { rate_entries_per_second: '100' }, { rate_entries_per_second: Infinity },
    { estimated_remaining_seconds: null }, { estimated_remaining_seconds: 0 }, { estimated_remaining_seconds: -1 }, { estimated_remaining_seconds: '90' }]) {
    assert.equal(present(scan(changes)).remainingSeconds, undefined, JSON.stringify(changes))
  }
  assert.equal(present(scan({ elapsed_seconds: 9 })).estimateState, 'warming')
  assert.equal(present(scan({ rate_entries_per_second: 0 })).rate, undefined)
})

test('fresh GET heartbeats cannot keep an old measurement estimate alive', () => {
  for (const updated_at of [now / 1000 - 31, now / 1000 + 6, null, '1800000000', NaN]) {
    const result = present(scan({ updated_at }))
    assert.equal(result.entries, 1000); assert.equal(result.rate, undefined)
    assert.equal(result.remainingSeconds, undefined); assert.equal(result.estimateState, 'stale')
  }
  assert.equal(present(scan({ updated_at: now / 1000 - 30 })).estimateState, 'ready')
  assert.equal(present(scan(), { now: now + 31000 }).estimateState, 'stale')
})

test('a growing source never clamps to 100 percent or carries an old scan estimate into a fresh pass', () => {
  const overrun = present(scan({ entries_processed: 10001 }))
  assert.equal(overrun.entries, 10001); assert.equal(overrun.remainingSeconds, undefined)
  assert.equal(overrun.rate, undefined); assert.equal(overrun.estimateState, 'overrun')
  assert.match(infinidyskV2ScanEstimateText('overrun'), /grown beyond/)
  const next = present(scan({ scan_id: 'source_runtime_2', phase: 'source_runtime', entries_processed: 0, elapsed_seconds: 0,
    entries_total: null, rate_entries_per_second: null, estimated_remaining_seconds: null }))
  assert.match(next.label, /application files/); assert.equal(next.scanId, 'source_runtime_2')
  assert.equal(next.entries, 0); assert.equal(next.rate, undefined); assert.equal(next.remainingSeconds, undefined)
})

test('terminal, completed, unconfirmed and later-phase observations never present a live scan ETA', () => {
  for (const options of [{ active: false }, { confirmed: false }, { stage: 'postgres_snapshot' }]) {
    const result = present(scan(), options)
    assert.equal(result.rate, undefined); assert.equal(result.remainingSeconds, undefined)
  }
  assert.equal(present(scan(), { confirmed: false }).estimateState, 'unconfirmed')
  const result = present(scan({ complete: true }))
  assert.equal(result.estimateState, 'complete'); assert.equal(result.rate, undefined); assert.equal(result.remainingSeconds, undefined)
})

test('older APIs and malformed new scan metadata fall back without exposing arbitrary fields', () => {
  for (const value of [undefined, null, [], 'scan', scan({ phase: 'constructor' }), scan({ scan_id: '/private/path' }),
    scan({ phase: 'unknown_scan' }), scan({ entries_processed: '1000' }), scan({ entries_processed: -1 }),
    scan({ estimate_scope: 'whole_migration' }), scan({ total_is_estimate: 'true' }), scan({ complete: 'false' }),
    scan({ elapsed_seconds: -1 })]) assert.equal(infinidyskV2ScanProgress(value, context), null)
  for (const phase of ['reuse_eligibility', 'source_data', 'source_runtime', 'legacy_blob_allocation']) assert.ok(present(scan({ phase })))
})

test('a proven cancellation before execution is neutral and needs no source restoration', () => {
  const job = { status: 'cancelled', stage: 'cancelled', mode: 'rehearsal', cancel_requested: true,
    result: { source_untouched: true, source_restored: false } }
  const result = infinidyskV2JobPresentation(job)
  assert.equal(result.state, 'source_untouched'); assert.equal(result.tone, 'neutral')
  assert.equal(result.active, false); assert.equal(result.showProgress, false)
  assert.match(result.title, /cancelled before services were paused/)
  assert.match(result.next, /No source recovery is needed/)
  assert.doesNotMatch(result.title + result.message, /restored|failed/)
  assert.equal(infinidyskV2JobPresentation({ ...job, recovery_required: true }).state, 'recovery')
  const exposed = infinidyskV2JobPresentation({ ...job, activation_exposed: true })
  assert.notEqual(exposed.state, 'source_untouched'); assert.notEqual(exposed.state, 'restored')
})
