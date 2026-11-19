import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SETUP_WALKTHROUGH_STORAGE_KEY, setupWalkthroughOutcome, setupWalkthroughActions,
  setupWalkthroughPrerequisites, setupWalkthroughSummary, setupWalkthroughPreference,
  readSetupWalkthroughPreference, writeSetupWalkthroughPreference,
  setupWalkthroughInstructions,
} from '../helper/setupWalkthrough.js'

const action = (id, extra = {}) => ({ id, label: id, automation: 'after_input', required: true, execution: 'waiting_input', verification: 'not_checked', ...extra })

test('manual instructions stay readable without repeating the action reason or inventing steps', () => {
  assert.deepEqual(setupWalkthroughInstructions({ reason: 'Sign in to the app.', instructions: [' Sign in to the app. ', 'Choose your server.', 'Choose your server.', null, { text: 'unsupported' }] }), ['Choose your server.'])
  assert.deepEqual(setupWalkthroughInstructions({ instructions: 'Open the app.\n\nChoose your library.\r\nReturn to DUMB.' }), ['Open the app.', 'Choose your library.', 'Return to DUMB.'])
  assert.deepEqual(setupWalkthroughInstructions({}), [])
})

test('walkthrough orders the retained prerequisites before consumers without inventing integration steps', () => {
  const run = { actions: [
    action('requests', { prerequisites: ['profiles'] }),
    action('profiles', { prerequisites: ['arr-ready'] }),
    action('arr-ready', { prerequisites: ['provider'] }),
    action('provider', { prerequisites: ['account'] }),
    action('account'),
  ] }
  assert.deepEqual(setupWalkthroughActions(run).map(item => item.id), ['account', 'provider', 'arr-ready', 'profiles', 'requests'])
  assert.equal(run.actions[0].id, 'requests', 'Presentation must not reorder the authoritative run object')
})

test('manual confirmations and saved-but-unchecked configuration never become verified connections', () => {
  assert.equal(setupWalkthroughOutcome(action('ready', { execution: 'already_present', verification: 'passed' })).verified, true)
  assert.equal(setupWalkthroughOutcome(action('applied', { execution: 'applied' })).complete, false)
  const manual = setupWalkthroughOutcome(action('manual', { execution: 'applied', verification: 'passed', evidence: { level: 'user_attested' } }))
  assert.equal(manual.manual, true)
  assert.equal(manual.verified, false)
  assert.equal(manual.complete, false)
  assert.equal(manual.resolved, true, 'A recorded confirmation can be reviewed without claiming automatic verification')
  const failedManual = setupWalkthroughOutcome(action('manual-failure', { execution: 'user_confirmed', verification: 'failed' }))
  assert.equal(failedManual.state, 'failed')
  assert.equal(failedManual.resolved, false, 'A failed check needs attention even after an earlier attestation')
  assert.equal(setupWalkthroughOutcome(action('process-only', { execution: 'running' })).complete, false)
})

test('required deferred steps remain unfinished and optional checks require a separate opt-in', () => {
  const run = { actions: [
    action('checked', { execution: 'applied', verification: 'passed' }),
    action('not-needed', { execution: 'not_applicable' }),
    action('manual', { execution: 'user_confirmed' }),
    action('later', { execution: 'waiting_input', deferred_by_user: true, reason: 'A required connection is left for later.' }),
    action('sample', { explicit_only: true, required: false }),
  ] }
  const summary = setupWalkthroughSummary(run)
  assert.equal(summary.total, 4)
  assert.equal(summary.verified, 1)
  assert.equal(summary.notRequired, 1)
  assert.equal(summary.manual, 1)
  assert.equal(summary.deferred, 1)
  assert.equal(summary.requiredRemaining, 1)
  assert.deepEqual(summary.remaining.map(item => item.action.id), ['later'])
  assert.deepEqual(summary.confirmations.map(item => item.action.id), ['manual'])
  assert.equal(setupWalkthroughActions(run, { includeOptionalChecks: true }).length, 5)
  assert.equal(run.actions[4].execution, 'waiting_input', 'Including a test must not execute or confirm it')
  const confirmed = setupWalkthroughSummary({ actions: [action('manual', { execution: 'user_confirmed' })] })
  assert.equal(confirmed.remaining.length, 0, 'Reopening the guide must not repeat an already attested task as outstanding')
  assert.equal(confirmed.verified, 0)
  assert.equal(confirmed.confirmations.length, 1)
  const failed = setupWalkthroughSummary({ actions: [action('manual', { execution: 'user_confirmed', verification: 'failed' })] })
  assert.equal(failed.requiredRemaining, 1, 'A failed check is still outstanding after a manual attestation')
  assert.equal(setupWalkthroughOutcome(action('optional-declined', { required: false, execution: 'declined' })).state, 'deferred', 'Existing optional deferrals use declined even without the new marker')
  assert.equal(setupWalkthroughOutcome(action('retry', { execution: 'waiting_input', deferred_by_user: false })).state, 'input', 'An explicit retry clears the deferral and returns the step to active review')
  assert.equal(setupWalkthroughOutcome(action('failed-defer', { execution: 'failed', deferred_by_user: true })).state, 'failed', 'A deferral marker must not conceal a failed check')
})

