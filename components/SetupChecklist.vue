<script setup>
import { computed } from 'vue'
import SetupCheckEvidence from '~/components/SetupCheckEvidence.vue'
import SetupNativeTransition from '~/components/SetupNativeTransition.vue'
import { safeSetupLink, setupActionMatchesService, setupAutomationLabel, setupCoverageText, setupActionStateLabel, setupActionTiming } from '~/helper/setupArrangements.js'
const props = defineProps({ data: { type: Object, default: () => ({}) }, capabilities: { type: Object, default: () => ({}) }, serviceKey: { type: String, default: '' }, instanceKey: { type: String, default: '' }, preview: Boolean, busy: Boolean })
defineEmits(['action'])
const actions = computed(() => (props.data.actions || []).filter(action => setupActionMatchesService(action, props.serviceKey, props.instanceKey)))
const sections = computed(() => {
  if (!props.preview) return [{ key: 'actions', title: '', actions: actions.value }]
  return [
    ['automatic', 'DUMB will configure'],
    ['after_input', 'Information you must provide'],
    ['manual', 'Finish manually'],
    ['unsupported', 'Unsupported configuration'],
    ['unknown', 'Needs review'],
  ].map(([key, title]) => ({ key, title, actions: actions.value.filter(action => (action.automation || 'unknown') === key) })).filter(section => section.actions.length)
})
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
    <div v-if="coverage.length" class="flex flex-wrap gap-3 text-sm" aria-label="Setup coverage">
      <span v-for="item in coverage" :key="item" class="rounded border border-gray-600 px-2 py-1">{{ item }}</span>
    </div>
    <p class="text-sm text-gray-300">Configuration and connection checks are tracked separately. A running service does not establish that the complete workflow works.</p>
    <p v-if="!actions.length" class="text-gray-300">No setup actions are recorded for this selection.</p>
    <section v-for="section in sections" :key="section.key" class="space-y-3">
    <h3 v-if="section.title" class="text-lg font-semibold text-white">{{ section.title }}</h3>
    <article v-for="action in section.actions" :key="action.id" class="rounded-lg border border-gray-600 p-4 space-y-2" :data-setup-action="action.id">
      <div class="flex flex-wrap justify-between gap-2">
        <h3 class="font-semibold text-white">{{ action.label }}</h3>
        <span class="text-sm text-cyan-200">{{ setupAutomationLabel(action.automation) }}{{ action.required ? ' · Required' : ' · Optional' }}</span>
      </div>
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
        <a v-if="safeSetupLink(action.ui_url)" :href="safeSetupLink(action.ui_url)" class="text-cyan-300 underline">Open {{ action.service_key || 'service' }}</a>
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
    </article>
    </section>
  </div>
</template>
