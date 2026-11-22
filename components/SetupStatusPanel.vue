<script setup>
import { computed, onMounted, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import { initialInstallationBackupActivity } from '~/helper/installationBackupActivity.js'
import SetupChecklist from '~/components/SetupChecklist.vue'
import SetupActionForm from '~/components/SetupActionForm.vue'
import SetupWalkthrough from '~/components/SetupWalkthrough.vue'
import { readSetupWalkthroughPreference, writeSetupWalkthroughPreference, setupWalkthroughActions } from '~/helper/setupWalkthrough.js'
import { setupChecklistSummary } from '~/helper/setupChecklistPresentation.js'
import { editableSetupChoices, setupRunStatusLabel, setupActionFields, setupLookupRefreshDelay, setupInstallationHoldReason, setupInstallationHoldText } from '~/helper/setupArrangements.js'
const props = defineProps({ serviceKey: { type: String, default: '' }, instanceKey: { type: String, default: '' }, processName: { type: String, default: '' }, always: Boolean, guidedEntry: Boolean, startGuided: Boolean, checklistInitially: Boolean, walkthroughHandoff: Boolean })
const emit = defineEmits(['walkthrough'])
const setup = useSetupArrangementsStore()
const backupActivity = useState('installationBackupActivity', initialInstallationBackupActivity)
const knownInstallationHold = computed(() => setupInstallationHoldReason(backupActivity.value))
const installationPaused = computed(() => Boolean(knownInstallationHold.value || setup.installationHold))
const installationHoldMessage = computed(() => setupInstallationHoldText(knownInstallationHold.value || setup.installationHold))
const resource = computed(() => props.processName ? (setup.run?.services || []).find(service => service.process_name === props.processName) : null)
const resolvedServiceKey = computed(() => resource.value?.service_key || props.serviceKey)
const resolvedInstanceKey = computed(() => resource.value?.instance_key || props.instanceKey)
const fields = computed(() => setup.run?.arrangement_schema?.fields || [])
const draft = ref({})
const panelOpen = ref(props.guidedEntry || props.startGuided || props.checklistInitially)
const panelBodyId = useId()
const walkthroughOpen = ref(false)
const fullChecklistOpen = ref(props.checklistInitially)
const walkthroughStarted = ref(false)
const autoGuideStarted = ref(false)
const scopedActions = computed(() => setupWalkthroughActions(setup.run || {}, { serviceKey: resolvedServiceKey.value, instanceKey: resolvedInstanceKey.value, includeOptionalChecks: true }))
const summary = computed(() => setupChecklistSummary(scopedActions.value))
watch(() => [props.guidedEntry, props.startGuided, props.checklistInitially], () => {
  if (props.guidedEntry || props.startGuided || props.checklistInitially) panelOpen.value = true
  if (props.checklistInitially) { walkthroughOpen.value = false; fullChecklistOpen.value = true }
  if (props.startGuided) autoGuideStarted.value = false
})
watch(() => setup.run?.run_id, () => {
  walkthroughOpen.value = false
  fullChecklistOpen.value = props.checklistInitially
  try { walkthroughStarted.value = Boolean(readSetupWalkthroughPreference(window.localStorage, setup.run || {}).activeActionId) } catch { walkthroughStarted.value = false }
}, { immediate: true })
function startWalkthrough() {
  if (setup.running || installationPaused.value || setup.actionBusy || !setup.run) return
  if (props.walkthroughHandoff) { emit('walkthrough', 'guided'); return }
  walkthroughStarted.value = true
  panelOpen.value = true
  walkthroughOpen.value = true
}
function openFullChecklist() {
  if (props.walkthroughHandoff) { emit('walkthrough', 'checklist'); return }
  try { writeSetupWalkthroughPreference(window.localStorage, setup.run || {}, { ...readSetupWalkthroughPreference(window.localStorage, setup.run || {}), paused: true }) } catch { /* The checklist still opens without browser storage. */ }
  walkthroughOpen.value = false
  panelOpen.value = true
  fullChecklistOpen.value = true
}
watch(() => [setup.run?.run_id, setup.running, setup.actionBusy, installationPaused.value, props.startGuided], () => {
  if (props.startGuided && !autoGuideStarted.value && setup.run && !setup.running && !setup.actionBusy && !installationPaused.value) {
    autoGuideStarted.value = true
    let paused = false
    try { paused = readSetupWalkthroughPreference(window.localStorage, setup.run).paused } catch { /* The guide remains usable without browser storage. */ }
    if (!paused) startWalkthrough()
  }
}, { immediate: true })
async function refreshWalkthrough(action) {
  if (installationPaused.value || setup.running || setup.actionBusy) return
  if (action?.id) await operate({ action, operation: 'recheck', values: {} })
  else { await setup.operate('recheck'); scheduleRefresh() }
}
watch(() => setup.run?.run_id, () => { draft.value = editableSetupChoices(setup.run?.values || {}) }, { immediate: true })
let timer
let disposed = false
let mounted = false
function scheduleRefresh() {
  clearTimeout(timer)
  if (knownInstallationHold.value) return
  const delay = setupLookupRefreshDelay(setup)
  if (!disposed && delay !== null) timer = setTimeout(refresh, delay)
}
async function refresh(latest = false) {
  clearTimeout(timer)
  if (disposed) return
  if (knownInstallationHold.value) {
    setup.suspendForInstallation(knownInstallationHold.value)
    return
  }
  await setup.refresh({ latest: latest === true })
  scheduleRefresh()
}
onMounted(() => { mounted = true; refresh() })
watch(knownInstallationHold, (current, previous) => {
  if (!mounted || disposed) return
  clearTimeout(timer)
  if (current) setup.suspendForInstallation(current)
  else if (previous) refresh()
})
watch(() => [setup.run?.run_id, setup.run?.status, setup.run?.next_retry_at, setup.run?.cancel_requested, setup.lookupState, setup.loading], scheduleRefresh)
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); draft.value = {} })
const actionFields = action => setupActionFields(action, fields.value)
async function operate({ action, operation, values: suppliedValues }) {
  if (installationPaused.value) return
  const allowed = new Set(actionFields(action).map(field => field.key))
  const values = suppliedValues || (operation === 'apply' ? Object.fromEntries(Object.entries(draft.value).filter(([key]) => allowed.has(key))) : {})
  const run = await setup.operate(operation, action.id, values)
  if (run && operation === 'apply') {
    const pending = Object.fromEntries(Object.entries(draft.value).filter(([key]) => !allowed.has(key)))
    draft.value = { ...editableSetupChoices(run.values || {}), ...pending }
  }
  scheduleRefresh()
}
</script>

