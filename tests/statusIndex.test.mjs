import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createStatusIndex,
  setStatusEntry,
} from '../helper/statusIndex.js'

test('status index safely stores property-like process names', () => {
  const index = createStatusIndex()
  const entry = { status: 'running' }

  setStatusEntry(index, '__proto__', entry)
  setStatusEntry(index, 'constructor', { status: 'stopped' })

  assert.equal(index.get('__proto__'), entry)
  assert.equal(index.get('constructor')?.status, 'stopped')
  assert.equal(Object.prototype.status, undefined)
})
