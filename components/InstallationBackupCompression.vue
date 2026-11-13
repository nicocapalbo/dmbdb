<script setup>
import { computed } from 'vue'
import { backupCompressionMode, backupCompressionSchemaSupported, backupCompressionSupported } from '~/helper/installationBackupCompression.js'
const props = defineProps({ modelValue: { type: String, default: 'none' }, capabilities: Object, disabled: Boolean, testId: { type: String, required: true } })
const emit = defineEmits(['update:modelValue'])
const supported = computed(() => backupCompressionSupported(props.capabilities))
const visible = computed(() => backupCompressionSchemaSupported(props.capabilities) || backupCompressionMode(props.modelValue) !== 'none')
</script>

<template>
  <div v-if="visible" class="archive-compression space-y-2">
    <label class="compression-label">Archive format
      <select :value="modelValue" :disabled="disabled" :data-testid="testId" :aria-describedby="testId + '-help'" class="compression-input" @change="emit('update:modelValue', $event.target.value)">
        <option v-if="backupCompressionMode(modelValue) === null" value="" disabled>Choose an archive format</option>
        <option value="none">Uncompressed tar (.tar)</option>
        <option value="zstd" :disabled="!supported">Zstandard (.tar.zst)</option>
      </select>
    </label>
    <p :id="testId + '-help'" class="compression-help">Both formats are complete installation backups. Zstandard uses more CPU and may reduce storage and transfer size; the reduction is not guaranteed. Archives stream directly to the destination without an intermediate local tar. Local verification space is still required.</p>
    <p v-if="!supported" role="alert" class="compression-help">This backend does not advertise Zstandard backup support. Choose uncompressed tar or refresh backend support before continuing.</p>
  </div>
</template>

<style scoped>
.archive-compression { @apply min-w-0; color: var(--app-text); }
.compression-label { @apply block text-sm font-medium; }
.compression-input { @apply mt-1 block w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50; background: var(--app-panel-deep); border-color: var(--app-border); color: var(--app-text); }
.compression-help { @apply text-xs leading-relaxed; color: var(--app-text-muted); }
</style>
