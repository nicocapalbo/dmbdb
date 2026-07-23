import assert from 'node:assert/strict'
import test from 'node:test'

import {
  plexComponentCount,
  plexStatusLabel,
  plexStatusState,
} from '../helper/plexStatus.js'

test('plexStatusState distinguishes disabled, stale, operational, and incident samples', () => {
  assert.equal(plexStatusState({ enabled: false }), 'disabled')
  assert.equal(plexStatusState({ enabled: true, available: false, refreshing: true }), 'collecting')
  assert.equal(plexStatusState({ enabled: true, available: false }), 'unavailable')
  assert.equal(plexStatusState({ enabled: true, available: true, stale: true }), 'stale')
  assert.equal(plexStatusState({ enabled: true, available: true, operational: true }), 'operational')
  assert.equal(plexStatusState({ enabled: true, available: true, operational: false }), 'incident')
})

test('plexStatusLabel uses the normalized description for incidents', () => {
  assert.equal(
    plexStatusLabel({
      enabled: true,
      available: true,
      operational: false,
      description: 'Minor Service Outage',
    }),
    'Minor Service Outage',
  )
})

test('plexComponentCount sums normalized component status counts', () => {
  assert.equal(plexComponentCount({
    component_status_counts: {
      operational: 24,
      partial_outage: 2,
    },
  }), 26)
})
