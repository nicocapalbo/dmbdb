import test from 'node:test'
import assert from 'node:assert/strict'
import { setupReviewServiceGroups, setupReviewServicePurpose, setupReviewBlockingChecks, setupReviewBlocker, setupReviewRemainingActions } from '../helper/setupReviewPresentation.js'

test('review separates chosen apps, supporting dependencies and external apps without changing the plan', () => {
  const services = [
    { id: 'plex', service_key: 'plex', name: 'Plex', selected: true },
    { id: 'postgres', name: 'PostgreSQL', required: true },
    { id: 'infinidysk', service_key: 'infinidysk', name: 'InfiniDysk', selection_kind: 'chosen' },
    { id: 'external', name: 'Existing Jellyfin', external: true, selected: true },
    { id: 'rclone', name: 'Rclone' },
  ]
  const original = structuredClone(services)
  const groups = setupReviewServiceGroups(services)
  assert.deepEqual(groups.chosen.map(service => service.id), ['infinidysk', 'plex'])
  assert.deepEqual(groups.required.map(service => service.id), ['postgres'])
  assert.deepEqual(groups.external.map(service => service.id), ['external'])
  assert.deepEqual(groups.companions.map(service => service.id), ['rclone'])
  assert.equal(setupReviewServicePurpose(groups.chosen[1]), 'Lets you browse and play your library')
  assert.deepEqual(services, original)
})

test('only a confirmed critical failure blocks start, not deferred or unknown checks', () => {
  const plan = { checks: [
    { key: 'storage:bazarr:0', critical: true, ok: false },
    { key: 'media', critical: false, ok: false },
    { key: 'unknown', critical: true, ok: null },
    { key: 'ready', critical: true, ok: true },
  ] }
  assert.deepEqual(setupReviewBlockingChecks(plan), [plan.checks[0]])
  assert.deepEqual(setupReviewBlockingChecks(null), [])
})

test('folder permission failures tell the operator what to fix without making them a connection choice', () => {
  const check = { key: 'storage:bazarr:0', resource_id: 'bazarr', label: 'Writable configuration: /example' }
  const result = setupReviewBlocker(check, [{ id: 'bazarr', name: 'Bazarr' }])
  assert.match(result.title, /Bazarr/)
  assert.match(result.explanation, /installation or storage-permissions/)
  assert.match(result.next, /person who manages/)
  assert.doesNotMatch(Object.values(result).join(' '), /UID|GID|supplementary ACL/)
})

test('pending required and optional work stays separate from supported automatic actions', () => {
  const actions = [
    { id: 'automatic', automation: 'automatic', execution: 'planned' },
    { id: 'ready-input', automation: 'after_input', missing_inputs: [], execution: 'planned' },
    { id: 'explicit-ready-test', automation: 'after_input', missing_inputs: [], execution: 'planned', explicit_only: true },
    { id: 'required-input', automation: 'after_input', required: true, execution: 'waiting_input' },
    { id: 'optional-test', automation: 'after_input', required: false, execution: 'waiting_input' },
    { id: 'unsupported', automation: 'manual', declared_automation: 'automatic', execution: 'pending' },
    { id: 'done', automation: 'manual', execution: 'user_confirmed' },
    { id: 'native-before-start', kind: 'native_transition', automation: 'manual', required: true, execution: 'waiting_input' },
  ]
  assert.deepEqual(setupReviewRemainingActions({ actions }).map(action => action.id), ['explicit-ready-test', 'required-input', 'optional-test', 'unsupported'])
})
