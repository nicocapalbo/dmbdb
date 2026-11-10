<script setup>
import { computed } from 'vue'
import { backupAcknowledgementLabels, backupBytes as bytes, backupCapacity, backupText as text } from '~/helper/installationBackups.js'

const props = defineProps({ preview: { type: Object, required: true }, confirmation: String, acknowledgements: Object, disabled: Boolean })
const emit = defineEmits(['update:confirmation', 'update:acknowledgements'])
const capacity = computed(() => backupCapacity(props.preview.capacity))
const acknowledge = (key, value) => emit('update:acknowledgements', { ...props.acknowledgements, [key]: value })
const acknowledgementLabel = key => Object.hasOwn(backupAcknowledgementLabels, key) ? backupAcknowledgementLabels[key] : ''
</script>

<template>
  <section class="review space-y-5" data-testid="installation-review">
    <div class="review-top"><span class="material-symbols-rounded !text-xl" aria-hidden="true">fact_check</span><div><h3 class="font-semibold">{{ preview.backup ? 'Review this restore' : 'Review this backup' }}</h3><p class="review-muted mt-1 text-xs">Check the scope and disk estimate, then confirm below.</p></div></div>
    <p v-for="(blocker, index) in preview.blockers || []" :key="`block-${index}`" role="alert" class="review-notice review-error">{{ text(blocker) }}</p>
    <p v-for="(warning, index) in preview.warnings || []" :key="`warn-${index}`" class="review-notice">{{ text(warning) }}</p>
    <p v-if="preview.ready !== true" class="review-notice">The backend has not approved this operation. Resolve its blockers and make a fresh preview.</p>
    <div class="grid gap-4 sm:grid-cols-2">
      <section class="review-scope"><h4 class="review-label">Included state</h4><ul class="mt-2 max-h-60 space-y-2 overflow-y-auto">
        <li v-for="(root, index) in preview.inventory?.roots || []" :key="root.id || index" class="review-root"><code class="block break-all text-xs">{{ text(root.path) }}</code><p class="review-muted mt-1 text-xs">{{ (root.roles || []).map(text).join(' · ') }} · {{ Number.isSafeInteger(root.entries) ? root.entries.toLocaleString() : 'Unknown' }} entries · {{ bytes(root.logical_bytes) }}</p></li>
      </ul></section>
      <section class="review-scope"><h4 class="review-label">Excluded state</h4><ul class="review-muted mt-2 list-inside list-disc space-y-2 text-xs leading-relaxed"><li v-for="(item, index) in preview.inventory?.excluded || []" :key="index"><span v-if="item.path" class="break-all">{{ text(item.path) }} — </span>{{ text(item) }}</li></ul></section>
    </div>
    <section class="review-capacity space-y-3" data-testid="installation-capacity">
      <div class="flex flex-wrap items-center justify-between gap-2"><h4 class="review-label">Disk capacity</h4><span class="review-status">{{ capacity?.status === 'sufficient' ? 'Enough estimated space' : capacity?.status === 'insufficient' ? 'Insufficient space' : 'Unavailable' }}</span></div>
      <p v-if="capacity?.source" class="review-muted text-xs">{{ capacity.source.entries.toLocaleString() }} entries · {{ bytes(capacity.source.logical_bytes) }} logical size · {{ capacity.source.root_count }} unique roots.</p>
      <div v-for="row in capacity?.filesystems || []" :key="row.label" class="review-filesystem">
        <p class="mb-2 text-sm font-medium">{{ row.label }}</p>
        <dl class="grid grid-cols-3 gap-2"><div><dt>Required, including margin</dt><dd>{{ bytes(row.required_bytes) }}</dd></div><div><dt>Available</dt><dd>{{ bytes(row.free_bytes) }}</dd></div><div><dt>Shortfall</dt><dd>{{ bytes(row.shortfall_bytes) }}</dd></div></dl>
      </div>
      <p class="review-muted text-xs leading-relaxed">Estimates do not reserve space. Shared filesystems are counted once; DUMB rechecks before copying and between phases. Unknown capacity cannot authorize an operation.</p>
    </section>
    <details v-if="preview.backup || preview.observed_permissions" class="text-xs">
      <summary class="review-muted cursor-pointer">Archive and permission details</summary>
      <div class="review-muted mt-3 space-y-2">
        <p v-if="preview.backup" class="break-all">Archive: {{ text(preview.backup.reference || preview.backup.archive_path || preview.backup.artifact_id) }}</p>
        <p v-if="preview.backup" class="break-all">SHA-256: {{ text(preview.backup.sha256) }} · format {{ preview.backup.schema_version }}</p>
        <p v-if="preview.observed_permissions" data-testid="installation-observed-permissions">Observed directory mode: {{ text(preview.observed_permissions.directory_mode) || 'Not recorded' }}; archive file mode: {{ text(preview.observed_permissions.file_mode) || 'Not recorded' }}. Mode bits do not prove ACL privacy or confidentiality.</p>
      </div>
    </details>
    <section class="review-confirm space-y-3">
      <div><h4 class="review-label">Confirm your review</h4><p class="review-muted mt-1 text-xs">Managed applications may stop for consistency. Review every acknowledgement before approving downtime.</p></div>
      <label v-for="key in preview.required_acknowledgements || []" :key="key" class="review-ack"><input type="checkbox" :checked="acknowledgements?.[key] === true" :disabled="disabled || !acknowledgementLabel(key)" :data-testid="`installation-ack-${key}`" @change="acknowledge(key, $event.target.checked)"><span>{{ acknowledgementLabel(key) || 'Unsupported acknowledgement; refresh backend capabilities before proceeding.' }}</span></label>
      <label class="review-label block">Type exactly: <code class="review-phrase">{{ text(preview.confirmation_text) }}</code><input :value="confirmation" :disabled="disabled" class="review-input mt-2" autocomplete="off" data-testid="installation-confirmation" @input="emit('update:confirmation', $event.target.value)"></label>
    </section>
  </section>
</template>

<style scoped>
.review { @apply rounded-xl border p-4 text-sm sm:p-5; border-color: var(--app-border); background: var(--app-panel-deep); color: var(--app-text); }
.review-top { @apply flex items-start gap-3; }
.review-muted { color: var(--app-text-muted); }
.review-label { @apply text-sm font-medium; }
.review-scope, .review-capacity { @apply rounded-lg border p-3; border-color: var(--app-border-soft); }
.review-root { @apply rounded-md p-2; background: var(--app-surface); }
.review-filesystem { @apply rounded-lg p-3; background: var(--app-surface); }
.review-filesystem dt { @apply text-xs; color: var(--app-text-muted); }
.review-filesystem dd { @apply mt-1 text-sm font-semibold; }
.review-status { @apply rounded-full px-2.5 py-1 text-xs font-medium; background: var(--app-surface); }
.review-notice { @apply rounded-lg border px-3 py-2 text-xs leading-relaxed; border-color: var(--app-warning); }
.review-error { border-color: var(--app-danger); }
.review-confirm { @apply border-t pt-4; border-color: var(--app-border); }
.review-ack { @apply flex items-start gap-3 rounded-lg border p-3 text-xs leading-relaxed; border-color: var(--app-border-soft); }
.review-ack input { @apply mt-0.5 shrink-0; }
.review-phrase { @apply mt-1 block break-all text-xs; color: var(--app-text-muted); }
.review-input { @apply block w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50; border-color: var(--app-border); background: var(--app-surface); color: var(--app-text); }
</style>
