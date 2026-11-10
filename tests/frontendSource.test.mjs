import test from 'node:test'
import assert from 'node:assert/strict'
import { frontendBuildDisplay } from '../helper/frontendSource.js'

const source = { schema_version: 1, repository: 'nicocapalbo/dmbdb', source_kind: 'branch', requested_ref: 'dev', commit_sha: 'a'.repeat(40), package_version: '1.91.0' }
const frontend = installed_source => [{ config_key: 'dumb_frontend', installed_source }]
const release = { label: 'v1.91.0', title: '' }

test('older APIs and ordinary releases preserve the package version label', () => {
  for (const rows of [undefined, {}, [], frontend(null), [{ config_key: 'other', installed_source: source }]]) {
    assert.deepEqual(frontendBuildDisplay('1.91.0', rows), release)
  }
  assert.deepEqual(frontendBuildDisplay('1.91.0', frontend({ ...source, source_kind: 'release', requested_ref: 'v1.91.0' })), release)
})

test('validated installed dev identity is independent of disabled or conflicting saved selectors', () => {
  const rows = frontend(source)
  rows[0].config = { branch_enabled: false, branch: 'main', release_version_enabled: true, release_version: 'v1.2.0', commit_sha: 'b'.repeat(40) }
  assert.deepEqual(frontendBuildDisplay('1.91.0', rows), { label: 'v1.91.0 · dev aaaaaaaa', title: `dev · ${'a'.repeat(40)}` })
})

test('commit and branch builds identify the installed SHA without changing the package version', () => {
  assert.deepEqual(frontendBuildDisplay('1.91.0', frontend({ ...source, source_kind: 'commit', requested_ref: 'b'.repeat(40) })), { label: 'v1.91.0 · commit aaaaaaaa', title: `commit · ${'a'.repeat(40)}` })
  assert.equal(frontendBuildDisplay('1.91.0', frontend({ ...source, requested_ref: 'feature/example' })).label, 'v1.91.0 · feature/example aaaaaaaa')
})

test('invalid, unsupported or differently versioned provenance never labels the served build', () => {
  for (const changes of [
    { schema_version: 2 }, { schema_version: '1' }, { repository: 'other/repository' },
    { source_kind: 'dev' }, { commit_sha: 'a'.repeat(8) }, { commit_sha: 'g'.repeat(40) }, { commit_sha: 'a'.repeat(40) + '\n' },
    { package_version: '1.92.0' }, { package_version: 1.91 }, { requested_ref: '' },
    { requested_ref: 'dev\nother' }, { requested_ref: 'a'.repeat(161) },
  ]) assert.deepEqual(frontendBuildDisplay('1.91.0', frontend({ ...source, ...changes })), release)
})

test('runtime replacement or invalidated metadata removes the previous baked identity', () => {
  const rows = frontend(source)
  assert.match(frontendBuildDisplay('1.91.0', rows).label, /dev aaaaaaaa$/)
  rows[0].installed_source = null
  assert.deepEqual(frontendBuildDisplay('1.91.0', rows), release)
  rows[0].installed_source = { ...source, commit_sha: 'b'.repeat(40) }
  assert.match(frontendBuildDisplay('1.91.0', rows).label, /dev bbbbbbbb$/)
})
