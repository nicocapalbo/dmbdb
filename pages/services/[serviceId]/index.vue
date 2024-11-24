<script setup lang="ts">
import { statusRepository } from '~/services/status';
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const serviceId = route.params.serviceId;
const serviceStatus = ref(null);
const error = ref(null);

const repo = statusRepository();

onMounted(async () => {
  try {
    const response = await repo.getServiceStatus(serviceId);
    if (!response.ok) {
      throw new Error(`Error fetching service status: ${response.statusText}`);
    }
    serviceStatus.value = await response.json();
  } catch (err) {
    console.error(err);
    error.value = err.message;
  }
});
</script>

<template>
  <div class="service-page">
    <div class="content-container">
      <h1 class="service-title">Service: {{ route.params.serviceId }}</h1>
      <p v-if="error" class="error-message">Error: {{ error }}</p>
      <p v-else-if="serviceStatus" class="status-message">
        Service Status: {{ serviceStatus }}
      </p>
      <p v-else class="loading-message">Loading service status...</p>
    </div>
  </div>
</template>

<style scoped>
.service-page {
  @apply flex items-center justify-center h-screen bg-stone-900 text-white;
}

.content-container {
  @apply flex flex-col items-center text-center bg-stone-800 rounded p-6 shadow-md w-full max-w-md;
}

.service-title {
  @apply text-lg font-bold text-blue-400 mb-4;
}

.error-message {
  @apply text-red-500;
}

.status-message {
  @apply text-green-400;
}

.loading-message {
  @apply text-gray-400;
}
</style>
