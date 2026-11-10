<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import SetupChecklist from '~/components/SetupChecklist.vue'
import SetupActionForm from '~/components/SetupActionForm.vue'
import { editableSetupChoices, setupRunStatusLabel, setupActionFields, setupRefreshDelay } from '~/helper/setupArrangements.js'
const props = defineProps({ serviceKey: { type: String, default: '' }, instanceKey: { type: String, default: '' }, processName: { type: String, default: '' }, always: Boolean })
const setup = useSetupArrangementsStore()
const resource = computed(() => props.processName ? (setup.run?.services || []).find(service => service.process_name === props.processName) : null)
const resolvedServiceKey = computed(() => resource.value?.service_key || props.serviceKey)
const resolvedInstanceKey = computed(() => resource.value?.instance_key || props.instanceKey)
const fields = computed(() => setup.run?.arrangement_schema?.fields || [])
const draft = ref({})
watch(() => setup.run?.run_id, () => { draft.value = editableSetupChoices(setup.run?.values || {}) }, { immediate: true })
let timer
let disposed = false
function scheduleRefresh() {
  clearTimeout(timer)
  const delay = setupRefreshDelay(setup.run)
  if (!disposed && delay !== null) timer = setTimeout(refresh, delay)
}
async function refresh(latest = false) {
  clearTimeout(timer)
  await setup.refresh({ latest: latest === true })
  scheduleRefresh()
}
onMounted(() => refresh())
watch(() => [setup.run?.run_id, setup.run?.status, setup.run?.next_retry_at, setup.run?.cancel_requested], scheduleRefresh)
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); draft.value = {} })
const actionFields = action => setupActionFields(action, fields.value)
async function operate({ action, operation, values: suppliedValues }) {
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
  <section v-if="setup.supported && (setup.run || setup.error || always)" class="rounded-xl border border-cyan-700 bg-gray-800 p-5 text-white space-y-4" data-setup-status>
    <div class="flex flex-wrap justify-between gap-3">
      <h2 class="text-xl font-semibold">Setup checklist</h2>
      <span v-if="setup.run" role="status">{{ setupRunStatusLabel(setup.run.status) }}</span>
    </div>
    <p v-if="setup.error" role="alert" class="text-amber-200">{{ setup.error }}</p>
    <p v-if="!setup.run" class="text-gray-300">No saved setup run is available.</p>
    <template v-if="setup.run">
      <p v-if="setup.run.status !== 'complete'" class="text-gray-200">You can keep using DUMB and return here to finish configuration. Unfinished actions remain recorded.</p>
      <div class="flex gap-3">
        <button type="button" class="rounded bg-cyan-700 px-3 py-2 disabled:opacity-50" :disabled="!!setup.actionBusy || setup.running" @click="setup.operate('recheck')">Recheck connections</button>
        <button type="button" class="rounded border border-gray-500 px-3 py-2 disabled:opacity-50" :disabled="!!setup.actionBusy || setup.running" @click="setup.operate('retry')">Retry incomplete automatic steps</button>
        <button type="button" class="underline disabled:opacity-50" :disabled="setup.loading" @click="refresh()">Refresh</button>
        <button type="button" class="underline disabled:opacity-50" :disabled="setup.loading" @click="refresh(true)">View latest setup</button>
      </div>
      <SetupChecklist :data="setup.run" :capabilities="setup.capabilities || {}" :service-key="resolvedServiceKey" :instance-key="resolvedInstanceKey" :busy="!!setup.actionBusy || setup.running" @action="operate">
        <template #action="{ action }">
          <SetupActionForm v-if="action.kind !== 'native_transition' && (actionFields(action).length || action.previewable || action.explicit_only)" v-model="draft" :action="action" :fields="actionFields(action)" :busy="!!setup.actionBusy || setup.running" @operate="operate" />
        </template>
      </SetupChecklist>
    </template>
  </section>
</template>
