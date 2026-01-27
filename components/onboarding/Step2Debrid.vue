<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import useService from '~/services/useService.js'

const store = useOnboardingStore()

// Determine which debrid-capable core service we're on (step 2 = index 0)
const index = computed(() => store.step - 2)
const coreEntry = computed(() => store.debridCoreServices[index.value] || {})
const coreKey = computed(() => coreEntry.value.name)

const coreService = ref({ name: '', key: '', debrid_providers: [] })
const providers = ref([])
const selectedProvider = ref(coreEntry.value.debrid_service || '')
const apiKey = ref(coreEntry.value.debrid_key || '')

async function loadProviders() {
    const { processService } = useService()
    const { core_services } = await processService.getCoreServices()
    const svc = core_services.find(s => s.key === coreKey.value)
    if (svc) {
        coreService.value = svc
        providers.value = svc.debrid_providers || []
    } else {
        coreService.value = { name: '', key: '', debrid_providers: [] }
        providers.value = []
    }

    if (!providers.value.length) {
        store.next()
        return
    }

    const entry = coreEntry.value
    selectedProvider.value = entry?.debrid_service || ''
    apiKey.value = entry?.debrid_key || ''
}

// Fetch metadata for this core service and skip when no providers
onMounted(loadProviders)
watch(coreKey, async () => {
    await loadProviders()
})

// Sync back to the onboarding store
watch([selectedProvider, apiKey], () => {
    const entry = store.coreServices[index.value]
    if (entry) {
        entry.debrid_service = selectedProvider.value
        entry.debrid_key = apiKey.value
    }
})
</script>

<template>
    <section class="space-y-6">
        <h2 class="text-lg font-semibold">
            Configure {{ coreService.name }} Debrid Service
        </h2>
        <p class="text-gray-700">
            Select which debrid provider to use and enter your API key.
        </p>
        <div class="rounded-md border border-amber-500/40 bg-amber-900/20 p-3 text-sm text-amber-100">
            API keys are sensitive. Keep them private and never share them publicly.
        </div>

        <div v-if="providers.length">
            <label v-for="p in providers" :key="p" class="flex items-center space-x-2 mb-2" :title="`Use ${p} with ${coreService.name}`">
                <input type="radio" :value="p" v-model="selectedProvider" />
                <span>{{ p }}</span>
            </label>
        </div>
        <div v-else class="text-gray-500">
            No compatible debrid providers available.
        </div>

        <div v-if="selectedProvider">
            <label class="block mb-1">API Key for {{ selectedProvider }}:</label>
            <input v-model="apiKey" type="text" placeholder="Enter API key" title="API key for the selected debrid provider."
                class="w-full px-3 py-2 border rounded text-black" />
        </div>
    </section>
</template>
