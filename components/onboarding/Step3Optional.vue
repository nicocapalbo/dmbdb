<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import useService from '~/services/useService.js'
import { useOnboardingStore } from '~/stores/onboarding.js'
import DescriptionText from '~/components/DescriptionText.vue'
import { descriptionPlainText } from '~/helper/descriptionText.js'
import { filterOptionalServicesByCapabilities } from '~/helper/backendCapabilities.js'

const store = useOnboardingStore()
const emit = defineEmits(['next'])
const skipCountdown = ref(30)
let countdownTimer
const requestTimeoutMs = 15000
const withTimeout = (promise, ms) => {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Optional services request timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}
// Metadata state for optional services
const optionalOptions = ref([])
const pending = ref(true)
const error = ref(null)
const enabledOptionals = ref([])
const selectedKeys = ref([...store.optionalServices])

onMounted(async () => {
  try {
    const { processService } = useService()
    const { core_services } = await withTimeout(processService.getCoreServices(), requestTimeoutMs)
    const supportedCoreKeys = new Set(core_services.map(s => s.key))
    const coreKeys = Array.from(new Set(
      store.coreServices
        .map(cs => cs.name)
        .filter(key => supportedCoreKeys.has(key))
    ))
    const preferredOptionals = store.optionalServices.map(opt => (typeof opt === 'string' ? opt : opt.key))

    let finalOptionals = []

    if (coreKeys.length) {
      const lists = await Promise.all(
        coreKeys.map(key =>
          withTimeout(
            processService
              .getOptionalServices(key, preferredOptionals)
              .then(r => r.optional_services),
            requestTimeoutMs
          )
        )
      )

      // If multiple cores, intersect optional services
      if (lists.length > 1) {
        finalOptionals = lists.reduce((acc, curr) => {
          const currKeys = new Set(curr.map(o => o.key))
          return acc.filter(o => currKeys.has(o.key))
        }, lists[0])
      } else {
        finalOptionals = lists[0]
      }
    } else {
      const resp = await withTimeout(processService.getOptionalServices(null, preferredOptionals), requestTimeoutMs)
      finalOptionals = resp.optional_services
    }

    finalOptionals = filterOptionalServicesByCapabilities(finalOptionals, store._capabilities)

    const config = store._Config || {}

    // Split into enabled vs available
    enabledOptionals.value = finalOptionals.filter(opt => config[opt.key]?.enabled === true)
    optionalOptions.value = finalOptionals.filter(opt => !config[opt.key]?.enabled)

    // Sanitize preselected optionals to those that are actually available
    const availableKeys = new Set(finalOptionals.map(opt => opt.key))
    const normalized = store.optionalServices
      .map(opt => (typeof opt === 'string' ? opt : opt.key))
      .filter(key => availableKeys.has(key))
    store.optionalServices = normalized
    selectedKeys.value = [...normalized]

    if (optionalOptions.value.length === 0) {
    countdownTimer = setInterval(() => {
        skipCountdown.value--
        if (skipCountdown.value === 0) {
        clearInterval(countdownTimer)
        emit('next')
        }
    }, 1000)
    }


  } catch (e) {
    error.value = e
  } finally {
    pending.value = false
  }
})


// sync selection with store
watch(selectedKeys, (keys) => {
    store.optionalServices = [...keys]
})

