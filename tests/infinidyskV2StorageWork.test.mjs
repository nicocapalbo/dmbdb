import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2StorageWork } from '../helper/infinidyskV2StorageWork.js'

const leg = (id, read, write, extra = {}) => ({ id, read_bytes: read, write_bytes: write, storage: 'local', passes: 1, minimum: false, ...extra })
const restoration = () => [leg('archive_restore_checks', 140 * 1024 ** 3, 0, { storage: 'archive', passes: 2, minimum: true }),
  leg('archive_restore', 70 * 1024 ** 3, 60 * 1024 ** 3, { storage: 'archive', minimum: true }), leg('restored_readback', 60 * 1024 ** 3, 0)]
const work = (changes = {}) => ({ protocol: 1, comparison_basis: 'logical_io_same_storage', ranking: 'not_estimated',
  selected_path: 'reuse_local', archive_required: true, archive_storage_type: 'network',
  source_data_bytes: 60 * 1024 ** 3, source_total_bytes: 70 * 1024 ** 3, legacy_blob_bytes: 50 * 1024 ** 3,
  archive_bytes: 70 * 1024 ** 3, archive_bytes_is_minimum: true,
  paths: [
    { id: 'reuse_local', selected: true, preparation_order: null, requires_registered_archive: true,
      preparation: [leg('archive_reuse_checks', 140 * 1024 ** 3, 0, { storage: 'archive', passes: 2, minimum: true })],
      activation: [leg('archive_acceptance', 70 * 1024 ** 3, 0, { storage: 'archive', minimum: true })],
      restoration: restoration() },
    { id: 'keep_local', selected: false, preparation_order: null, requires_registered_archive: false,
      preparation: [leg('candidate_copy', 60 * 1024 ** 3, 60 * 1024 ** 3), leg('retained_source_check', 60 * 1024 ** 3, 0)],
      activation: [leg('retained_source_check', 60 * 1024 ** 3, 0)], restoration: [] },
    { id: 'external_blobs', selected: false, preparation_order: null, requires_registered_archive: true,
      preparation: [leg('archive_reuse_checks', 210 * 1024 ** 3, 0, { storage: 'archive', passes: 3, minimum: true }),
        leg('blob_copy', 50 * 1024 ** 3, 50 * 1024 ** 3, { storage: 'archive' }), leg('blob_readback', 150 * 1024 ** 3, 0, { storage: 'archive', passes: 3 })],
      activation: [leg('archive_acceptance', 70 * 1024 ** 3, 0, { storage: 'archive', minimum: true })], restoration: restoration() },
  ], ...changes })

test('storage comparison preserves actual copy and verification passes without inventing elapsed ranking', () => {
  const result = infinidyskV2StorageWork(work())
  assert.deepEqual(result.paths.map(path => path.id), ['keep_local', 'reuse_local', 'external_blobs'])
  assert.equal(result.storageType, 'network')
  assert.equal(result.paths[0].phases[0].readBytes, 120 * 1024 ** 3)
  assert.equal(result.paths[0].phases[0].writeBytes, 60 * 1024 ** 3)
  assert.equal(result.paths[1].phases[0].readBytes, 140 * 1024 ** 3, 'Pass totals must not be multiplied again')
  assert.equal(result.paths[1].phases[0].minimum, true)
  assert.equal(result.paths[1].phases[2].readBytes, 270 * 1024 ** 3)
  assert.equal(result.paths[1].phases[2].writeBytes, 60 * 1024 ** 3)
  assert.equal(result.paths[2].phases[0].readBytes, 410 * 1024 ** 3)
  assert.equal(result.paths[2].phases[0].writeBytes, 50 * 1024 ** 3)
  assert.equal(result.paths[2].phases[2].readBytes, 270 * 1024 ** 3)
  assert.equal(result.paths[2].phases[2].writeBytes, 60 * 1024 ** 3)
  assert.equal(result.paths[0].order, undefined)
  assert.equal(result.etaSeconds, undefined)
})

test('unmeasured bytes remain unavailable while exact zero is retained', () => {
  const value = work({ source_data_bytes: null, archive_bytes: null })
  value.paths[1].preparation[0].read_bytes = null
  value.paths[1].preparation[1].read_bytes = null
  const result = infinidyskV2StorageWork(value)
  assert.equal(result.sourceDataBytes, null)
  assert.equal(result.archiveBytes, null)
  assert.equal(result.paths[0].phases[0].readBytes, null)
  assert.equal(result.paths[0].phases[0].writeBytes, 60 * 1024 ** 3)
  assert.equal(result.paths[0].phases[2].readBytes, 0)
})

test('invalid storage or incomplete pass catalogs never display a misleading quantified comparison', () => {
  for (const changes of [{ protocol: 2 }, { ranking: 'fastest' }, { selected_path: 'constructor' },
    { archive_storage_type: 'external-url' }, { paths: [] }, { paths: work().paths.slice(1) }]) {
    assert.equal(infinidyskV2StorageWork(work(changes)), null)
  }
  for (const mutate of [value => { value.paths[0].selected = false },
    value => { value.paths[0].preparation_order = 1 },
    value => { value.paths[0].preparation[0].read_bytes = -1 },
    value => { value.paths[0].preparation[0].id = 'constructor' },
    value => { value.paths[0].preparation[0].passes = 0 },
    value => { value.paths[0].preparation[0].storage = '/private/share' },
    value => { value.paths[0].activation[0].minimum = 'false' }]) {
    const value = work(); mutate(value)
    assert.equal(infinidyskV2StorageWork(value), null)
  }
})

test('unknown storage and actual archive size stay distinct from source lower bounds', () => {
  const result = infinidyskV2StorageWork(work({ archive_storage_type: 'unknown', archive_bytes: 75 * 1024 ** 3,
    archive_bytes_is_minimum: false, path: '/private/share', measured_fastest: 'reuse_local' }))
  assert.equal(result.storageType, 'unknown')
  assert.equal(result.archiveBytes, 75 * 1024 ** 3)
  assert.equal(result.archiveBytesIsMinimum, false)
  assert.doesNotMatch(JSON.stringify(result), /private|measured_fastest/)
})
