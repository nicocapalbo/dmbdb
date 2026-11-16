import test from 'node:test'
import assert from 'node:assert/strict'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { createInfiniDyskV2Polling } from '../helper/infinidyskV2Polling.js'
import { createInfiniDyskV2ServiceObserver, infinidyskV2AffectedServices } from '../helper/infinidyskV2Services.js'
import { infinidyskV2AmbiguousRequest, infinidyskV2SnapshotProgress, infinidyskV2SnapshotStage } from '../helper/infinidyskV2Status.js'

const caps = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1 }
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const app = overrides => {
  const state = { value: initialInfiniDyskV2State() }
  const storage = { data: '{}', getItem() { return this.data }, setItem(key, value) { this.data = value }, removeItem() { this.data = null } }
  const repository = { capabilities: async () => caps, status: async () => ({ protocol: 1, runtime_generation: '1', job: null }), ...overrides }
  return { state, storage, repository, ...createInfiniDyskV2Controller({ state, repository, storage }) }
}
const status = job => ({ protocol: 1, runtime_generation: '1', job })
const running = { job_id: 'new-test', status: 'running', mode: 'rehearsal', plan_fingerprint: 'reviewed-plan', stage: 'postgres_snapshot' }

test('an ambiguous POST is settled only by a new matching mode and plan, never by replay', async () => {
  let calls = 0
  const client = app({ rehearse: async () => { calls++; throw { code: 'ECONNABORTED' } }, status: async () => status(calls ? running : null) })
  await client.refresh()
  const result = await client.mutate('major', 'rehearse', { preview_token: 'private-preview' }, { plan_fingerprint: 'reviewed-plan' })
  assert.equal(result.reconciled, true); assert.equal(calls, 1)
  assert.equal(client.state.value.majorJob.job_id, running.job_id)
  assert.equal(client.state.value.majorMutation.status, 'confirmed')
  assert.equal(client.state.value.busy, false)
  assert.doesNotMatch(JSON.stringify(client.state.value.majorMutation) + client.storage.data, /private-preview/)
})

test('old or different job evidence cannot settle a lost acknowledgement; a later exact observation can', async () => {
  let job = { ...running, job_id: 'previous-test', status: 'failed_restored' }, calls = 0
  const client = app({ rehearse: async () => { calls++; throw { code: 'ERR_NETWORK' } }, status: async () => status(job) })
  await client.refresh()
  await assert.rejects(client.mutate('major', 'rehearse', {}, { plan_fingerprint: 'reviewed-plan' }))
  assert.equal(client.state.value.majorMutation.status, 'uncertain')
  job = { ...running, plan_fingerprint: 'different-plan' }; await client.refresh({ force: true })
  assert.equal(client.state.value.majorMutation.status, 'uncertain')
  job = running; await client.refresh({ force: true })
  assert.equal(client.state.value.majorMutation.status, 'confirmed')
  assert.equal(client.state.value.majorMutation.error, '')
  assert.equal(calls, 1)
  assert.equal(infinidyskV2AmbiguousRequest({ response: { status: 409 } }), false)
  assert.equal(infinidyskV2AmbiguousRequest(new Error('timeout')), false)
})

test('forced reads observe a job during its held POST and an old POST body cannot regress its terminal state', async () => {
  const gate = deferred(); let calls = 0, current = null
  const client = app({ rehearse: async () => { calls++; await gate.promise; return { job: running } }, status: async () => status(current) })
  await client.refresh()
  const submitting = client.mutate('major', 'rehearse', {}, { plan_fingerprint: 'reviewed-plan' })
  await tick(); current = running; await client.refresh({ force: true })
  assert.equal(client.state.value.busy, true); assert.equal(client.state.value.majorMutation.status, 'confirmed')
  current = { ...running, status: 'failed_restored', result: { source_restored: true } }
  await client.refresh({ force: true })
  gate.resolve(); await submitting
  assert.equal(client.state.value.majorJob.status, 'failed_restored')
  assert.equal(calls, 1)
})

