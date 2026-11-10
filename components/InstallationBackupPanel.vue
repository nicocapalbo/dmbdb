<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import BackupStorageSelector from '~/components/BackupStorageSelector.vue'
import InstallationBackupReview from '~/components/InstallationBackupReview.vue'
import { backupStorageSupported } from '~/helper/backupStorage.js'
import { backupBytes as bytes, backupText as text, backupTime, installationBackupSupported, installationBlocked, installationJobActive, installationPreviewReady, installationRestartRequired, installationRestoreInput, installationRollbackReady } from '~/helper/installationBackups.js'
import { createInstallationBackupController, initialInstallationBackupState } from '~/helper/installationBackupController.js'
import { installationBackupsRepository } from '~/services/installationBackups.js'

const state = ref(initialInstallationBackupState())
const controller = createInstallationBackupController({ state, repository: installationBackupsRepository() })
const tab = ref('backup'), destination = ref(''), restoreMode = ref('catalog'), reference = ref(''), archivePath = ref('')
const allowSharedPermissions = ref(false)
const backupConfirmation = ref(''), restoreConfirmation = ref(''), backupAcknowledgements = ref({}), restoreAcknowledgements = ref({}), rollbackConfirmation = ref('')
const schedule = ref({ enabled: false, destination_id: '', interval_hours: 24, keep_last: 7 }), scheduleSaved = ref(false)
const selectedDestination = computed({ get: () => tab.value === 'schedule' ? schedule.value.destination_id : destination.value, set: value => { if (tab.value === 'schedule') schedule.value.destination_id = value; else destination.value = value } })
const now = ref(Date.now())
const lookupJobId = ref('')
const supported = computed(() => installationBackupSupported(state.value.capabilities))
const blocked = computed(() => installationBlocked(state.value))
const storageKind = computed(() => ['installation_backup', 'symlink_manifest', 'infinidysk_v2_archive'].find(kind => backupStorageSupported(state.value.capabilities, kind)))
const backupDestinationSupported = computed(() => backupStorageSupported(state.value.capabilities, 'installation_backup'))
const active = computed(() => installationJobActive(state.value.job))
const sharedPermissionsSupported = computed(() => state.value.capabilities?.installation_backup_shared_permissions === true)
const restoreInput = computed(() => installationRestoreInput({ capabilities: state.value.capabilities, mode: restoreMode.value, reference: reference.value, archivePath: archivePath.value, allowSharedPermissions: allowSharedPermissions.value }))
const restoreInputValid = computed(() => restoreMode.value === 'catalog' ? reference.value.startsWith('dumb-backup://') : archivePath.value.trim().startsWith('/') && !archivePath.value.trim().startsWith('//') && !/[\x00-\x1f\x7f]/.test(archivePath.value))
const canStart = mode => installationPreviewReady({ state: state.value, mode, preview: state.value[mode === 'backup' ? 'backupPreview' : 'restorePreview'], confirmation: mode === 'backup' ? backupConfirmation.value : restoreConfirmation.value, acknowledgements: mode === 'backup' ? backupAcknowledgements.value : restoreAcknowledgements.value, now: now.value })
const scheduleValid = computed(() => typeof schedule.value.enabled === 'boolean' && (!schedule.value.enabled || Boolean(schedule.value.destination_id))
  && Number.isInteger(schedule.value.interval_hours) && schedule.value.interval_hours >= 1 && schedule.value.interval_hours <= 8760
  && Number.isInteger(schedule.value.keep_last) && schedule.value.keep_last >= 1 && schedule.value.keep_last <= 100)
const clearReview = () => { controller.invalidate(); backupConfirmation.value = ''; restoreConfirmation.value = ''; backupAcknowledgements.value = {}; restoreAcknowledgements.value = {} }
watch(destination, () => { clearReview(); reference.value = ''; controller.catalog(destination.value) })
watch([restoreMode, reference, archivePath, allowSharedPermissions, sharedPermissionsSupported], clearReview)
watch([restoreMode, archivePath, sharedPermissionsSupported], () => { allowSharedPermissions.value = false })
watch(() => state.value.backupPreview, () => { backupConfirmation.value = ''; backupAcknowledgements.value = {} })
watch(() => state.value.restorePreview, () => { restoreConfirmation.value = ''; restoreAcknowledgements.value = {} })
let scheduleInitialized = false
watch(() => state.value.status?.schedule, value => { if (value && !scheduleInitialized) { schedule.value = { ...value }; scheduleInitialized = true } })
watch(schedule, () => { scheduleSaved.value = false }, { deep: true })
const refresh = async () => { await controller.refresh(); await controller.catalog(destination.value) }
const saveSchedule = async () => { scheduleSaved.value = false; if (scheduleValid.value) scheduleSaved.value = await controller.saveSchedule({ ...schedule.value }) }
const rollback = async () => { if (await controller.rollback(rollbackConfirmation.value)) { rollbackConfirmation.value = ''; await refresh() } }
let timer, polling = false, disposed = false
onMounted(async () => {
  await refresh()
  if (disposed) return
  timer = setInterval(async () => {
    now.value = Date.now()
    if (polling || !installationJobActive(state.value.job)) return
    polling = true
    try { await controller.poll(); if (!installationJobActive(state.value.job)) await refresh() }
    finally { polling = false }
  }, 2000)
})
onUnmounted(() => { disposed = true; clearInterval(timer); controller.invalidate() })
</script>

