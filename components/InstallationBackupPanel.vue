<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import BackupStorageSelector from '~/components/BackupStorageSelector.vue'
import InstallationBackupReview from '~/components/InstallationBackupReview.vue'
import { backupStorageSupported } from '~/helper/backupStorage.js'
import { backupBytes as bytes, backupText as text, backupTime, installationBackupSupported, installationBlocked, installationJobActive, installationPreviewReady, installationRestartRequired, installationRollbackReady } from '~/helper/installationBackups.js'
import { createInstallationBackupController, initialInstallationBackupState } from '~/helper/installationBackupController.js'
import { installationBackupsRepository } from '~/services/installationBackups.js'

const state = ref(initialInstallationBackupState())
const controller = createInstallationBackupController({ state, repository: installationBackupsRepository() })
const tab = ref('backup'), destination = ref(''), restoreMode = ref('catalog'), reference = ref(''), archivePath = ref('')
const backupConfirmation = ref(''), restoreConfirmation = ref(''), backupAcknowledgements = ref({}), restoreAcknowledgements = ref({}), rollbackConfirmation = ref('')
const schedule = ref({ enabled: false, destination_id: '', interval_hours: 24, keep_last: 7 }), scheduleSaved = ref(false)
const now = ref(Date.now())
const lookupJobId = ref('')
const supported = computed(() => installationBackupSupported(state.value.capabilities))
const blocked = computed(() => installationBlocked(state.value))
const storageKind = computed(() => ['installation_backup', 'symlink_manifest', 'infinidysk_v2_archive'].find(kind => backupStorageSupported(state.value.capabilities, kind)))
const backupDestinationSupported = computed(() => backupStorageSupported(state.value.capabilities, 'installation_backup'))
const active = computed(() => installationJobActive(state.value.job))
const restoreInput = computed(() => restoreMode.value === 'catalog' ? { reference: reference.value } : { archive_path: archivePath.value.trim() })
const restoreInputValid = computed(() => restoreMode.value === 'catalog' ? reference.value.startsWith('dumb-backup://') : archivePath.value.trim().startsWith('/') && !archivePath.value.trim().startsWith('//') && !/[\x00-\x1f\x7f]/.test(archivePath.value))
const canStart = mode => installationPreviewReady({ state: state.value, mode, preview: state.value[mode === 'backup' ? 'backupPreview' : 'restorePreview'], confirmation: mode === 'backup' ? backupConfirmation.value : restoreConfirmation.value, acknowledgements: mode === 'backup' ? backupAcknowledgements.value : restoreAcknowledgements.value, now: now.value })
const scheduleValid = computed(() => typeof schedule.value.enabled === 'boolean' && (!schedule.value.enabled || Boolean(schedule.value.destination_id))
  && Number.isInteger(schedule.value.interval_hours) && schedule.value.interval_hours >= 1 && schedule.value.interval_hours <= 8760
  && Number.isInteger(schedule.value.keep_last) && schedule.value.keep_last >= 1 && schedule.value.keep_last <= 100)
