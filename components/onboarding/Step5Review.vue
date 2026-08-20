<script setup>
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()
// pick up the ready‑made payload
const { reviewPayload } = storeToRefs(store)
const autheliaSelected = computed(() =>
    Boolean(reviewPayload.value?.optional_services?.includes('authelia'))
)
const aioStreamsSelected = computed(() =>
    Boolean(reviewPayload.value?.optional_services?.includes('aiostreams'))
)

const sensitiveReviewKey = /(?:password|passwd|secret|token|api[_-]?key|debrid[_-]?key|claim)/i

const sanitizeForReview = (value, key = '') => {
    if (sensitiveReviewKey.test(String(key)) && value !== '' && value != null) {
        return '[configured]'
    }
    if (Array.isArray(value)) return value.map(item => sanitizeForReview(item))
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([childKey, childValue]) => [
                childKey,
                sanitizeForReview(childValue, childKey),
            ])
        )
    }
    return value
}

const safeReviewPayload = computed(() => sanitizeForReview(reviewPayload.value))
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
                        [configured]
                    </code>
                </p>

                <!-- Service options (only if any keys exist) -->
                <div v-if="svc.service_options && Object.keys(svc.service_options).length" class="mt-2">
                    <h4 class="font-medium">Service Options:</h4>
                    <pre class="bg-gray-600 p-2 rounded text-sm overflow-x-auto">
{{ sanitizeForReview(svc.service_options) }}
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

            <div
                v-if="autheliaSelected"
                class="rounded-md border border-violet-400/50 bg-violet-900/20 p-4 text-sm text-violet-100"
            >
                <p class="font-semibold text-white">Authelia requires one post-onboarding step</p>
                <p class="mt-1">
                    <strong>Start services</strong> installs Authelia but intentionally leaves it stopped.
                    When onboarding finishes, open the Authelia service page and complete the required
                    bootstrap step. Its initial Stopped or Unhealthy status is expected.
                </p>
            </div>

            <div
                v-if="aioStreamsSelected"
                class="rounded-md border border-cyan-400/50 bg-cyan-900/20 p-4 text-sm text-cyan-100"
            >
                <p class="font-semibold text-white">AIOStreams access</p>
                <p class="mt-1">
                    The saved <code class="rounded bg-gray-900 px-1">base_url</code> is authoritative for Stremio
                    manifests and OAuth callbacks. Use the administrator credentials you created to sign in to
                    the Dashboard. DUMB creates and retains the separate AIOStreams encryption secret; include the
                    AIOStreams service data and DUMB configuration in your normal backups.
                </p>
            </div>

            <!-- Raw payload preview -->
            <div class="bg-gray-700 rounded-xl p-4 text-sm text-gray-200 overflow-x-auto border border-gray-600">
                <h3 class="text-lg font-medium">Configuration Payload Preview:</h3>
                <p class="mb-2 text-xs text-gray-400">Sensitive values are masked in this preview.</p>
                <pre class="whitespace-pre-wrap">{{ safeReviewPayload }}</pre>
            </div>

            <p class="mt-4 text-gray-400">
                Click <strong class="text-white">Start services</strong> to launch and finish onboarding.
            </p>
        </div>
    </section>
</template>
