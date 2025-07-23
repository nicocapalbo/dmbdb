<script setup lang="ts">
import { useOnboardingStore } from '~/stores/onboarding'
const store = useOnboardingStore()
</script>

<template>
    <section class="bg-gray-900 flex justify-center py-12 px-4">
        <div class="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6 text-center">
            <!-- Error Header -->
            <h2 class="text-2xl font-bold text-red-500">
                Something went wrong
            </h2>

            <!-- Response Dump -->
            <pre
                class="bg-gray-700 text-gray-200 rounded-xl p-4 text-sm overflow-x-auto border border-gray-600 whitespace-pre-wrap">
{{ store.lastResponse }}
      </pre>

            <!-- Guidance Text -->
            <p class="text-gray-300">
                Go back and verify your settings, then try again.
            </p>
        </div>
    </section>
</template>
