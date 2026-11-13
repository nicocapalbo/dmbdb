<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useAuthStore } from '~/stores/auth.js'
import { initialInstallationBackupState } from '~/helper/installationBackupController.js'
import { backupBytes, backupText, backupTime } from '~/helper/installationBackups.js'
import { createInstallationBackupActivity, initialInstallationBackupActivity, installationBackupActivityView } from '~/helper/installationBackupActivity.js'
import { installationBackupsRepository } from '~/services/installationBackups.js'
const auth = useAuthStore()
const route = useRoute()
const toast = useToast()
const state = useState('installationBackupActivity', initialInstallationBackupActivity)
const now = ref(Date.now())
const view = computed(() => installationBackupActivityView(state.value, now.value))
const authorizationBlocked = ref(false)
const authIdentity = computed(() => [auth._initialized, auth.isAuthEnabled, auth.isAuthenticated, auth.user?.username || ''].join(':'))
const allowed = computed(() => auth._initialized === true && !authorizationBlocked.value && !['/login', '/setup'].includes(route.path) && (!auth.isAuthEnabled || auth.isAuthenticated))
const controller = createInstallationBackupActivity({ state, repository: installationBackupsRepository(), notify: ({ type, title, message }) => toast[type]({ title, message }) })
const previewState = useState('installationBackupState', initialInstallationBackupState)
const previewDestination = useState('installationBackupDestination', () => '')
const previewCompression = useState('installationBackupCompression', () => 'none')
const clearPrivatePreview = () => { previewState.value = { ...initialInstallationBackupState(), reviewGeneration: previewState.value.reviewGeneration + 1, identityGeneration: previewState.value.identityGeneration + 1 }; previewDestination.value = ''; previewCompression.value = 'none' }
let timer = null, clock = null, generation = 0
const openBackupSettings = async () => {
  if (route.path !== '/settings' || !['#backups', '#settings-section-backups'].includes(route.hash)) return
  window.dispatchEvent(new Event('hashchange'))
  await nextTick()
  document.getElementById('backups')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
const stop = () => { generation++; clearTimeout(timer); clearInterval(clock); timer = null; clock = null }
const poll = async current => {
  if (!allowed.value || current !== generation) return
  await controller.refresh()
  if (!allowed.value || current !== generation) return
  timer = setTimeout(() => poll(current), view.value.visible ? 5000 : 15000)
}
onMounted(() => {
  watch(authIdentity, () => { authorizationBlocked.value = false })
  watch(() => state.value.authorizationRejected, rejected => { if (rejected) { authorizationBlocked.value = true; clearPrivatePreview() } })
  watch(allowed, enabled => {
    stop()
    if (!enabled) { controller.reset(); clearPrivatePreview(); return }
    clock = setInterval(() => { now.value = Date.now() }, 1000)
    poll(generation)
  }, { immediate: true })
})
onBeforeUnmount(stop)
</script>

<template>
  <section v-if="allowed && view.visible" class="backup-activity mx-auto mt-3 w-[calc(100%-1.5rem)] max-w-7xl rounded-lg border p-4" :class="{ 'backup-activity-attention': view.recovery || view.restart || view.uncertain }" role="status" aria-live="polite" data-testid="installation-backup-activity">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-start gap-3">
        <span class="material-symbols-rounded !text-xl" :class="{ 'animate-spin': (view.active || view.preparing) && !view.uncertain }" aria-hidden="true">{{ (view.active || view.preparing) && !view.uncertain ? 'sync' : 'warning' }}</span>
        <div class="min-w-0 space-y-1">
          <h2 class="font-semibold">{{ view.title }}</h2>
          <p v-if="view.active || view.preparing" class="text-sm font-semibold">Do not stop the DUMB container or shut down the host until the backup finishes and its status is confirmed.</p>
          <p v-else-if="view.restart && view.displayJob?.job_type === 'installation_backup'" class="text-sm">Backup recovery completed with applications stopped. Restart DUMB to resume the retained installation. No archive was restored and no services were installed by backup recovery.</p>
          <p v-else-if="view.restart" class="text-sm">Managed applications remain stopped. Review the completed restore, then restart DUMB to load restored configuration and authentication.</p>
          <p v-else-if="view.displayJob?.job_type === 'installation_backup'" class="text-sm">The failed or interrupted backup retained your existing application data. Open Backup and restore to review and finish its recovery session. A container restart may be required before applications resume; this is not an archive restore or software installation.</p>
          <p v-else class="text-sm">The operation needs recovery review. Preserve the archive and retained recovery state; open Backup and restore before restarting or changing files.</p>
          <p class="break-all text-sm">{{ backupText((view.preparing ? state.preparation : view.displayJob)?.stage).replaceAll('_', ' ') }}<span v-if="view.preparing ? state.preparation?.message : view.displayMessage"> · {{ view.preparing ? backupText(state.preparation.message) : view.displayMessage }}</span></p>
          <p class="break-all text-xs"><span v-if="!view.preparing">Job <code>{{ backupText(view.displayJob?.job_id) }}</code> · Last status {{ backupTime(view.displayJob?.updated_at) }}</span><span v-if="view.elapsed">{{ view.preparing ? 'Elapsed ' : ' · Elapsed ' }}{{ view.elapsed }}</span></p>
          <dl v-if="view.progress && !view.preparing" class="grid gap-3 text-sm sm:grid-cols-3" data-testid="installation-backup-activity-progress">
            <div v-if="view.progress.entries !== null"><dt class="text-xs">{{ view.progress.entries_label }}</dt><dd>{{ view.progress.entries.toLocaleString() }}</dd></div>
            <div v-if="view.progress.logical_bytes !== null"><dt class="text-xs">{{ view.progress.logical_label }}</dt><dd>{{ backupBytes(view.progress.logical_bytes) }}</dd></div>
            <div v-if="view.progress.bytes_processed !== null"><dt class="text-xs">{{ view.progress.bytes_label }}</dt><dd>{{ backupBytes(view.progress.bytes_processed) }}</dd></div>
          </dl>
          <p v-if="state.recoveryJob && state.recoveryJob.job_id !== state.job?.job_id" class="text-sm">Retained job {{ backupText(state.recoveryJob.job_id) }} also requires recovery review. Preserve its archive and recovery state.</p>
          <p v-if="state.error" class="text-sm" data-testid="installation-backup-activity-error">{{ state.error }} Showing the last known operation state; it is not confirmed finished.</p>
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <NuxtLink to="/settings#backups" class="backup-activity-button" data-testid="installation-backup-activity-open" @click="openBackupSettings">Open Backup and restore</NuxtLink>
        <button type="button" class="backup-activity-button" :disabled="state.loading" data-testid="installation-backup-activity-refresh" @click="controller.refresh">{{ state.loading ? 'Refreshing…' : 'Refresh status' }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.backup-activity { color: var(--app-text); background: var(--app-bg-soft); border-color: var(--app-accent); }
.backup-activity-attention { border-color: var(--app-warning); }
.backup-activity-button { @apply inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm disabled:opacity-40; border-color: var(--app-border); }
.backup-activity-button:hover { background: var(--app-surface); }
</style>
