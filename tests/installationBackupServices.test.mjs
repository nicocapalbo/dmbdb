import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createInstallationBackupController, initialInstallationBackupState } from '../helper/installationBackupController.js'
import { backupScopeFields, backupScopeLabel, backupScopeMatches, backupServiceChoices, backupServiceSelectionReady, installationBackupServicesSupported } from '../helper/installationBackupServices.js'
import { installationBackupsRepository } from '../services/installationBackups.js'
import { installationBackupJobProgress } from '../helper/installationBackupActivity.js'

const baseCaps = { installation_backup: true, installation_backup_protocol: 1 }
const caps = { ...baseCaps, installation_backup_services: true, installation_backup_services_protocol: 1, installation_backup_direct_start: true }
const choices = [{ id: 'radarr:movies', key: 'radarr', instance_name: 'movies', name: 'Movies', available: true, blocking_reasons: [] }, { id: 'radarr:other', name: 'Other movies', available: true, blocking_reasons: [] }, { id: 'postgres', name: 'PostgreSQL', available: false, blocking_reasons: ['Use an entire installation backup for the shared PostgreSQL cluster.'] }]
const scope = ids => ({ kind: 'services', service_ids: ids, services: choices.filter(choice => ids.includes(choice.id)), database_count: 0, affected_process_names: ['Movies'] })
const preview = ids => ({ protocol: 1, compression: 'none', ready: true, service_scope: ids ? scope(ids) : { kind: 'installation' }, preview_token: 'reviewed', expires_at: Date.now() / 1000 + 300 })
const fixture = overrides => {
  const calls = []
  const state = ref(initialInstallationBackupState())
  const repository = {
    capabilities: async () => caps,
    status: async () => ({ protocol: 1, job: null, recovery_required: false, direct_start: { confirmation_text: 'BACK UP DUMB INSTALLATION', required_acknowledgements: ['downtime', 'secrets', 'external_state'] } }),
    services: async () => { calls.push(['services']); return { protocol: 1, services: choices } },
    preview: async request => { calls.push(['preview', request]); return preview(request.scope === 'services' ? request.service_ids : undefined) },
    startDirect: async request => { calls.push(['direct', request]); return { protocol: 1, job: { job_id: 'example', job_type: 'installation_backup', status: 'queued', request_id: request.request_id, service_scope: scope(request.service_ids) } } },
    saveSchedule: async request => { calls.push(['schedule', request]); return { protocol: 1, schedule: request } },
    ...overrides,
  }
  return { calls, state, controller: createInstallationBackupController({ state, repository }) }
}

test('individual services require strict additive capabilities and legacy installation requests remain unchanged', () => {
  assert.equal(installationBackupServicesSupported(caps), true)
  for (const changed of [{ installation_backup_services: 'true' }, { installation_backup_services_protocol: '1' }, { installation_backup_protocol: 2 }]) assert.equal(installationBackupServicesSupported({ ...caps, ...changed }), false)
  assert.deepEqual(backupScopeFields(baseCaps), {})
  assert.deepEqual(backupScopeFields(caps), { scope: 'installation', service_ids: [] })
  assert.throws(() => backupScopeFields(baseCaps, 'services', ['radarr:movies']), /does not support/)
  for (const ids of [[], ['radarr:movies', 'radarr:movies'], ['bad\nvalue'], ['a'.repeat(129)], Array.from({ length: 65 }, (_, index) => `instance:${index}`)]) assert.throws(() => backupScopeFields(caps, 'services', ids), /Select at least/)
  assert.deepEqual(backupScopeFields(caps, 'services', ['radarr:4K Movies']), { scope: 'services', service_ids: ['radarr:4K Movies'] }, 'Backend-owned instance identities are opaque and may contain spaces')
  assert.throws(() => backupScopeFields(caps, 'installation', ['radarr:movies']), /Clear the selected/)
})

test('service choices retain per-instance identities and refuse ambiguous or malformed responses', () => {
  assert.deepEqual(backupServiceChoices({ protocol: 1, services: choices }).map(item => item.id), ['radarr:movies', 'radarr:other', 'postgres'])
  for (const response of [{ protocol: '1', services: choices }, { protocol: 1, services: [...choices, choices[0]] }, { protocol: 1, services: [{ ...choices[0], available: 'true' }] }]) assert.throws(() => backupServiceChoices(response), /did not confirm|unsupported/)
  assert.equal(backupServiceSelectionReady(choices, ['radarr:movies']), true)
  for (const ids of [['postgres'], ['removed'], []]) assert.equal(backupServiceSelectionReady(choices, ids), false)
  const shared = [{ ...choices[0], required_service_ids: ['radarr:other'] }, choices[1]]
  assert.equal(backupServiceSelectionReady(shared, ['radarr:movies']), false)
  assert.equal(backupServiceSelectionReady(shared, ['radarr:movies', 'radarr:other']), true)
})

test('manual service preview includes only exact chosen ids and requires matching backend scope', async () => {
  const f = fixture(); await f.controller.refresh(); await f.controller.services()
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive', scope: 'services', service_ids: ['radarr:movies'] }), true)
  assert.deepEqual(f.calls.at(-1), ['preview', { destination_id: 'archive', scope: 'services', service_ids: ['radarr:movies'] }])
  assert.equal(f.state.value.backupPreview.service_scope.kind, 'services')
  f.controller.invalidate()
  for (const ids of [['postgres'], ['removed'], []]) assert.equal(await f.controller.preview('backup', { destination_id: 'archive', scope: 'services', service_ids: ids }), false)
  assert.equal(f.calls.filter(call => call[0] === 'preview').length, 1)
  const mismatch = fixture({ preview: async () => preview() }); await mismatch.controller.refresh(); await mismatch.controller.services()
  assert.equal(await mismatch.controller.preview('backup', { destination_id: 'archive', scope: 'services', service_ids: ['radarr:movies'] }), false)
  assert.equal(mismatch.state.value.backupPreview, null)
  assert.match(mismatch.state.value.error, /did not confirm the selected services/)
})

