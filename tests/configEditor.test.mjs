import assert from 'node:assert/strict'
import test from 'node:test'

import { configUpdateErrorText, normalizeJsonEditorValue } from '../helper/configEditor.js'

test('normalizes JSON editor text-mode output to a structured value', () => {
  assert.deepEqual(
    normalizeJsonEditorValue('{"Preferences":{"@FriendlyName":"DUMB"}}'),
    { Preferences: { '@FriendlyName': 'DUMB' } },
  )
})

test('leaves JSON editor tree-mode output unchanged', () => {
  const value = { Preferences: { '@FriendlyName': 'DUMB' } }

  assert.equal(normalizeJsonEditorValue(value), value)
})

test('rejects invalid JSON editor text without returning a save payload', () => {
  assert.throws(
    () => normalizeJsonEditorValue('{not valid'),
    /Invalid JSON/,
  )
})

test('surfaces backend config rejection details from repository response objects', () => {
  assert.equal(
    configUpdateErrorText({ data: { detail: 'Guarded PostgreSQL cutover prevents this change.' } }),
    'Guarded PostgreSQL cutover prevents this change.',
  )
  assert.equal(
    configUpdateErrorText({ response: { data: { message: 'Invalid configuration.' } } }),
    'Invalid configuration.',
  )
})
