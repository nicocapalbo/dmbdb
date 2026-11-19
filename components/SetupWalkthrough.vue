<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import SetupActionForm from '~/components/SetupActionForm.vue'
import SetupNativeTransition from '~/components/SetupNativeTransition.vue'
import SetupCheckEvidence from '~/components/SetupCheckEvidence.vue'
import { safeSetupLink, setupActionFields } from '~/helper/setupArrangements.js'
import {
  readSetupWalkthroughPreference, writeSetupWalkthroughPreference, setupWalkthroughPreference,
  setupWalkthroughActions, setupWalkthroughOutcome, setupWalkthroughPrerequisites, setupWalkthroughSummary,
  setupWalkthroughInstructions,
} from '~/helper/setupWalkthrough.js'

const props = defineProps({
  run: { type: Object, required: true },
  capabilities: { type: Object, default: () => ({}) },
  modelValue: { type: Object, default: () => ({}) },
  busy: Boolean,
  serviceKey: { type: String, default: '' },
  instanceKey: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'operate', 'refresh', 'pause'])
const storage = () => { try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null } }
const preference = ref(setupWalkthroughPreference(null, props.run))
const summaryOpen = ref(false)
const visited = ref(new Set())
const scope = computed(() => ({ serviceKey: props.serviceKey, instanceKey: props.instanceKey, includeOptionalChecks: preference.value.includeOptionalChecks }))
const actions = computed(() => setupWalkthroughActions(props.run, scope.value))
const fields = computed(() => props.run.arrangement_schema?.fields || [])
const active = computed(() => actions.value.find(action => action.id === preference.value.activeActionId) || null)
const activeFields = computed(() => active.value ? setupActionFields(active.value, fields.value) : [])
const outcome = computed(() => setupWalkthroughOutcome(active.value || {}))
const prerequisites = computed(() => setupWalkthroughPrerequisites(active.value || {}, props.run))
const instructions = computed(() => setupWalkthroughInstructions(active.value || {}))
const hasCheckDetails = computed(() => active.value?.evidence?.paths?.length || active.value?.evidence?.checks?.length)
const summary = computed(() => setupWalkthroughSummary(props.run, scope.value))
const optionalChecks = computed(() => setupWalkthroughActions(props.run, { ...scope.value, includeOptionalChecks: true }).some(action => action.explicit_only === true))
const draft = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const activeIndex = computed(() => actions.value.findIndex(action => action.id === active.value?.id))
const canDefer = computed(() => active.value && active.value.automation !== 'automatic' && outcome.value.state !== 'deferred' && !['applied', 'already_present', 'not_applicable'].includes(active.value.execution))
const canConfirm = computed(() => active.value && ['manual', 'unknown', 'unsupported'].includes(active.value.automation) && !outcome.value.manual && !outcome.value.complete)
const save = changes => { preference.value = writeSetupWalkthroughPreference(storage(), props.run, { ...preference.value, ...changes, runId: props.run.run_id }) }

function chooseFirst({ includeDeferred = false } = {}) {
  const next = actions.value.find(action => {
    const result = setupWalkthroughOutcome(action)
    return !result.resolved && (includeDeferred || result.state !== 'deferred')
  })
  save({ activeActionId: next?.id || null })
  summaryOpen.value = !next
}
function resume() {
  preference.value = readSetupWalkthroughPreference(storage(), props.run)
  visited.value = new Set()
  summaryOpen.value = false
  if (!active.value || setupWalkthroughOutcome(active.value).resolved || setupWalkthroughOutcome(active.value).state === 'deferred') chooseFirst()
  save({ paused: false })
}
watch(() => props.run.run_id, resume, { immediate: true })
watch(actions, () => { if (!summaryOpen.value && !active.value) chooseFirst() })
onMounted(() => { resume(); refreshCurrent() })
function next() {
  if (active.value) visited.value = new Set([...visited.value, active.value.id])
  const available = actions.value.filter(action => !setupWalkthroughOutcome(action).resolved && !visited.value.has(action.id))
  const following = available.find(action => actions.value.indexOf(action) > activeIndex.value) || available[0]
  if (following) save({ activeActionId: following.id })
  else summaryOpen.value = true
}
function previous() {
  const action = actions.value[activeIndex.value - 1]
  if (action) save({ activeActionId: action.id })
}
function reviewRemaining() { visited.value = new Set(); chooseFirst({ includeDeferred: true }) }
function pause() { save({ paused: true }); emit('pause') }
function optionalChanged(event) {
  save({ includeOptionalChecks: event.target.checked })
  visited.value = new Set()
  chooseFirst()
}
function operate(operation) { if (active.value && !props.busy) emit('operate', { action: active.value, operation }) }
function refreshCurrent() { if (!props.busy) emit('refresh', active.value) }
</script>

