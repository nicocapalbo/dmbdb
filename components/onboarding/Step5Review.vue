<script setup>
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import SetupChecklist from '~/components/SetupChecklist.vue'
import SetupChoiceSummary from '~/components/SetupChoiceSummary.vue'
import { setupCheckLabel } from '~/helper/setupArrangements.js'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()
const setup = useSetupArrangementsStore()
const supported = computed(() => store._capabilities?.setup_arrangements === true)
onMounted(async () => { if (supported.value) await store.previewSetupChoices() })

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

            <template v-if="supported">
                <p v-if="setup.loading" role="status">Preparing your setup plan…</p>
                <p v-if="setup.error" role="alert" class="text-amber-200">{{ setup.error }}</p>
                <button type="button" :disabled="setup.loading" class="underline text-cyan-300 disabled:opacity-50" @click="store.previewSetupChoices()">{{ setup.error ? 'Retry setup preview' : 'Refresh setup preview' }}</button>
                <div v-if="setup.plan" class="space-y-5">
                    <p class="text-gray-200">Review the automatic changes and the tasks that need your input. Existing settings and unfinished manual work remain visible after startup.</p>
                    <div v-if="setup.plan.services?.length" class="space-y-2">
                      <div v-for="service in setup.plan.services" :key="service.id || service.resource_id || service.key" class="flex flex-wrap gap-2">
                        <span>{{ service.name || service.label || service.service_key || service.key }}</span>
                        <span class="text-xs rounded border border-gray-500 px-2 py-1">{{ service.external || service.selection_kind === 'external' ? 'Existing external service' : service.requirement || (service.selection_kind === 'required' || service.required ? 'Required dependency' : service.selection_kind === 'chosen' || service.selected ? 'Chosen by you' : 'Optional companion') }}</span>
                        <span v-for="role in service.roles || (service.role ? [{ title: service.role }] : [])" :key="typeof role === 'string' ? role : role.key || role.title" class="text-xs text-cyan-200">{{ typeof role === 'string' ? role.replaceAll('_', ' ') : role.title }}</span>
                      </div>
                    </div>
                    <ul v-if="setup.plan.checks?.length" class="space-y-2" aria-label="Arrangement readiness">
                      <li v-for="check in setup.plan.checks" :key="check.key" class="rounded border p-3 text-sm" :class="check.ok === true ? 'border-emerald-700 text-emerald-100' : check.ok === false ? 'border-amber-600 text-amber-100' : 'border-gray-500 text-gray-200'">
                        <p class="font-semibold">{{ check.label }} · {{ setupCheckLabel(check) }}</p>
                        <p v-if="check.detail">{{ check.detail }}</p>
                      </li>
                    </ul>
                    <SetupChoiceSummary :data="setup.plan" />
                    <SetupChecklist :data="setup.plan" :capabilities="store._capabilities" preview />
                </div>
            </template>

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
            <details class="bg-gray-700 rounded-xl p-4 text-sm text-gray-200 overflow-x-auto border border-gray-600">
                <summary class="cursor-pointer font-medium">Advanced configuration payload</summary>
                <p class="my-2 text-xs text-gray-400">Sensitive values are masked in this preview.</p>
                <pre class="whitespace-pre-wrap">{{ safeReviewPayload }}</pre>
            </details>

            <p class="mt-4 text-gray-400">
                Click <strong class="text-white">Start services</strong> to apply the reviewed configuration. Remaining tasks stay available on the dashboard and service pages.
            </p>
        </div>
    </section>
</template>
