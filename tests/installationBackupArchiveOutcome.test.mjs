import test from 'node:test'
import assert from 'node:assert/strict'
import { installationVerifiedArchive, installationArchivePublicationUncertain, installationJobDisplay } from '../helper/installationBackups.js'
import { createInstallationBackupActivity, initialInstallationBackupActivity, installationBackupActivityView } from '../helper/installationBackupActivity.js'
const reference = 'dumb-backup://archive/installation/' + 'a'.repeat(32)
const receipt = changes => ({ artifact_id: 'a'.repeat(32), reference, backup_destination_id: 'archive', namespace: 'installation', artifact_kind: 'installation_backup', verified: true, sha256: 'b'.repeat(64), size_bytes: 4096, created_at: 1700000000, extension: 'tar', ...changes })
const job = changes => ({ job_id: 'backup_one', job_type: 'installation_backup', status: 'recovery_required', stage: 'resume_required', archive_verified: true, created_at: 1700000000, updated_at: 1700000010, errors: ['A retained application could not resume'], result: { complete: true, archive: receipt() }, ...changes })

test('saved archive proof is strict, canonical and backward compatible with complete legacy receipts', () => {
  assert.equal(installationVerifiedArchive(job()).reference, reference)
  const legacy = job(); delete legacy.archive_verified
  assert.equal(installationVerifiedArchive(legacy).reference, reference)
  for (const changed of [{ job_type: 'installation_restore' }, { archive_verified: false }, { archive_verified: 'true' }, { result: { complete: false, archive: receipt() } }, { result: { complete: true } }]) assert.equal(installationVerifiedArchive(job(changed)), null)
  for (const changed of [{ verified: false }, { verified: 'true' }, { sha256: 'bad' }, { size_bytes: -1 }, { size_bytes: '4096' }, { reference: 'dumb-backup://archive/installation/example' }, { reference: reference + '?secret=fixture' }, { artifact_kind: 'symlink_manifest' }, { namespace: 'other' }, { artifact_id: 'c'.repeat(32) }, { backup_destination_id: 'other' }, { compression: 'zstd', extension: 'tar' }]) assert.equal(installationVerifiedArchive(job({ result: { complete: true, archive: receipt(changed) } })), null)
})

test('archive copy counters and phase completion never substitute for verified saved receipt evidence', () => {
  const incomplete = job({ archive_verified: false, result: { complete: false }, progress: { stage: 'verifying', percent: 100, bytes_processed: 4096, total_bytes: 4096 }, message: 'Source or archive verification failed' })
  assert.equal(installationVerifiedArchive(incomplete), null)
  assert.doesNotMatch(installationJobDisplay(incomplete).statusLabel, /saved|verified/i)
  assert.equal(installationBackupActivityView({ ...initialInstallationBackupActivity(), job: incomplete }).archive, null)
})

test('service recovery and its reviewed restart preserve the separate verified archive outcome', () => {
  for (const changed of [{ status: 'running', stage: 'resuming' }, { status: 'recovery_required', stage: 'resume_required' }, { status: 'rolled_back', stage: 'restart_required', restart_required: true, result: { complete: true, archive: receipt(), restart_required: true } }, { status: 'rolled_back', stage: 'restart_required', restart_required: false, result: { complete: true, archive: receipt(), restart_required: false } }]) {
    const current = job(changed), display = installationJobDisplay(current)
    assert.equal(display.archive.reference, reference)
    assert.match(display.statusLabel, /saved/i); assert.doesNotMatch(display.statusLabel, /backup failed/i)
    assert.doesNotMatch(display.message, /create the backup again|no archive was accepted/i)
  }
  const pending = installationBackupActivityView({ ...initialInstallationBackupActivity(), job: job() })
  assert.equal(pending.title, 'Backup saved; service recovery required')
  assert.match(pending.displayMessage, /does not require creating the backup again/)
})

test('unconfirmed publication is distinct from verified archive success and from pre-publication validation failure', () => {
  const uncertain = job({ archive_verified: false, archive_publication_uncertain: true, stage: 'interrupted', result: undefined })
  assert.equal(installationArchivePublicationUncertain(uncertain), true)
  assert.equal(installationVerifiedArchive(uncertain), null)
  assert.match(installationJobDisplay(uncertain).message, /Inspect the backup catalog/)
  const legacy = job({ stage: 'publishing', result: undefined }); delete legacy.archive_verified
  assert.equal(installationArchivePublicationUncertain(legacy), true)
  assert.equal(installationArchivePublicationUncertain(job({ archive_verified: false, archive_publication_uncertain: false, result: undefined, stage: 'checking_source' })), false)
})

test('resume-only failure notifies saved archive recovery instead of claiming the backup failed', async () => {
  const state = { value: initialInstallationBackupActivity() }, notices = []
  let current = job({ status: 'running', stage: 'resuming' })
  const repository = { capabilities: async () => ({ installation_backup: true, installation_backup_protocol: 1 }), status: async () => ({ protocol: 1, job: current }) }
  const activity = createInstallationBackupActivity({ state, repository, notify: value => notices.push(value) })
  await activity.refresh(); current = job(); await activity.refresh()
  assert.equal(notices.length, 1); assert.equal(notices[0].type, 'warning'); assert.match(notices[0].title, /Backup saved/); assert.doesNotMatch(notices[0].title, /backup failed/i)
  await activity.refresh(); assert.equal(notices.length, 1)
})

test('a completed job without strict saved proof warns about missing receipt without claiming success or absence', async () => {
  const state = { value: initialInstallationBackupActivity() }, notices = []
  let current = job({ status: 'running', stage: 'verifying', archive_verified: false, result: { complete: false } })
  const activity = createInstallationBackupActivity({ state, repository: { capabilities: async () => ({ installation_backup: true, installation_backup_protocol: 1 }), status: async () => ({ protocol: 1, job: current }) }, notify: value => notices.push(value) })
  await activity.refresh(); current = { ...current, status: 'completed', stage: 'completed' }; await activity.refresh()
  assert.equal(notices.length, 1); assert.equal(notices[0].type, 'warning'); assert.match(notices[0].title, /receipt unavailable/)
  assert.doesNotMatch(notices[0].message, /no archive was accepted|archive is absent|backup failed/i)
})