test('a successful new job identity is retained if the intervening poll saw only the old job and the final read fails', async () => {
  const gate = deferred(); const old = { ...running, job_id: 'old-test', status: 'failed_restored' }
  let readsFail = false
  const client = app({ rehearse: async () => { await gate.promise; readsFail = true; return { job: running } }, status: async () => { if (readsFail) throw { code: 'ERR_NETWORK' }; return status(old) } })
  await client.refresh()
  const submitting = client.mutate('major', 'rehearse', {}, { plan_fingerprint: 'reviewed-plan' })
  await tick(); await client.refresh({ force: true }); gate.resolve(); await submitting
  assert.equal(client.state.value.majorStatusConfirmed, false)
  assert.equal(client.state.value.majorJob.job_id, running.job_id)
  assert.equal(JSON.parse(client.storage.data).major, running.job_id)
})

test('a rejected old-session read cannot poison a fresh session or clear its active refresh', async () => {
  const gate = deferred(); let first = true
  const client = app({ status: async () => { if (first) { first = false; return gate.promise }; return status(running) } })
  const oldRead = client.refresh(); await tick()
  client.reset(); await client.refresh({ force: true })
  gate.reject({ code: 'ERR_NETWORK' }); await oldRead
  assert.equal(client.state.value.majorJob.job_id, running.job_id)
  assert.equal(client.state.value.majorStatusConfirmed, true)
  assert.equal(client.state.value.error, '')
})

test('a mutation waiting for an older read cannot cross a session reset', async () => {
  const gate = deferred(); let reads = 0, mutations = 0
  const client = app({ status: async () => { reads++; if (reads === 2) await gate.promise; return status(null) }, rehearse: async () => { mutations++; return {} } })
  await client.refresh()
  const oldRead = client.refresh(); await tick()
  const mutation = client.mutate('major', 'rehearse', {})
  client.reset(); await client.refresh(); gate.resolve(); await oldRead
  await assert.rejects(mutation, /session changed/)
  assert.equal(mutations, 0)
})

class Events {
  handlers = new Map()
  visibilityState = 'visible'
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn) }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn) }
  emit(name) { for (const fn of this.handlers.get(name) || []) fn() }
}
test('one polling loop is shared, wakes on visibility/focus, pauses hidden and stops with its final owner', async () => {
  const page = new Events(), windowTarget = new Events(), timers = new Map(); let sequence = 0, calls = 0
  const poller = createInfiniDyskV2Polling({ page, windowTarget, getState: () => initialInfiniDyskV2State(),
    refresh: async options => { assert.equal(options.force, true); calls++ },
    setTimer: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id }, clearTimer: id => timers.delete(id) })
  const idle = poller.subscribe(); await tick()
  assert.equal(calls, 1); assert.equal([...timers.values()][0].delay, 15000)
  const active = poller.subscribe({ active: true }); await tick()
  assert.equal(calls, 2); assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 2000)
  page.visibilityState = 'hidden'; page.emit('visibilitychange'); windowTarget.emit('focus')
  assert.equal(timers.size, 0); assert.equal(calls, 2)
  page.visibilityState = 'visible'; page.emit('visibilitychange'); await tick()
  assert.equal(calls, 3); assert.equal(timers.size, 1)
  active(); idle()
  assert.equal(timers.size, 0)
  windowTarget.emit('focus'); page.emit('visibilitychange'); await tick()
  assert.equal(calls, 3)
})

test('only affected service snapshots become unknown and actual status confirms stop and eventual resume', async () => {
  const snapshots = new Map([['Managed App', { status: 'running' }], ['Unrelated App', { status: 'running' }]])
  const gate = deferred(); let calls = 0, fail = false
  const observer = createInfiniDyskV2ServiceObserver({ getSnapshot: name => snapshots.get(name), setSnapshot: (name, value) => snapshots.set(name, value),
    fetchStatus: async name => { calls++; if (calls === 1) return gate.promise; if (fail) throw new Error('offline'); return { process_name: name, status: 'running' } } })
  const job = { ...running, stage: 'quiescing', affected_services: ['Managed App'] }
  const reading = observer.observe(job)
  assert.equal(snapshots.get('Managed App').status, 'unknown')
  assert.equal(snapshots.get('Unrelated App').status, 'running')
  gate.resolve({ process_name: 'Managed App', status: 'stopped' }); await reading
  assert.equal(snapshots.get('Managed App').status, 'stopped')
  fail = true; const terminal = { ...job, status: 'failed_restored', stage: 'failed' }
  await observer.observe(terminal)
  assert.equal(snapshots.get('Managed App').status, 'unknown')
  fail = false; await observer.observe(terminal)
  assert.equal(snapshots.get('Managed App').status, 'running')
  await observer.observe(terminal); assert.equal(calls, 3)
})

