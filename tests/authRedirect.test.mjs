import assert from 'node:assert/strict'
import test from 'node:test'
import { safeAuthRedirect } from '../helper/authRedirect.js'

const origin = 'https://dashboard.example'
test('login destinations retain canonical local paths, queries, fragments and encoded bytes', () => {
  for (const [input, expected] of [
    ['/', '/'], ['/services/Plex?tab=logs#tail', '/services/Plex?tab=logs#tail'],
    ['/old/../services/Plex', '/services/Plex'], ['/literal%2Fname?x=%23#tail', '/literal%2Fname?x=%23#tail'],
  ]) {
    assert.equal(safeAuthRedirect(input, origin), expected)
    assert.equal(new URL(expected, origin).origin, origin)
  }
})

test('login destinations reject raw backslashes, every C0 character and DEL', () => {
  for (const code of [...Array(32).keys(), 92, 127]) {
    const value = '/' + String.fromCharCode(code) + '/reserved.example'
    assert.equal(safeAuthRedirect(value, origin), '/', 'code point ' + code)
  }
})

test('login destinations reject foreign origins and ambiguous canonical double-slash paths', () => {
  for (const value of ['//reserved.example', 'https://reserved.example/', 'javascript:alert(1)', '/a/..//reserved.example', '/%2e%2e//reserved.example']) assert.equal(safeAuthRedirect(value, origin), '/')
  for (const value of [null, undefined, 123, ['/services/Plex'], { toString() { throw new Error('Must not coerce') } }]) assert.equal(safeAuthRedirect(value, origin), '/')
  for (const base of ['invalid', 'file:///tmp/example', 'https://user:password@dashboard.example']) assert.equal(safeAuthRedirect('/services/Plex', base), '/')
})
