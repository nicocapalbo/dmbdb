import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2ExternalBlobStagingSupported, infinidyskV2SourceStorageMatches, infinidyskV2AcknowledgementsReady, infinidyskV2Capacity } from '../helper/infinidyskV2.js'
import { infinidyskV2ReviewNotes, infinidyskV2CheckText, infinidyskV2SummaryValue, infinidyskV2JobLabel } from '../helper/infinidyskV2Presentation.js'

const capabilities = { api_version: '2.24.0', infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1,
  infinidysk_v2_low_space_migration: true, infinidysk_v2_migration_backup_storage: true, backup_storage_selection: true,
  backup_storage_protocol: 1, backup_storage_kinds: ['infinidysk_v2_archive'], infinidysk_v2_external_blob_staging: true }
const status = { mode: 'migrate', runtime_generation: '1' }
const acknowledgements = ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream', 'archive_recovery', 'external_blob_staging']
const stagedPreview = () => ({ source_storage: { mode: 'archive_recovery', reclaim_source_space: true, rollback_requires_archive: true, offload_legacy_blobs: true },
  backup_storage: { mode: 'cold_archive' }, required_acknowledgements: acknowledgements })

test('external blob staging needs strict current capability, archive support and an existing v1 source', () => {
  assert.equal(infinidyskV2ExternalBlobStagingSupported(capabilities, status), true)
  assert.equal(infinidyskV2ExternalBlobStagingSupported(capabilities, { ...status, capabilities: { external_blob_staging: true } }), true)
  for (const change of [{ infinidysk_v2_external_blob_staging: undefined }, { infinidysk_v2_external_blob_staging: 'true' }, { infinidysk_v2_low_space_migration: false }, { backup_storage_kinds: [] }, { backup_storage_protocol: '1' }, { api_version: '2.23.0' }]) {
    assert.equal(infinidyskV2ExternalBlobStagingSupported({ ...capabilities, ...change }, status), false)
  }
  for (const change of [{ mode: 'fresh' }, { runtime_generation: '2' }, { capabilities: { external_blob_staging: false } }, { capabilities: { external_blob_staging: 'true' } }]) {
    assert.equal(infinidyskV2ExternalBlobStagingSupported(capabilities, { ...status, ...change }), false)
  }
})

test('reviewed offload is never silently enabled or downgraded and requires both specific consents', () => {
  const preview = stagedPreview()
  assert.equal(infinidyskV2SourceStorageMatches(preview, true, true), true)
  assert.equal(infinidyskV2SourceStorageMatches(preview, true, false), false)
  assert.equal(infinidyskV2SourceStorageMatches(preview, false, true), false)
  assert.equal(infinidyskV2SourceStorageMatches(preview, 'true', true), false)
  for (const change of [{ source_storage: { ...preview.source_storage, offload_legacy_blobs: undefined } }, { source_storage: { ...preview.source_storage, offload_legacy_blobs: 'true' } }, { source_storage: { ...preview.source_storage, rollback_requires_archive: false } }, { required_acknowledgements: acknowledgements.filter(key => key !== 'external_blob_staging') }, { required_acknowledgements: acknowledgements.filter(key => key !== 'archive_recovery') }, { backup_storage: { mode: 'local_tree' } }]) {
    assert.equal(infinidyskV2SourceStorageMatches({ ...preview, ...change }, true, true), false)
  }
  const accepted = Object.fromEntries(acknowledgements.map(key => [key, true]))
  assert.equal(infinidyskV2AcknowledgementsReady(preview, accepted), true)
  assert.equal(infinidyskV2AcknowledgementsReady(preview, { ...accepted, external_blob_staging: false }), false)
  assert.equal(infinidyskV2SourceStorageMatches({}, false, false), true, 'The older API default remains compatible')
  assert.equal(infinidyskV2SourceStorageMatches({ ...preview, source_storage: { ...preview.source_storage, offload_legacy_blobs: undefined } }, true, false), true)
})

const phasedCapacity = () => ({
  status: 'sufficient', complete: true, estimated: true, reserved: false, release_is_projected: true,
  source: { entries: 12, logical_bytes: 100, root_count: 1 },
  filesystems: [
    { id: 'before', phase: 'before_blob_release', roles: ['external_blob_staging'], base_required_bytes: 40, safety_margin_bytes: 4, required_bytes: 44, free_bytes: 50, projected_released_bytes: 0, projected_available_bytes: 50, shortfall_bytes: 0, sufficient: true },
    { id: 'after', phase: 'after_blob_release', roles: ['native_import_growth', 'external_blob_manifest'], base_required_bytes: 100, safety_margin_bytes: 10, required_bytes: 110, free_bytes: 50, projected_released_bytes: 100, projected_available_bytes: 150, shortfall_bytes: 0, sufficient: true },
  ],
})

