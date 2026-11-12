import assert from 'node:assert/strict'
import test from 'node:test'

import {
  actionableProjectNotices,
  compareProjectVersions,
  projectNoticeActionable,
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


test('known package versions use SemVer precedence and ignore build metadata', () => {
  for (const [left, right, expected] of [
    ['1.91.0', 'v1.92.0-dev.26', -1], ['V1.92.0', '1.92.0+build.1', 0],
    ['1.92.0', '1.92.0-dev.26', 1], ['1.92.0-dev.10', '1.92.0-dev.9', 1],
    ['1.92.0-alpha', '1.92.0-alpha.1', -1], ['2.0.0-1', '2.0.0-a', -1],
  ]) assert.equal(compareProjectVersions(left, right), expected, `${left} vs ${right}`)
  for (const value of ['1.02.0', '1.2', '1.2.0-dev.01', 'dev-abcdef', '', null]) {
    assert.equal(compareProjectVersions(value, '1.92.0'), null)
  }
})

test('older or equal ordinary stable notices do not advertise a frontend downgrade', () => {
  assert.equal(projectNoticeActionable({ available_version: 'v1.91.0' }, '1.92.0-dev.26'), false)
  assert.equal(projectNoticeActionable({ available_version: 'v1.92.0' }, '1.92.0'), false)
  assert.equal(projectNoticeActionable({ available_version: 'v1.92.0' }, '1.92.0-dev.26'), true)
  assert.equal(aboutUpdateLabel({ available_version: 'v1.91.0' }, '1.92.0'), '')
  assert.equal(projectNoticeForService([{ process_name: 'DUMB Frontend', available_version: '1.91.0' }], {
    process_name: 'DUMB Frontend', version: '1.92.0',
  }), null)
})

test('explicit pins and branch or commit updates remain actionable', () => {
  for (const kind of ['branch', 'commit', 'release', 'version']) {
    const notice = { available_version: '1.91.0', configured_target_kind: kind, configured_target_installed: false }
    assert.equal(projectNoticeActionable(notice, '1.92.0'), true, kind)
    assert.equal(projectNoticeActionable({ ...notice, configured_target_installed: true }, '1.92.0'), false, kind)
  }
  assert.equal(projectNoticeActionable({ available_version: 'dev-abcdef' }, '1.92.0'), true)
  assert.equal(projectNoticeActionable({ available_version: '1.92.0', configured_target_kind: 'branch' }, '1.92.0'), true)
  assert.equal(aboutUpdateLabel({ available_version: 'dev-abcdef' }, '1.92.0-dev.26'), 'Update available')
})

test('fresh installed process version filters stale notices without deleting history', () => {
  const available = { type: 'available', process_name: 'DUMB Frontend', current_version: '1.90.0', available_version: '1.91.0' }
  const info = { ...available, type: 'info', message: 'Manual target information' }
  const branch = { ...available, available_version: 'dev-fedcba' }
  const notices = [available, info, branch]
  const processes = [{ process_name: 'DUMB Frontend', version: '1.92.0' }]
  assert.deepEqual(actionableProjectNotices(notices, processes), [info, branch])
  assert.equal(notices.length, 3)
  assert.deepEqual(actionableProjectNotices(notices, []), notices)
})
