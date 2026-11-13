<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import { initialInstallationBackupActivity } from '~/helper/installationBackupActivity.js'
import SetupChecklist from '~/components/SetupChecklist.vue'
import SetupActionForm from '~/components/SetupActionForm.vue'
import { editableSetupChoices, setupRunStatusLabel, setupActionFields, setupLookupRefreshDelay, setupInstallationHoldReason, setupInstallationHoldText } from '~/helper/setupArrangements.js'
const props = defineProps({ serviceKey: { type: String, default: '' }, instanceKey: { type: String, default: '' }, processName: { type: String, default: '' }, always: Boolean })
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
    <div class="flex flex-wrap justify-between gap-3">
      <h2 class="text-xl font-semibold">Setup checklist</h2>
      <span v-if="setup.run" role="status">{{ setupRunStatusLabel(setup.run.status) }}</span>
    </div>
    <div v-if="installationPaused" class="space-y-2 rounded-lg border border-cyan-700 bg-gray-900 p-3" role="status" data-setup-installation-hold>
      <p>{{ installationHoldMessage }}</p>
      <NuxtLink to="/settings#backups" class="text-cyan-200 underline">Open Backup and restore for status</NuxtLink>
    </div>
    <p v-if="setup.error && !installationPaused" role="alert" class="text-amber-200">{{ setup.error }}</p>
    <p v-if="!setup.run && setup.lookupState === 'empty'" class="text-gray-300">No saved setup run is available.</p>
    <p v-else-if="!setup.run && !setup.error && !installationPaused" role="status" class="text-gray-300">Loading saved setup results…</p>
    <p v-if="setup.run && setup.lookupState === 'unavailable'" class="text-gray-300">Showing the last saved result while a fresh response is unavailable.</p>
    <button v-if="setup.error && !installationPaused" type="button" class="rounded bg-cyan-700 px-3 py-2 disabled:opacity-50" :disabled="setup.loading || installationPaused" @click="refresh()">Retry loading checklist</button>
    <template v-if="setup.run">
      <p v-if="setup.run.status !== 'complete' && !installationPaused" class="text-gray-200">You can keep using DUMB and return here to finish configuration. Unfinished actions remain recorded.</p>
      <div class="flex gap-3">
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
    </template>
  </section>
</template>
