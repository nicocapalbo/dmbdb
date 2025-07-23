<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'
import useService from '~/services/useService.js'

const store = useOnboardingStore()

// Determine which core service we're on (step 2 = index 0)
const index = computed(() => store.step - 2)
const coreEntry = computed(() => store.coreServices[index.value] || {})
const coreKey = computed(() => coreEntry.value.name)

const coreService = ref({ name: '', key: '', debrid_providers: [] })
const providers = ref([])
const selectedProvider = ref(coreEntry.value.debrid_service || '')
const apiKey = ref(coreEntry.value.debrid_key || '')

// Fetch metadata for this core service and skip when no providers
onMounted(async () => {
    const { processService } = useService()
    const { core_services } = await processService.getCoreServices()
    const svc = core_services.find(s => s.key === coreKey.value)
    if (svc) {
        coreService.value = svc
        providers.value = svc.debrid_providers || []
    }

    // Skip this step if there are no providers
    if (!providers.value.length) {
        store.next()
        return
    }
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

        <div v-if="providers.length">
            <label v-for="p in providers" :key="p" class="flex items-center space-x-2 mb-2">
                <input type="radio" :value="p" v-model="selectedProvider" />
                <span>{{ p }}</span>
            </label>
        </div>
        <div v-else class="text-gray-500">
            No compatible debrid providers available.
        </div>

        <div v-if="selectedProvider">
            <label class="block mb-1">API Key for {{ selectedProvider }}:</label>
            <input v-model="apiKey" type="text" placeholder="Enter API key"
                class="w-full px-3 py-2 border rounded text-black" />
        </div>
    </section>
</template>