<template>
  <div class="backup-panel" :aria-busy="state.busy || state.loading" data-testid="installation-backups">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="max-w-2xl">
        <p class="backup-muted text-sm leading-relaxed">Protect DUMB configuration, authentication and supported managed application state. Review coverage and downtime before each backup or restore.</p>
        <details class="mt-2 text-xs">
          <summary class="backup-muted cursor-pointer">Coverage and recovery requirements</summary>
          <div class="backup-card mt-3 space-y-3">
            <div class="grid gap-4 sm:grid-cols-2">
              <div><h3 class="font-medium">Included state</h3><ul class="backup-muted mt-2 list-inside list-disc space-y-1"><li v-for="item in state.status?.scope?.includes || []" :key="item">{{ text(item) }}</li></ul></div>
              <div><h3 class="font-medium">Separate backups required</h3><ul class="backup-muted mt-2 list-inside list-disc space-y-1"><li v-for="item in state.status?.scope?.excludes || []" :key="item">{{ text(item) }}</li></ul></div>
            </div>
            <p class="backup-muted">On a replacement container, mount the archive directory and open this section before setup. Active databases stay local; DUMB does not mount NFS or SMB shares.</p>
          </div>
        </details>
      </div>
      <button type="button" class="backup-button backup-secondary shrink-0" :disabled="state.busy || state.loading" data-testid="installation-refresh" @click="refresh"><span class="material-symbols-rounded !text-base" aria-hidden="true">refresh</span>{{ state.loading ? 'Loading backup status…' : 'Refresh backup status' }}</button>
    </header>
    <p v-if="state.error" role="alert" class="backup-notice backup-error" data-testid="installation-error">{{ state.error }}</p>
    <p v-if="state.operation === 'verify_restore'" role="status" class="backup-notice">Verifying the complete archive; large backups can take time. No application is stopped and no restore starts during this preview. Do not repeat the request while verification is running.</p>
    <p v-else-if="state.operation === 'preview_backup'" role="status" class="backup-notice">Inspecting backup coverage and capacity. Large source trees can take time; wait for the complete review before confirming.</p>
    <p v-if="state.resolved && !supported" class="backup-notice">This backend does not advertise installation backup and restore. Upgrade DUMB to a version that supports these controls, then refresh. Existing service symlink snapshots remain in service tools.</p>
    <p v-for="(warning, index) in state.status?.warnings || []" :key="index" class="backup-notice">{{ text(warning) }}</p>
    <template v-if="supported">
      <p v-if="state.status?.recovery_required || state.job?.status === 'recovery_required'" role="alert" class="backup-notice backup-warning">Recovery is required. New operations are blocked; keep the archives and recovery state, review the job and use only the backend-advertised rollback action.</p>
      <p v-if="installationRestartRequired(state.job)" role="status" class="backup-notice backup-warning" data-testid="installation-restart-required">Restore completed with applications stopped. Restart the DUMB container to load the restored configuration and authentication, then sign in with the restored credentials. This page does not restart DUMB.</p>
      <nav class="backup-tabs" aria-label="Backup sections">
        <button v-for="item in ['backup', 'restore', 'schedule', 'jobs']" :key="item" type="button" :aria-pressed="tab === item" :data-testid="`installation-tab-${item}`" @click="tab = item"><span class="material-symbols-rounded !text-lg" aria-hidden="true">{{ ({ backup: 'backup', restore: 'restore', schedule: 'schedule', jobs: 'history' })[item] }}</span>{{ item === 'backup' ? 'Back up now' : item[0].toUpperCase() + item.slice(1) }}</button>
      </nav>
    </template>

    <div v-if="storageKind" :data-testid="tab === 'schedule' ? 'installation-schedule-destination' : 'installation-destination'">
      <BackupStorageSelector v-model="selectedDestination" :capabilities="state.capabilities" :kind="storageKind" :label="tab === 'schedule' ? 'Schedule destination' : 'Backup destination'" :legacy-label="tab === 'schedule' ? 'Choose a schedule destination' : 'Choose a registered destination'" :disabled="state.busy || active || (supported && !state.confirmed)" @catalog-changed="clearReview(); controller.catalog(destination)" />
    </div>

    <template v-if="supported">
      <section v-if="tab === 'backup'" class="backup-card space-y-4">
        <div><h3 class="backup-heading">Create an installation backup</h3><p class="backup-muted mt-1 text-sm">Preview the included state, exclusions, space and downtime. No backup starts until you approve the review.</p></div>
        <p v-if="!backupDestinationSupported || !destination" class="backup-muted text-sm">Choose a registered installation-backup destination above. The global default is used only when explicitly selected.</p>
        <button type="button" class="backup-button backup-primary" :disabled="blocked || !backupDestinationSupported || !destination" data-testid="installation-preview" @click="controller.preview('backup', { destination_id: destination })">Preview backup</button>
        <InstallationBackupReview v-if="state.backupPreview" :preview="state.backupPreview" v-model:confirmation="backupConfirmation" v-model:acknowledgements="backupAcknowledgements" :disabled="state.busy || active" />
        <button v-if="state.backupPreview" type="button" class="backup-button backup-primary" :disabled="!canStart('backup')" data-testid="installation-start" @click="controller.start('backup', backupConfirmation, backupAcknowledgements)">Start reviewed backup</button>
      </section>

      <section v-if="tab === 'restore'" class="backup-card space-y-4">
        <div><h3 class="backup-heading">Restore an installation</h3><p class="backup-muted mt-1 text-sm">Choose an archive to verify before replacing managed state. After a successful restore, applications stay stopped until you restart DUMB.</p></div>
        <div class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label class="flex items-center gap-2"><input v-model="restoreMode" value="catalog" type="radio" :disabled="state.busy || active"> Registered archive</label>
          <label class="flex items-center gap-2"><input v-model="restoreMode" value="file" type="radio" :disabled="state.busy || active" data-testid="installation-restore-file-mode"> Existing container file</label>
        </div>
        <div v-if="restoreMode === 'catalog'" class="space-y-2">
          <label class="backup-label">Verified archive<select v-model="reference" :disabled="state.busy || active" class="backup-input mt-1" data-testid="installation-archive"><option value="">Choose an archive from the selected destination</option><option v-for="item in state.artifacts" :key="item.reference" :value="item.reference" :disabled="item.verified !== true">{{ item.artifact_id }} · {{ backupTime(item.created_at) }} · {{ bytes(item.size_bytes) }}{{ item.verified === true ? '' : ' · not verified' }}</option></select></label>
          <p v-if="state.catalogError" role="alert" class="backup-notice backup-error">{{ state.catalogError }}</p>
          <p v-else-if="!destination" class="backup-muted text-xs">Choose a destination above to list its archives, or use an existing container file.</p>
          <p v-else-if="!state.artifacts.length" class="backup-muted text-xs">No installation archives were confirmed at this destination.</p>
        </div>
        <label v-else class="backup-label">Existing archive path inside this container<input v-model="archivePath" :disabled="state.busy || active" class="backup-input mt-1" placeholder="/mnt/backups/installation.tar" autocomplete="off" data-testid="installation-archive-path"></label>
        <label v-if="restoreMode === 'file' && sharedPermissionsSupported" class="backup-consent">
          <input v-model="allowSharedPermissions" type="checkbox" :disabled="state.busy || active" class="mt-1 shrink-0" data-testid="installation-restore-shared-permissions">
          <span><strong class="block font-medium">Allow shared archive permissions</strong><span class="backup-muted mt-1 block text-xs leading-relaxed">I trust this storage’s access controls and everyone with access to backups containing credentials and private keys. DUMB does not make this storage private.</span></span>
        </label>
        <button type="button" class="backup-button backup-primary" :disabled="blocked || !restoreInputValid" data-testid="installation-restore-preview" @click="controller.preview('restore', restoreInput)">Preview restore</button>
        <InstallationBackupReview v-if="state.restorePreview" :preview="state.restorePreview" v-model:confirmation="restoreConfirmation" v-model:acknowledgements="restoreAcknowledgements" :disabled="state.busy || active" />
        <button v-if="state.restorePreview" type="button" class="backup-button backup-danger" :disabled="!canStart('restore')" data-testid="installation-restore-start" @click="controller.start('restore', restoreConfirmation, restoreAcknowledgements)">Start reviewed restore</button>
      </section>

      <section v-if="tab === 'schedule'" class="backup-card space-y-4">
        <div><h3 class="backup-heading">Scheduled installation backups</h3><p class="backup-muted mt-1 text-sm">Choose a destination above, then save to opt in. Retention affects only scheduled installation backups; manual archives and other backup types stay protected.</p></div>
        <label class="flex items-center gap-3 rounded-lg border border-slate-600 p-3 text-sm font-medium"><input v-model="schedule.enabled" type="checkbox" :disabled="blocked" data-testid="installation-schedule-enabled"> Enable scheduled installation backups</label>
        <p class="backup-muted text-xs">Enabling this schedule authorizes recurring application downtime and archives containing private keys. Review coverage and arrange separate external backups.</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="backup-label">Interval in hours<input v-model.number="schedule.interval_hours" type="number" min="1" max="8760" class="backup-input mt-1" :disabled="blocked" data-testid="installation-schedule-hours"></label>
          <label class="backup-label">Scheduled backups to retain<input v-model.number="schedule.keep_last" type="number" min="1" max="100" class="backup-input mt-1" :disabled="blocked" data-testid="installation-schedule-retention"></label>
        </div>
        <div class="flex flex-wrap gap-2"><button type="button" class="backup-button backup-primary" :disabled="blocked || !scheduleValid || (schedule.enabled && !backupDestinationSupported)" data-testid="installation-schedule-save" @click="saveSchedule">Save backup schedule</button><button type="button" class="backup-button backup-secondary" :disabled="blocked || !state.status?.schedule" @click="schedule = { ...state.status.schedule }">Reload saved schedule</button></div>
        <p v-if="scheduleSaved" role="status" class="backup-notice">Backup schedule saved.</p>
        <section v-if="state.status?.schedule_runtime" class="backup-divider space-y-2 text-sm" data-testid="installation-schedule-runtime">
          <h3 class="font-medium">Schedule execution: {{ text(state.status.schedule_runtime.status) }}</h3>
          <div class="backup-muted grid gap-2 text-xs sm:grid-cols-3"><p>Last attempt: {{ backupTime(state.status.schedule_runtime.last_attempt_at) }}</p><p>Last verified scheduled backup: {{ backupTime(state.status.schedule_runtime.last_success_at) }}</p><p>Next due: {{ backupTime(state.status.schedule_runtime.next_due_at) }}</p></div>
          <p v-if="state.status.schedule_runtime.blocker" role="alert" class="backup-notice backup-warning">{{ text(state.status.schedule_runtime.blocker) }}</p>
          <p v-if="state.status.schedule_runtime.error" role="alert" class="backup-notice backup-error">{{ text(state.status.schedule_runtime.error) }}</p>
          <p v-if="state.status.schedule_runtime.job_id" class="flex flex-wrap items-center gap-2">Scheduled job: <code>{{ text(state.status.schedule_runtime.job_id) }}</code><button type="button" class="backup-button backup-secondary" :disabled="state.busy" @click="controller.loadJob(state.status.schedule_runtime.job_id); tab = 'jobs'">View scheduled job</button></p>
          <p class="backup-muted text-xs">DUMB reports execution and retry times. Refreshing does not run a backup; manual backups do not advance schedule success.</p>
        </section>
        <p v-else class="backup-notice">Schedule execution status is not confirmed. A saved schedule alone does not prove that a backup succeeded.</p>
      </section>

      <section v-if="state.job || tab === 'jobs'" class="backup-card space-y-3" data-testid="installation-job">
        <h3 class="backup-heading">{{ state.job ? 'Backup / restore job' : 'No backup or restore job recorded' }}</h3>
        <template v-if="state.job">
          <div class="flex flex-wrap items-center gap-2"><span class="backup-badge">{{ state.job.status.replaceAll('_', ' ') }}</span><span class="text-sm">{{ state.job.job_type === 'installation_restore' ? 'Installation restore' : 'Installation backup' }}</span></div>
          <code class="backup-muted block break-all text-xs">{{ state.job.job_id }}</code>
          <p class="text-sm">{{ text(state.job.stage) }} {{ text(state.job.message) }}</p>
          <p class="backup-muted text-xs">Last update: {{ backupTime(state.job.updated_at) }}</p>
          <p v-for="(error, index) in state.job.errors || []" :key="index" role="alert" class="backup-notice backup-error">{{ text(error) }}</p>
          <p v-if="state.job.result?.reference" class="backup-muted break-all text-xs">Archive reference: {{ text(state.job.result.reference) }}</p>
          <div v-if="state.job.can_rollback === true" class="backup-notice backup-warning space-y-3">
            <p>Review the job error and retained recovery state before rollback. This page never requests rollback automatically.</p>
            <label class="backup-label">Type exactly: <code class="break-all">{{ text(state.job.rollback_confirmation_text) }}</code><input v-model="rollbackConfirmation" :disabled="state.busy || active" class="backup-input mt-1" autocomplete="off" data-testid="installation-rollback-confirmation"></label>
            <button type="button" class="backup-button backup-secondary" :disabled="!installationRollbackReady(state, rollbackConfirmation)" data-testid="installation-rollback" @click="rollback">Request reviewed rollback</button>
          </div>
        </template>
      </section>

      <section v-if="tab === 'jobs'" class="backup-card space-y-4">
        <label class="backup-label">Look up a retained job ID<span class="mt-1 flex flex-wrap gap-2"><input v-model="lookupJobId" class="backup-input flex-1" autocomplete="off" data-testid="installation-job-id"><button type="button" class="backup-button backup-secondary" :disabled="state.busy || !/^[A-Za-z0-9_-]{1,160}$/.test(lookupJobId)" @click="controller.loadJob(lookupJobId)">Load job</button></span></label>
        <div class="backup-divider flex flex-wrap items-center justify-between gap-2"><h3 class="font-medium">Installation archive catalog</h3><button type="button" class="backup-button backup-secondary" :disabled="state.busy || !destination" @click="controller.catalog(destination)">Refresh archives</button></div>
        <p v-if="state.catalogError" role="alert" class="backup-notice backup-error">{{ state.catalogError }}</p>
        <p v-else-if="!destination" class="backup-muted text-sm">Select a destination above to list its archives. DUMB does not scan other destinations implicitly.</p>
        <p v-else-if="!state.artifacts.length" class="backup-muted text-sm">No installation archives were confirmed at this destination.</p>
        <div v-for="item in state.artifacts" :key="item.reference" class="backup-archive"><div class="flex flex-wrap items-center justify-between gap-2"><p class="font-medium">{{ item.artifact_id }}</p><span class="backup-badge">{{ item.verified === true ? 'Verified' : 'Unverified' }}</span></div><p class="backup-muted mt-1 text-xs">{{ backupTime(item.created_at) }} · {{ bytes(item.size_bytes) }}</p><code class="backup-muted mt-2 block break-all text-xs">{{ text(item.reference) }}</code></div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.backup-panel { @apply min-w-0 space-y-5; color: var(--app-text); }
