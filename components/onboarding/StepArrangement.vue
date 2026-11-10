<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import SetupFields from '~/components/SetupFields.vue'
import SetupNativeTransition from '~/components/SetupNativeTransition.vue'
import { setupRuntimeFields } from '~/helper/setupInfiniDysk.js'
import { setupErrorText } from '~/helper/setupArrangements.js'
const onboarding = useOnboardingStore()
const setup = useSetupArrangementsStore()
const fields = computed(() => setupRuntimeFields(setup.plan?.arrangement_schema?.fields, onboarding._capabilities))
const nativeActions = computed(() => (setup.plan?.actions || []).filter(action => action.kind === 'native_transition'))
const groups = computed(() => {
  const grouped = new Map()
  for (const field of fields.value) {
    const id = field.resource_id || field.service_key || 'arrangement'
    const resource = (setup.plan?.services || []).find(service => service.id === id)
    const metadata = (setup.plan?.arrangement_schema?.groups || []).find(group => (group.resource_id || group.id) === id)
    if (!grouped.has(id)) grouped.set(id, { id, name: metadata?.label || metadata?.name || field.group_label || resource?.name || (id === 'setup' ? 'Existing external services' : field.service_key) || 'Arrangement', fields: [] })
    grouped.get(id).fields.push(field)
  }
  return [...grouped.values()]
})
let refreshTimer
async function refresh() {
  try {
    await onboarding.loadMetadata()
    await onboarding.previewSetupChoices({ keepPrevious: true })
    if (onboarding.seedArrangementMediaChoices(fields.value)) await onboarding.previewSetupChoices({ keepPrevious: true })
  } catch (error) { setup.error = setupErrorText(error, 'Could not refresh setup choices. Your draft is retained.') }
}
const discoveryChoices = computed(() => JSON.stringify(fields.value
  .filter(field => ['connection', 'multiselect'].includes(field.type) || field.refresh_on_change === true)
  .map(field => [field.key, onboarding.arrangementValues[field.key] ?? null])))
watch(discoveryChoices, () => {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, 500)
})
onMounted(refresh)
onBeforeUnmount(() => clearTimeout(refreshTimer))
</script>
<template>
  <section class="space-y-5 text-white">
    <h2 class="text-2xl font-semibold">Connections and choices</h2>
    <p>Choose the connections and policies you want. DUMB derives managed addresses, ports and credentials where available. An external service is different from having no service.</p>
    <p class="text-sm text-gray-300">Inputs stay in this browser session until submitted to DUMB. Missing credentials or choices remain visible as unfinished tasks.</p>
    <p v-if="setup.loading" role="status">Preparing available setup choices…</p>
    <p v-if="setup.error" role="alert" class="text-amber-200">{{ setup.error }}</p>
    <details v-for="group in groups" :key="group.id" open class="rounded-lg border border-gray-600 p-4 space-y-4">
      <summary class="cursor-pointer font-semibold">{{ group.name }}</summary>
      <SetupFields v-model="onboarding.arrangementValues" :fields="group.fields" :disabled="setup.loading" />
    </details>
    <SetupNativeTransition v-for="action in nativeActions" :key="action.id" :action="action" :capabilities="onboarding._capabilities" :busy="setup.loading" />
    <p v-if="!setup.loading && !fields.length">No additional choices are advertised for these services. The review lists any remaining manual configuration.</p>
    <button type="button" class="rounded border px-3 py-2" :disabled="setup.loading" @click="refresh">Refresh available choices</button>
  </section>
</template>
