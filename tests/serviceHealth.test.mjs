import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeServiceHealthStatus,
  serviceHealthBadgeClass,
  serviceHealthLabel,
  serviceHealthTitle,
} from '../helper/serviceHealth.js'

test('normalizes structured and legacy health states', () => {
  assert.equal(normalizeServiceHealthStatus('degraded', true), 'degraded')
  assert.equal(normalizeServiceHealthStatus('starting', false), 'starting')
  assert.equal(normalizeServiceHealthStatus(null, true), 'healthy')
  assert.equal(normalizeServiceHealthStatus(null, false), 'unhealthy')
  assert.equal(normalizeServiceHealthStatus(null, null), null)
})

test('renders operator-facing labels and component detail', () => {
  const title = serviceHealthTitle(
    'degraded',
    'InfiniDysk reports Degraded',
    {
      probe: 'InfiniDysk backend health',
      components: [
        { name: 'database', status: 'healthy' },
        { name: 'providerPool', status: 'degraded' },
      ],
    },
  )

  assert.equal(serviceHealthLabel('degraded'), 'Degraded')
  assert.match(serviceHealthBadgeClass('starting'), /sky/)
  assert.match(title, /providerPool: degraded/)
  assert.match(title, /Probe: InfiniDysk backend health/)
})
