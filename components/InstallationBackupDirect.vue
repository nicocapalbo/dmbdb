<script setup>
import { backupAcknowledgementLabels, backupText as text } from '~/helper/installationBackups.js'

defineProps({ consent: { type: Object, required: true }, confirmation: String, acknowledgements: Object, disabled: Boolean })
const emit = defineEmits(['update:confirmation', 'update:acknowledgements'])
const labels = {
  ...backupAcknowledgementLabels,
  downtime: 'I approve stopping all managed applications for this backup, which can take hours on large installations or slow storage.',
  external_state: 'I understand media, external services and databases, and container configuration need their own backups; I reviewed the coverage and exclusions above.',
}
</script>

<template>
  <section class="direct-review space-y-4" data-testid="installation-direct-review">
    <div><h4 class="font-semibold">Back up without a preview</h4><p class="direct-muted mt-1 text-sm">DUMB will stop managed applications, inventory their stopped state once, check space, and create the backup. You will not receive an advance item count or size estimate. If coverage or capacity cannot be confirmed, the backup stops and DUMB attempts to resume applications.</p></div>
    <p class="direct-muted text-sm">Archive verification still runs. Keep the container and host running until the backup and application resumption finish; use direct frontend/API access because managed proxies and tunnels may stop.</p>
    <label v-for="key in consent.required_acknowledgements" :key="key" class="direct-ack"><input type="checkbox" :checked="acknowledgements?.[key] === true" :disabled="disabled" :data-testid="`installation-direct-ack-${key}`" @change="emit('update:acknowledgements', { ...acknowledgements, [key]: $event.target.checked })"><span>{{ labels[key] }}</span></label>
    <label class="block text-sm font-medium">Type exactly: <code class="direct-muted mt-1 block break-all text-xs">{{ text(consent.confirmation_text) }}</code><input :value="confirmation" :disabled="disabled" class="direct-input mt-2" autocomplete="off" data-testid="installation-direct-confirmation" @input="emit('update:confirmation', $event.target.value)"></label>
  </section>
</template>

<style scoped>
.direct-review { @apply rounded-xl border p-4 sm:p-5; border-color: var(--app-border); background: var(--app-panel-deep); }
.direct-muted { color: var(--app-text-muted); }
.direct-ack { @apply flex items-start gap-3 rounded-lg border p-3 text-xs leading-relaxed; border-color: var(--app-border-soft); }
.direct-ack input { @apply mt-0.5 shrink-0; }
.direct-input { @apply block w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50; border-color: var(--app-border); background: var(--app-surface); color: var(--app-text); }
</style>