<template>
  <section class="space-y-4 rounded-xl border border-cyan-700 bg-gray-900 p-5 text-white" data-setup-walkthrough>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="text-xl font-semibold">Finish connecting your apps</h3>
        <p class="mt-1 text-sm text-gray-300">Work through one step at a time. Your saved setup stays available if you pause.</p>
      </div>
      <button type="button" class="rounded border px-3 py-2" data-setup-walkthrough-pause @click="pause">Pause walkthrough</button>
    </div>
    <p v-if="busy" role="status" class="text-sm text-gray-200">DUMB is applying or checking a step. Wait for its result before changing it.</p>
    <label v-if="optionalChecks" class="flex items-center gap-2 text-sm text-gray-200">
      <input type="checkbox" :checked="preference.includeOptionalChecks" :disabled="busy" @change="optionalChanged">
      Include optional workflow checks
    </label>
    <p class="text-sm text-gray-300" data-setup-walkthrough-count>{{ summary.verified }} checked · {{ summary.manual }} confirmed by you · {{ summary.remaining.length }} still need attention</p>

    <template v-if="active && !summaryOpen">
      <article class="space-y-4 rounded-lg border border-gray-600 p-4" :data-setup-walkthrough-action="active.id">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h4 class="text-lg font-semibold">{{ active.label || 'Review this app connection' }}</h4>
          <span class="text-sm text-cyan-200">{{ active.required ? 'Needed for this connection' : 'Optional' }}</span>
        </div>
        <p role="status" data-setup-walkthrough-outcome>{{ outcome.label }}</p>
        <p v-if="active.reason" class="text-sm text-gray-200">{{ active.reason }}</p>
        <ol v-if="instructions.length" class="list-decimal space-y-2 pl-5 text-gray-200" data-setup-walkthrough-instructions>
          <li v-for="instruction in instructions" :key="instruction">{{ instruction }}</li>
        </ol>
        <ul v-if="prerequisites.some(item => !item.ready)" class="space-y-1 text-sm text-gray-300" aria-label="Earlier setup steps">
          <li v-for="item in prerequisites" :key="item.id">{{ item.label }} · {{ item.status }}</li>
        </ul>
        <p v-if="outcome.manual" class="text-sm text-gray-200">Your confirmation is recorded. It does not replace an automatic connection check.</p>
        <p v-if="active.explicit_only" class="text-sm text-gray-200">This is an optional test. Opening it does not run it; review the scope and authorize any download, import or scan separately.</p>
        <SetupNativeTransition v-if="active.kind === 'native_transition'" :action="active" :capabilities="capabilities" :busy="busy" />
        <SetupActionForm v-else-if="activeFields.length || active.previewable || active.explicit_only" :key="active.id"
          v-model="draft" :action="active" :fields="activeFields" :context-fields="fields" :actions="run.actions || []" :services="run.services || []"
          :busy="busy" expanded guided @operate="$emit('operate', $event)" />
        <div class="flex flex-wrap gap-3 text-sm">
          <template v-if="active.kind !== 'native_transition'">
          <button type="button" class="rounded border px-3 py-2 disabled:opacity-50" :disabled="busy" @click="operate('recheck')">Recheck this step</button>
          <button v-if="active.retryable && !activeFields.length && !active.previewable && !active.explicit_only" type="button" class="rounded border px-3 py-2 disabled:opacity-50" :disabled="busy" @click="operate('apply')">Retry this step</button>
          <button v-if="canConfirm" type="button" class="underline disabled:opacity-50" :disabled="busy" @click="operate('confirm')">I completed this in the app</button>
          <button v-if="canDefer" type="button" class="underline disabled:opacity-50" :disabled="busy" @click="operate('defer')">Do this later</button>
          </template>
          <a v-if="safeSetupLink(active.ui_url)" :href="safeSetupLink(active.ui_url)" target="_blank" rel="noopener noreferrer" class="text-cyan-200 underline">Open app in a new tab</a>
          <a v-if="safeSetupLink(active.docs_url)" :href="safeSetupLink(active.docs_url)" target="_blank" rel="noopener noreferrer" class="text-cyan-200 underline">Setup guide</a>
        </div>
        <details v-if="hasCheckDetails" class="rounded border border-gray-600 p-3" data-setup-walkthrough-evidence>
          <summary class="cursor-pointer text-sm text-cyan-200">Connection check details</summary>
          <SetupCheckEvidence class="mt-3" :evidence="active.evidence" />
        </details>
      </article>
      <div class="flex flex-wrap justify-between gap-3">
        <button type="button" class="rounded border px-3 py-2 disabled:opacity-50" :disabled="busy || activeIndex <= 0" @click="previous">Previous step</button>
        <button type="button" class="rounded bg-cyan-700 px-3 py-2 disabled:opacity-50" :disabled="busy" data-setup-walkthrough-next @click="next">{{ outcome.complete || outcome.manual || outcome.state === 'deferred' ? 'Next step' : 'See another task' }}</button>
      </div>
      <p class="text-sm text-gray-300">Moving to another task does not mark this one complete.</p>
    </template>
    <section v-else class="space-y-3" data-setup-walkthrough-summary>
      <h4 class="text-lg font-semibold">{{ !summary.total ? 'No connection tasks are available' : summary.remaining.length ? 'Some setup tasks remain unfinished' : 'No unfinished tasks in this walkthrough' }}</h4>
      <p v-if="!summary.total" class="text-sm text-gray-300">Refresh the saved setup to see the steps available for these apps.</p>
      <p v-else-if="summary.remaining.length" class="text-sm text-gray-200">{{ summary.requiredRemaining }} {{ summary.requiredRemaining === 1 ? 'required task remains' : 'required tasks remain' }} and {{ summary.deferred }} {{ summary.deferred === 1 ? 'task was left' : 'tasks were left' }} for later.</p>
      <p v-else class="text-sm text-gray-200">You can return to the checklist or choose additional optional checks. Connection checks do not prove that every item in your library plays.</p>
      <div v-if="summary.confirmations.length" class="space-y-1 text-sm text-gray-200" data-setup-walkthrough-confirmations>
        <p>{{ summary.manual }} {{ summary.manual === 1 ? 'step was' : 'steps were' }} confirmed by you. {{ summary.manual === 1 ? 'It is' : 'They are' }} recorded separately from automatically checked connections.</p>
        <ul class="list-disc space-y-1 pl-5"><li v-for="item in summary.confirmations" :key="item.action.id">{{ item.action.label }} · {{ item.outcome.label }}</li></ul>
      </div>
      <ul v-if="summary.remaining.length" class="list-disc space-y-1 pl-5 text-sm text-gray-300">
        <li v-for="item in summary.remaining" :key="item.action.id">{{ item.action.label }} · {{ item.outcome.label }}</li>
      </ul>
      <button v-if="summary.remaining.length" type="button" class="rounded border px-3 py-2" :disabled="busy" @click="reviewRemaining">Review unfinished steps</button>
      <button type="button" class="rounded bg-cyan-700 px-3 py-2" @click="pause">Return to checklist</button>
    </section>
    <button type="button" class="text-sm text-cyan-200 underline disabled:opacity-50" :disabled="busy" @click="refreshCurrent">Refresh app choices and status</button>
    <p class="text-sm text-gray-300">Pausing closes this guide. Work already accepted by DUMB keeps running.</p>
  </section>
</template>
