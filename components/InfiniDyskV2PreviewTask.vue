<script setup>
import { computed } from 'vue'
import { formatInfiniDyskV2Bytes as bytes } from '~/helper/infinidyskV2.js'
import { infinidyskV2PreviewDuration } from '~/helper/infinidyskV2Presentation.js'
import { infinidyskV2PreviewTaskActive } from '~/helper/infinidyskV2Preview.js'
const props = defineProps({ task: { type: Object, default: null }, pending: Boolean, uncertain: Boolean,
  confirmed: Boolean, cancelPending: Boolean, canRetry: Boolean, legacyBusy: Boolean,
  startedAt: { type: Number, default: null }, now: { type: Number, default: 0 } })
const emit = defineEmits(['refresh', 'cancel', 'retry'])
const active = computed(() => infinidyskV2PreviewTaskActive(props.task))
const duration = computed(() => infinidyskV2PreviewDuration(props.task, props.startedAt, props.now))
const finished = computed(() => ['completed', 'failed', 'interrupted', 'cancelled'].includes(props.task?.status))
const elapsed = computed(() => {
  const seconds = duration.value?.seconds
  return seconds == null ? null : seconds >= 60 ? Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's' : seconds + 's'
})
const heading = computed(() => props.uncertain ? (finished.value ? 'Checking saved preview status' : 'Checking preview status') : ({
  completed: props.task?.preview_available ? 'Migration preview ready' : 'Migration preview needs a new review',
  failed: 'Migration preview failed', interrupted: 'Migration preview interrupted', cancelled: 'Migration preview cancelled',
})[props.task?.status] || 'Preparing migration preview')
const counts = computed(() => Object.entries({ entries: 'Entries inspected', processed: 'Records inspected', blobs: 'Legacy blobs inspected', logical_bytes: 'Logical size inspected' })
  .filter(([key]) => Number.isSafeInteger(props.task?.progress?.[key])).map(([key, label]) => ({ key, label, value: key === 'logical_bytes' ? bytes(props.task.progress[key]) : props.task.progress[key].toLocaleString('en-US') })))
</script>

<template>
  <section v-if="task || pending || uncertain || legacyBusy" class="space-y-2 rounded border p-3 text-sm" :class="finished ? 'border-slate-500' : 'border-blue-400'" role="status" aria-live="polite" data-testid="v2-preview-status">
    <h3 tabindex="-1" class="font-semibold focus:outline-none" data-testid="v2-preview-heading">{{ heading }}</h3>
    <p>{{ finished ? 'The read-only inspection finished. It did not stop services or start a backup or migration.' : 'This is a read-only inspection. Your services keep running; no backup or migration has started.' }}</p>
    <p v-if="active && task?.cancel_requested">Stopping the preview scan safely. Keep checking status until cancellation is confirmed.</p>
    <p v-else-if="!finished && task?.message">{{ task.message }}</p>
    <p v-if="elapsed !== null">{{ finished ? 'Inspection duration' : 'Elapsed' }}: {{ elapsed }}<span v-if="task?.updated_at"> · Last update: {{ new Date(task.updated_at * 1000).toLocaleTimeString() }}</span></p>
    <dl v-if="counts.length" class="grid grid-cols-2 gap-2"><template v-for="row in counts" :key="row.key"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></template></dl>
    <progress v-if="!finished && (active || pending || uncertain || legacyBusy)" class="w-full" max="100" aria-label="Migration preview inspection in progress" />
    <p v-if="uncertain">{{ finished ? 'The saved preview has not been reconfirmed. Check status before relying on its result.' : 'DUMB may still be inspecting your library. Check status before starting another scan; reconnecting does not repeat the request.' }}</p>
    <p v-if="legacyBusy">This backend returns the preview in one request. Large libraries can take a long time, and a proxy may still interrupt the connection.</p>
    <p v-if="task?.preview_unavailable_reason === 'expired'">This preview has expired. Generate a fresh preview for another review.</p>
    <p v-if="task?.preview_unavailable_reason === 'consumed'">This preview was already used. Generate a fresh preview before another attempt.</p>
    <p v-if="task?.status === 'interrupted'">DUMB restarted during inspection. No scan resumes automatically; request a new preview when ready.</p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="button-small border border-slate-500" data-testid="v2-preview-refresh" @click="emit('refresh')">Check preview status</button>
      <button v-if="active && confirmed && task.can_cancel" type="button" class="button-small border border-amber-500 disabled:opacity-40" :disabled="cancelPending" data-testid="v2-preview-cancel" @click="emit('cancel')">{{ cancelPending ? 'Requesting cancellation…' : 'Cancel preview scan' }}</button>
      <button v-if="canRetry" type="button" class="button-small border border-blue-500" data-testid="v2-preview-retry" @click="emit('retry')">Retry preview connection</button>
    </div>
    <p v-if="canRetry">Retry reconnects the original request identity so the same request does not create duplicate scans.</p>
  </section>
</template>
