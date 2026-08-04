import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardUpdateRows,
  dashboardInstallableNames,
  formatDashboardUpdateStatus,
  mergeDashboardUpdateResult,
  orderDashboardInstallNames,
} from '../helper/dashboardUpdates.js'

test('dashboard inventory includes only enabled update-capable services', () => {
  const rows = createDashboardUpdateRows([
    {
      process_name: 'Radarr',
      config_key: 'radarr',
      config: { enabled: true },
      supports_manual_update: true,
    },
    {
      process_name: 'Disabled Sonarr',
      config: { enabled: false },
      supports_manual_update: true,
    },
    {
      process_name: 'PostgreSQL',
      config: { enabled: true },
      supports_manual_update: false,
    },
  ])

  assert.deepEqual(rows.map((row) => row.process_name), ['Radarr'])
  assert.equal(formatDashboardUpdateStatus(rows[0]), 'Not checked')
})

test('bulk selection excludes blocked source targets', () => {
  let rows = createDashboardUpdateRows([
    {
      process_name: 'Radarr',
      config: { enabled: true },
      supports_manual_update: true,
    },
    {
      process_name: 'NzbDAV',
      config: { enabled: true },
      supports_manual_update: true,
    },
  ])
  rows = mergeDashboardUpdateResult(rows, 'Radarr', { status: 'update_available' })
  rows = mergeDashboardUpdateResult(rows, 'NzbDAV', { status: 'blocked', reason: 'commit' })

  assert.deepEqual(dashboardInstallableNames(rows), ['Radarr'])
  assert.equal(formatDashboardUpdateStatus(rows[1]), 'Review source')
})

test('bulk install order updates the frontend and API last', () => {
  const rows = [
    { process_name: 'DUMB API', config_key: 'dumb' },
    { process_name: 'DUMB Frontend', config_key: 'dumb_frontend' },
    { process_name: 'Radarr', config_key: 'radarr' },
  ]

  assert.deepEqual(
    orderDashboardInstallNames(rows.map((row) => row.process_name), rows),
    ['Radarr', 'DUMB Frontend', 'DUMB API'],
  )
})

test('deferred protected updates get an operator-facing status', () => {
  assert.equal(formatDashboardUpdateStatus({
    operation: 'deferred',
    update_status: { status: 'protection_required' },
  }), 'Protected · deferred')
})
