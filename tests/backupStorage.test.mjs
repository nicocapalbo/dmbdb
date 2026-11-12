import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { backupDestinationFields, backupDestinationProfile, backupStorageCatalog, backupStorageError, backupStorageAvailability, backupStorageManagementSupported, backupStorageRevalidationSupported, backupStorageRevalidationReady, backupStorageUsage, backupStoragePermissionFields, backupStorageSupported, backupStorageText, symlinkBackupPayload } from '../helper/backupStorage.js'
import { backupStorageRepository } from '../services/backupStorage.js'

const capabilities = { backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['symlink_manifest', 'infinidysk_v2_archive'] }

test('storage requires explicit protocol and artifact kind; existing paths never opt into a default', () => {
  assert.equal(backupStorageSupported(capabilities, 'symlink_manifest'), true)
  for (const changed of [{}, { ...capabilities, backup_storage_selection: 'true' }, { ...capabilities, backup_storage_protocol: '1' }, { ...capabilities, backup_storage_kinds: ['other'] }]) assert.equal(backupStorageSupported(changed, 'symlink_manifest'), false)
  assert.deepEqual(backupDestinationFields(capabilities, ''), {})
  assert.deepEqual(backupDestinationFields({}, '@default'), {})
  assert.deepEqual(backupDestinationFields(capabilities, '@default'), { backup_destination_id: '@default' })
  assert.deepEqual(backupDestinationFields(capabilities, 'nas'), { backup_destination_id: 'nas' })
})

test('manual backup omits legacy output path only for a supported explicit destination', () => {
  const input = { capabilities, destination: '', processName: 'Example Service', path: '/config/example.json', includeBroken: true, roots: ['/library'] }
  assert.deepEqual(symlinkBackupPayload(input), { process_name: 'Example Service', backup_path: '/config/example.json', include_broken: true, roots: ['/library'] })
  const managed = symlinkBackupPayload({ ...input, destination: 'nas' })
  assert.equal(managed.backup_destination_id, 'nas')
  assert.equal('backup_path' in managed, false)
  assert.equal(managed.process_name, 'Example Service')
  assert.throws(() => symlinkBackupPayload({ ...input, capabilities: {}, destination: 'nas' }), /not supported/)
  assert.equal(symlinkBackupPayload({ ...input, destination: '@default', path: '' }).backup_destination_id, '@default')
})

test('catalog defaults are resolved without treating managed references as external URLs', () => {
  const catalog = backupStorageCatalog({ protocol: 1, default_destination_id: 'nas', destinations: [{ id: 'nas', name: 'Archive', path: '/mnt/backups' }] })
  assert.equal(backupDestinationProfile(catalog, '@default').id, 'nas')
  assert.equal(backupDestinationProfile(catalog, ''), null)
  assert.equal(backupStorageCatalog({ protocol: 2, destinations: [] }), null)
  const reference = 'dumb-backup://nas/namespace/artifact'
  assert.equal(backupStorageText(reference), reference)
  assert.doesNotMatch(backupStorageText('password=fixture smb://fixture:secret@example.invalid/share'), /fixture|secret@example/)
})

test('storage client performs no registration or default write until explicitly called', async () => {
  const calls = []
  const repository = backupStorageRepository({ get: async url => { calls.push(['GET', url]); return { data: {} } }, post: async (url, body) => { calls.push(['POST', url, body]); return { data: {} } } })
  await repository.catalog(); await repository.preview({ id: 'nas', path: '/mnt/backups' })
  assert.deepEqual(calls.map(call => call[1]), ['/api/process/backup-storage', '/api/process/backup-storage/preview'])
  await repository.save({ id: 'nas' }); await repository.setDefault('nas')
  assert.deepEqual(calls.slice(2).map(call => call[1]), ['/api/process/backup-storage/profiles', '/api/process/backup-storage/default'])
  assert.deepEqual(calls[3][2], { destination_id: 'nas' })
})

test('storage validation details remain actionable while credentials are redacted', () => {
  const message = 'The owned backup directory must enforce private mode 0700.'
  assert.equal(backupStorageError({ response: { data: { detail: message } } }), message)
  assert.equal(backupStorageError({ response: { data: { detail: { message } } } }), message)
  assert.equal(backupStorageError({ data: { detail: message } }), message)
  assert.doesNotMatch(backupStorageError({ response: { data: { detail: message + ' password=private-fixture' } } }), /private-fixture/)
})

