<script setup>
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import SetupStatusPanel from '~/components/SetupStatusPanel.vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import {
  isValidAioStreamsAdminCredentials,
  isValidAioStreamsBaseUrl,
} from '~/helper/aiostreams.js'

const store = useOnboardingStore()
const setup = useSetupArrangementsStore()
const { step, coreServices, submitting } = storeToRefs(store)
// current service key for conditional disabling
const currentServiceKey = computed(() => store.currentServiceKey)
const supportsOptionalOnly = computed(() => store._capabilities?.optional_only_onboarding === true)

// skip onboarding function
async function skipOnboarding() {
  await store.skip()
  await navigateTo('/')
}

// riven_frontend origin
const currentMergedOptions = computed(() => {
  const key = currentServiceKey.value
  const defaults = store.currentServiceOptions.options || {}
  const edits = store._userServiceOptions[key] || {}
  return { ...defaults, ...edits }
})

const rivenFrontendOrigin = computed(() => {
  return currentServiceKey.value === 'riven_frontend' ? Boolean(currentMergedOptions.value.origin) : true
})

const cloudflaredTunnelTokenEntered = computed(() => {
  return currentServiceKey.value === 'cloudflared'
    ? Boolean(String(currentMergedOptions.value.tunnel_token || currentMergedOptions.value.TUNNEL_TOKEN || '').trim())
    : true
})

const aioStreamsBaseUrlValid = computed(() => (
  currentServiceKey.value === 'aiostreams'
    ? isValidAioStreamsBaseUrl(currentMergedOptions.value.base_url)
    : true
))

const aioStreamsAdminCredentialsValid = computed(() => (
  currentServiceKey.value === 'aiostreams'
    ? isValidAioStreamsAdminCredentials(
        currentMergedOptions.value.auth_username,
        currentMergedOptions.value.auth_password,
      )
    : true
))


const Step1CoreService = defineAsyncComponent(() => import('~/components/onboarding/Step1CoreService.vue'))
const StepPreflight = defineAsyncComponent(() => import('~/components/onboarding/StepPreflight.vue'))
const Step2Debrid = defineAsyncComponent(() => import('~/components/onboarding/Step2Debrid.vue'))
const Step3Optional = defineAsyncComponent(() => import('~/components/onboarding/Step3Optional.vue'))
const Step4ServiceOptions = defineAsyncComponent(() => import('~/components/onboarding/Step4ServiceOptions.vue'))
const StepServiceUi = defineAsyncComponent(() => import('~/components/onboarding/StepServiceUi.vue'))
const Step5Review = defineAsyncComponent(() => import('~/components/onboarding/Step5Review.vue'))
const StepLogs = defineAsyncComponent(() => import('~/components/onboarding/StepLogs.vue'))
const StepSuccess = defineAsyncComponent(() => import('~/components/onboarding/StepSuccess.vue'))
const StepError = defineAsyncComponent(() => import('~/components/onboarding/StepError.vue'))

onMounted(async () => {
  await store.runPreflightChecks()
})

const StepArrangement = defineAsyncComponent(() => import('~/components/onboarding/StepArrangement.vue'))
const components = {
  services: Step1CoreService, preflight: StepPreflight, provider: Step2Debrid,
  companions: Step3Optional, options: Step4ServiceOptions, serviceUi: StepServiceUi,
  arrangement: StepArrangement, review: Step5Review, progress: StepLogs,
  result: StepSuccess, error: StepError,
}
const Current = computed(() => components[store.currentWizardStep.component])
const isReview = computed(() => store.currentWizardStep.id === 'review')
const isProgress = computed(() => store.currentWizardStep.id === 'progress')
const isTerminal = computed(() => ['result', 'error'].includes(store.currentWizardStep.id))
const debridEntry = computed(() => store.debridCoreServices[store.currentWizardStep.providerIndex])
const nextBlocked = computed(() => (
  (!supportsOptionalOnly.value && step.value === 1 && coreServices.value.length === 0)
  || (store.currentWizardStep.id === 'preflight' && store.preflightHasBlockingIssues)
  || (store.currentWizardStep.component === 'provider' && (!debridEntry.value?.debrid_service || !debridEntry.value?.debrid_key))
  || store._instanceNameBlocked
  || !rivenFrontendOrigin.value || !cloudflaredTunnelTokenEntered.value
  || !aioStreamsBaseUrlValid.value || !aioStreamsAdminCredentialsValid.value
))
const startBlocked = computed(() => submitting.value
  || (!coreServices.value.length && !store.optionalServices.length)
  || (!supportsOptionalOnly.value && !coreServices.value.length)
  || (store._capabilities?.setup_arrangements === true && (
    setup.loading || !setup.plan || setup.planSignature !== JSON.stringify(store.setupPayload)
    || (setup.plan.checks || []).some(check => check.critical && check.ok === false)
  )))
const leaving = ref(false)
async function leaveSetup() {
  if (leaving.value) return
  leaving.value = true
  store.navigationError = ''
  try {
    await store.leaveSetup()
    await navigateTo('/')
  } catch {
    store.navigationError = 'Could not save the onboarding navigation preference. Your setup checklist remains saved; try again.'
  } finally { leaving.value = false }
}

</script>

<template>
    <main class="max-w-4xl mx-auto p-8">
        <h1 class="text-2xl font-bold mb-6">Onboarding Wizard</h1>

        <ul class="flex space-x-2 mb-8">
            <li v-for="(entry, i) in store.wizardSteps" :key="entry.id" :title="entry.label" class="w-3 h-3 rounded-full"
                :class="i === step - 1 ? 'bg-blue-500' : 'bg-gray-300'" />
        </ul>

        <Suspense>
          <template #default>
            <div>
              <SetupStatusPanel v-if="isProgress && store._capabilities?.setup_arrangements === true" always />
              <component :is="Current" :key="store.currentWizardStep.id" @next="store.next()" />
            </div>
          </template>
          <template #fallback><p role="status">Loading step…</p></template>
        </Suspense>


        <p v-if="store.navigationError" role="alert" class="mt-4 text-amber-200">{{ store.navigationError }}</p>
        <div class="mt-8 flex flex-wrap justify-between gap-3">
            <button v-if="step === 1" @click="skipOnboarding" class="px-4 py-2 bg-gray-600 text-white rounded">Skip Onboarding</button>
            <button v-else-if="!isProgress && !isTerminal" @click="store.back()" :disabled="submitting" class="px-4 py-2 bg-gray-700 text-white rounded">Back</button>
            <button v-if="!isReview && !isProgress && !isTerminal" @click="store.next()" :disabled="nextBlocked" class="px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-50">Next</button>
            <button v-if="isReview" @click="store.submit()" :disabled="startBlocked" class="px-4 py-2 bg-green-700 text-white rounded disabled:opacity-50">{{ submitting ? 'Starting…' : 'Start services' }}</button>
            <template v-if="isProgress || isTerminal">
              <button v-if="isTerminal && store.currentWizardStep.id === 'error'" @click="store.step = store.reviewStep" class="px-4 py-2 bg-gray-700 text-white rounded">Review configuration</button>
              <button @click="leaveSetup" :disabled="leaving" class="px-4 py-2 bg-indigo-700 text-white rounded">Continue to dashboard</button>
            </template>
        </div>
    </main>
</template>
