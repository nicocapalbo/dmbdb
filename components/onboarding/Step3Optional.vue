<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import useService from '~/services/useService.js'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()
const emit = defineEmits(['next'])
const skipCountdown = ref(30)
let countdownTimer
// Metadata state for optional services
const optionalOptions = ref([])
const pending = ref(true)
const error = ref(null)
const enabledOptionals = ref([]) 

onMounted(async () => {
  try {
    const { processService } = useService()
    const { core_services } = await processService.getCoreServices()
    const coreKeys = store.coreServices
      .map(cs => cs.name)
      .filter(key => core_services.some(s => s.key === key))

    let finalOptionals = []

    if (coreKeys.length) {
      const lists = await Promise.all(
        coreKeys.map(key =>
          processService
            .getOptionalServices(key, store.optionalServices)
            .then(r => r.optional_services)
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
      const resp = await processService.getOptionalServices(null, store.optionalServices)
      finalOptionals = resp.optional_services
    }

    const config = store._Config || {}

    // Split into enabled vs available
    enabledOptionals.value = finalOptionals.filter(opt => config[opt.key]?.enabled === true)
    optionalOptions.value = finalOptionals.filter(opt => !config[opt.key]?.enabled)

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
const selectedKeys = ref([...store.optionalServices])
watch(selectedKeys, (keys) => {
    store.optionalServices = [...keys]
})

const optionalOptionsWithHtml = computed(() =>
    optionalOptions.value.map(opt => {
        // 1) linkify URLs
        let html = opt.description
            .replace(
                /(https?:\/\/[^\s]+)/g,
                `<a href="$1" target="_blank" class="text-blue-400 underline break-words">$1</a>`
            )
            // 2) turn blank lines into paragraph breaks
            .replace(/\n\n/g, '<br/><br/>')

        return {
            ...opt,
            descriptionHtml: html
        }
    })
)
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
            <p v-if="optionalOptionsWithHtml.length" class="text-gray-300">
                Choose any additional services you'd like to enable to extend your core installation.
            </p>

            <!-- Tip Note -->
            <div v-if="optionalOptionsWithHtml.length" class="block mt-2 p-3 rounded-md bg-gray-700 border-l-4 border-blue-400 text-blue-200">
                <strong>Tip:</strong> Click a service name to expand its details and learn more.
            </div>
            
            <!-- Loading / Error -->
            <div v-if="pending" class="text-gray-400 text-center py-6">
                Loading optional services…
            </div>
            <div v-else-if="error" class="text-red-500 text-center">
                Failed to load optional services.
            </div>
            <!-- No Optional Services -->
            <div v-else-if="!optionalOptionsWithHtml.length" class="text-yellow-400 text-center py-6 space-y-4">
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
                v-for="opt in optionalOptionsWithHtml"
                :key="'available-' + opt.key"
                class="group bg-gray-700 p-4 rounded-lg border border-gray-600 hover:shadow-xl transition-shadow"
            >
                <summary class="flex items-center space-x-3 cursor-pointer">
                <input
                    type="checkbox"
                    :value="opt.key"
                    v-model="selectedKeys"
                    class="h-5 w-5 text-indigo-500 bg-gray-600 border-gray-500 rounded focus:ring-indigo-400 focus:ring-2"
                />
                <span class="font-semibold text-white group-open:text-indigo-300">
                    {{ opt.name }}
                </span>
                </summary>
                <div class="mt-3 text-gray-400 prose prose-sm">
                <p v-html="opt.descriptionHtml"></p>
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
                <p v-html="opt.description" />
                </div>
            </details>

            </div>
        </div>
    </section>
</template>