test('phase estimates preserve observed free space and expose expected release separately', () => {
  const estimate = infinidyskV2Capacity(phasedCapacity())
  assert.equal(estimate.status, 'sufficient')
  assert.equal(estimate.release_is_projected, true)
  assert.equal(estimate.filesystems[1].free_bytes, 50)
  assert.equal(estimate.filesystems[1].projected_released_bytes, 100)
  assert.equal(estimate.filesystems[1].projected_available_bytes, 150)
  assert.equal(estimate.filesystems[0].phase_label, 'Before moving legacy files')
  assert.equal(estimate.filesystems[1].phase_label, 'After freeing local space')
  assert.deepEqual(estimate.filesystems[0].roles, ['Temporary v1 import files on migration storage'])
  assert.deepEqual(estimate.filesystems[1].roles, ['Local space for the v2 import', 'Local import-file verification'])
})

test('phase rows keep one physical filesystem label across local and archive requirements', () => {
  const value = phasedCapacity()
  value.filesystems[0].filesystem_id = 'physical_a'
  value.filesystems[1].filesystem_id = 'physical_a'
  value.filesystems.splice(1, 0, { ...value.filesystems[0], id: 'other_before', filesystem_id: 'physical_b' })
  assert.deepEqual(infinidyskV2Capacity(value).filesystems.map(row => row.label), ['Filesystem 1', 'Filesystem 2', 'Filesystem 1'])
  value.filesystems[1].filesystem_id = 'physical_a'
  assert.deepEqual(infinidyskV2Capacity(value).filesystems.map(row => row.label), ['Filesystem 1', 'Filesystem 1', 'Filesystem 1'], 'Shared local and migration locations remain the same device')
  for (const row of value.filesystems) delete row.filesystem_id
  assert.deepEqual(infinidyskV2Capacity(value).filesystems.map(row => row.label), ['Filesystem 1', 'Filesystem 2', 'Filesystem 3'], 'Older distinct row IDs remain compatible')
})

test('malformed or unconfirmed release projections never become a successful capacity estimate', () => {
  for (const mutate of [
    value => { delete value.release_is_projected },
    value => { value.release_is_projected = 'true' },
    value => { value.filesystems[0].projected_released_bytes = 1 },
    value => { value.filesystems[1].projected_available_bytes = 151 },
    value => { value.filesystems[1].shortfall_bytes = 60; value.filesystems[1].sufficient = false; value.status = 'insufficient' },
    value => { value.filesystems[1].phase = 'unknown_phase' },
    value => { value.filesystems[1].projected_released_bytes = Number.MAX_SAFE_INTEGER },
    value => { value.filesystems.pop() },
  ]) {
    const value = phasedCapacity(); mutate(value)
    const result = infinidyskV2Capacity(value)
    assert.equal(result.status, 'unavailable')
    assert.equal(result.source, null)
    assert.equal(result.filesystems.every(row => row.free_bytes === null), true)
  }
})

test('known review notices become plain language while unknown and changed warnings remain visible', () => {
  const known = 'The native beta import can read NNTP and requires a real contained rehearsal.'
  const changed = known + ' Extra provider restriction.'
  const result = infinidyskV2ReviewNotes({ rehearsal_required: true, required_acknowledgements: ['backup'], warnings: [known, known, changed, { message: 'Provider notice api_key=private-value' }] })
  assert.equal(result.notes.length, 1)
  assert.match(result.notes[0].message, /Usenet providers/)
  assert.equal(result.important.length, 2)
  assert.equal(result.additional[0], changed)
  assert.equal(result.additional[1], 'Provider notice api_key=[redacted]')
  assert.equal(infinidyskV2CheckText({ name: 'source_queue', status: 'must_be_empty_after_quiescence' }).includes('Failed history entries alone'), true)
  assert.equal(infinidyskV2CheckText({ name: 'source_queue', status: 'must_be_empty_after_quiescence', passed: false, message: 'Actual blocking queue failure' }), 'Actual blocking queue failure')
})

test('compatibility explanation is deduplicated only when the structured enforced policy is present', () => {
  const warning = 'The retained backend compatibility listener requires native admin authentication mode Required, locked by DUMB for each launch. Saved native authentication settings are unchanged; disable compatibility by using the same backend and frontend port to retain native Local/Disabled mode.'
  assert.deepEqual(infinidyskV2ReviewNotes({ warnings: [warning] }).additional, [warning])
  const target = { compatibility_auth_policy: { enforced: true, mode: 'required', reason: 'legacy_compatibility_listener' } }
  assert.equal(infinidyskV2ReviewNotes({ warnings: [warning], target }).additional.length, 0)
})

test('plain summaries and retained progress labels do not change backend state or invent progress', () => {
  assert.equal(infinidyskV2SummaryValue('mount_backend', 'fuse'), 'Native FUSE')
  assert.equal(infinidyskV2SummaryValue('provider', 'postgres'), 'PostgreSQL')
  assert.equal(infinidyskV2JobLabel('rehearsed', 'rehearsal'), 'Test migration passed')
  assert.equal(infinidyskV2JobLabel('releasing_local_blobs'), 'Freeing local v1 blob space')
  assert.equal(infinidyskV2JobLabel('future_unknown_stage'), 'future unknown stage')
})
