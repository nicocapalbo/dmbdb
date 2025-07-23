<script setup>
import { storeToRefs } from 'pinia'
import { watch, computed, defineAsyncComponent } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()
const { step, coreServices, submitting } = storeToRefs(store)
// current service key for conditional disabling
const currentServiceKey = computed(() => store.currentServiceKey)

// skip onboarding function
async function skipOnboarding() {
  await store.skip()
  await navigateTo('/')
}

// plex claim entered? look up in userServiceOptions
const plexClaimEntered = computed(() => {
    const key = currentServiceKey.value
    const opts = store._userServiceOptions[key] || {}
    return Boolean(opts.plex_claim)
})

// riven_frontend origin
const rivenFrontendOrigin = computed(() => {
  const key = currentServiceKey.value
  const defaults = store.currentServiceOptions.options || {}
  const edits = store._userServiceOptions[key] || {}

  const merged = { ...defaults, ...edits }
  return key === 'riven_frontend' ? Boolean(merged.origin) : true
})


onMounted(() => {
    store.loadConfig()
})

// 1-based step → components array
const stepComponents = computed(() => {
    const list = []

    // 1: pick cores
    list.push(defineAsyncComponent(() => import('~/components/onboarding/Step1CoreService.vue')))

    // 2..N+1: debrid config
    coreServices.value.forEach(() => {
        list.push(defineAsyncComponent(() => import('~/components/onboarding/Step2Debrid.vue')))
    })

    // N+2: optional services
    list.push(defineAsyncComponent(() => import('~/components/onboarding/Step3Optional.vue')))

    // N+3 .. N+2+M: service-options (core + deps + optionals)
    const totalServices = store.allServicesMeta.length
    for (let i = 0; i < totalServices; i++) {
        list.push(defineAsyncComponent(() => import('~/components/onboarding/Step4ServiceOptions.vue')))
    }

    // review, logs, success, error
    list.push(defineAsyncComponent(() => import('~/components/onboarding/Step5Review.vue')))
    list.push(defineAsyncComponent(() => import('~/components/onboarding/StepLogs.vue')))
    list.push(defineAsyncComponent(() => import('~/components/onboarding/StepSuccess.vue')))
    list.push(defineAsyncComponent(() => import('~/components/onboarding/StepError.vue')))

    return list
})

// map step → component
const Current = computed(() => {
    const idx = step.value - 1
    return stepComponents.value[idx] || stepComponents.value[0]
})

// whenever step jumps into the very first options page,
// fire store.loadMetadata() so everything is cached
watch(
    () => store.step,
    async (step) => {
        if (step === store.optionsStart) {
            await store.loadMetadata()
        }
    }
)
</script>

<template>
    <main class="max-w-4xl mx-auto p-8">
        <h1 class="text-2xl font-bold mb-6">Onboarding Wizard</h1>

        <ul class="flex space-x-2 mb-8">
            <li v-for="(_, i) in stepComponents" :key="i" class="w-3 h-3 rounded-full"
                :class="i === step - 1 ? 'bg-blue-500' : 'bg-gray-300'" />
        </ul>

        <Suspense>
            <template #default>
                <component :is="Current" @next="store.next()" />
            </template>
            <template #fallback>
                <div class="text-center py-10">Loading step…</div>
            </template>
        </Suspense>

        <div class="mt-8 flex justify-between">
            <!-- Skip replaces Back on step 1 -->
            <button v-if="step === 1" @click="skipOnboarding"
                class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-400">
                Skip Onboarding
            </button>

            <!-- Show Back for other steps -->
            <button v-else @click="store.back()"
                class="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600">
                Back
            </button>

             <!-- Next button -->
            <button v-if="step < stepComponents.length - 2" @click="store.next()" :disabled="(step === 1 && coreServices.length === 0) ||
                (step > 1 &&
                    step <= coreServices.length + 1 &&
                    (!store.coreServices[step - 2]?.debrid_service ||
                        !store.coreServices[step - 2]?.debrid_key)
                ) ||
                (currentServiceKey === 'plex' && !plexClaimEntered)
                || 
                (currentServiceKey === 'riven_frontend' && !rivenFrontendOrigin)
                " class="px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-50">
                Next
            </button>

            <!-- Submit button for the last step -->
            <button v-else-if="step === stepComponents.length - 2" @click="store.submit()" :disabled="submitting"
                class="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50">
                {{ submitting ? 'Starting…' : 'Start services' }}
            </button>
        </div>
    </main>
</template>