const clearReview = () => { controller.invalidate(); backupConfirmation.value = ''; restoreConfirmation.value = ''; backupAcknowledgements.value = {}; restoreAcknowledgements.value = {} }
watch(destination, () => { clearReview(); reference.value = ''; controller.catalog(destination.value) })
watch([restoreMode, reference, archivePath], clearReview)
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
  <div class="space-y-4" :aria-busy="state.busy || state.loading" data-testid="installation-backups">
    <p>Back up DUMB configuration, authentication and supported managed application state. Review exclusions: this does not replace backups of external services, media or your container definition.</p>
    <p>Backup destinations hold closed archives. Active databases and live service directories are not moved to the backup share.</p>
    <p>On a replacement container, open this section before running setup. Mount the archive directory first, then preview a restore from an existing container file. DUMB does not mount NFS or SMB shares for you.</p>
    <button type="button" class="button-small border border-slate-600" :disabled="state.busy || state.loading" data-testid="installation-refresh" @click="refresh">{{ state.loading ? 'Loading backup status…' : 'Refresh backup status' }}</button>
    <p v-if="state.error" role="alert" class="text-rose-200" data-testid="installation-error">{{ state.error }}</p>
    <p v-if="state.operation === 'verify_restore'" role="status">Verifying the complete archive; large backups can take time. No application is stopped and no restore starts during this preview. Do not repeat the request while verification is running.</p>
    <p v-else-if="state.operation === 'preview_backup'" role="status">Inspecting backup coverage and capacity. Large source trees can take time; wait for the complete review before confirming.</p>
    <p v-if="state.resolved && !supported" class="text-amber-200">This backend does not advertise installation backup and restore. Upgrade DUMB to a version that supports these controls, then refresh. Existing service symlink snapshots remain in service tools.</p>
    <div v-if="storageKind" data-testid="installation-destination">
      <BackupStorageSelector v-model="destination" :capabilities="state.capabilities" :kind="storageKind" legacy-label="Choose a registered destination" :disabled="state.busy || active || (supported && !state.confirmed)" @catalog-changed="clearReview(); controller.catalog(destination)" />
      <p class="text-xs text-slate-400">This selection is used for new backup previews and the archive catalog. Save the schedule separately to change its configured destination; a schedule explicitly using the global default follows changes to that default.</p>
    </div>
    <template v-if="supported">
      <div class="rounded border border-slate-600 p-3 text-sm">
        <p class="font-semibold">Backup coverage</p>
        <ul class="list-inside list-disc"><li v-for="item in state.status?.scope?.includes || []" :key="item">{{ text(item) }}</li></ul>
        <p class="mt-2 font-semibold">Separate backups required</p>
        <ul class="list-inside list-disc"><li v-for="item in state.status?.scope?.excludes || []" :key="item">{{ text(item) }}</li></ul>
        <p v-for="(warning, index) in state.status?.warnings || []" :key="index" class="text-amber-200">{{ text(warning) }}</p>
      </div>
      <p v-if="state.status?.recovery_required || state.job?.status === 'recovery_required'" role="alert" class="text-amber-200">Recovery is required. New operations are blocked; keep the archives and recovery state, review the job and use only the backend-advertised rollback action.</p>
      <p v-if="installationRestartRequired(state.job)" role="status" class="text-amber-200" data-testid="installation-restart-required">Restore completed with applications stopped. Restart the DUMB container to load the restored configuration and authentication, then sign in with the restored credentials. This page does not restart DUMB.</p>
      <nav class="flex flex-wrap gap-2" aria-label="Backup sections">
        <button v-for="item in ['backup', 'restore', 'schedule', 'jobs']" :key="item" type="button" class="button-small border border-slate-600 capitalize" :aria-pressed="tab === item" :data-testid="`installation-tab-${item}`" @click="tab = item">{{ item === 'backup' ? 'Back up now' : item }}</button>
      </nav>
      <section v-if="tab === 'backup'" class="space-y-3">
        <p>Preview the exact included roots, exclusions, capacity and downtime before starting. Consistency checks that cannot be proven block the backup.</p>
        <p v-if="!backupDestinationSupported || !destination" class="text-amber-200">Choose a registered installation-backup destination above. A global default is used only when explicitly selected.</p>
        <button type="button" class="button-small border border-slate-600" :disabled="blocked || !backupDestinationSupported || !destination" data-testid="installation-preview" @click="controller.preview('backup', { destination_id: destination })">Preview backup</button>
        <InstallationBackupReview v-if="state.backupPreview" :preview="state.backupPreview" v-model:confirmation="backupConfirmation" v-model:acknowledgements="backupAcknowledgements" :disabled="state.busy || active" />
        <button v-if="state.backupPreview" type="button" class="button-small border border-slate-600" :disabled="!canStart('backup')" data-testid="installation-start" @click="controller.start('backup', backupConfirmation, backupAcknowledgements)">Start reviewed backup</button>
      </section>
      <section v-if="tab === 'restore'" class="space-y-3">
        <p>Restore replaces managed state. Applications remain stopped after success; restart DUMB yourself after reviewing the result. The preview must confirm archive integrity, destination ownership, capacity and rollback readiness.</p>
        <label class="mr-4"><input v-model="restoreMode" value="catalog" type="radio" :disabled="state.busy || active"> Registered archive</label>
        <label><input v-model="restoreMode" value="file" type="radio" :disabled="state.busy || active" data-testid="installation-restore-file-mode"> Existing container file</label>
        <label v-if="restoreMode === 'catalog'" class="block">Verified archive
          <select v-model="reference" :disabled="state.busy || active" class="block w-full rounded border border-slate-600 bg-slate-900 p-2" data-testid="installation-archive"><option value="">Choose an archive from the selected destination</option><option v-for="item in state.artifacts" :key="item.reference" :value="item.reference" :disabled="item.verified !== true">{{ item.artifact_id }} · {{ backupTime(item.created_at) }} · {{ bytes(item.size_bytes) }}{{ item.verified === true ? '' : ' · not verified' }}</option></select>
        </label>
        <label v-else class="block">Existing archive path inside this container
          <input v-model="archivePath" :disabled="state.busy || active" class="block w-full rounded border border-slate-600 bg-slate-900 p-2" placeholder="/mnt/backups/installation.tar" autocomplete="off" data-testid="installation-archive-path">
        </label>
        <button type="button" class="button-small border border-slate-600" :disabled="blocked || !restoreInputValid" data-testid="installation-restore-preview" @click="controller.preview('restore', restoreInput)">Preview restore</button>
        <InstallationBackupReview v-if="state.restorePreview" :preview="state.restorePreview" v-model:confirmation="restoreConfirmation" v-model:acknowledgements="restoreAcknowledgements" :disabled="state.busy || active" />
        <button v-if="state.restorePreview" type="button" class="button-small border border-rose-500" :disabled="!canStart('restore')" data-testid="installation-restore-start" @click="controller.start('restore', restoreConfirmation, restoreAcknowledgements)">Start reviewed restore</button>
      </section>
      <section v-if="tab === 'schedule'" class="space-y-3">
        <p>Scheduled backups are opt-in. Retention applies only to this installation-backup schedule at its selected destination; it does not prune manual backups or other backup types.</p>
        <p class="text-amber-200">Enabling a schedule authorizes recurring application downtime and archives containing private keys. Review coverage and arrange separate external backups before saving.</p>
        <section v-if="state.status?.schedule_runtime" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="installation-schedule-runtime">
          <h3 class="font-semibold">Schedule execution: {{ text(state.status.schedule_runtime.status) }}</h3>
          <p>Last attempt: {{ backupTime(state.status.schedule_runtime.last_attempt_at) }}</p>
          <p>Last verified scheduled backup: {{ backupTime(state.status.schedule_runtime.last_success_at) }}</p>
          <p>Next due: {{ backupTime(state.status.schedule_runtime.next_due_at) }}</p>
          <p v-if="state.status.schedule_runtime.blocker" role="alert" class="text-amber-200">{{ text(state.status.schedule_runtime.blocker) }}</p>
          <p v-if="state.status.schedule_runtime.error" role="alert" class="text-rose-200">{{ text(state.status.schedule_runtime.error) }}</p>
          <p v-if="state.status.schedule_runtime.job_id">Scheduled job: <code>{{ text(state.status.schedule_runtime.job_id) }}</code> <button type="button" class="button-small border border-slate-600" :disabled="state.busy" @click="controller.loadJob(state.status.schedule_runtime.job_id); tab = 'jobs'">View scheduled job</button></p>
          <p class="text-xs text-slate-400">Execution and retry times are reported by DUMB. Refreshing this page does not run a backup; manual backups do not advance scheduled-backup success.</p>
        </section>
        <p v-else class="text-amber-200">Schedule execution status is not confirmed. A saved schedule alone does not prove that a backup succeeded.</p>
        <label class="block"><input v-model="schedule.enabled" type="checkbox" :disabled="blocked" data-testid="installation-schedule-enabled"> Enable scheduled installation backups</label>
        <div v-if="backupDestinationSupported" data-testid="installation-schedule-destination"><BackupStorageSelector v-model="schedule.destination_id" :capabilities="state.capabilities" kind="installation_backup" legacy-label="Choose a schedule destination" :disabled="blocked" @catalog-changed="clearReview" /></div>
        <label class="block">Interval in hours<input v-model.number="schedule.interval_hours" type="number" min="1" max="8760" class="ml-2 w-28 rounded bg-slate-900 p-2" :disabled="blocked" data-testid="installation-schedule-hours"></label>
        <label class="block">Scheduled backups to retain<input v-model.number="schedule.keep_last" type="number" min="1" max="100" class="ml-2 w-28 rounded bg-slate-900 p-2" :disabled="blocked" data-testid="installation-schedule-retention"></label>
        <button type="button" class="button-small border border-slate-600" :disabled="blocked || !scheduleValid || (schedule.enabled && !backupDestinationSupported)" data-testid="installation-schedule-save" @click="saveSchedule">Save backup schedule</button>
        <button type="button" class="button-small border border-slate-600" :disabled="blocked || !state.status?.schedule" @click="schedule = { ...state.status.schedule }">Reload saved schedule</button>
        <p v-if="scheduleSaved" role="status">Backup schedule saved.</p>
      </section>
      <section class="space-y-3 rounded border border-slate-600 p-3" data-testid="installation-job">
        <h3 class="font-semibold">{{ state.job ? 'Backup / restore job' : 'No backup or restore job recorded' }}</h3>
        <template v-if="state.job">
          <p class="break-all">{{ state.job.job_id }} · {{ state.job.job_type === 'installation_restore' ? 'Installation restore' : 'Installation backup' }} · {{ state.job.status.replaceAll('_', ' ') }}</p>
          <p>{{ text(state.job.stage) }} {{ text(state.job.message) }}</p>
          <p class="text-xs">Last update: {{ backupTime(state.job.updated_at) }}</p>
          <p v-for="(error, index) in state.job.errors || []" :key="index" role="alert" class="text-rose-200">{{ text(error) }}</p>
          <p v-if="state.job.result?.reference" class="break-all">Archive reference: {{ text(state.job.result.reference) }}</p>
          <div v-if="state.job.can_rollback === true" class="space-y-2 rounded border border-amber-500 p-3">
            <p>Review the job error and retained recovery state before rollback. No automatic rollback is requested by this page.</p>
            <label class="block">Type exactly: <code>{{ text(state.job.rollback_confirmation_text) }}</code><input v-model="rollbackConfirmation" :disabled="state.busy || active" class="block w-full rounded bg-slate-900 p-2" autocomplete="off" data-testid="installation-rollback-confirmation"></label>
            <button type="button" class="button-small border border-amber-500" :disabled="!installationRollbackReady(state, rollbackConfirmation)" data-testid="installation-rollback" @click="rollback">Request reviewed rollback</button>
          </div>
        </template>
      </section>
      <section v-if="tab === 'restore' || tab === 'jobs'" class="space-y-2">
        <label v-if="tab === 'jobs'" class="block">Look up a retained job ID<input v-model="lookupJobId" class="ml-2 rounded bg-slate-900 p-2" autocomplete="off" data-testid="installation-job-id"><button type="button" class="button-small border border-slate-600" :disabled="state.busy || !/^[A-Za-z0-9_-]{1,160}$/.test(lookupJobId)" @click="controller.loadJob(lookupJobId)">Load job</button></label>
        <h3 class="font-semibold">Installation archive catalog</h3>
        <button type="button" class="button-small border border-slate-600" :disabled="state.busy || !destination" @click="controller.catalog(destination)">Refresh archives</button>
        <p v-if="state.catalogError" role="alert" class="text-rose-200">{{ state.catalogError }}</p>
        <p v-else-if="!destination">Select a destination above to list its archives. DUMB does not scan other destinations implicitly.</p>
        <p v-else-if="!state.artifacts.length">No installation archives were confirmed at this destination.</p>
        <div v-for="item in state.artifacts" :key="item.reference" class="rounded border border-slate-700 p-2 text-sm"><p>{{ item.artifact_id }} · {{ backupTime(item.created_at) }} · {{ bytes(item.size_bytes) }} · {{ item.verified === true ? 'Verified' : 'Unverified' }}</p><code class="break-all">{{ text(item.reference) }}</code></div>
      </section>
    </template>
  </div>
</template>

<style scoped>
[data-appearance-mode='light'] .text-amber-200 { @apply text-amber-800; }
[data-appearance-mode='light'] .text-rose-200 { @apply text-rose-800; }
[data-appearance-mode='light'] .text-slate-400 { @apply text-slate-600; }
</style>
