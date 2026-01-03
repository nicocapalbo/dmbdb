<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import useService from '~/services/useService.js'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()

// dynamic core services state
const coreServiceOptions = ref([])
const pending = ref(true)
const error = ref(null)

// selection of service KEYS (unique per service)
const selectedNames = ref(store.coreServices.map(s => s.name))
const prevSelected = ref([...selectedNames.value])

onMounted(async () => {
  try {
    const { processService } = useService()
    const { core_services } = await processService.getCoreServices()

    // Filter: always show instance-based cores even if enabled (so users can add more);
    // hide already-enabled singletons.
    const config = store._Config || {}
    coreServiceOptions.value = core_services.filter(service => {
      const serviceConfig = config[service.key]
      if (service.supports_instances) return true
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
    let html = s.description
      .replace(/(https?:\/\/[^\s]+)/g, `<a href="$1" target="_blank" class="text-blue-500 underline break-words">$1</a>`)
      .replace(/\n/g, '<br/>')

    let tosNotice = null
    if (s.key === 'emby') {
      tosNotice = `By enabling Emby, you agree to the <a href="https://emby.media/terms.html" target="_blank" rel="noopener noreferrer" class="underline">Emby Terms of Service</a>.`
    } else if (s.key === 'plex') {
      tosNotice = `By enabling Plex, you agree to the <a href="https://www.plex.tv/about/privacy-legal/plex-terms-of-service/" target="_blank" rel="noopener noreferrer" class="underline">Plex Terms of Service</a>.`
    }
    return { ...s, descriptionHtml: html, tosNotice }
  })
)

// Keep store.coreServices in sync with checkbox changes WITHOUT losing multiple instances
watch(selectedNames, (names) => {
  const prev = prevSelected.value

  // removals: drop ALL instances for that service
  const removed = prev.filter(k => !names.includes(k))
  if (removed.length) {
    store.coreServices = store.coreServices.filter(cs => !removed.includes(cs.name))
  }

  // additions: add one default instance (user can add more below)
  const added = names.filter(k => !prev.includes(k))
  for (const k of added) {
    if (!store.coreServices.some(cs => cs.name === k)) {
      store.coreServices.push({ name: k, instance_name: '' })
    }
  }

  prevSelected.value = [...names]
})

// helpers for multiple instances UI
const instancesFor = (key) => store.coreServices.filter(cs => cs.name === key)
function addInstance(key) {
  if (!selectedNames.value.includes(key)) selectedNames.value.push(key)
  store.coreServices.push({ name: key, instance_name: '' })
}
function removeInstance(key, idx) {
  const list = instancesFor(key)
  const target = list[idx]
  const i = store.coreServices.indexOf(target)
  if (i !== -1) store.coreServices.splice(i, 1)
  if (instancesFor(key).length === 0) {
    selectedNames.value = selectedNames.value.filter(k => k !== key)
  }
}

// ---- Duplicate / Empty validation (includes existing enabled instances) ----
function existingInstanceNamesLC(key) {
  const conf = (store._Config || {})[key]
  const inst = conf?.instances || {}
  const names = Array.isArray(inst)
    ? inst.map(i => (i.instance_name || i.name || '').trim().toLowerCase())
    : Object.keys(inst).map(n => n.trim().toLowerCase())
  return new Set(names.filter(n => n && n !== 'default'))
}

function hasDupInstance(key) {
  const current = instancesFor(key)
    .map(x => (x.instance_name || '').trim().toLowerCase())
    .filter(Boolean)
  const currentSet = new Set(current)
  const existingSet = existingInstanceNamesLC(key)
  // duplicate among "to-be-created" OR conflicts with existing enabled instances
  const hasInternalDup = currentSet.size !== current.length
  const hasExistingConflict = current.some(n => existingSet.has(n))
  return hasInternalDup || hasExistingConflict
}

function hasEmptyInstanceName(key) {
  return instancesFor(key).some(x => !(x.instance_name || '').trim())
}

// expose a hard-block flag to onboarding.vue's Next button
const instanceNameBlocked = computed(() => {
  return coreServiceOptions.value.some(s =>
    selectedNames.value.includes(s.key) && s.supports_instances && (
      hasEmptyInstanceName(s.key) || hasDupInstance(s.key)
    )
  )
})
watch(instanceNameBlocked, (v) => { store._instanceNameBlocked = v }, { immediate: true })
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
            <span v-if="store._capabilities?.optional_only_onboarding" class="block mt-2">
                If you only want optional services, you can skip selecting a core service and click Next.
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
            <details
                v-for="service in servicesWithLinks"
                :key="service.key"
                class="group bg-gray-700 p-4 rounded-lg border border-gray-600 hover:shadow-xl transition-shadow"
                :open="selectedNames.includes(service.key)"
            >
                <summary class="flex flex-col sm:flex-row sm:items-center sm:space-x-3 cursor-pointer">
                <div class="flex items-center space-x-3">
                    <label class="inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        :value="service.key"
                        v-model="selectedNames"
                        class="h-5 w-5 text-indigo-500 bg-gray-600 border-gray-500 rounded focus:ring-indigo-400 focus:ring-2"
                    />
                    </label>
                    <span class="font-semibold text-white group-open:text-indigo-300">
                    {{ service.name }}
                    </span>
                </div>

                <!-- Always-visible Terms line for Emby/Plex -->
                <span
                    v-if="service.tosNotice"
                    class="mt-1 sm:mt-0 sm:ml-3 text-xs text-gray-400"
                    v-html="service.tosNotice"
                />
                </summary>

                <div class="mt-3 text-gray-400 prose prose-sm">
                <p v-html="service.descriptionHtml"></p>

                <!-- Show currently enabled instances from existing config, if any -->
                <div v-if="service.supports_instances && existingInstanceNamesLC(service.key).size" class="mt-3">
                  <div class="text-s text-indigo-300 mb-1">Existing instances:</div>
                  <ul class="text-s text-indigo-300 list-disc pl-5">
                    <li v-for="name in Array.from(existingInstanceNamesLC(service.key))" :key="name">
                      <span class="font-mono">{{ name }}</span>
                    </li>
                  </ul>
                </div>
                </div>

                <!-- Instances UI: shows only if selected and backend supports instances -->
                <div
                  v-if="selectedNames.includes(service.key) && service.supports_instances"
                  class="mt-4 p-3 rounded-md bg-gray-800 border border-gray-600"
                >
                  <div class="flex items-center justify-between mb-2">
                    <label class="text-sm text-gray-300">Instances</label>
                    <button type="button" @click="addInstance(service.key)" class="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white">
                      Add another instance
                    </button>
                  </div>

                  <div class="space-y-3">
                    <div
                      v-for="(inst, idx) in instancesFor(service.key)"
                      :key="service.key + '-' + idx"
                      class="p-3 rounded-md bg-gray-900 border border-gray-700"
                    >
                      <div class="flex items-center gap-3">
                        <input
                          v-model.trim="inst.instance_name"
                          type="text"
                          placeholder="e.g., TV, Anime, Movies"
                          class="flex-1 rounded-md bg-gray-950 border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          maxlength="64"
                        />
                        <button
                          v-if="instancesFor(service.key).length > 1"
                          type="button"
                          class="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
                          @click="removeInstance(service.key, idx)"
                        >Remove</button>
                      </div>
                    </div>
                  </div>

                  <p v-if="hasEmptyInstanceName(service.key)" class="text-xs text-amber-300 mt-2">
                    Please enter an instance name for all {{ service.name }} instances.
                  </p>
                  <p v-else-if="hasDupInstance(service.key)" class="text-xs text-amber-300 mt-2">
                    Duplicate instance names detected for {{ service.name }} (includes existing instances). Please make them unique.
                  </p>
                </div>
            </details>
            </div>
        </div>
    </section>
</template>