test('shared storage permissions require their own explicit capability and boolean consent', () => {
  assert.deepEqual(backupStoragePermissionFields(capabilities, true), {})
  assert.deepEqual(backupStoragePermissionFields({ backup_storage_shared_permissions: 'true' }, true), {})
  const supported = { ...capabilities, backup_storage_shared_permissions: true }
  assert.deepEqual(backupStoragePermissionFields(supported, false), { allow_shared_permissions: false })
  assert.deepEqual(backupStoragePermissionFields(supported, true), { allow_shared_permissions: true })
  assert.deepEqual(backupStoragePermissionFields(supported, 'true'), { allow_shared_permissions: false })
})

const pageSource = readFileSync(new URL('../pages/services/[serviceId]/index.vue', import.meta.url), 'utf8')
const pageHandler = (name, end, state) => {
  const start = pageSource.indexOf(`const ${name} =`)
  assert.ok(start > 0)
  const finish = pageSource.indexOf(end, start)
  assert.ok(finish > start)
  return Function('state', `const { ${Object.keys(state).join(', ')} } = state;\n${pageSource.slice(start, finish)}\nreturn ${name};`)(state)
}

test('actual schedule Save preserves the configured path and adopts storage only explicitly', async () => {
  for (const [supported, destination] of [[false, ''], [true, ''], [true, '@default'], [true, 'archive']]) {
    let saved, rescheduled = 0
    const original = { custom_setting: 'preserved', symlink_backup_path: '/example/backups/{timestamp}.json' }
    const state = {
      service: ref({ process_name: 'Example Service', config: original }), symlinkBackupSaving: ref(false), symlinkManifestError: ref(''),
      symlinkBackupStorageSupported: ref(supported), symlinkBackupDestination: ref(destination), symlinkBackupScheduleEnabled: ref(true),
      symlinkBackupInterval: ref(168), symlinkBackupStartTime: ref('04:00'), symlinkBackupPathTemplate: ref(original.symlink_backup_path),
      symlinkBackupIncludeBroken: ref(true), symlinkBackupRetentionCount: ref(2), symlinkBackupRoots: ref(''),
      normalizeAutoUpdateStartTime: value => value, parseSymlinkRoots: () => null,
      configService: { updateConfig: async (name, updates, persist) => { assert.equal(name, 'Example Service'); assert.equal(persist, true); saved = updates } },
      processService: { rescheduleSymlinkBackup: async () => { rescheduled++ } }, getConfig: async () => {},
      refreshSymlinkBackupStatus: async () => {}, refreshSymlinkBackupManifests: async () => {},
      toast: { success() {}, error(value) { assert.fail(value.message) } },
    }
    await pageHandler('saveSymlinkBackupSettings', '\nconst normalizeAutoUpdateStartTime', state)()
    assert.equal(saved.symlink_backup_path, original.symlink_backup_path)
    assert.equal(saved.custom_setting, 'preserved')
    assert.equal(saved.backup_destination_id, supported ? destination : undefined)
    assert.equal(rescheduled, 1)
    assert.equal(state.symlinkBackupSaving.value, false)
  }
})

test('actual manual backup sends process-bound managed storage and keeps returned reference opaque', async () => {
  let payload, refreshed = 0
  const reference = 'dumb-backup://archive/namespace/artifact'
  const state = {
    service: ref({ process_name: 'Example Service' }), process_name_param: ref('unused'), symlinkBackupStorageCapabilities: ref(capabilities),
    symlinkManualBackupDestination: ref('archive'), symlinkManifestPath: ref('/example/legacy.json'), symlinkManifestIncludeBroken: ref(true),
    symlinkManifestError: ref(''), symlinkManifestResult: ref(null), symlinkManifestJobState: ref(''), symlinkManifestJobProgress: ref(null),
    symlinkManifestLoading: ref(false), symlinkManifestBackupAsyncSupported: ref(false), symlinkLastPayloadByOperation: {},
    buildSnapshotRoots: () => ['/library'], symlinkBackupPayload, clonePayload: value => structuredClone(value), addSymlinkJobHistoryEntry() {},
    processService: { runSymlinkManifestBackup: async body => { payload = body; return { backup_manifest: reference, recorded_entries: 2 } } },
    refreshSymlinkManifestFiles: async () => { refreshed++ }, refreshSymlinkBackupManifests: async () => {},
    toast: { success() {}, error(value) { assert.fail(value.message) } },
  }
  await pageHandler('runSymlinkManifestBackup', '\nconst runSymlinkManifestRestore', state)()
  assert.equal(payload.process_name, 'Example Service')
  assert.equal(payload.backup_destination_id, 'archive')
  assert.equal('backup_path' in payload, false)
  assert.equal(state.symlinkManifestPath.value, reference)
  assert.equal(refreshed, 1)
})

