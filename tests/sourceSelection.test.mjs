import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeReleaseSelection,
  sourceOptionUpdates,
} from '../helper/sourceSelection.js'

test('normalizes an enabled blank release selector to latest without mutating input', () => {
  const input = { release_version_enabled: true, release_version: '   ' }

  const normalized = normalizeReleaseSelection(input)

  assert.deepEqual(normalized, {
    release_version_enabled: true,
    release_version: 'latest',
  })
  assert.equal(input.release_version, '   ')
})

test('preserves explicit release selectors and disabled blank fields', () => {
  const fixed = { release_version_enabled: true, release_version: 'v1.1.0' }
  const disabled = { release_version_enabled: false, release_version: '' }

  assert.equal(normalizeReleaseSelection(fixed), fixed)
  assert.equal(normalizeReleaseSelection(disabled), disabled)
})

test('enabling releases seeds latest when the current release field is blank', () => {
  assert.deepEqual(
    sourceOptionUpdates('release_version_enabled', true, { release_version: '' }),
    {
      release_version_enabled: true,
      release_version: 'latest',
      commit_sha: '',
      branch_enabled: false,
    },
  )
})

test('enabling releases preserves an explicit release target', () => {
  assert.deepEqual(
    sourceOptionUpdates('release_version_enabled', true, { release_version: 'v1.1.0' }),
    {
      release_version_enabled: true,
      commit_sha: '',
      branch_enabled: false,
    },
  )
})
