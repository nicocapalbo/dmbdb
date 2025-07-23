<script setup>
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()
// pick up the ready‑made payload
const { reviewPayload } = storeToRefs(store)
</script>

<template>
    <section class="bg-gray-900 flex justify-center py-12 px-4">
        <div class="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
            <h2 class="text-2xl font-semibold text-white">Review Configuration</h2>

            <!-- Core services -->
            <div v-for="(svc, idx) in reviewPayload.core_services" :key="idx"
                class="p-4 bg-gray-700 text-white rounded-lg border border-gray-600">
                <h3 class="text-lg font-medium">{{ svc.name }}</h3>

                <!-- Debrid provider (only if set) -->
                <p v-if="svc.debrid_service" class="mt-1 text-gray-300">
                    Debrid provider:
                    <span class="font-semibold text-white">{{ svc.debrid_service }}</span>
                </p>

                <!-- API key (only if set) -->
                <p v-if="svc.debrid_key" class="mt-1 text-gray-300">
                    API Key:
                    <code class="bg-gray-600 px-1 rounded text-sm">
                        {{ svc.debrid_key }}
                    </code>
                </p>

                <!-- Service options (only if any keys exist) -->
                <div v-if="svc.service_options && Object.keys(svc.service_options).length" class="mt-2">
                    <h4 class="font-medium">Service Options:</h4>
                    <pre class="bg-gray-600 p-2 rounded text-sm overflow-x-auto">
{{ svc.service_options }}
                    </pre>
                </div>
            </div>

            <!-- Optional services -->
            <div v-if="reviewPayload.optional_services?.length"
                class="p-4 bg-gray-700 text-white rounded-lg border border-gray-600">
                <h3 class="text-lg font-medium">Optional Services:</h3>
                <ul class="list-disc list-inside mt-2 text-gray-300">
                    <li v-for="opt in reviewPayload.optional_services" :key="opt">
                        {{ opt }}
                    </li>
                </ul>
            </div>

            <!-- Raw payload preview -->
            <div class="bg-gray-700 rounded-xl p-4 text-sm text-gray-200 overflow-x-auto border border-gray-600">
                <h3 class="text-lg font-medium">Raw Configuration Payload:</h3>
                <pre class="whitespace-pre-wrap">{{ reviewPayload }}</pre>
            </div>

            <p class="mt-4 text-gray-400">
                Click <strong class="text-white">Start services</strong> to launch and finish onboarding.
            </p>
        </div>
    </section>
</template>
