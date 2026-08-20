import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isValidAioStreamsAdminCredentials,
  validateAioStreamsAdminCredentials,
  isValidAioStreamsBaseUrl,
  validateAioStreamsBaseUrl,
} from '../helper/aiostreams.js'

test('accepts HTTPS AIOStreams origins and HTTP loopback development URLs', () => {
  for (const value of [
    'https://streams.example.com',
    'http://localhost:3006',
    'http://127.0.0.1:3006',
    'http://aiostreams.localhost:3006',
  ]) {
    assert.equal(isValidAioStreamsBaseUrl(value), true, value)
  }
})

test('rejects unsafe or incomplete AIOStreams BASE_URL values', () => {
  const invalid = [
    '',
    '/ui/aiostreams',
    'ftp://streams.example.com',
    'http://streams.example.com',
    'https://user:password@streams.example.com',
    'https://streams.example.com?token=example',
    'https://streams.example.com#dashboard',
  ]

  for (const value of invalid) {
    const result = validateAioStreamsBaseUrl(value)
    assert.equal(result.valid, false, value)
    assert.ok(result.message, value)
  }
})

test('accepts valid AIOStreams administrator credentials', () => {
  assert.equal(
    isValidAioStreamsAdminCredentials('admin', 'correct-horse-battery-staple'),
    true,
  )
  assert.equal(
    isValidAioStreamsAdminCredentials('operator', 'supports:colons-and=symbols'),
    true,
  )
})

test('rejects missing or ambiguous AIOStreams administrator credentials', () => {
  const invalid = [
    ['', 'correct-horse-battery-staple'],
    ['admin', ''],
    ['admin', 'too-short'],
    ['admin,other', 'correct-horse-battery-staple'],
    ['admin', 'correct,horse,battery,staple'],
    ['admin', ' correct-horse-battery-staple'],
  ]

  for (const [username, password] of invalid) {
    const result = validateAioStreamsAdminCredentials(username, password)
    assert.equal(result.valid, false, `${username}:${password}`)
    assert.ok(result.message)
  }
})
