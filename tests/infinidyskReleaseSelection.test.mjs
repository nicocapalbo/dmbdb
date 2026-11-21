import assert from 'node:assert/strict'
import test from 'node:test'
import { configuredSourceTargetInstalled, resolveConfiguredSourceTarget } from '../helper/configuredSourceTarget.js'

test('native InfiniDysk uses standard release controls and ignores dormant v1 source choices', () => {
  for (const serviceKey of ['infinidysk', 'nzbdav']) {
    const config = {
      runtime_generation: '2',
      release_version_enabled: true,
      release_version: 'v2.0.0-beta.10',
      branch_enabled: true,
      branch: 'old-v1-branch',
      commit_sha: 'a'.repeat(40),
    }
    const target = resolveConfiguredSourceTarget(config, serviceKey)
    assert.deepEqual(target, { kind: 'release', value: 'v2.0.0-beta.10', label: 'v2.0.0-beta.10' })
    assert.equal(configuredSourceTargetInstalled(target, null, '2.0.0-beta.10'), true)
    const builtTag = 'v2.0.0-beta.10+build.2'
    assert.deepEqual(resolveConfiguredSourceTarget({ ...config, release_version: builtTag }, serviceKey), {
      kind: 'release', value: builtTag, label: builtTag,
    })
    assert.equal(resolveConfiguredSourceTarget({ ...config, release_version_enabled: false }, serviceKey), null)
    for (const release_version of ['latest', '', 'v1.3.0', 'v3.0.0', 'nightly', 'v2.01.0', 'v2.0.0-beta.01', 'v2.0.0-beta..1', 'v2.0.0+' + 'a'.repeat(128)]) {
      assert.equal(resolveConfiguredSourceTarget({ ...config, release_version }, serviceKey), null)
    }
  }
})

test('older native backends keep their separate selector and ignore dormant standard controls', () => {
  const config = {
    runtime_generation: '2',
    v2_release_version: 'v2.0.0-beta.6',
    release_version_enabled: true,
    release_version: 'v1.2.0',
  }
  assert.deepEqual(resolveConfiguredSourceTarget(config, 'infinidysk'), {
    kind: 'release', value: 'v2.0.0-beta.6', label: 'v2.0.0-beta.6',
  })
  for (const v2_release_version of ['latest', '', 'v1.2.0']) {
    assert.equal(resolveConfiguredSourceTarget({ ...config, v2_release_version }, 'infinidysk'), null)
  }
})
