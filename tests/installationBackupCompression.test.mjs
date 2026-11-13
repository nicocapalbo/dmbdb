import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { backupArchiveFormat, backupCompressionFields, backupCompressionMode, backupCompressionSupported } from '../helper/installationBackupCompression.js'
import { createInstallationBackupController, initialInstallationBackupState } from '../helper/installationBackupController.js'
import { installationPreviewReady } from '../helper/installationBackups.js'

const caps = { installation_backup: true, installation_backup_protocol: 1, installation_backup_compression: true, installation_backup_zstd: true }
const preview = compression => ({ protocol: 1, ready: true, compression, preview_token: 'bound-format-token', expires_at: Date.now() / 1000 + 900, confirmation_text: 'BACK UP EXAMPLE', inventory: { roots: [{ path: '/config' }], excluded: [] }, blockers: [], required_acknowledgements: ['downtime', 'secrets', 'external_state'], capacity: { status: 'sufficient', complete: true, estimated: true, reserved: false, source: { entries: 10, logical_bytes: 1000, root_count: 1 }, filesystems: [{ id: 'filesystem_1', roles: ['cold_archive'], base_required_bytes: 1000, safety_margin_bytes: 1000, required_bytes: 2000, free_bytes: 5000, shortfall_bytes: 0, sufficient: true }] } })
const fixture = (capabilities = caps) => {
  const state = ref(initialInstallationBackupState()), calls = [], notices = []
  const repository = { capabilities: async () => capabilities, status: async () => ({ protocol: 1, job: null, recovery_required: false }),
    preview: async body => { calls.push(['preview', body]); return preview(body.compression) },
    start: async body => { calls.push(['start', body]); return { protocol: 1, job: { job_id: 'installation_one', job_type: 'installation_backup', status: 'queued' } } },
    saveSchedule: async body => { calls.push(['schedule', body]); return { protocol: 1, schedule: body } } }
  const controller = createInstallationBackupController({ state, repository, notify: event => notices.push(event) })
  return { state, calls, notices, repository, controller }
}
test('compression is strict-capability gated, defaults compatible and never leaks fields to legacy APIs', () => {
  for (const capabilities of [{}, { installation_backup_zstd: 'true' }]) {
    assert.equal(backupCompressionSupported(capabilities), false)
    assert.deepEqual(backupCompressionFields(capabilities, undefined), {})
    assert.deepEqual(backupCompressionFields(capabilities, 'none'), {})
    assert.throws(() => backupCompressionFields(capabilities, 'zstd'), /does not advertise/)
  }
  assert.deepEqual(backupCompressionFields(caps, undefined), { compression: 'none' })
  assert.deepEqual(backupCompressionFields(caps, 'zstd'), { compression: 'zstd' })
  for (const value of [null, false, 'gzip', 'ZSTD']) assert.throws(() => backupCompressionFields(caps, value), /Choose/)
  assert.equal(backupCompressionMode(undefined), 'none')
})
test('manual format is included in preview but actual start still sends only the reviewed token and consent', async () => {
  const f = fixture(); await f.controller.refresh()
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive', compression: 'zstd' }), true)
  assert.deepEqual(f.calls[0], ['preview', { destination_id: 'archive', compression: 'zstd' }])
  const acknowledgements = { downtime: true, secrets: true, external_state: true }
  assert.equal(await f.controller.start('backup', 'BACK UP EXAMPLE', acknowledgements), true)
  assert.deepEqual(f.calls[1], ['start', { preview_token: 'bound-format-token', confirmation: 'BACK UP EXAMPLE', acknowledgements }])
})
test('legacy requests omit the new field and unsupported stale Zstandard selection fails before a request', async () => {
  const f = fixture({ installation_backup: true, installation_backup_protocol: 1 }); await f.controller.refresh()
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive', compression: 'none' }), true)
  assert.deepEqual(f.calls[0], ['preview', { destination_id: 'archive' }])
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive', compression: 'zstd' }), false)
  assert.equal(f.calls.length, 1)
  assert.match(f.state.value.error, /does not advertise/)
})
test('backend format mismatch leaves no review or start authorization', async () => {
  const f = fixture(); f.repository.preview = async () => preview('none'); await f.controller.refresh()
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive', compression: 'zstd' }), false)
  assert.equal(f.state.value.backupPreview, null)
  assert.match(f.state.value.error, /did not confirm the selected archive format/)
})
test('schedule codec is independent and omission preserves a previously stored codec', async () => {
  const f = fixture(); await f.controller.refresh()
  const schedule = { enabled: true, destination_id: 'archive', interval_hours: 24, keep_last: 7 }
  assert.equal(await f.controller.saveSchedule({ ...schedule, compression: 'zstd' }), true)
  assert.deepEqual(f.calls.at(-1), ['schedule', { ...schedule, compression: 'zstd' }])
  assert.equal(await f.controller.saveSchedule(schedule), true)
  assert.deepEqual(f.calls.at(-1), ['schedule', schedule])
  const legacy = fixture({ installation_backup: true, installation_backup_protocol: 1 }); await legacy.controller.refresh()
  assert.equal(await legacy.controller.saveSchedule({ ...schedule, compression: 'none' }), true)
  assert.deepEqual(legacy.calls.at(-1), ['schedule', schedule])
  assert.equal(await legacy.controller.saveSchedule({ ...schedule, compression: 'zstd' }), false)
  assert.equal(legacy.calls.length, 1)
})
test('a recovered compressed review requires capability support and fresh consent', () => {
  const state = { ...initialInstallationBackupState(), capabilities: caps, confirmed: true, status: {} }
  const result = preview('zstd')
  assert.equal(installationPreviewReady({ state, preview: result, mode: 'backup', confirmation: '', acknowledgements: {} }), false)
  assert.equal(installationPreviewReady({ state: { ...state, capabilities: {} }, preview: result, mode: 'backup', confirmation: 'BACK UP EXAMPLE', acknowledgements: { downtime: true, secrets: true, external_state: true } }), false)
})
test('archive labels use detected codec or legacy extension without assuming a compression ratio', () => {
  assert.equal(backupArchiveFormat({}), 'Uncompressed tar (.tar)')
  assert.equal(backupArchiveFormat({ compression: 'zstd' }), 'Zstandard (.tar.zst)')
  assert.equal(backupArchiveFormat({ extension: 'tar.zst' }), 'Zstandard (.tar.zst)')
  assert.equal(backupArchiveFormat({ compression: 'other' }), 'Unrecognized archive format')
})

