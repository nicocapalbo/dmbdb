<script setup>
import { computed } from 'vue'
import { infinidyskV2InventoryRows, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
const props = defineProps({ preview: { type: Object, default: null } })
const inventory = computed(() => infinidyskV2InventoryRows(props.preview?.inventory))
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
