<script setup>
import { computed } from 'vue'
import { backupBytes, backupText, backupTime } from '~/helper/installationBackups.js'
import { backupPreviewActive, backupPreviewDuration, backupPreviewElapsed, backupPreviewStatusSupported } from '~/helper/installationBackupProgress.js'
const props = defineProps({ state: { type: Object, required: true }, now: { type: Number, required: true } })
const emit = defineEmits(['refresh', 'cancel'])
const operation = computed(() => props.state.previewOperation)
const active = computed(() => backupPreviewActive(operation.value))
const tracked = computed(() => backupPreviewStatusSupported(props.state.capabilities))
const elapsed = computed(() => backupPreviewDuration(backupPreviewElapsed(props.state, props.now)))
const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : 'Not yet reported'
const title = computed(() => props.state.previewUncertain ? 'Reconnecting to backup preview'
  : operation.value?.status === 'cancelling' ? 'Cancelling backup preview'
    : operation.value?.status === 'completed' ? 'Backup preview complete'
      : operation.value?.status === 'failed' ? 'Backup preview failed'
        : operation.value?.status === 'cancelled' ? 'Backup preview cancelled' : 'Inspecting backup coverage and space')
const quietFor = computed(() => Number.isFinite(operation.value?.last_progress_at) ? Math.max(0, props.now / 1000 - operation.value.last_progress_at) : null)
</script>

<template>
  <section class="preview-progress" role="status" aria-live="polite" data-testid="installation-preview-progress">
    <div class="flex items-start gap-3">
      <span class="material-symbols-rounded !text-xl" :class="{ 'animate-spin': active || state.previewUncertain || !operation }" aria-hidden="true">{{ active || state.previewUncertain || !operation ? 'sync' : operation.status === 'completed' ? 'fact_check' : 'info' }}</span>
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold">{{ title }}</h3><span class="preview-muted text-xs" data-testid="installation-preview-elapsed">Elapsed {{ elapsed }}</span></div>
        <p v-if="operation?.message" class="text-sm">{{ backupText(operation.message) }}</p>
        <p v-if="operation?.stage" class="preview-muted text-xs">Stage: {{ backupText(operation.stage).replaceAll('_', ' ') }}</p>
        <p v-if="!operation || active" class="text-sm">Applications stay running during this preview. Preview does not create a backup archive; starting one still requires your reviewed confirmation.</p>
        <dl v-if="operation" class="grid gap-3 text-sm sm:grid-cols-3" data-testid="installation-preview-counters">
          <div><dt class="preview-muted text-xs">Entries inspected</dt><dd>{{ count(operation.entries) }}</dd></div>
          <div><dt class="preview-muted text-xs">Logical size inspected</dt><dd>{{ backupBytes(operation.logical_bytes) }}</dd></div>
          <div><dt class="preview-muted text-xs">Roots completed</dt><dd>{{ count(operation.roots_completed) }} / {{ count(operation.root_count) }}</dd></div>
        </dl>
        <p v-if="operation?.current_root?.path" class="preview-muted break-all text-xs" data-testid="installation-preview-root">Current root: <code>{{ backupText(operation.current_root.path) }}</code></p>
        <p v-if="operation?.last_progress_at" class="preview-muted text-xs">Last inventory progress: {{ backupTime(operation.last_progress_at) }}<span v-if="active && quietFor >= 30"> · No new inventory progress reported for {{ backupPreviewDuration(quietFor) }}. DUMB may be waiting on storage.</span></p>
        <p v-if="state.previewStatusError" role="alert" class="preview-warning text-sm" data-testid="installation-preview-status-error">{{ state.previewStatusError }}</p>
        <p v-if="operation?.status === 'cancelling'" class="preview-warning text-sm">Cancellation is requested. Wait for DUMB to finish the current filesystem call and clean up its temporary inventory. A slow or blocked storage call may delay cancellation.</p>
        <p v-if="tracked && (active || state.previewUncertain || !operation)" class="preview-muted text-xs">You can leave this page and reopen Backup and restore to reconnect to the preview while this DUMB controller remains running. Closing the page does not stop the scan. Do not submit another preview while its status is unconfirmed.</p>
        <p v-else-if="!tracked" class="preview-muted text-xs">This backend cannot report scan counters or reconnect to a preview. Keep this page open for the result. Closing or refreshing may lose the review and does not confirm that DUMB stopped scanning; do not repeat the request.</p>
        <div v-if="tracked && (active || state.previewUncertain)" class="flex flex-wrap gap-2 pt-1">
          <button type="button" class="preview-button" data-testid="installation-preview-refresh" @click="emit('refresh')"><span class="material-symbols-rounded !text-base" aria-hidden="true">refresh</span>Refresh preview status</button>
          <button v-if="active" type="button" class="preview-button" :disabled="state.previewCancelPending || state.previewUncertain || operation.cancel_requested || operation.status === 'cancelling'" data-testid="installation-preview-cancel" @click="emit('cancel')">{{ operation.cancel_requested || operation.status === 'cancelling' ? 'Cancellation requested' : 'Cancel preview' }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.preview-progress { @apply rounded-lg border p-4; color: var(--app-text); border-color: var(--app-accent); background: var(--app-bg-soft); }
.preview-muted { color: var(--app-text-muted); }
.preview-warning { color: var(--app-text); @apply border-l-2 pl-3; border-color: var(--app-warning); }
.preview-button { @apply inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40; border-color: var(--app-border); }
.preview-button:not(:disabled):hover { background: var(--app-surface); }
</style>
