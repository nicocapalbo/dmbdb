import assert from 'node:assert/strict'
import test from 'node:test'
import { startupReadiness } from '../helper/startupStatus.js'
test('startup readiness reports actual pending reasons and elapsed time', () => {
  const view = startupReadiness({ phase: 'stabilizing', started_at: 1000, expected_services: ['API', 'Arr'], services: { API: { state: 'ready' }, Arr: { state: 'starting', reason: 'HTTP health check has not passed.' } } }, 1072000)
  assert.equal(view.elapsed, '1m 12s')
  assert.match(view.message, /1 of 2/)
  assert.deepEqual(view.pending, [{ name: 'Arr', state: 'starting', reason: 'HTTP health check has not passed.' }])
})
test('all-green stabilization is explained without inventing a deadline or pending service', () => {
  const view = startupReadiness({ phase: 'stabilizing', expected_services: ['API'], services: { API: { state: 'ready' } } })
  assert.equal(view.pending.length, 0)
  assert.match(view.message, /All|1 of 1/)
  assert.match(view.message, /confirming.*stable/)
  assert.equal(view.elapsed, '')
})

test('intentional recovery hold requires restart and never invents pending service readiness', () => {
  const view = startupReadiness({
    phase: 'recovery_required', terminal: true, started_at: 1000, completed_at: 1010,
    expected_services: ['DUMB API', 'DUMB Frontend'],
    services: { 'DUMB API': { state: 'starting', reason: 'Health probe pending.' } },
    failures: { 'Installation recovery': 'Preserve private state, complete recovery, then restart.' },
  }, 5000000)
  assert.equal(view.label, 'Installation recovery requires attention')
  assert.match(view.message, /Normal services and background workers are paused/)
  assert.match(view.message, /restart DUMB/)
  assert.doesNotMatch(view.message, /Waiting|stable|report ready/)
  assert.deepEqual(view.pending, [])
  assert.equal(view.elapsed, '10s')
  assert.equal(view.failures[0].name, 'Installation recovery')
})
