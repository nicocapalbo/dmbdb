import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isNzbDavRcloneConfig,
  retainedTraceSummary,
  rcloneOptimizerNotificationKind,
  warmColdStartupAverages,
} from '../helper/rcloneOptimizer.js'

test('optimizer is limited to NzbDAV-backed rclone services', () => {
  assert.equal(isNzbDavRcloneConfig('rclone', { key_type: 'NzbDAV' }), true)
  assert.equal(isNzbDavRcloneConfig('rclone', { key_type: 'RealDebrid' }), false)
  assert.equal(isNzbDavRcloneConfig('nzbdav', { key_type: 'nzbdav' }), false)
})

test('frontend only notifies on a newly observed completion or failure', () => {
  assert.equal(rcloneOptimizerNotificationKind('benchmarking', 'completed'), 'success')
  assert.equal(rcloneOptimizerNotificationKind('benchmarking', 'failed'), 'warning')
  assert.equal(rcloneOptimizerNotificationKind(null, 'completed'), null)
  assert.equal(rcloneOptimizerNotificationKind('completed', 'completed'), null)
})

test('warm and older startup measurements remain separate', () => {
  assert.deepEqual(warmColdStartupAverages([
    { scored: true, age_bucket: 'recent', startup_ms: 100 },
    { scored: true, age_bucket: 'recent', startup_ms: 200 },
    { scored: true, age_bucket: 'older', startup_ms: 900 },
    { scored: false, age_bucket: 'older', startup_ms: 1 },
  ]), { recent: 150, older: 900 })
})

test('retained provider traces are aggregated across candidate matches', () => {
  assert.deepEqual(retainedTraceSummary({
    stream_traces: [
      {
        providers: ['primary', 'backup'],
        retries: 1,
        bytes_served: 1024,
        provider_wait_ms: 20,
        connection_wait_ms: 3,
      },
      {
        providers: ['primary'],
        retries: 2,
        bytes_served: 2048,
        provider_wait_ms: 40,
        connection_wait_ms: 5,
      },
    ],
  }), {
    available: true,
    matched: 2,
    providers: 'primary, backup',
    retries: 3,
    bytesServed: 3072,
    providerWaitMs: 60,
    connectionWaitMs: 8,
  })
})

test('retained provider fields remain explicit when no trace matched', () => {
  assert.deepEqual(retainedTraceSummary({ stream_traces: [] }), {
    available: false,
    matched: 0,
    providers: 'not available',
    retries: 0,
    bytesServed: 0,
    providerWaitMs: 0,
    connectionWaitMs: 0,
  })
})
