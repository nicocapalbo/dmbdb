import assert from 'node:assert/strict'
import test from 'node:test'

import {
  databaseProbeLatency,
  databaseSignalCount,
  databaseSize,
  databaseWalSize,
  nextDatabaseHealthSort,
  sortDatabaseHealthServices,
} from '../helper/databaseHealthSort.js'

const MIB = 1024 * 1024
const GIB = 1024 * MIB

const services = [
  {
    id: 'alpha',
    process_name: 'Example Alpha',
    provider: 'sqlite',
    pressure: 'healthy',
    score: 3,
    recommendation: 'Keep observing',
    databases: [
      { size_bytes: 4 * GIB, wal_size_bytes: 42 * MIB, probe_ms: 2.3 },
      { size_bytes: 300 * MIB, wal_size_bytes: 0, probe_ms: 1.1 },
    ],
    log_signals: { locked: 1, timeout: 1 },
  },
  {
    id: 'beta',
    process_name: 'Example Beta',
    provider: 'postgresql',
    pressure: 'critical',
    score: 80,
    recommendation: 'Review immediately',
    databases: [{ size_bytes: 441 * MIB, probe_ms: 11.6 }],
    log_signals: { busy: 5, deadlock: 3 },
  },
  {
    id: 'gamma',
    process_name: 'Example Gamma',
    provider: 'postgresql',
    pressure: 'high',
    score: 50,
    recommendation: 'Check storage',
    databases: [{ size_bytes: 8.2 * GIB, wal_size_bytes: 0, probe_ms: null }],
    log_signals: { io_error: 1 },
  },
  {
    id: 'delta',
    process_name: 'Example Delta',
    provider: 'custom-store',
    pressure: 'high',
    score: 60,
    recommendation: 'Check storage',
    databases: [],
    log_signals: {},
  },
]

const sortedIds = (key, direction) => (
  sortDatabaseHealthServices(services, key, direction).map((service) => service.id)
)

test('aggregates the same raw Database Health values used by the table', () => {
  assert.equal(databaseSize(services[0]), (4 * GIB) + (300 * MIB))
  assert.equal(databaseWalSize(services[0]), 42 * MIB)
  assert.equal(databaseSignalCount(services[1]), 8)
  assert.equal(databaseProbeLatency(services[0]), 2.3)
  assert.equal(databaseProbeLatency(services[2]), null)
})

test('sorts byte and latency columns numerically with missing values last', () => {
  assert.deepEqual(sortedIds('store_size', 'desc'), ['gamma', 'alpha', 'beta', 'delta'])
  assert.deepEqual(sortedIds('store_size', 'asc'), ['beta', 'alpha', 'gamma', 'delta'])
  assert.deepEqual(sortedIds('wal', 'asc'), ['gamma', 'alpha', 'beta', 'delta'])
  assert.deepEqual(sortedIds('probe', 'desc'), ['beta', 'alpha', 'delta', 'gamma'])
})

test('sorts pressure by severity and score and signals by combined count', () => {
  assert.deepEqual(sortedIds('pressure', 'desc'), ['beta', 'delta', 'gamma', 'alpha'])
  assert.deepEqual(sortedIds('signals', 'desc'), ['beta', 'alpha', 'gamma', 'delta'])
})

test('sorts text columns case-insensitively and uses service names as stable ties', () => {
  assert.deepEqual(sortedIds('service', 'asc'), ['alpha', 'beta', 'delta', 'gamma'])
  assert.deepEqual(sortedIds('provider', 'asc'), ['delta', 'beta', 'gamma', 'alpha'])
  assert.deepEqual(sortedIds('recommendation', 'asc'), ['delta', 'gamma', 'alpha', 'beta'])
})

test('defaults new numeric sorts descending and toggles an active column', () => {
  assert.deepEqual(nextDatabaseHealthSort('service', 'asc', 'store_size'), {
    key: 'store_size',
    direction: 'desc',
  })
  assert.deepEqual(nextDatabaseHealthSort('store_size', 'desc', 'store_size'), {
    key: 'store_size',
    direction: 'asc',
  })
  assert.deepEqual(nextDatabaseHealthSort('pressure', 'desc', 'provider'), {
    key: 'provider',
    direction: 'asc',
  })
})
