<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import SetupFields from '~/components/SetupFields.vue'
import SetupNativeTransition from '~/components/SetupNativeTransition.vue'
import { setupRuntimeFields, isSetupInfiniDyskRuntimeField } from '~/helper/setupInfiniDysk.js'
import { setupErrorText } from '~/helper/setupArrangements.js'
import { setupGuidanceGroups } from '~/helper/setupGuidance.js'
const onboarding = useOnboardingStore()
const setup = useSetupArrangementsStore()
const fields = computed(() => setupRuntimeFields(setup.plan?.arrangement_schema?.fields, onboarding._capabilities))
const installationFields = computed(() => fields.value.filter(isSetupInfiniDyskRuntimeField))
const groups = computed(() => setupGuidanceGroups(setup.plan || {}, fields.value))
const nativeActions = computed(() => (setup.plan?.actions || []).filter(action => action.kind === 'native_transition'))
const showConnections = computed({
  get: () => onboarding.arrangementGuideState?.mode === 'expert',
  set: value => { onboarding.arrangementGuideState = { ...onboarding.arrangementGuideState, mode: value ? 'expert' : 'guided' } },
})
watch(() => !setup.loading && Boolean(setup.plan), value => { onboarding.arrangementGuideReady = value }, { immediate: true })
let refreshTimer
async function refresh() {
  try {
    await onboarding.loadMetadata()
    await onboarding.previewSetupChoices({ keepPrevious: true })
    if (onboarding.seedArrangementMediaChoices(fields.value)) await onboarding.previewSetupChoices({ keepPrevious: true })
  } catch (error) { setup.error = setupErrorText(error, 'Could not refresh installation choices. Your draft is retained.') }
}
const discoveryChoices = computed(() => JSON.stringify(fields.value
  .filter(field => ['connection', 'multiselect'].includes(field.type) || field.refresh_on_change === true)
  .map(field => [field.key, onboarding.arrangementValues[field.key] ?? null])))
watch(discoveryChoices, () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 500) })
onMounted(refresh)
onBeforeUnmount(() => clearTimeout(refreshTimer))
</script>

<template>
  <section class="space-y-5 text-white" data-setup-installation-choices>
    <h2 class="text-2xl font-semibold">Installation choices</h2>
    <p>Choose anything DUMB needs before installing your apps. After startup, you can use an optional walkthrough to add accounts, choose libraries and connect the apps.</p>
    <p v-if="setup.loading" role="status">Preparing your installation choices…</p>
    <p v-if="setup.error" role="alert" class="text-amber-200">{{ setup.error }}</p>
    <template v-if="!showConnections">
      <div v-if="installationFields.length" class="rounded-lg border border-gray-600 p-5">
        <SetupFields v-model="onboarding.arrangementValues" :fields="installationFields" :context-fields="fields" :actions="setup.plan?.actions || []" :services="setup.plan?.services || []" guided :disabled="setup.loading" />
      </div>
      <p v-else-if="setup.plan && !setup.loading" class="rounded-lg border border-gray-600 p-4" data-setup-no-installation-choices>No additional installation choices are needed for these apps. You can continue to review your setup.</p>
      <button type="button" class="rounded border px-3 py-2" @click="showConnections = true">Show connection settings before startup</button>
      <p class="text-sm text-gray-300">For experienced users who already know their settings. Menus supplied by a new app may need to wait until it is running.</p>
    </template>
    <template v-else>
      <button type="button" class="rounded border px-3 py-2" @click="showConnections = false">Show installation choices</button>
      <p>These connection settings are optional before startup. Leave unanswered choices for the walkthrough afterward; your entries are kept when switching views.</p>
      <details v-for="group in groups" :key="group.id" class="rounded-lg border border-gray-600 p-4 space-y-4" :data-setup-expert-group="group.id">
        <summary class="cursor-pointer font-semibold">{{ group.name }}</summary>
        <SetupFields v-model="onboarding.arrangementValues" :fields="group.fields" :context-fields="fields" :actions="setup.plan?.actions || []" :services="setup.plan?.services || []" :disabled="setup.loading" />
      </details>
    </template>
    <SetupNativeTransition v-for="action in nativeActions" :key="action.id" :action="action" :capabilities="onboarding._capabilities" :busy="setup.loading" />
    <button type="button" class="rounded border px-3 py-2" :disabled="setup.loading" @click="refresh">Refresh available choices</button>
    <p class="text-sm text-gray-300">Your draft stays in this browser session. DUMB also receives your entries when preparing the plan; credentials are kept in protected setup state and masked in the review.</p>
  </section>
</template>
