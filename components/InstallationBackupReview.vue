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
  <section class="space-y-3 rounded border border-slate-600 p-3" data-testid="installation-review">
    <h3 class="font-semibold">Review this operation</h3>
    <p v-for="(blocker, index) in preview.blockers || []" :key="`block-${index}`" role="alert" class="text-rose-200">{{ text(blocker) }}</p>
    <p v-for="(warning, index) in preview.warnings || []" :key="`warn-${index}`" class="text-amber-200">{{ text(warning) }}</p>
    <p v-if="preview.ready !== true" class="text-amber-200">The backend has not approved this operation. Resolve its blockers and make a fresh preview.</p>
    <h4 class="font-semibold">Included state</h4>
    <ul class="space-y-2 break-all text-sm">
      <li v-for="(root, index) in preview.inventory?.roots || []" :key="root.id || index" class="rounded border border-slate-700 p-2">
        <p>{{ text(root.path) }}</p><p>{{ (root.roles || []).map(text).join(' · ') }} · {{ Number.isSafeInteger(root.entries) ? root.entries.toLocaleString() : 'Unknown' }} entries · {{ bytes(root.logical_bytes) }}</p>
      </li>
    </ul>
    <h4 class="font-semibold">Excluded state</h4>
    <ul class="list-inside list-disc text-sm"><li v-for="(item, index) in preview.inventory?.excluded || []" :key="index">{{ text(item.path) }} {{ text(item) }}</li></ul>
    <section class="space-y-2 rounded border border-slate-600 p-3" data-testid="installation-capacity">
      <h4 class="font-semibold">Disk capacity: {{ capacity?.status === 'sufficient' ? 'Enough estimated space' : capacity?.status === 'insufficient' ? 'Insufficient space' : 'Unavailable' }}</h4>
      <p v-if="capacity?.source">{{ capacity.source.entries.toLocaleString() }} entries · {{ bytes(capacity.source.logical_bytes) }} logical size · {{ capacity.source.root_count }} unique roots.</p>
      <div v-for="row in capacity?.filesystems || []" :key="row.label" class="rounded border border-slate-700 p-2">
        <p class="font-semibold">{{ row.label }}</p>
        <dl class="grid grid-cols-2 gap-1 text-sm"><dt>Required, including margin</dt><dd>{{ bytes(row.required_bytes) }}</dd><dt>Available</dt><dd>{{ bytes(row.free_bytes) }}</dd><dt>Shortfall</dt><dd>{{ bytes(row.shortfall_bytes) }}</dd></dl>
      </div>
      <p class="text-xs text-slate-400">Estimates do not reserve space. Shared filesystems are counted once; DUMB rechecks before copying and between phases. Unknown capacity cannot authorize an operation.</p>
    </section>
    <p v-if="preview.backup" class="text-sm">Archive: {{ text(preview.backup.reference || preview.backup.archive_path || preview.backup.artifact_id) }}</p>
    <p v-if="preview.backup" class="break-all text-sm">SHA-256: {{ text(preview.backup.sha256) }} · format {{ preview.backup.schema_version }}</p>
    <p class="text-amber-200">Managed applications may be stopped for consistency. Review all included roots and exclusions before approving downtime.</p>
    <label v-for="key in preview.required_acknowledgements || []" :key="key" class="flex items-start gap-2 text-sm">
      <input type="checkbox" :checked="acknowledgements?.[key] === true" :disabled="disabled || !acknowledgementLabel(key)" :data-testid="`installation-ack-${key}`" @change="acknowledge(key, $event.target.checked)">
      <span>{{ acknowledgementLabel(key) || 'Unsupported acknowledgement; refresh backend capabilities before proceeding.' }}</span>
    </label>
    <label class="block text-sm">Type exactly: <code class="break-all">{{ text(preview.confirmation_text) }}</code>
      <input :value="confirmation" :disabled="disabled" class="mt-1 block w-full rounded border border-slate-600 bg-slate-900 p-2" autocomplete="off" data-testid="installation-confirmation" @input="emit('update:confirmation', $event.target.value)">
    </label>
  </section>
</template>

<style scoped>
[data-appearance-mode='light'] .text-amber-200 { @apply text-amber-800; }
[data-appearance-mode='light'] .text-rose-200 { @apply text-rose-800; }
[data-appearance-mode='light'] .text-slate-400 { @apply text-slate-600; }
</style>