test('cycle and missing-prerequisite metadata stays visible rather than fabricating readiness', () => {
  const run = { actions: [action('first', { prerequisites: ['second'] }), action('second', { prerequisites: ['first', 'missing'] })] }
  assert.deepEqual(setupWalkthroughActions(run).map(item => item.id), ['first', 'second'])
  const prerequisites = setupWalkthroughPrerequisites(run.actions[1], run)
  assert.equal(prerequisites[0].ready, false)
  assert.equal(prerequisites[1].known, false)
  assert.equal(prerequisites[1].ready, false)
  assert.doesNotMatch(prerequisites[1].label, /missing/)
  const manual = action('manual', { execution: 'user_confirmed' })
  assert.equal(setupWalkthroughPrerequisites(action('consumer', { prerequisites: ['manual'] }), { actions: [manual] })[0].ready, false,
    'Manual confirmation can resolve guide navigation without authorizing a dependent action')
})

test('service scoping includes exact source and target connections without sibling leakage', () => {
  const run = { actions: [
    action('main', { source: 'sonarr.Series', service_key: 'sonarr', instance_key: 'Series' }),
    action('other', { source: 'sonarr.4K', service_key: 'sonarr', instance_key: '4K' }),
    action('request-link', { source: 'seerr.Requests', service_key: 'seerr', target: 'sonarr.Series' }),
    action('other-workflow', { source: 'sonarr.4K', service_key: 'sonarr', instance_key: '4K', explicit_only: true }),
    action('main-workflow', { source: 'sonarr.Series', service_key: 'sonarr', instance_key: 'Series', explicit_only: true }),
  ] }
  assert.deepEqual(setupWalkthroughActions(run, { serviceKey: 'sonarr', instanceKey: 'Series' }).map(item => item.id), ['main', 'request-link'])
  assert.deepEqual(setupWalkthroughActions(run, { serviceKey: 'sonarr', instanceKey: 'Series', includeOptionalChecks: true }).map(item => item.id), ['main', 'request-link', 'main-workflow'])
})

test('resume metadata stores only valid run/action navigation and never credential-bearing form values', () => {
  const run = { run_id: 'run-one', actions: [action('seerr::arr_connections')], values: { password: 'private-run-secret' } }
  const storage = new Map()
  const adapter = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  const saved = writeSetupWalkthroughPreference(adapter, run, {
    runId: 'run-one', activeActionId: 'seerr::arr_connections', paused: true, includeOptionalChecks: false,
    password: 'private-form-secret', values: run.values, endpoint: 'https://private.example.invalid',
  })
  assert.deepEqual(readSetupWalkthroughPreference(adapter, run), saved)
  assert.doesNotMatch(storage.get(SETUP_WALKTHROUGH_STORAGE_KEY), /private|password|endpoint|values/)
  assert.equal(setupWalkthroughPreference({ ...saved, activeActionId: 'unknown' }, run).activeActionId, null)
  assert.deepEqual(readSetupWalkthroughPreference(adapter, { ...run, run_id: 'another-run' }), {
    runId: 'another-run', activeActionId: null, paused: false, includeOptionalChecks: false,
  })
})

test('unavailable browser storage cannot discard the authoritative run or prevent navigation', () => {
  const run = { run_id: 'run-one', actions: [action('provider')] }
  const denied = { getItem() { throw new Error('Storage unavailable') }, setItem() { throw new Error('Storage unavailable') } }
  assert.equal(readSetupWalkthroughPreference(denied, run).runId, 'run-one')
  const preference = writeSetupWalkthroughPreference(denied, run, { runId: 'run-one', activeActionId: 'provider', paused: true })
  assert.equal(preference.activeActionId, 'provider')
  assert.equal(preference.paused, true)
  assert.equal(run.actions[0].execution, 'waiting_input')
})
