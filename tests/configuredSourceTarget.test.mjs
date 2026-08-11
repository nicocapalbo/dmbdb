import test from 'node:test'
import assert from 'node:assert/strict'

import {
  configuredSourceTargetInstalled,
  resolveConfiguredSourceTarget,
} from '../helper/configuredSourceTarget.js'

test('resolves a fixed release even when the retained update status is stale', () => {
  const target = resolveConfiguredSourceTarget({
    release_version_enabled: true,
    release_version: 'v1.81.0',
    branch_enabled: false,
  }, 'dumb_frontend')

  assert.deepEqual(target, { kind: 'release', value: 'v1.81.0', label: 'v1.81.0' })
  assert.equal(configuredSourceTargetInstalled(target, { status: 'error' }, 'v1.82.0'), false)
})

test('resolves an enabled branch without requiring an update-check payload', () => {
  const target = resolveConfiguredSourceTarget({
    branch_enabled: true,
    branch: 'dev',
    release_version_enabled: false,
  }, 'dumb_frontend')

  assert.deepEqual(target, { kind: 'branch', value: 'dev', label: 'dev' })
  assert.equal(configuredSourceTargetInstalled(target, null, 'v1.82.0'), false)
})

test('does not treat moving release channels as configured pins', () => {
  for (const release of ['latest', 'prerelease', 'nightly']) {
    assert.equal(resolveConfiguredSourceTarget({
      release_version_enabled: true,
      release_version: release,
    }, 'dumb_frontend'), null)
  }

  assert.equal(resolveConfiguredSourceTarget({
    release_version_enabled: true,
    release_version: 'dev',
  }, 'nzbdav'), null)
})

test('recognizes an installed fixed release independent of a leading v', () => {
  const target = resolveConfiguredSourceTarget({
    release_version_enabled: true,
    release_version: 'v1.81.0',
  }, 'dumb_frontend')

  assert.equal(configuredSourceTargetInstalled(target, null, '1.81.0'), true)
})

test('accepts branch installed state only for the selected branch marker', () => {
  const target = resolveConfiguredSourceTarget({
    branch_enabled: true,
    branch: 'dev',
  }, 'dumb_frontend')

  assert.equal(configuredSourceTargetInstalled(target, {
    configured_target_kind: 'branch',
    configured_target_installed: true,
    current_version: 'dev-abcdef12',
    available_version: 'dev-abcdef12',
  }), true)
  assert.equal(configuredSourceTargetInstalled(target, {
    configured_target_kind: 'branch',
    configured_target_installed: true,
    current_version: 'main-abcdef12',
    available_version: 'main-abcdef12',
  }), false)
})
