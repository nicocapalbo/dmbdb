import assert from 'node:assert/strict'
import test from 'node:test'
import {
  setupChecklistActions,
  setupChecklistFilteredActions,
  setupChecklistGroups,
  setupChecklistSummary,
} from '../helper/setupChecklistPresentation.js'

const action = (id, extra = {}) => ({ id, label: id, service_key: 'infinidysk', required: true, automation: 'after_input', execution: 'waiting_input', verification: 'not_checked', ...extra })

test('checklist attention keeps unverified, deferred and failed work while distinguishing manual confirmations', () => {
  const actions = [
    action('needs-input'),
    action('saved-unchecked', { execution: 'applied' }),
    action('later', { deferred_by_user: true }),
    action('failed-optional', { execution: 'failed', required: false }),
    action('manual-then-failed', { execution: 'user_confirmed', verification: 'failed' }),
    action('verified', { execution: 'already_present', verification: 'passed' }),
    action('confirmed', { execution: 'user_confirmed', evidence: { level: 'user_attested' } }),
    action('not-needed', { execution: 'not_applicable', required: false }),
    action('optional-check', { explicit_only: true, required: false }),
  ]
  const before = structuredClone(actions)
  assert.deepEqual(setupChecklistSummary(actions), { total: 9, remaining: 6, required: 4, optional: 2, verified: 1, manual: 1, notRequired: 1 })
  assert.deepEqual(setupChecklistFilteredActions(actions).map(item => item.id), ['needs-input', 'saved-unchecked', 'later', 'failed-optional', 'manual-then-failed', 'optional-check'])
  assert.deepEqual(setupChecklistFilteredActions(actions, 'checked').map(item => item.id), ['verified', 'confirmed'])
  assert.deepEqual(setupChecklistFilteredActions(actions, 'all'), actions)
  assert.deepEqual(actions, before, 'Browsing a checklist must preserve authoritative task results')
})

test('service checklists retain incoming links and explicit checks without leaking another instance', () => {
  const incoming = action('incoming', { service_key: 'seerr', source: 'seerr.Requests', instance_key: 'Requests', target: 'sonarr.Series', target_instance_key: 'Series' })
  const series = action('series', { service_key: 'sonarr', source: 'sonarr.Series', instance_key: 'sonarr.Series', explicit_only: true })
  const run = { actions: [
    incoming, series,
    action('4k', { service_key: 'sonarr', source: 'sonarr.4K', instance_key: '4K' }),
    action('internal', { internal: true }),
  ] }
  const before = structuredClone(run)
  const scoped = setupChecklistActions(run, { serviceKey: 'sonarr', instanceKey: 'Series' })
  assert.deepEqual(scoped.map(item => item.id), ['incoming', 'series'])
  assert.deepEqual(setupChecklistActions(run, { serviceKey: 'sonarr', instanceKey: '4K' }).map(item => item.id), ['4k'])
  assert.equal(setupChecklistGroups(scoped)[0].key, 'seerr.Requests', 'An incoming connection keeps the app that owns its configuration')
  assert.deepEqual(run, before)
})

test('app groups normalize legacy instance identities and use saved process names', () => {
  const groups = setupChecklistGroups([
    action('one', { service_key: 'sonarr', instance_key: 'sonarr.Series' }),
    action('two', { service_key: 'sonarr', instance_key: 'Series', execution: 'applied', verification: 'passed' }),
    action('three', { service_key: 'sonarr', instance_key: '4K' }),
    action('provider'),
  ], [
    { id: 'sonarr.Series', service_key: 'sonarr', instance_key: 'Series', process_name: 'Sonarr Series' },
    { id: 'sonarr.4K', service_key: 'sonarr', instance_key: '4K', process_name: 'Sonarr 4K' },
  ])
  assert.deepEqual(groups.map(group => [group.key, group.label, group.actions.map(item => item.id)]), [
    ['sonarr.Series', 'Sonarr Series', ['one', 'two']],
    ['sonarr.4K', 'Sonarr 4K', ['three']],
    ['infinidysk', 'InfiniDysk', ['provider']],
  ])
  assert.equal(groups[0].summary.remaining, 1)
  assert.equal(groups[0].summary.verified, 1)
})

test('empty setup results remain empty without manufacturing completed work', () => {
  assert.deepEqual(setupChecklistActions(), [])
  assert.deepEqual(setupChecklistGroups(), [])
  assert.deepEqual(setupChecklistFilteredActions(), [])
  assert.deepEqual(setupChecklistSummary(), { total: 0, remaining: 0, required: 0, optional: 0, verified: 0, manual: 0, notRequired: 0 })
})
