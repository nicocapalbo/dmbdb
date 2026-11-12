<script setup>
import { computed, ref, watch } from 'vue'
import { buildSettingsUtilityCatalog } from '~/helper/settingsUtilities.js'

const props = defineProps({
  processes: { type: Array, default: () => [] },
  capabilities: { type: Object, default: null },
  globalConfig: { type: Object, default: () => ({}) },
  evidenceByProcess: { type: Object, default: () => ({}) },
  mediaProtectionStatus: { type: Object, default: null },
})
const emit = defineEmits(['open'])
const catalog = computed(() => buildSettingsUtilityCatalog(props))
const selectedProcess = ref('')
watch(catalog, rows => {
  if (!rows.some(row => row.processName === selectedProcess.value)) selectedProcess.value = rows[0]?.processName || ''
}, { immediate: true })
const selected = computed(() => catalog.value.find(row => row.processName === selectedProcess.value))
const open = tool => emit('open', {
  id: tool.id, processName: tool.processName, serviceKey: tool.serviceKey,
})
</script>

<template>
  <div class="settings-utilities" data-testid="settings-utilities">
    <p class="settings-utilities__hint">Choose a service or instance to open its existing tools. Safety checks and confirmations still apply.</p>
    <p v-if="!capabilities" class="settings-utilities__hint" role="status">Utility availability has not loaded yet.</p>
    <p v-else-if="!catalog.length" class="settings-utilities__hint" data-testid="settings-utilities-empty">No enabled services or saved utility configuration have supported tools available.</p>
    <template v-else>
      <label class="settings-utilities__field" for="settings-utility-service">
        <span>Service or instance</span>
        <select id="settings-utility-service" v-model="selectedProcess" data-testid="settings-utility-service">
          <option v-for="entry in catalog" :key="entry.processName" :value="entry.processName">{{ entry.processName }} — {{ entry.stateLabel }}</option>
        </select>
      </label>
      <div v-if="selected" class="settings-utilities__tools" :aria-label="'Utilities for ' + selected.processName">
        <button v-for="tool in selected.tools" :key="tool.id" type="button" class="settings-utilities__tool" :data-testid="'settings-utility-' + tool.id" @click="open(tool)">
          <span class="settings-utilities__title">{{ tool.label }}</span>
          <span class="settings-utilities__hint">{{ tool.description }}</span>
          <span class="settings-utilities__open" aria-hidden="true">Open →</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings-utilities { display: grid; gap: 1rem; margin-bottom: 1.5rem; color: var(--app-text); }
.settings-utilities__hint { font-size: .875rem; line-height: 1.5; opacity: .8; }
.settings-utilities__field { display: grid; gap: .4rem; font-size: .875rem; max-width: 42rem; }
.settings-utilities__field select { min-width: 0; width: 100%; padding: .65rem; border: 1px solid var(--app-border); border-radius: .5rem; background: var(--app-surface); color: inherit; }
.settings-utilities__tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: .75rem; }
.settings-utilities__tool { display: grid; gap: .5rem; padding: 1rem; border: 1px solid var(--app-border); border-radius: .65rem; background: var(--app-surface); color: inherit; text-align: left; cursor: pointer; }
.settings-utilities__tool:hover { background: var(--app-bg-soft); }
.settings-utilities__tool:focus-visible, .settings-utilities__field select:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.settings-utilities__title { font-weight: 600; }
.settings-utilities__open { justify-self: end; font-size: .8rem; font-weight: 600; }
</style>