test('direct and scheduled service backups bind sorted exact instances without posting config or credentials', async () => {
  const f = fixture(); await f.controller.refresh(); await f.controller.services()
  assert.equal(await f.controller.startDirect({ destination_id: 'archive', scope: 'services', service_ids: ['radarr:other', 'radarr:movies'], confirmation: 'BACK UP DUMB INSTALLATION', acknowledgements: { downtime: true, secrets: true, external_state: true } }), true)
  assert.deepEqual(f.calls.at(-1)[1].service_ids, ['radarr:movies', 'radarr:other'])
  assert.equal(f.calls.at(-1)[1].scope, 'services')
  assert.equal(Object.hasOwn(f.calls.at(-1)[1], 'services'), false)
  f.state.value.job = null; f.state.value.status.job = null
  assert.equal(await f.controller.saveSchedule({ enabled: true, destination_id: 'archive', interval_hours: 24, keep_last: 7, scope: 'services', service_ids: ['radarr:movies'] }), true)
  assert.deepEqual(f.calls.at(-1)[1].service_ids, ['radarr:movies'])
  assert.equal(await f.controller.saveSchedule({ enabled: false, destination_id: 'archive', interval_hours: 24, keep_last: 7, scope: 'services', service_ids: ['removed:instance'] }), true)
})

test('unsupported backends receive no services request and omit scope from whole backups and schedules', async () => {
  const f = fixture({ capabilities: async () => baseCaps }); await f.controller.refresh(); await f.controller.services()
  assert.equal(f.calls.length, 0)
  await f.controller.preview('backup', { destination_id: 'archive', scope: 'installation', service_ids: [] })
  assert.deepEqual(f.calls.at(-1), ['preview', { destination_id: 'archive' }])
  await f.controller.saveSchedule({ enabled: false, destination_id: '', interval_hours: 24, keep_last: 7, scope: 'installation', service_ids: [] })
  assert.deepEqual(f.calls.at(-1)[1], { enabled: false, destination_id: '', interval_hours: 24, keep_last: 7 })
})

test('late service inventories cannot replace a more recent set or re-enable removed capabilities', async () => {
  const pending = []
  const f = fixture({ services: () => new Promise(resolve => pending.push(resolve)) }); await f.controller.refresh()
  const first = f.controller.services(), second = f.controller.services()
  pending[1]({ protocol: 1, services: choices }); await second
  pending[0]({ protocol: 1, services: [] }); await first
  assert.equal(f.state.value.services.length, choices.length)
  const third = f.controller.services(); f.state.value.capabilities = baseCaps
  pending[2]({ protocol: 1, services: choices }); await third
  assert.equal(f.state.value.services.length, 0)
})

test('archive labels keep legacy whole archives distinct from exact service bundles', () => {
  assert.equal(backupScopeLabel({}), 'Entire DUMB installation')
  assert.equal(backupScopeLabel({ service_scope: scope(['radarr:movies']) }), 'Services: Movies')
  assert.equal(backupScopeLabel({ service_scope: { kind: 'services', service_ids: ['radarr:movies'] } }), '1 selected service')
  assert.equal(backupScopeMatches({ scope: 'services', service_ids: ['radarr:movies'] }, { service_scope: scope(['radarr:other']) }), false)
})

test('service inventory uses the fixed authenticated backup route', async () => {
  let request
  const repository = installationBackupsRepository({ get: async (...args) => { request = args; return { data: { protocol: 1, services: [] } } } })
  await repository.services()
  assert.equal(request[0], '/api/process/installation-backups/services')
  assert.equal(request[1].timeout, 30000)
})

test('database phases replace stale archive percentages with their own measured tables and export counters', () => {
  const progress = { stage: 'verifying', percent_scope: 'phase', percent: 100, percent_basis: 'bytes', bytes_processed: 4096, total_bytes: 4096 }
  const job = { stage: 'database_backup', progress, database_progress: { phase: 'database_records', completed: 2, total: 4 } }
  const tables = installationBackupJobProgress(job, caps)
  assert.equal(tables.percent, 50); assert.equal(tables.entries_label, 'Database tables checked'); assert.equal(tables.bytes_processed, null)
  const dump = installationBackupJobProgress({ ...job, database_progress: { phase: 'database_dump', bytes: 1234 } }, caps)
  assert.equal(dump.percent, null); assert.equal(dump.bytes_processed, 1234); assert.equal(dump.bytes_label, 'Database export written')
  const restoring = installationBackupJobProgress({ ...job, stage: 'database_restore', database_progress: { phase: 'database_restore' } }, caps)
  assert.equal(restoring.percent, null); assert.equal(restoring.entries, null); assert.match(restoring.heading, /Restoring/)
  assert.equal(installationBackupJobProgress({ ...job, stage: 'database_restore', database_progress: { phase: 'database_dump', completed: 1, total: 1 } }, caps).percent, null)
  assert.equal(installationBackupJobProgress({ ...job, stage: 'committing' }, caps), null)
  assert.equal(installationBackupJobProgress(job, baseCaps), null)
  for (const database_progress of [undefined, { phase: 'database_records', completed: 5, total: 4 }, { phase: 'database_records', completed: '2', total: 4 }]) assert.equal(installationBackupJobProgress({ ...job, database_progress }, caps).percent, null)
})
