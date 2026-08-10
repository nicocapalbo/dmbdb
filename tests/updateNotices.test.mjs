import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aboutUpdateLabel,
  isDevelopmentVersion,
  projectNoticeForService,
  projectServiceKind,
  releaseDistanceLabel,
} from '../helper/updateNotices.js'

test('release distance labels singular and plural counts', () => {
  assert.equal(releaseDistanceLabel({ releases_behind: 1 }), '1 release behind')
  assert.equal(releaseDistanceLabel({ releases_behind: 4 }), '4 releases behind')
})

test('release distance stays hidden when unavailable or current', () => {
  assert.equal(releaseDistanceLabel({}), '')
  assert.equal(releaseDistanceLabel({ releases_behind: 0 }), '')
  assert.equal(releaseDistanceLabel({ releases_behind: 'unknown' }), '')
})

test('project services map to API and frontend update notices', () => {
  const notices = [
    { process_name: 'DUMB API', available_version: 'v2.14.0' },
    { process_name: 'dumb frontend', available_version: 'v1.80.0' },
  ]

  assert.equal(projectServiceKind({ process_name: 'DUMB API' }), 'api')
  assert.equal(projectServiceKind({ process_name: 'DUMB Frontend' }), 'frontend')
  assert.equal(projectServiceKind({ process_name: 'Bazarr' }), '')
  assert.equal(projectNoticeForService(notices, { config_key: 'dumb_frontend' }), notices[1])
  assert.equal(projectNoticeForService(notices, { config_key: 'dumb' }), notices[0])
})

test('about labels distinguish release distance and development builds', () => {
  assert.equal(isDevelopmentVersion('v2.14.0-dev.1'), true)
  assert.equal(isDevelopmentVersion('v2.14.0'), false)
  assert.equal(
    aboutUpdateLabel({ releases_behind: 2 }, 'v1.78.0'),
    'Update available · 2 releases behind',
  )
  assert.equal(
    aboutUpdateLabel({ available_version: 'v2.14.0' }, 'v2.14.0-dev.1'),
    'Stable release available',
  )
})
