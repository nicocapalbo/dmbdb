<script setup>
import { computed } from 'vue'
import { formatInfiniDyskV2Bytes as bytes, infinidyskV2Capacity, infinidyskV2InventoryRows, infinidyskCompatibilityAuthRequired, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
import { infinidyskV2ReviewNotes, infinidyskV2SummaryLabel, infinidyskV2SummaryValue, infinidyskV2CheckText as checkText } from '~/helper/infinidyskV2Presentation.js'
const props = defineProps({ preview: { type: Object, default: null } })
const inventory = computed(() => infinidyskV2InventoryRows(props.preview?.inventory))
const capacity = computed(() => infinidyskV2Capacity(props.preview?.capacity))
const notices = computed(() => infinidyskV2ReviewNotes(props.preview))
const capacityStatus = { sufficient: 'Enough estimated space', insufficient: 'Insufficient space', unavailable: 'Unavailable' }
const summaryFields = ['runtime_generation', 'mount_backend', 'mount_path', 'database_provider', 'provider', 'import_strategy']
const technicalFields = ['host', 'port', 'database', 'user', 'runtime_dir', 'data_dir']
const hasTechnicalFields = side => technicalFields.some(field => props.preview?.[side]?.[field] != null)
</script>

<template>
  <div v-if="preview" class="space-y-3" data-testid="v2-review">
    <h3 class="font-semibold">Review the migration</h3>
    <div class="grid gap-3 md:grid-cols-2">
      <div v-for="side in ['current', 'target']" :key="side" class="rounded border border-slate-600 p-3">
        <p class="mb-2 font-semibold">{{ side === 'current' ? 'Current installation' : 'After migration' }}</p>
        <dl v-for="field in summaryFields" :key="field" class="text-sm">
          <template v-if="preview[side]?.[field] != null">
            <dt class="v2-muted">{{ infinidyskV2SummaryLabel(field) }}</dt>
            <dd class="break-all">{{ infinidyskV2SummaryValue(field, preview[side][field]) }}</dd>
          </template>
        </dl>
        <details v-if="hasTechnicalFields(side)" class="mt-3 text-sm"><summary class="cursor-pointer v2-muted">Application and database details</summary>
          <dl v-for="field in technicalFields" :key="field" class="mt-2"><template v-if="preview[side]?.[field] != null"><dt class="v2-muted">{{ infinidyskV2SummaryLabel(field) }}</dt><dd class="break-all">{{ text(preview[side][field]) }}</dd></template></dl>
        </details>
      </div>
    </div>
    <div v-if="preview.blockers?.length" class="space-y-2 rounded border border-rose-500 p-3" role="alert" data-testid="v2-preview-blockers"><p class="font-semibold text-rose-200">Resolve before continuing</p><p v-for="(item, index) in preview.blockers" :key="index" class="text-rose-200">{{ checkText(item) }}</p></div>
    <div v-if="notices.important.length" class="space-y-2 rounded border border-amber-600 p-3 text-sm text-amber-200" data-testid="v2-migration-warning"><p v-for="note in notices.important" :key="note.key">{{ note.message }}</p></div>
    <ul v-if="notices.notes.length" class="space-y-1 text-sm v2-muted" aria-label="Migration details"><li v-for="note in notices.notes" :key="note.key">{{ note.message }}</li></ul>
    <section v-if="notices.additional.length" class="space-y-1 text-sm v2-muted" data-testid="v2-additional-notices"><h4 class="font-medium">Additional notes from DUMB</h4><p v-for="(message, index) in notices.additional" :key="index">{{ message }}</p></section>
    <section v-if="infinidyskCompatibilityAuthRequired(preview.target)" class="rounded border border-slate-600 p-3 text-sm" data-testid="v2-compatibility-auth-target">
      <p>InfiniDysk will require a sign-in after the upgrade.</p>
      <details class="mt-2 v2-muted" data-testid="v2-auth-details-target"><summary class="cursor-pointer">Why sign-in is required</summary><p class="mt-2">DUMB requires native authentication for the compatibility listener and leaves your stored policy unchanged. The native interface cannot relax this launch requirement. Using the same backend and frontend port disables that compatibility listener.</p></details>
    </section>
    <div v-if="preview.backup_storage" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="v2-backup-storage-review">
      <p class="font-semibold">Migration recovery backup</p>
      <p v-if="preview.backup_storage.name">Location: {{ text(preview.backup_storage.name) }}</p>
      <p v-if="preview.backup_storage.path" class="break-all">Container path: {{ text(preview.backup_storage.path) }}</p>
      <p class="v2-muted">{{ preview.backup_storage.mode === 'cold_archive' ? 'DUMB will create and verify this archive before changing local files.' : 'DUMB will create this local recovery copy before changing the installation.' }} The working v2 database and DUMB’s recovery controls stay local.</p>
    </div>
    <div v-if="preview.source_storage?.mode === 'archive_recovery' && preview.source_storage.reclaim_source_space === true && preview.source_storage.rollback_requires_archive === true" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="v2-source-storage-review">
      <p class="font-semibold">{{ preview.source_storage.offload_legacy_blobs === true ? 'Legacy blobs will move to migration storage' : 'The local v1 directory will be reused' }}</p>
      <p v-if="preview.source_storage.offload_legacy_blobs === true" class="v2-muted">After verifying the archive and external import files, DUMB removes the local v1 blobs to make room for v2. The external location temporarily holds the recovery archive and working legacy files. The working v2 database stays local.</p>
      <p v-else class="v2-muted">This avoids a second local working copy. It does not remove the legacy blobs before import.</p>
      <p class="v2-muted">Restoring v1 requires its mount to remain available and takes additional downtime. Later v2 changes are discarded.</p>
    </div>
    <section v-if="capacity" class="space-y-3 rounded border border-slate-600 p-3 text-sm" aria-label="Migration disk capacity" data-testid="v2-capacity">
      <h3 class="font-semibold">Disk capacity: {{ capacityStatus[capacity.status] }}</h3>
      <p v-if="capacity.source" data-testid="v2-capacity-source">Source inventory: {{ capacity.source.entries.toLocaleString('en-US') }} entries · {{ bytes(capacity.source.logical_bytes) }} logical size · {{ capacity.source.root_count }} unique source {{ capacity.source.root_count === 1 ? 'root' : 'roots' }}. Shared source roots are counted once.</p>
      <p v-else class="text-amber-200">A complete capacity estimate is unavailable. Partial inventory values cannot establish that enough space is available.</p>
      <p v-if="capacity.release_is_projected" class="v2-muted" data-testid="v2-capacity-projection-note">Expected release is an estimate of space freed after DUMB verifies and removes the local legacy blobs. It is not free space available now.</p>
      <div v-for="(row, index) in capacity.filesystems" :key="index" class="space-y-2 rounded border border-slate-600 p-3" data-testid="v2-capacity-filesystem">
        <p class="font-semibold">{{ row.label }}<span v-if="row.phase_label"> · {{ row.phase_label }}</span>: <span :class="row.status === 'insufficient' ? 'text-rose-200' : row.status === 'unavailable' ? 'text-amber-200' : ''">{{ capacityStatus[row.status] }}</span></p>
        <p v-if="row.roles.length" class="v2-muted">{{ row.roles.join(' · ') }}</p>
        <dl class="grid grid-cols-2 gap-2">
          <dt>Required, including safety margin</dt><dd>{{ bytes(row.required_bytes) }}</dd>
          <dt>{{ capacity.release_is_projected ? 'Observed free space now' : 'Available' }}</dt><dd>{{ bytes(row.free_bytes) }}</dd>
          <template v-if="capacity.release_is_projected"><dt>Expected local space released</dt><dd>{{ bytes(row.projected_released_bytes) }}</dd><dt>Projected available for this phase</dt><dd>{{ bytes(row.projected_available_bytes) }}</dd></template>
          <dt>Shortfall</dt><dd>{{ bytes(row.shortfall_bytes) }}</dd>
          <dt>Included safety margin</dt><dd>{{ bytes(row.safety_margin_bytes) }}</dd>
        </dl>
      </div>
      <p class="text-xs v2-muted">Estimates are not a reservation. Requirements sharing a filesystem are combined. DUMB rechecks real capacity before copying, freeing local files and importing.</p>
    </section>
    <details v-if="preview.checks?.length" class="rounded border border-slate-600 p-3 text-sm" :open="preview.checks.some(check => check.passed === false || check.ready === false) ? true : undefined"><summary class="cursor-pointer font-medium">Migration checks</summary><ul class="mt-2 space-y-1"><li v-for="(check, index) in preview.checks" :key="index"><span :class="check.passed === false || check.ready === false ? 'text-rose-300' : 'v2-muted'">{{ checkText(check) }}</span></li></ul></details>
    <dl v-if="inventory.length" class="grid grid-cols-2 gap-2 rounded border border-slate-600 p-3 text-sm"><template v-for="row in inventory" :key="row.label"><dt class="v2-muted">{{ row.label }}</dt><dd>{{ row.value }}</dd></template></dl>
    <details v-for="kind in ['mounts', 'consumers', 'symlinks']" :key="kind" class="text-sm"><template v-if="Array.isArray(preview.inventory?.[kind]) && preview.inventory[kind].length"><summary class="cursor-pointer capitalize">Recorded {{ kind }}</summary><ul class="mt-2 space-y-1 break-all pl-3"><li v-for="(item, index) in preview.inventory[kind]" :key="index">{{ text(typeof item === 'string' ? item : [item.process_name, item.instance, item.path || item.mount_path].filter(Boolean).join(' · ')) }}</li></ul></template></details>
    <p v-if="inventory.length" class="text-xs v2-muted">This is DUMB’s recorded scope. You still need to check external apps, existing library paths and signed STRM links before upgrading.</p>
    <details v-if="preview.target_identity" class="rounded border border-slate-600 p-3 text-sm"><summary class="cursor-pointer font-medium">Verified PostgreSQL identity</summary><dl class="mt-2 grid grid-cols-2 gap-2"><template v-for="field in ['system_identifier', 'database_oid', 'schema']" :key="field"><dt>{{ field.replaceAll('_', ' ') }}</dt><dd>{{ text(preview.target_identity[field]) }}</dd></template></dl></details>
  </div>
</template>

<style scoped>
.v2-muted { color: var(--app-text-muted, #cbd5e1); }
[data-appearance-mode='light'] .text-amber-200 { @apply text-amber-800; }
[data-appearance-mode='light'] .text-rose-200,
[data-appearance-mode='light'] .text-rose-300 { @apply text-rose-800; }
</style>