test('destination management and mount review require their own strict capabilities', () => {
  const managed = { ...capabilities, backup_storage_profile_management: true, backup_storage_management_protocol: 1, backup_storage_revalidation: true }
  assert.equal(backupStorageManagementSupported(managed), true)
  assert.equal(backupStorageRevalidationSupported(managed), true)
  for (const patch of [{ backup_storage_profile_management: false }, { backup_storage_profile_management: 'true' }, { backup_storage_management_protocol: '1' }, { backup_storage_protocol: 2 }, { backup_storage_kinds: [] }]) assert.equal(backupStorageManagementSupported({ ...managed, ...patch }), false)
  assert.equal(backupStorageManagementSupported(capabilities), false)
  assert.equal(backupStorageRevalidationSupported({ ...managed, backup_storage_revalidation: 'true' }), false)
})

test('registration does not pretend that a mount has been checked live', () => {
  const profile = { enabled: true, registered: true, ready: true }
  assert.equal(backupStorageAvailability(profile), 'Not checked')
  assert.equal(backupStorageAvailability({ ...profile, live_checked: 'true', validation_state: 'ready' }), 'Not checked')
  assert.equal(backupStorageAvailability({ ...profile, live_checked: true, validation_state: 'ready' }), 'Available at last check')
  assert.equal(backupStorageAvailability({ ...profile, live_checked: true, ready: false, validation_state: 'blocked' }), 'Unavailable at last check')
  assert.equal(backupStorageAvailability({ ...profile, enabled: false }), 'Disabled')
  assert.equal(backupStorageAvailability({ ...profile, registered: false }), 'Not registered')
})

test('mount confirmation binds the reviewed archive identity, capability and unexpired token', () => {
  const managed = { ...capabilities, backup_storage_profile_management: true, backup_storage_management_protocol: 1, backup_storage_revalidation: true }
  const profile = { id: 'archive', path: '/mnt/archive' }
  const review = { protocol: 1, destination_id: 'archive', ready: true, revalidation_required: true, token: 'private-reviewed-token', expires_at: 1900000300, registered: { path: profile.path }, observed: { path: profile.path } }
  const input = { capabilities: managed, profile, review, confirmed: true, busy: false, now: 1900000000000 }
  assert.equal(backupStorageRevalidationReady(input), true)
  for (const patch of [{ capabilities }, { profile: null }, { confirmed: 'true' }, { confirmed: false }, { busy: true }, { now: 1900000400000 }, { profile: { ...profile, id: 'other' } }, { profile: { ...profile, path: '/mnt/other' } }]) assert.equal(backupStorageRevalidationReady({ ...input, ...patch }), false)
  for (const patch of [{ protocol: '1' }, { revalidation_required: false }, { ready: 'true' }, { token: '' }, { token: 'token\nother' }, { expires_at: '1900000300' }, { observed: { path: '/mnt/other' } }]) assert.equal(backupStorageRevalidationReady({ ...input, review: { ...review, ...patch } }), false)
})

test('reference labels are bounded and never expose nested values or credentials', () => {
  assert.deepEqual(backupStorageUsage([{ kind: 'schedule', label: 'Scheduled installation backup' }, { nested: { token: 'hidden' } }, { label: 'token=private-fixture' }]), ['Scheduled installation backup', 'token=[redacted]'])
  assert.deepEqual(backupStorageUsage(null), [])
})

test('management client uses explicit per-profile verbs and preserves opaque review tokens', async () => {
  const calls = []
  const client = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (url, body) => { calls.push({ method, url, body }); return { data: { protocol: 1 } } }]))
  const repository = backupStorageRepository(client)
  await repository.update('archive/other', { id: 'archive/other', name: 'Renamed' })
  await repository.check('archive')
  await repository.revalidationPreview('archive')
  await repository.revalidate('archive', { token: 'reviewed-token', confirm: true })
  await repository.remove('archive')
  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ['put', '/api/process/backup-storage/profiles/archive%2Fother'],
    ['post', '/api/process/backup-storage/profiles/archive/check'],
    ['post', '/api/process/backup-storage/profiles/archive/revalidate/preview'],
    ['post', '/api/process/backup-storage/profiles/archive/revalidate'],
    ['delete', '/api/process/backup-storage/profiles/archive'],
  ])
  assert.deepEqual(calls[3].body, { token: 'reviewed-token', confirm: true })
  assert.equal(calls.some(call => call.url.endsWith('/default')), false)
})
