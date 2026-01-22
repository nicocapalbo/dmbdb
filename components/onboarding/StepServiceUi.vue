<script setup>
import { computed, onMounted } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()

const uiEmbedSupported = computed(() => store.serviceUiSupported)
const uiEmbedEnabled = computed(() => store.serviceUiEnabled)
const uiEmbedLoading = computed(() => store.serviceUiLoading)
const uiEmbedError = computed(() => store.serviceUiError)
const uiEmbedServices = computed(() => store.serviceUiServices)

const toggleServiceUi = async (event) => {
  const nextValue = !!event?.target?.checked
  await store.setServiceUiEnabled(nextValue)
}

onMounted(() => {
  if (store.serviceUiSupported === null) {
    store.loadServiceUiStatus()
  }
})
</script>

<template>
  <section class="bg-gray-900 flex justify-center py-12 px-4">
    <div class="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
      <h2 class="text-2xl font-semibold text-white">Embedded Service iFrames</h2>

      <p class="text-gray-300">
        Embed supported service web UIs directly inside the app. This keeps navigation in one place and routes
        requests through the built-in proxy for a smoother experience.
      </p>

      <div class="p-3 rounded-md bg-gray-700 border border-gray-600 text-sm text-gray-200">
        <p>When enabled, a UI tab appears for supported services so you can manage them without leaving the app.</p>
        <p class="mt-2">You can change this later in Settings.</p>
      </div>

      <label class="flex items-center gap-3 text-sm text-slate-200">
        <input
          type="checkbox"
          class="accent-emerald-400 h-4 w-4"
          :checked="uiEmbedEnabled"
          :disabled="uiEmbedLoading || !uiEmbedSupported"
          @change="toggleServiceUi"
        />
        <span>Enable embedded service iframes</span>
      </label>

      <p v-if="uiEmbedLoading" class="text-xs text-slate-400">Updating embedded UI settings...</p>
      <p v-else-if="uiEmbedError" class="text-xs text-amber-300">{{ uiEmbedError }}</p>
      <p v-else-if="uiEmbedSupported" class="text-xs text-slate-400">
        Detected UI services: {{ uiEmbedServices.length }}
      </p>
      <p v-else class="text-xs text-amber-300">Embedded UI support is not available on this backend.</p>
    </div>
  </section>
</template>
