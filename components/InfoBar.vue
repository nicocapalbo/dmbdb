<script setup>
const router = useRouter()
const route = useRoute()

let metricsAvailabilityPromise = null
let metricsAvailabilityValue = null
const metricsAvailable = ref(false)

const toggleSettingsPage = () => {
  if (route.path === "/settings") {
    router.push({ name: 'index' })
  } else {
    router.push({ name: 'settings' })
  }
}

const toggleMetricsPage = () => {
  if (route.path === "/metrics") {
    router.push({ name: 'index' })
  } else {
    router.push({ name: 'metrics' })
  }
}

const checkMetricsAvailability = async () => {
  if (metricsAvailabilityPromise) return metricsAvailabilityPromise
  metricsAvailabilityPromise = fetch('/api/metrics')
    .then((response) => {
      metricsAvailabilityValue = response.ok
      return metricsAvailabilityValue
    })
    .catch(() => {
      metricsAvailabilityValue = false
      return false
    })
  return metricsAvailabilityPromise
}

onMounted(async () => {
  if (metricsAvailabilityValue !== null) {
    metricsAvailable.value = metricsAvailabilityValue
    return
  }
  metricsAvailable.value = await checkMetricsAvailability()
})
</script>

<template>
  <div class="w-full flex gap-2 items-center justify-end">

    <button
      v-if="metricsAvailable"
      class="w-max button-small group bg-gray-800 hover:bg-gray-700"
      @click="toggleMetricsPage()"
    >
      <span
        class="material-symbols-rounded !text-[16px] rotate-0 group-hover:-rotate-12 transform transition ease-in-out duration-200">monitoring</span>
    </button>
    <button class="w-max button-small group bg-gray-800 hover:bg-gray-700" @click="toggleSettingsPage()">
      <span
        class="material-symbols-rounded !text-[16px] rotate-0 group-hover:rotate-90 transform transition ease-in-out duration-200">settings</span>
    </button>
  </div>
</template>