const optionalOptionsForDisplay = computed(() =>
    optionalOptions.value.map(opt => ({
        ...opt,
        description: String(opt.description || ''),
        descriptionText: descriptionPlainText(opt.description)
    }))
)
const mediaStormSelected = computed(() => selectedKeys.value.includes('mediastorm'))
const aioStreamsSelected = computed(() => selectedKeys.value.includes('aiostreams'))
const autheliaSelected = computed(() => selectedKeys.value.includes('authelia'))
onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
        <section class="bg-gray-900 flex justify-center py-12 px-4">
            <div class="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
            
            <!-- Header -->
            <h2 class="text-2xl font-semibold text-white">Optional Services</h2>
            
            <!-- Description -->
            <p v-if="optionalOptionsForDisplay.length" class="text-gray-300">
                Choose any additional services you'd like to enable to extend your core installation.
            </p>
            <div v-if="optionalOptionsForDisplay.length" class="rounded-md border border-blue-500/40 bg-blue-900/20 p-3 text-sm text-blue-100">
                Optional services are filtered based on the core services you selected. If a tool is missing here,
                it is not compatible with the chosen core set.
            </div>

            <!-- Tip Note -->
            <div v-if="optionalOptionsForDisplay.length" class="block mt-2 p-3 rounded-md bg-gray-700 border-l-4 border-blue-400 text-blue-200">
                <strong>Tip:</strong> Click a service name to expand its details and learn more.
            </div>
            
            <!-- Loading / Error -->
            <div v-if="pending" class="text-gray-400 text-center py-6">
                Loading optional services…
            </div>
            <div v-else-if="error" class="text-red-500 text-center space-y-3">
                <p>Failed to load optional services. {{ error.message || '' }}</p>
                <button
                  type="button"
                  class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm"
                  @click="$emit('next')"
                >
                  Skip and continue
                </button>
            </div>
            <!-- No Optional Services -->
            <div v-else-if="!optionalOptionsForDisplay.length" class="text-yellow-400 text-center py-6 space-y-4">
                <p class="font-medium">
                No optional services available to configure.
                <br />
                Skipping to the next step in {{ skipCountdown }} second<span v-if="skipCountdown !== 1">s</span>...
                <br />
                Or click `Next` to continue immediately.
                </p>

                <div v-if="enabledOptionals.length" class="text-sm text-left max-w-lg mx-auto text-gray-300">
                <p class="mb-2 font-semibold text-white">Already enabled optional services:</p>
                <ul class="list-disc list-inside space-y-1">
                    <li v-for="opt in enabledOptionals" :key="opt.key">{{ opt.name }}</li>
                </ul>
                </div>
            </div>
            <!-- Options List -->
            <div v-else class="grid grid-cols-1 gap-4">

            <!-- Available Optional Services -->
            <details
                v-for="opt in optionalOptionsForDisplay"
                :key="'available-' + opt.key"
                class="group bg-gray-700 p-4 rounded-lg border border-gray-600 hover:shadow-xl transition-shadow"
            >
                <summary class="flex items-center space-x-3 cursor-pointer">
                <input
                    type="checkbox"
                    :value="opt.key"
                    v-model="selectedKeys"
                    :title="opt.descriptionText || opt.name"
                    class="h-5 w-5 text-indigo-500 bg-gray-600 border-gray-500 rounded focus:ring-indigo-400 focus:ring-2"
                />
                <span class="font-semibold text-white group-open:text-indigo-300">
                    {{ opt.name }}
                </span>
                </summary>
                <div class="mt-3 text-gray-400 prose prose-sm">
                <p>
                  <DescriptionText :text="opt.description" line-breaks="paragraphs" />
                </p>
                </div>
            </details>

            <!-- Already Enabled Optional Services -->
            <details
                v-for="opt in enabledOptionals"
                :key="'enabled-' + opt.key"
                class="group bg-gray-700 p-4 rounded-lg border border-green-700 hover:shadow-xl transition-shadow opacity-60"
                open
            >
                <summary class="flex items-center space-x-3 cursor-default">
                <span class="h-5 w-5 inline-block rounded-full bg-green-500"></span>
                <span class="font-semibold text-white group-open:text-green-300">
                    {{ opt.name }} <span class="text-xs text-green-400">(already enabled)</span>
                </span>
                </summary>
                <div class="mt-3 text-gray-400 prose prose-sm">
                <p>
                  <DescriptionText :text="opt.description" line-breaks="paragraphs" />
                </p>
                </div>
            </details>

            </div>

            <div
                v-if="mediaStormSelected"
                class="rounded-md border border-amber-500/50 bg-amber-900/20 p-4 text-sm text-amber-100"
            >
                <p class="font-semibold text-white">mediastorm first login</p>
                <p class="mt-1">
                    Current mediastorm builds start with
                    <code class="rounded bg-gray-900 px-1">admin</code> /
                    <code class="rounded bg-gray-900 px-1">admin</code>. During that first sign-in, mediastorm requires
                    you to choose and confirm a replacement password before it creates the admin session. DUMB keeps
                    the credential notice compatible with older, pinned, or explicitly customized builds.
                </p>
            </div>

            <div
                v-if="aioStreamsSelected"
                class="rounded-md border border-cyan-400/50 bg-cyan-900/20 p-4 text-sm text-cyan-100"
            >
                <p class="font-semibold text-white">AIOStreams needs its public URL</p>
                <p class="mt-1">
                    On the options page, set <code class="rounded bg-gray-900 px-1">base_url</code> to the final URL
                    that Stremio and OAuth callbacks can reach. Use HTTPS except for localhost testing; the embedded
                    <code class="rounded bg-gray-900 px-1">/ui/aiostreams</code> path is not a public BASE_URL.
                    DUMB generates and persists AIOStreams' secret key separately.
                </p>
            </div>

            <div
                v-if="autheliaSelected"
                class="rounded-md border border-violet-400/50 bg-violet-900/20 p-4 text-sm text-violet-100"
            >
                <p class="font-semibold text-white">Authelia is installed now and started later</p>
                <p class="mt-1">
                    Onboarding installs Authelia and enables PostgreSQL, but intentionally does not start
                    Authelia yet. After onboarding, open the Authelia service page and complete
                    <strong>Step 1: Configure and start Authelia</strong>. A Stopped or Unhealthy status
                    before that bootstrap is expected and does not mean installation failed.
                </p>
            </div>
        </div>
    </section>
</template>
