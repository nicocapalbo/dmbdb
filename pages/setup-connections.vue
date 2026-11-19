<script setup>
import { computed } from 'vue'
import SetupStatusPanel from '~/components/SetupStatusPanel.vue'
const route = useRoute()
const checklist = computed(() => route.query.view === 'checklist')
</script>

<template>
  <main class="mx-auto max-w-4xl space-y-5 p-6 text-white">
    <h1 class="text-2xl font-semibold">Connect your apps</h1>
    <p>Your installation choices are saved. This optional walkthrough helps finish accounts, app connections and library settings. You can pause it and keep using DUMB.</p>
    <NuxtLink to="/" class="inline-block text-cyan-200 underline">Return to dashboard</NuxtLink>
    <SetupStatusPanel always guided-entry :start-guided="!checklist" :checklist-initially="checklist" />
  </main>
</template>
