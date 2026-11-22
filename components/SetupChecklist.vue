<script setup>
import { computed, nextTick, ref, useId, watch } from 'vue'
import SetupCheckEvidence from '~/components/SetupCheckEvidence.vue'
import SetupNativeTransition from '~/components/SetupNativeTransition.vue'
import { safeSetupLink, setupActionMatchesService, setupAutomationLabel, setupCoverageText, setupActionStateLabel, setupActionTiming } from '~/helper/setupArrangements.js'
import { setupWalkthroughOutcome } from '~/helper/setupWalkthrough.js'
import { setupChecklistActions, setupChecklistFilteredActions, setupChecklistGroups, setupChecklistSummary } from '~/helper/setupChecklistPresentation.js'
const props = defineProps({ data: { type: Object, default: () => ({}) }, capabilities: { type: Object, default: () => ({}) }, serviceKey: { type: String, default: '' }, instanceKey: { type: String, default: '' }, preview: Boolean, busy: Boolean })
defineEmits(['action'])
const status = ref('attention')
const app = ref('all')
const openGroup = ref('')
const openAction = ref('')
const disclosureId = useId()
const statusControl = ref(null)
const actions = computed(() => props.preview
  ? (props.data.actions || []).filter(action => setupActionMatchesService(action, props.serviceKey, props.instanceKey))
  : setupChecklistActions(props.data, { serviceKey: props.serviceKey, instanceKey: props.instanceKey }))
const groups = computed(() => setupChecklistGroups(actions.value, props.data.services || []))
const summary = computed(() => setupChecklistSummary(actions.value))
const sections = computed(() => {
  if (!props.preview) return groups.value.filter(group => app.value === 'all' || group.key === app.value)
    .map(group => {
      const visible = new Set(setupChecklistFilteredActions(group.actions, status.value).map(action => action.id))
      return { ...group, title: group.label, actions: group.actions.filter(action => visible.has(action.id) || action.id === openAction.value) }
    })
    .filter(group => group.actions.length)
  return [
    ['automatic', 'DUMB will configure'],
    ['after_input', 'Information you must provide'],
    ['manual', 'Finish manually'],
    ['unsupported', 'Unsupported configuration'],
    ['unknown', 'Needs review'],
  ].map(([key, title]) => ({ key, title, actions: actions.value.filter(action => (action.automation || 'unknown') === key) })).filter(section => section.actions.length)
})
watch(() => props.data.run_id, () => { status.value = 'attention'; app.value = 'all'; openGroup.value = ''; openAction.value = '' })
watch(app, value => { openGroup.value = value === 'all' ? '' : value; openAction.value = '' })
watch(status, () => { openAction.value = '' })
watch(groups, value => {
  if (app.value !== 'all' && !value.some(group => group.key === app.value)) app.value = 'all'
})
function toggleGroup(event, key) {
  if (event.target.open) { openGroup.value = key; openAction.value = '' }
  else if (openGroup.value === key) {
    const resolved = status.value === 'attention' && setupWalkthroughOutcome(actions.value.find(action => action.id === openAction.value)).resolved
    openGroup.value = ''
    openAction.value = ''
    if (resolved) nextTick(() => { if (!openGroup.value) statusControl.value?.focus() })
  }
}
function toggleAction(event, id) {
  if (event.target.open) openAction.value = id
  else if (openAction.value === id) {
    const resolved = status.value === 'attention' && setupWalkthroughOutcome(actions.value.find(action => action.id === id)).resolved
    openAction.value = ''
    if (resolved) nextTick(() => { if (!openAction.value) statusControl.value?.focus() })
  }
}
const timing = action => setupActionTiming(action, props.data)
const coverage = computed(() => setupCoverageText(props.data.coverage))
const inputLabel = input => typeof input === 'string'
  ? (props.data.arrangement_schema?.fields || []).find(field => field.key === input)?.label || input
  : input.label || input.key
const instructions = action => {
  const lines = Array.isArray(action.instructions) ? action.instructions : action.instructions ? [action.instructions] : []
  return lines.filter(line => line !== action.reason)
}
</script>

