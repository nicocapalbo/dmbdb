import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardUpdateRows,
  dashboardInstallableNames,
  formatDashboardUpdateTiming,
  formatDashboardUpdateStatus,
  formatUpdateTiming,
  formatUpdateDuration,
  installCacheLimitGibFromStatus,
  mergeDashboardUpdateResult,
  mergeServiceUpdateOperation,
  normalizeInstallCacheLimitGib,
  orderDashboardInstallNames,
  reconcileDashboardUpdateRows,
  mergeUpdateTiming,
  serviceUpdateOperationBusy,
  serviceUpdateOperationFor,
} from '../helper/dashboardUpdates.js'

test('update timing formats total install time and observed downtime', () => {
  assert.equal(formatUpdateDuration(0.4), '<1s')
  assert.equal(formatUpdateDuration(97.4), '1m 37s')
  assert.equal(
    formatDashboardUpdateTiming({
      install_duration_seconds: 97.4,
      downtime_seconds: 21.6,
      downtime_status: 'completed',
    }),
    'Install 1m 37s · Downtime 22s',
  )
  assert.equal(
    formatDashboardUpdateTiming({
      install_duration_seconds: 130,
      downtime_seconds: 45,
      downtime_status: 'ongoing',
    }),
    'Install 2m 10s · Downtime at least 45s · readiness not confirmed',
  )
  assert.equal(
    formatDashboardUpdateTiming({
      install_duration_seconds: 12,
      downtime_seconds: 0,
      downtime_status: 'not_observed',
    }),
    'Install 12s · Downtime not observed',
  )
  assert.equal(
    formatUpdateTiming({
      install_duration_seconds: 97.4,
      downtime_seconds: 21.6,
      downtime_status: 'completed',
    }),
    'Install 1m 37s · Downtime 22s',
  )
})

test('per-service recheck retains timing from the completed install response', () => {
  assert.deepEqual(
    mergeUpdateTiming(
      {
        status: 'no_update',
        current_version: 'v0.10.0-rc.3-cf468605',
        available_version: 'v0.10.0-rc.3',
      },
      {
        status: 'updated',
        install_duration_seconds: 97.4,
        downtime_seconds: 21.6,
        downtime_status: 'completed',
        timing_completed_at: '2026-08-05T12:34:56+00:00',
      },
    ),
    {
      status: 'no_update',
      current_version: 'v0.10.0-rc.3-cf468605',
      available_version: 'v0.10.0-rc.3',
      install_duration_seconds: 97.4,
      downtime_seconds: 21.6,
      downtime_status: 'completed',
      timing_completed_at: '2026-08-05T12:34:56+00:00',
    },
  )
})

test('install cache limit helpers preserve valid GiB values and reject unsafe input', () => {
  assert.equal(installCacheLimitGibFromStatus({ max_size_bytes: 25 * (1024 ** 3) }), 25)
  assert.equal(installCacheLimitGibFromStatus({}, 12), 12)
  assert.equal(normalizeInstallCacheLimitGib('48.5'), 48.5)
  assert.equal(normalizeInstallCacheLimitGib(0), null)
  assert.equal(normalizeInstallCacheLimitGib(1025), null)
})

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

test('cached scheduled check-only results populate the pending update count', () => {
  const rows = createDashboardUpdateRows([
    {
      process_name: 'Radarr',
      config: {
        enabled: true,
        auto_update: true,
        auto_update_mode: 'check_only',
      },
      supports_manual_update: true,
      update_status: {
        status: 'update_available',
        current_version: '1.0.0',
        available_version: '1.1.0',
      },
    },
  ])

  assert.deepEqual(dashboardInstallableNames(rows), ['Radarr'])
  assert.equal(formatDashboardUpdateStatus(rows[0]), 'Update available')
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

test('inventory refresh preserves an in-flight install when the panel reopens', () => {
  const services = [{
    process_name: 'Pulsarr',
    config: { enabled: true },
    supports_manual_update: true,
    update_status: { status: 'scheduled' },
  }]
  const currentRows = mergeDashboardUpdateResult(
    createDashboardUpdateRows(services),
    'Pulsarr',
    { status: 'update_available', available_version: '0.17.4' },
    'installing',
  )

  const rows = reconcileDashboardUpdateRows(services, currentRows, true)

  assert.equal(rows[0].operation, 'installing')
  assert.equal(rows[0].update_status.status, 'update_available')
  assert.equal(formatDashboardUpdateStatus(rows[0]), 'Installing')
})

test('inventory refresh clears completed modal-local operations when idle', () => {
  const services = [{
    process_name: 'Pulsarr',
    config: { enabled: true },
    supports_manual_update: true,
    update_status: { status: 'updated' },
  }]
  const currentRows = mergeDashboardUpdateResult(
    createDashboardUpdateRows(services),
    'Pulsarr',
    { status: 'update_available' },
    'installing',
  )

  const rows = reconcileDashboardUpdateRows(services, currentRows, false)

  assert.equal(rows[0].operation, 'idle')
  assert.equal(rows[0].update_status.status, 'updated')
})

test('per-service update progress survives modal and service-page remounts', () => {
  const operations = mergeServiceUpdateOperation({}, 'NzbDAV', {
    operation: 'installing',
    progress: 'Installing update for NzbDAV...',
    update_status: { status: 'update_available', available_version: 'v0.10.0-rc.4' },
    started_at: 1785924000000,
  })

  const reattached = serviceUpdateOperationFor(operations, 'NzbDAV')
  assert.equal(serviceUpdateOperationBusy(reattached), true)
  assert.equal(reattached.operation, 'installing')
  assert.equal(reattached.progress, 'Installing update for NzbDAV...')
  assert.equal(reattached.update_status.available_version, 'v0.10.0-rc.4')
})

test('per-service update completion remains isolated by process name', () => {
  let operations = mergeServiceUpdateOperation({}, 'NzbDAV', {
    operation: 'installing',
  })
  operations = mergeServiceUpdateOperation(operations, 'Pulsarr', {
    operation: 'checking',
  })
  operations = mergeServiceUpdateOperation(operations, 'NzbDAV', {
    operation: 'idle',
    progress: '',
    update_status: {
      status: 'no_update',
      current_version: 'v0.10.0-rc.4-a1b2c3d4',
      install_duration_seconds: 42,
    },
    completed_at: 1785924042000,
  })

  assert.equal(serviceUpdateOperationBusy(serviceUpdateOperationFor(operations, 'NzbDAV')), false)
  assert.equal(serviceUpdateOperationFor(operations, 'NzbDAV').update_status.install_duration_seconds, 42)
  assert.equal(serviceUpdateOperationFor(operations, 'Pulsarr').operation, 'checking')
})