test('job change without a new scope fences old service responses and reset stops old workers scheduling more reads', async () => {
  const snapshots = new Map(), gates = [], names = Array.from({ length: 8 }, (_, i) => 'Managed ' + i)
  const observer = createInfiniDyskV2ServiceObserver({ getSnapshot: name => snapshots.get(name), setSnapshot: (name, value) => snapshots.set(name, value),
    fetchStatus: name => { const gate = deferred(); gates.push({ ...gate, name }); return gate.promise } })
  const first = observer.observe({ ...running, affected_services: names })
  assert.equal(gates.length, 4)
  await observer.observe({ ...running, job_id: 'different-job' })
  for (const gate of gates) gate.reject(new Error('disconnected'))
  await first
  assert.equal(gates.length, 4)
  assert.ok([...snapshots.values()].every(value => value.status === 'unknown'))
  const second = observer.observe({ ...running, affected_services: names })
  assert.equal(gates.length, 8); observer.reset()
  for (const gate of gates.slice(4)) gate.reject(new Error('disconnected'))
  await second; assert.equal(gates.length, 8)
})

test('optional snapshot progress is typed, phase-scoped and never invents an overall total', () => {
  const value = infinidyskV2SnapshotProgress({ phase: 'restore_verification', restore_phase: 'restoring_database', table: 'public.media',
    table_index: 8, table_count: 8, rows: 100, elapsed_seconds: 125, idle_seconds: 5, stall_warning: true, percent: 100, password: 'private' })
  assert.match(value.label, /Testing recovery/)
  assert.match(value.restoreLabel, /Restoring the dump/)
  assert.equal(value.table, undefined); assert.equal(value.rows, undefined); assert.equal(value.table_count, undefined, 'Restore work cannot borrow old inventory totals')
  const current = infinidyskV2SnapshotProgress({ phase: 'source_inventory', table: 'public.media', table_index: 5, table_count: 7, rows: 37000 })
  assert.equal(current.table_index, 5); assert.equal(current.table_count, 7); assert.equal(current.rows, 37000)
  assert.equal(value.percent, undefined); assert.equal(value.password, undefined)
  assert.equal(infinidyskV2SnapshotProgress({ phase: 'constructor' }), null)
  const malformed = infinidyskV2SnapshotProgress({ phase: 'database_dump', table: 'password=private', rows: '100', table_count: Number.MAX_SAFE_INTEGER + 1, idle_seconds: -1, stall_warning: 'true' })
  assert.equal(malformed.table, undefined); assert.equal(malformed.rows, undefined); assert.equal(malformed.table_count, undefined); assert.equal(malformed.stall_warning, false)
  assert.equal(infinidyskV2SnapshotStage('importing'), false)
  assert.equal(infinidyskV2SnapshotStage('postgres_restore_verification'), true)
  assert.deepEqual(infinidyskV2AffectedServices({ affected_services: ['Managed App', 'Managed App'] }), ['Managed App'])
  assert.deepEqual(infinidyskV2AffectedServices({ affected_services: ['Managed\nApp'] }), [])
})

test('a terminal explicit unknown status stays eligible for later actual confirmation', async () => {
  const snapshots = new Map(); let calls = 0
  const observer = createInfiniDyskV2ServiceObserver({ getSnapshot: name => snapshots.get(name), setSnapshot: (name, value) => snapshots.set(name, value),
    fetchStatus: async name => ({ process_name: name, status: ++calls === 2 ? 'unknown' : 'running' }) })
  const job = { ...running, affected_services: ['Managed App'] }
  await observer.observe(job)
  const terminal = { ...job, status: 'failed_restored' }
  await observer.observe(terminal); assert.equal(snapshots.get('Managed App').status, 'unknown')
  await observer.observe(terminal); assert.equal(snapshots.get('Managed App').status, 'running')
  await observer.observe(terminal); assert.equal(calls, 3)
})
