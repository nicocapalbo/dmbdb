<script setup>
import { ref, onMounted, watch, computed, reactive } from 'vue'
import useService from '~/services/useService.js'
import { useOnboardingStore } from '~/stores/onboarding.js'
import ServiceDescription from '~/components/ServiceDescription.vue'
import { descriptionPlainText } from '~/helper/descriptionText.js'
import { filterOptionalServicesByCapabilities } from '~/helper/backendCapabilities.js'
import { groupOnboardingServices } from '~/helper/onboardingServiceGroups.js'
import ServiceCategory from '~/components/onboarding/ServiceCategory.vue'

const store = useOnboardingStore()
const emit = defineEmits(['next'])
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
const serviceCategories = computed(() => groupOnboardingServices([
    ...optionalOptionsForDisplay.value.map(opt => ({ ...opt, alreadyEnabled: false })),
    ...enabledOptionals.value.map(opt => ({
        ...opt,
        description: String(opt.description || ''),
        alreadyEnabled: true
    }))
]))
const expandedCategories = reactive({})
watch(serviceCategories, (categories) => {
    for (const category of categories) {
        if (!(category.key in expandedCategories)) expandedCategories[category.key] = selectedCountFor(category) > 0
    }
}, { immediate: true })
function selectedCountFor(category) {
    return category.services.filter(opt => !opt.alreadyEnabled && selectedKeys.value.includes(opt.key)).length
}
function enabledCountFor(category) {
    return category.services.filter(opt => opt.alreadyEnabled).length
}
function setAllCategories(open) {
    for (const category of serviceCategories.value) expandedCategories[category.key] = open
}
const mediaStormSelected = computed(() => selectedKeys.value.includes('mediastorm'))
const aioStreamsSelected = computed(() => selectedKeys.value.includes('aiostreams'))
const audiobookshelfSelected = computed(() => selectedKeys.value.includes('audiobookshelf'))
const autheliaSelected = computed(() => selectedKeys.value.includes('authelia'))

</script>

<template>
        <section class="bg-gray-900 flex justify-center py-12 px-4">
            <div class="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
            
            <!-- Header -->
            <h2 class="text-2xl font-semibold text-white">Companion services</h2>
            
            <!-- Description -->
            <p v-if="optionalOptionsForDisplay.length" class="text-gray-300">
                Choose any additional services you'd like to enable to extend your selected arrangement.
            </p>
            <div v-if="optionalOptionsForDisplay.length" class="rounded-md border border-blue-500/40 bg-blue-900/20 p-3 text-sm text-blue-100">
                Available choices depend on your selected services and backend support.
                Required dependencies are configured automatically.
            </div>

            <!-- Tip Note -->
            <div v-if="optionalOptionsForDisplay.length" class="block mt-2 p-3 rounded-md bg-gray-700 border-l-4 border-blue-400 text-blue-200">
                <strong>Tip:</strong> Expand a category to browse its services, then click a service name to learn more.
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
            <template v-else>
            <!-- Continue deliberately while reading enabled services. -->
            <div v-if="!optionalOptionsForDisplay.length" class="text-yellow-400 text-center py-6 space-y-4">
                <p class="font-medium">
                No optional services available to configure.
                <br />
                Your enabled services are listed below.
                <br />
                Click Next when you are ready.
                </p>
            </div>
            <div v-if="serviceCategories.length" class="grid grid-cols-1 gap-4">
            <div class="flex flex-wrap justify-end gap-2">
              <button type="button" class="rounded bg-gray-700 px-3 py-1 text-sm text-gray-200 hover:bg-gray-600" @click="setAllCategories(true)">Expand all</button>
              <button type="button" class="rounded bg-gray-700 px-3 py-1 text-sm text-gray-200 hover:bg-gray-600" @click="setAllCategories(false)">Collapse all</button>
            </div>
            <ServiceCategory
                v-for="category in serviceCategories"
                :key="category.key"
                v-model="expandedCategories[category.key]"
                :category="category"
                :selected-count="selectedCountFor(category)"
                :enabled-count="enabledCountFor(category)"
            >
            <details
                v-for="opt in category.services"
                :key="opt.key"
                class="group bg-gray-700 p-4 rounded-lg border hover:shadow-xl transition-shadow"
                :class="opt.alreadyEnabled ? 'border-green-700' : 'border-gray-600'"
                :open="selectedKeys.includes(opt.key) || opt.alreadyEnabled"
            >
                <summary class="flex items-center space-x-3 cursor-pointer">
                <span v-if="opt.alreadyEnabled" class="h-5 w-5 shrink-0 inline-block rounded-full bg-green-500" aria-hidden="true"></span>
                <input
                    v-else
                    type="checkbox"
                    :value="opt.key"
                    v-model="selectedKeys"
                    :aria-label="opt.name"
                    :title="opt.descriptionText || opt.name"
                    class="h-5 w-5 shrink-0 text-indigo-500 bg-gray-600 border-gray-500 rounded focus:ring-indigo-400 focus:ring-2"
                />
                <span class="font-semibold text-white group-open:text-indigo-300">
                    {{ opt.name }} <span v-if="opt.alreadyEnabled" class="text-xs text-green-400">(already enabled)</span>
                </span>
                </summary>
                <div class="mt-3 text-gray-400 prose prose-sm">
                <ServiceDescription :text="opt.description" />
                </div>
            </details>
            </ServiceCategory>
            </div>
            </template>

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
                v-if="audiobookshelfSelected"
                class="rounded-md border border-sky-400/50 bg-sky-900/20 p-4 text-sm text-sky-100"
            >
                <p class="font-semibold text-white">Audiobookshelf first setup</p>
                <p class="mt-1">
                    Keep Audiobookshelf's configuration and metadata directories on persistent storage.
                    After startup, open its web UI and complete Initial Server Setup to create the root account.
                    Add audiobook and podcast libraries using media folders that DUMB can read.
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
