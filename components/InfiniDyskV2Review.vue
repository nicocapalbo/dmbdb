<script setup>
import { computed } from 'vue'
import { formatInfiniDyskV2Bytes as bytes, infinidyskV2Capacity, infinidyskV2InventoryRows, infinidyskCompatibilityAuthRequired, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
const props = defineProps({ preview: { type: Object, default: null } })
const inventory = computed(() => infinidyskV2InventoryRows(props.preview?.inventory))
const capacity = computed(() => infinidyskV2Capacity(props.preview?.capacity))
const capacityStatus = { sufficient: 'Enough estimated space', insufficient: 'Insufficient space', unavailable: 'Unavailable' }
const summaryFields = ['runtime_generation', 'mount_backend', 'mount_path', 'database_provider', 'provider', 'import_strategy', 'host', 'port', 'database', 'user', 'runtime_dir', 'data_dir']
const checkText = value => text(typeof value === 'string' ? value : value?.message || value?.label
  || [value?.name, value?.status].filter(Boolean).join(': ').replaceAll('_', ' '))
</script>

<template>
  <div v-if="preview" class="space-y-3" data-testid="v2-review">
    <div class="grid gap-3 md:grid-cols-2">
      <div v-for="side in ['current', 'target']" :key="side" class="rounded border border-slate-600 p-3">
        <p class="mb-2 font-semibold capitalize">{{ side }}</p>
        <dl v-for="field in summaryFields" :key="field" class="text-sm">
          <template v-if="preview[side]?.[field] != null">
            <dt class="text-slate-400">{{ field.replaceAll('_', ' ') }}</dt>
            <dd class="break-all">{{ text(preview[side][field]) }}</dd>
          </template>
        </dl>
      </div>
    </div>
    <p v-for="(item, index) in preview.blockers || []" :key="`block-${index}`" class="text-rose-200">{{ checkText(item) }}</p>
    <p v-for="(item, index) in preview.warnings || []" :key="`warn-${index}`" class="text-amber-200">{{ checkText(item) }}</p>
    <p v-if="infinidyskCompatibilityAuthRequired(preview.target)" class="rounded border border-amber-500 p-3 text-sm text-amber-200" data-testid="v2-compatibility-auth-target">For the target compatibility listener, DUMB will lock native Required authentication at launch and leave your stored policy unchanged. The native interface cannot relax this launch requirement.</p>
    <div v-if="preview.backup_storage" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="v2-backup-storage-review">
      <p class="font-semibold">Retained backup: {{ preview.backup_storage.mode === 'cold_archive' ? 'verified cold archive' : 'legacy local tree' }}</p>
      <p v-if="preview.backup_storage.name">Destination: {{ text(preview.backup_storage.name) }}</p>
      <p v-if="preview.backup_storage.path" class="break-all">Container path: {{ text(preview.backup_storage.path) }}</p>
      <p>Backups are retained. Control state, local verification and the working candidate stay local. Review capacity for every filesystem; archived backups do not move the active SQLite database.</p>
    </div>
    <div v-if="preview.source_storage?.mode === 'archive_recovery' && preview.source_storage.reclaim_source_space === true && preview.source_storage.rollback_requires_archive === true" class="space-y-1 rounded border border-amber-600 p-3 text-sm text-amber-200" data-testid="v2-source-storage-review">
      <p class="font-semibold">Local v1 storage will be reused</p>
      <p>After archive verification, the original local data is reused for the v2 candidate. Recovery restores v1 from the selected archive and requires its mount to remain available. Allow additional downtime; later v2 writes are discarded during rollback.</p>
    </div>
    <section v-if="capacity" class="space-y-3 rounded border border-slate-600 p-3 text-sm" aria-label="Migration disk capacity" data-testid="v2-capacity">
      <h3 class="font-semibold">Disk capacity: {{ capacityStatus[capacity.status] }}</h3>
      <p v-if="capacity.source" data-testid="v2-capacity-source">Source inventory: {{ capacity.source.entries.toLocaleString('en-US') }} entries · {{ bytes(capacity.source.logical_bytes) }} logical size · {{ capacity.source.root_count }} unique source {{ capacity.source.root_count === 1 ? 'root' : 'roots' }}. Shared source roots are counted once.</p>
      <p v-else class="text-amber-200">A complete capacity estimate is unavailable. Partial inventory values cannot establish that enough space is available.</p>
      <div v-for="row in capacity.filesystems" :key="row.label" class="space-y-2 rounded border border-slate-600 p-3" data-testid="v2-capacity-filesystem">
        <p class="font-semibold">{{ row.label }}: <span :class="row.status === 'insufficient' ? 'text-rose-200' : row.status === 'unavailable' ? 'text-amber-200' : ''">{{ capacityStatus[row.status] }}</span></p>
        <p v-if="row.roles.length">{{ row.roles.join(' · ') }}</p>
        <dl class="grid grid-cols-2 gap-2">
          <dt>Required, including safety margin</dt><dd>{{ bytes(row.required_bytes) }}</dd>
          <dt>Available</dt><dd>{{ bytes(row.free_bytes) }}</dd>
          <dt>Shortfall</dt><dd>{{ bytes(row.shortfall_bytes) }}</dd>
          <dt>Included safety margin</dt><dd>{{ bytes(row.safety_margin_bytes) }}</dd>
        </dl>
      </div>
      <p class="text-xs text-slate-400">These are estimates, not a space reservation. Requirements sharing a filesystem are combined; available space is counted once. DUMB rechecks capacity before copying and between phases. The backend's checks and blockers determine whether you can proceed.</p>
    </section>
    <ul v-if="preview.checks?.length" class="space-y-1 text-sm">
      <li v-for="(check, index) in preview.checks" :key="index">
        <span :class="check.passed === false || check.ready === false ? 'text-rose-300' : 'text-slate-300'">{{ checkText(check) }}</span>
      </li>
    </ul>
    <dl v-if="inventory.length" class="grid grid-cols-2 gap-2 rounded bg-slate-950 p-3 text-sm">
      <template v-for="row in inventory" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></template>
    </dl>
    <details v-for="kind in ['mounts', 'consumers', 'symlinks']" :key="kind" class="text-sm">
      <template v-if="Array.isArray(preview.inventory?.[kind]) && preview.inventory[kind].length">
        <summary class="cursor-pointer capitalize">Recorded {{ kind }}</summary>
        <ul class="mt-2 space-y-1 break-all pl-3"><li v-for="(item, index) in preview.inventory[kind]" :key="index">{{ text(typeof item === 'string' ? item : [item.process_name, item.instance, item.path || item.mount_path].filter(Boolean).join(' · ')) }}</li></ul>
      </template>
    </details>
    <p v-if="inventory.length" class="text-xs text-slate-400">This is the backend's recorded scope. Empty STRM entries do not prove that external libraries or signed stream URLs are absent. Confirm all consumers and existing output paths before proceeding.</p>
    <dl v-if="preview.target_identity" class="grid grid-cols-2 gap-2 rounded border border-amber-600 p-3 text-sm">
      <template v-for="field in ['system_identifier', 'database_oid', 'schema']" :key="field"><dt>{{ field.replaceAll('_', ' ') }}</dt><dd>{{ text(preview.target_identity[field]) }}</dd></template>
    </dl>
  </div>
</template>

<style scoped>
[data-appearance-mode='light'] .text-amber-200 {
  @apply text-amber-800;
}

[data-appearance-mode='light'] .text-rose-200,
[data-appearance-mode='light'] .text-rose-300 {
  @apply text-rose-800;
}
</style>
