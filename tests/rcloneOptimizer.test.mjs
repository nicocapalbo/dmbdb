import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isNzbDavRcloneConfig,
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