.backup-card { @apply min-w-0 rounded-xl border p-4 sm:p-5; background: var(--app-surface); border-color: var(--app-border-soft); }
.backup-heading { @apply text-base font-semibold; }
.backup-muted { color: var(--app-text-muted); }
.backup-label { @apply block text-sm font-medium; }
.backup-input { @apply block w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50; background: var(--app-panel-deep); border-color: var(--app-border); color: var(--app-text); }
.backup-button { @apply inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40; }
.backup-primary { background: var(--app-accent); color: var(--app-accent-contrast); }
.backup-primary:not(:disabled):hover { background: var(--app-accent-hover); }
.backup-secondary { @apply border; border-color: var(--app-border); }
.backup-secondary:not(:disabled):hover { background: var(--app-bg-soft); }
.backup-danger { background: var(--app-danger); color: #fff; }
.backup-tabs { @apply grid grid-cols-2 gap-1 rounded-xl border p-1 sm:flex; background: var(--app-panel-deep); border-color: var(--app-border-soft); }
.backup-tabs button { @apply min-w-0 flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition; color: var(--app-text-muted); }
.backup-tabs button[aria-pressed='true'] { background: var(--app-accent); color: var(--app-accent-contrast); }
.backup-tabs button:not([aria-pressed='true']):hover { background: var(--app-surface); color: var(--app-text); }
.backup-notice { @apply rounded-lg border px-3 py-2.5 text-sm leading-relaxed; border-color: var(--app-border); }
.backup-warning, .backup-consent { border-color: var(--app-warning); }
.backup-error { border-color: var(--app-danger); }
.backup-consent { @apply flex items-start gap-3 rounded-lg border p-3 text-sm; }
.backup-divider { @apply border-t pt-4; border-color: var(--app-border-soft); }
.backup-badge { @apply inline-block rounded-full px-2.5 py-1 text-xs font-medium; background: var(--app-bg-soft); }
.backup-archive { @apply rounded-lg border p-3 text-sm; border-color: var(--app-border-soft); }
</style>