test('tracked completion cannot replace the requested codec with a different format or show a success notice', async () => {
  const f = fixture({ ...caps, installation_backup_preview_status: true })
  let id = 'preview_old'
  f.repository.previewStatus = async () => ({ protocol: 1, controller_session: 'controller_one', preview: { preview_id: id, kind: 'backup', destination_id: 'archive', compression: 'none', status: 'completed', stage: 'completed', message: 'Preview complete', result: preview('none'), expires_at: Date.now() / 1000 + 900 } })
  await f.controller.refresh()
  f.notices.length = 0
  id = 'preview_new'
  await f.controller.preview('backup', { destination_id: 'archive', compression: 'zstd' })
  assert.equal(f.state.value.backupPreview, null)
  assert.equal(f.notices.length, 0)
  assert.match(f.state.value.error, /did not confirm a supported archive format/)
  assert.equal(await f.controller.start('backup', 'BACK UP EXAMPLE', { downtime: true, secrets: true, external_state: true }), false)
})

test('schema support permits explicitly replacing a stored zstd schedule with none when the encoder is unavailable', async () => {
  const f = fixture({ ...caps, installation_backup_zstd: false })
  await f.controller.refresh()
  const schedule = { enabled: true, destination_id: 'archive', interval_hours: 24, keep_last: 7, compression: 'none' }
  assert.equal(await f.controller.saveSchedule(schedule), true)
  assert.deepEqual(f.calls.at(-1), ['schedule', schedule])
  assert.equal(await f.controller.preview('backup', { destination_id: 'archive', compression: 'none' }), true)
  assert.deepEqual(f.calls.at(-1), ['preview', { destination_id: 'archive', compression: 'none' }])
  assert.equal(await f.controller.saveSchedule({ ...schedule, compression: 'zstd' }), false)
})
