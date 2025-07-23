<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import useService from '~/services/useService.js'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()

// dynamic core services state
const coreServiceOptions = ref([])
const pending = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    const { processService } = useService()
    const { core_services } = await processService.getCoreServices()

    // Filter out core services that are already enabled in the config
    const config = store._Config || {}
    coreServiceOptions.value = core_services.filter(service => {
      const serviceConfig = config[service.key]
      return !(serviceConfig?.enabled === true)
    })
  } catch (e) {
    error.value = e
  } finally {
    pending.value = false
  }
})


// augment descriptions with hyperlink HTML
const servicesWithLinks = computed(() =>
    coreServiceOptions.value.map(s => {
        // 1) linkify
        let html = s.description
            .replace(
                /(https?:\/\/[^\s]+)/g,
                `<a href="$1" target="_blank" class="text-blue-500 underline break-words">$1</a>`
            )
            // 2) convert newlines to <br>
            .replace(/\n/g, '<br/>')

        return { ...s, descriptionHtml: html }
    })
)

// initialize selection from store
const selectedNames = ref(store.coreServices.map(s => s.name))

// sync selection back to store
watch(selectedNames, (names) => {
    store.coreServices = names.map(name => ({ name }))
})
</script>

<template>
    <section class="bg-gray-900 flex justify-center py-12 px-4">
        <div class="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
            <!-- Intro Text -->
            <p class="text-gray-300 space-y-2">
            Select one or more core services to get started.
            <br />

            <!-- Emphasized Note -->
            <span class="block mt-4 p-4 rounded-md bg-gray-700 border-l-4 border-yellow-400 text-yellow-200">
                <strong>Note:</strong> 
                <br />
                Each core service involves automated backend setup, so we recommend starting with just one.    
                <br />
                You can enable additional services later by relaunching the onboarding process from the settings menu.
            </span>

            <!-- Standard Tips -->
            <span class="block mt-4">
                Each service provides distinct features, so choose what best suits your workflow.
            </span>

            <!-- Tip Note -->
            <span class="block mt-2 p-3 rounded-md bg-gray-700 border-l-4 border-blue-400 text-blue-200">
                <strong>Tip:</strong> Click a service name to expand its details and learn more.
            </span>
            </p>


            <!-- Loading / Error States -->
            <div v-if="pending" class="text-gray-400 text-center py-10">
                Loading services…
            </div>
            <div v-else-if="error" class="text-red-500 text-center">
                Failed to load services
            </div>

            <!-- Service List -->
            <div v-else class="grid grid-cols-1 gap-4">
                <details v-for="service in servicesWithLinks" :key="service.key"
                    class="group bg-gray-700 p-4 rounded-lg border border-gray-600 hover:shadow-xl transition-shadow">
                    <summary class="flex items-center space-x-3 cursor-pointer">
                        <label class="inline-flex items-center cursor-pointer">
                            <input type="checkbox" :value="service.key" v-model="selectedNames"
                                class="h-5 w-5 text-indigo-500 bg-gray-600 border-gray-500 rounded focus:ring-indigo-400 focus:ring-2" />
                        </label>
                        <span class="font-semibold text-white group-open:text-indigo-300">
                            {{ service.name }}
                        </span>
                    </summary>
                    <div class="mt-3 text-gray-400 prose prose-sm">
                        <p v-html="service.descriptionHtml"></p>
                    </div>
                </details>
            </div>
        </div>
    </section>
</template>
