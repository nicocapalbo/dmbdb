<script setup>
import { useOnboardingStore } from '~/stores/onboarding.js'
const store = useOnboardingStore()
</script>
<template>
  <section class="rounded-xl bg-gray-800 p-6 text-white space-y-3">
    <h2 class="text-2xl font-semibold">Startup request finished</h2>
    <p>This backend does not provide a persistent setup checklist. Review each application's required configuration and test its connections before using the complete workflow.</p>
    <p>Service startup alone does not verify provider credentials, media libraries, request routing or playback.</p>
    <p v-if="store.lastResponse?.results?.length">The backend returned {{ store.lastResponse.results.length }} startup result(s).</p>
    <a href="https://dumbarr.com/frontend/onboarding/" target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline">Onboarding and service configuration guidance</a>
  </section>
</template>
