<script setup>
import { useProcessesStore } from "~/stores/processes.js";
import { useLogsStore } from "~/stores/logs.js";
import { useMetricsStore } from "~/stores/metrics.js";
import { useAuthStore } from "~/stores/auth.js";

const processesStore = useProcessesStore()
const logsStore = useLogsStore()
const metricsStore = useMetricsStore()
const authStore = useAuthStore()


onMounted(async () => {
  // Note: Auth initialization is handled by the middleware, not here
  // Only load app data if we're authenticated and past the setup/login flow

  // Don't load data if:
  // 1. We're on the setup page (no users exist yet)
  // 2. We're on the login page (not authenticated yet)
  // 3. Auth is enabled but user isn't authenticated
  const route = useRoute()
  const isAuthPage = route.path === '/setup' || route.path === '/login'

  if (isAuthPage) {
    console.log('Skipping data load on auth page:', route.path)
    return
  }

  // If auth is enabled, wait until user is authenticated
  if (authStore.isAuthEnabled && !authStore.isAuthenticated) {
    console.log('Skipping data load - auth required but not authenticated')
    return
  }

  try {
    await processesStore.getProcesses()
  } catch (err) {
    console.warn('Failed to load processes in app.vue:', err)
  }

  try {
    await logsStore.getAllLogs()
  } catch (err) {
    console.warn('Failed to load logs in app.vue:', err)
  }

  try {
    metricsStore.connect()
  } catch (err) {
    console.warn('Failed to connect metrics in app.vue:', err)
  }
});

watchEffect(() => {
  useHead({
    titleTemplate: `${processesStore.projectName} Dashboard`,
  });
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