<template>
  <div class="space-y-4" data-setup-checklist>
    <div v-if="preview && coverage.length" class="flex flex-wrap gap-3 text-sm" aria-label="Setup coverage">
      <span v-for="item in coverage" :key="item" class="rounded border border-gray-600 px-2 py-1">{{ item }}</span>
    </div>
    <p v-if="preview" class="text-sm text-gray-300">Configuration and connection checks are tracked separately. A running service does not establish that the complete workflow works.</p>
    <template v-else>
      <div class="flex flex-wrap items-end gap-4" data-setup-filters>
        <label class="flex min-w-0 flex-col gap-1 text-sm text-gray-200">Task status
          <select ref="statusControl" v-model="status" aria-label="Task status" class="max-w-full rounded border border-gray-500 bg-gray-900 px-3 py-2 text-white">
            <option value="attention">Needs attention ({{ summary.remaining }})</option>
            <option value="all">All tasks ({{ summary.total }})</option>
            <option value="checked">Checked or confirmed ({{ summary.verified + summary.manual }})</option>
          </select>
        </label>
        <label v-if="groups.length > 1" class="flex min-w-0 flex-col gap-1 text-sm text-gray-200">App
          <select v-model="app" aria-label="App" class="max-w-full rounded border border-gray-500 bg-gray-900 px-3 py-2 text-white">
            <option value="all">All apps</option>
            <option v-for="group in groups" :key="group.key" :value="group.key">{{ group.label }}</option>
          </select>
        </label>
      </div>
      <p class="text-sm text-gray-300">Choose an app, then open a task for instructions and controls. Checked tasks are hidden from Needs attention.</p>
      <p v-if="actions.length && !sections.length" class="rounded border border-gray-600 p-4 text-sm text-gray-200" role="status" data-setup-filter-empty>
        {{ status === 'attention' ? 'No unfinished tasks match this selection. Choose All tasks to review saved results.' : 'No tasks match this selection. Try another app or task status.' }}
      </p>
    </template>
    <p v-if="!actions.length" class="text-gray-300">No setup actions are recorded for this selection.</p>
    <component :is="preview ? 'section' : 'details'" v-for="section in sections" :key="section.key"
      :name="preview ? undefined : disclosureId + '-groups'" :open="preview ? undefined : openGroup === section.key"
      :data-setup-group="preview ? undefined : section.key" :class="preview ? 'space-y-3' : 'rounded-lg border border-gray-600'"
      @toggle.self="!preview && toggleGroup($event, section.key)">
    <h3 v-if="preview && section.title" class="text-lg font-semibold text-white">{{ section.title }}</h3>
    <summary v-if="!preview" class="cursor-pointer rounded-lg p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
      <span class="font-semibold text-white">{{ section.title }}</span>
      <span class="ml-3 inline-block text-sm text-gray-300">{{ section.summary.remaining }} {{ section.summary.remaining === 1 ? 'task needs' : 'tasks need' }} attention<span v-if="section.summary.required"> · {{ section.summary.required }} required</span></span>
    </summary>
    <div v-if="preview || openGroup === section.key" :class="preview ? 'space-y-3' : 'space-y-2 px-3 pb-3'">
    <component :is="preview ? 'article' : 'details'" v-for="action in section.actions" :key="action.id"
      class="rounded-lg border border-gray-600" :class="preview ? 'p-4 space-y-2' : ''" :data-setup-action="action.id"
      :name="preview ? undefined : disclosureId + '-actions'" :open="preview ? undefined : openAction === action.id"
      @toggle.self="!preview && toggleAction($event, action.id)">
      <div v-if="preview" class="flex flex-wrap justify-between gap-2">
        <h3 class="font-semibold text-white">{{ action.label }}</h3>
        <span class="text-sm text-cyan-200">{{ setupAutomationLabel(action.automation) }}{{ action.required ? ' · Required' : ' · Optional' }}</span>
      </div>
      <summary v-else class="cursor-pointer rounded-lg p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
        <span class="font-medium text-white">{{ action.label }}</span>
        <span class="ml-3 inline-block text-xs" :class="action.required ? 'text-cyan-200' : 'text-gray-300'">{{ action.required ? 'Required' : 'Optional' }}</span>
        <span class="mt-1 block text-sm" :class="setupWalkthroughOutcome(action).state === 'failed' ? 'text-amber-200' : 'text-gray-300'">{{ setupWalkthroughOutcome(action).label }}</span>
      </summary>
      <div v-if="preview || openAction === action.id" :class="preview ? 'space-y-2' : 'space-y-3 border-t border-gray-600 p-4'" data-setup-action-details>
      <p v-if="!preview && status === 'attention' && setupWalkthroughOutcome(action).resolved" role="status" class="text-sm text-cyan-200">{{ setupWalkthroughOutcome(action).label }}. This result stays open until you close this task.</p>
      <p v-if="!preview" class="text-sm text-cyan-200">{{ setupAutomationLabel(action.automation) }} · {{ action.required ? 'Required for this connection' : 'Optional' }}</p>
      <p v-if="!preview" class="text-sm text-gray-200">Configuration: {{ action.evidence?.level === 'user_attested' ? 'Confirmed by you' : setupActionStateLabel(action.execution) }} · Verification: {{ setupActionStateLabel(action.verification || 'unchecked') }}</p>
      <div v-if="!preview && (timing(action).checked || timing(action).retry || timing(action).attempts)" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300" aria-label="Check and retry history">
        <p v-if="timing(action).checked">Last checked: <time :datetime="timing(action).checked.datetime">{{ timing(action).checked.text }}</time></p>
        <p v-if="timing(action).retry">Next automatic retry: <time :datetime="timing(action).retry.datetime">{{ timing(action).retry.text }}</time></p>
        <p v-if="timing(action).attempts">{{ timing(action).attempts }} {{ timing(action).attempts === 1 ? 'attempt' : 'attempts' }}</p>
      </div>
      <p v-if="action.reason" class="text-sm text-amber-100">{{ action.reason }}</p>
      <SetupCheckEvidence v-if="!preview" :evidence="action.evidence" />
      <ul v-if="action.missing_inputs?.length" class="list-disc pl-5 text-sm text-amber-200">
        <li v-for="input in action.missing_inputs" :key="typeof input === 'string' ? input : input.key">Needed: {{ inputLabel(input) }}</li>
      </ul>
      <ol v-if="instructions(action).length" class="list-decimal space-y-1 pl-5 text-sm">
        <li v-for="(instruction, index) in instructions(action)" :key="index">{{ instruction }}</li>
      </ol>
      <div class="flex flex-wrap gap-4 text-sm">
        <a v-if="!preview && safeSetupLink(action.ui_url)" :href="safeSetupLink(action.ui_url)" target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline">Open {{ action.service_key || 'service' }} in a new tab</a>
        <span v-else-if="preview && safeSetupLink(action.ui_url)" class="text-gray-300">The app will be available from your checklist after startup.</span>
        <a v-if="safeSetupLink(action.docs_url)" :href="safeSetupLink(action.docs_url)" target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline">Configuration guide</a>
        <template v-if="!preview && action.kind !== 'native_transition'">
          <button v-if="['manual', 'unknown', 'unsupported'].includes(action.automation) && !['applied', 'already_present', 'user_confirmed'].includes(action.execution)" type="button" :disabled="busy" class="underline text-cyan-200 disabled:opacity-50" @click="$emit('action', { action, operation: 'confirm' })">I completed this manually</button>
          <button v-if="action.retryable && !action.previewable && !action.explicit_only" type="button" :disabled="busy" class="underline text-cyan-200 disabled:opacity-50" @click="$emit('action', { action, operation: 'apply' })">Retry this action</button>
          <button type="button" :disabled="busy" class="underline text-cyan-200 disabled:opacity-50" @click="$emit('action', { action, operation: 'recheck' })">Recheck</button>
          <button v-if="action.automation !== 'automatic' && action.execution !== 'applied'" type="button" :disabled="busy" class="underline text-gray-300 disabled:opacity-50" @click="$emit('action', { action, operation: 'defer' })">Do later</button>
        </template>
      </div>
      <SetupNativeTransition v-if="action.kind === 'native_transition'" :action="action" :capabilities="capabilities" :busy="busy" />
      <p v-if="!preview && ['manual', 'unknown', 'unsupported'].includes(action.automation)" class="text-xs text-gray-400">Manual completion records your confirmation. It does not perform a connection check.</p>
      <slot name="action" :action="action" />
      </div>
    </component>
    </div>
    </component>
    <details v-if="!preview" class="text-sm text-gray-300">
      <summary class="cursor-pointer text-cyan-200">About these checks</summary>
      <p class="mt-2">A running app does not mean its connections work. Checked tasks passed an automatic check; manual confirmations are recorded separately.</p>
      <div v-if="coverage.length" class="mt-2 flex flex-wrap gap-2" aria-label="Setup coverage"><span v-for="item in coverage" :key="item" class="rounded border border-gray-600 px-2 py-1">{{ item }}</span></div>
    </details>
  </div>
</template>