<template>
  <section v-if="setup.supported !== false && (setup.run || setup.error || installationPaused || always)" class="rounded-xl border border-cyan-700 bg-gray-800 p-5 text-white space-y-4" data-setup-status>
    <div class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <h2 class="w-full min-w-0 text-xl font-semibold sm:w-auto sm:flex-1">
        <button type="button" class="flex w-full items-center justify-start gap-3 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" :aria-expanded="panelOpen" :aria-controls="panelBodyId" data-setup-toggle @click="panelOpen = !panelOpen">
          <span aria-hidden="true" class="text-sm text-cyan-200">{{ panelOpen ? '▾' : '▸' }}</span>
          <span>Setup checklist</span>
          <span class="text-sm font-normal text-cyan-200">{{ panelOpen ? 'Hide' : 'Show' }}</span>
        </button>
      </h2>
      <span v-if="setup.run" class="text-sm text-gray-200" role="status">{{ setupRunStatusLabel(setup.run.status) }}</span>
    </div>
    <p v-if="setup.run" class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-200" data-setup-summary>
      <span>
      <template v-if="summary.remaining">{{ summary.required }} required · {{ summary.optional }} optional {{ summary.remaining === 1 ? 'task needs' : 'tasks need' }} attention.</template>
      <template v-else-if="summary.total">No unfinished tasks in this checklist.</template>
      <template v-else>No setup tasks are recorded for this selection.</template>
      </span>
      <span v-if="summary.verified">{{ summary.verified }} checked.</span>
      <span v-if="summary.manual">{{ summary.manual }} confirmed by you.</span>
    </p>
    <div v-if="installationPaused" class="space-y-2 rounded-lg border border-cyan-700 bg-gray-900 p-3" role="status" data-setup-installation-hold>
      <p>{{ installationHoldMessage }}</p>
      <NuxtLink to="/settings#backups" class="text-cyan-200 underline">Open Backup and restore for status</NuxtLink>
    </div>
    <p v-if="setup.error && !installationPaused" role="alert" class="text-amber-200">{{ setup.error }}</p>
    <p v-if="!setup.run && setup.lookupState === 'empty'" class="text-gray-300">No saved setup run is available.</p>
    <p v-else-if="!setup.run && !setup.error && !installationPaused" role="status" class="text-gray-300">Loading saved setup results…</p>
    <p v-if="setup.run && setup.lookupState === 'unavailable'" class="text-gray-300">Showing the last saved result while a fresh response is unavailable.</p>
    <button v-if="setup.error && !installationPaused" type="button" class="rounded bg-cyan-700 px-3 py-2 disabled:opacity-50" :disabled="setup.loading || installationPaused" @click="refresh()">Retry loading checklist</button>
    <div v-show="panelOpen" :id="panelBodyId" class="space-y-4" data-setup-panel-content>
    <template v-if="setup.run">
      <p v-if="setup.run.status !== 'complete' && !installationPaused" class="text-sm text-gray-300">Finish connecting your apps when you are ready. Your progress is saved.</p>
      <section v-if="scopedActions.length && !walkthroughOpen" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-600/50 p-4" data-setup-walkthrough-offer>
        <div class="space-y-1">
        <h3 class="font-semibold">Prefer step-by-step help?</h3>
        <p v-if="setup.running" role="status" class="text-sm text-gray-200">DUMB is preparing or checking your apps. Guided configuration becomes available when this operation finishes.</p>
        <p v-else class="text-sm text-gray-300">The optional guide explains one task at a time.</p>
        </div>
        <div class="flex flex-wrap gap-3">
          <button v-if="!walkthroughOpen" type="button" class="rounded bg-cyan-700 px-3 py-2 disabled:opacity-50" :disabled="setup.running || !!setup.actionBusy || installationPaused" @click="startWalkthrough">{{ walkthroughStarted ? 'Resume guided setup' : 'Walk me through setup' }}</button>
          <button v-if="guidedEntry || walkthroughOpen" type="button" class="rounded border px-3 py-2" @click="openFullChecklist">Show full checklist</button>
        </div>
      </section>
      <div v-if="walkthroughOpen" class="flex justify-end"><button type="button" class="rounded border px-3 py-2" @click="openFullChecklist">Show full checklist</button></div>
      <SetupWalkthrough v-if="walkthroughOpen" v-model="draft" :run="setup.run" :capabilities="setup.capabilities || {}" :service-key="resolvedServiceKey" :instance-key="resolvedInstanceKey" :busy="!!setup.actionBusy || setup.running || installationPaused" @operate="operate" @refresh="refreshWalkthrough" @pause="walkthroughOpen = false" />
      <div v-if="!walkthroughOpen && (!guidedEntry || fullChecklistOpen)" class="space-y-4" data-setup-full-checklist>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="rounded bg-cyan-700 px-3 py-2 disabled:opacity-50" :disabled="!!setup.actionBusy || setup.running || installationPaused" @click="setup.operate('recheck')">Recheck connections</button>
        <button type="button" class="rounded border border-gray-500 px-3 py-2 disabled:opacity-50" :disabled="!!setup.actionBusy || setup.running || installationPaused" @click="setup.operate('retry')">Retry incomplete automatic steps</button>
        <button type="button" class="underline disabled:opacity-50" :disabled="setup.loading || installationPaused" @click="refresh()">Refresh</button>
        <button type="button" class="underline disabled:opacity-50" :disabled="setup.loading || installationPaused" @click="refresh(true)">View latest setup</button>
      </div>
      <SetupChecklist :data="setup.run" :capabilities="setup.capabilities || {}" :service-key="resolvedServiceKey" :instance-key="resolvedInstanceKey" :busy="!!setup.actionBusy || setup.running || installationPaused" @action="operate">
        <template #action="{ action }">
          <SetupActionForm v-if="action.kind !== 'native_transition' && (actionFields(action).length || action.previewable || action.explicit_only)" v-model="draft" :action="action" :fields="actionFields(action)" :busy="!!setup.actionBusy || setup.running || installationPaused" @operate="operate" />
        </template>
      </SetupChecklist>
      </div>
    </template>
    </div>
  </section>
</template>
