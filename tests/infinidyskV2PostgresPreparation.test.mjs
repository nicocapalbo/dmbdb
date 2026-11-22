import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2PostgresPreparationSupported } from '../helper/infinidyskV2.js'
import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '../helper/infinidyskV2Controller.js'
import { infinidyskV2Repository } from '../services/infinidyskV2.js'

const capabilities = {
  api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true,
  infinidysk_v2_migration_protocol: 1, infinidysk_v2_postgres: true,
  infinidysk_v2_postgres_prepare_target: true, infinidysk_v2_postgres_prepare_target_protocol: 1,
}
const target = { use_managed_postgres: true, database: 'example_database' }
const fixture = (overrides = {}) => {
  const calls = []
  const state = { value: initialInfiniDyskV2State() }
  const repository = {
    capabilities: async () => capabilities,
    status: async () => ({ protocol: 1, runtime_generation: '2', job: null }),
    postgresStatus: async () => ({ protocol: 1, provider: 'sqlite', actions: { start: true } }),
    postgresPrepareTarget: async payload => { calls.push(payload); return { protocol: 1, ready: true, created: true, target: payload.target } },
    ...overrides,
  }
  return { state, calls, ...createInfiniDyskV2Controller({ state, repository }) }
}

test('managed destination preparation requires its own strict capability and protocol', () => {
  assert.equal(infinidyskV2PostgresPreparationSupported(capabilities), true)
  for (const change of [
    { infinidysk_v2_postgres_prepare_target: undefined }, { infinidysk_v2_postgres_prepare_target: 'true' },
    { infinidysk_v2_postgres_prepare_target_protocol: '1' }, { infinidysk_v2_postgres_prepare_target_protocol: 2 },
    { infinidysk_v2_postgres: false }, { infinidysk_v2_migration_protocol: 2 }, { api_version: '2.23.0' },
  ]) assert.equal(infinidyskV2PostgresPreparationSupported({ ...capabilities, ...change }), false)
})

test('dedicated preparation client uses only the native managed destination endpoint', async () => {
  const calls = []
  const client = infinidyskV2Repository({ post: async (url, body) => { calls.push({ url, body }); return { data: {} } } })
  await client.postgresPrepareTarget({ target })
  assert.deepEqual(calls, [{ url: '/api/process/infinidysk-v2/postgres/prepare-target', body: { target } }])
})

test('preparation only admits a confirmed native SQLite service and a managed target', async () => {
  const app = fixture()
  await app.refresh()
  assert.equal(app.calls.length, 0, 'Status discovery does not create a database')
  const result = await app.mutate('postgres', 'postgresPrepareTarget', { target })
  assert.equal(result.created, true)
  assert.deepEqual(app.calls, [{ target }])
  assert.equal(app.state.value.postgresJob, null, 'Preparing a database does not start a conversion job')
  for (const payload of [{ target: { ...target, use_managed_postgres: false } }, { target: { host: 'db.example.invalid', database: 'example_database' } }, { target: { ...target, database: '' } }]) {
    await assert.rejects(app.mutate('postgres', 'postgresPrepareTarget', payload), /managed preparation/)
  }
  assert.equal(app.calls.length, 1)
})

test('old, unconfirmed or busy migration state blocks destination creation', async () => {
  const cases = [
    { capabilities: async () => ({ ...capabilities, infinidysk_v2_postgres_prepare_target: false }) },
    { status: async () => ({ protocol: 1, runtime_generation: '1' }) },
    { status: async () => ({ protocol: 1, runtime_generation: '2', job: { job_id: 'active-major', status: 'running' } }) },
    { postgresStatus: async () => ({ protocol: 1, provider: 'postgres', actions: { start: true } }) },
    { postgresStatus: async () => ({ protocol: 1, provider: 'sqlite', actions: { start: false } }) },
    { postgresStatus: async () => ({ protocol: 1, provider: 'sqlite', actions: { start: true }, job: { job_id: 'active-copy', status: 'copying' } }) },
  ]
  for (const overrides of cases) {
    const app = fixture(overrides)
    await app.refresh()
    await assert.rejects(app.mutate('postgres', 'postgresPrepareTarget', { target }))
    assert.equal(app.calls.length, 0)
  }
  const app = fixture()
  await app.refresh()
  app.state.value.postgresStatusConfirmed = false
  await assert.rejects(app.mutate('postgres', 'postgresPrepareTarget', { target }), /current backend job state/)
  assert.equal(app.calls.length, 0)
})
