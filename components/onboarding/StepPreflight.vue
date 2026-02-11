<script setup>
import { computed } from 'vue'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()

const checks = computed(() => store.preflightChecks || [])
const hasBlockingIssues = computed(() => store.preflightHasBlockingIssues)
const hasChecks = computed(() => checks.value.length > 0)

async function rerunChecks() {
  await store.runPreflightChecks()
}
</script>

<template>
  <section class="bg-gray-900 flex justify-center py-12 px-4">
    <div class="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-2xl font-semibold text-white">Preflight Checks</h2>
          <p class="text-sm text-gray-300 mt-2">
            Validate backend readiness before service selection and startup.
          </p>
        </div>
        <button
          class="px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          :disabled="store.preflightRunning"
          @click="rerunChecks"
        >
          {{ store.preflightRunning ? 'Running…' : 'Re-run checks' }}
        </button>
      </div>

      <div v-if="!hasChecks && store.preflightRunning" class="p-4 rounded-lg bg-gray-700 text-gray-200 border border-gray-600">
        Running onboarding preflight checks...
      </div>

      <div v-else-if="!hasChecks" class="p-4 rounded-lg bg-yellow-900/30 text-yellow-100 border border-yellow-700/60">
        Preflight checks have not run yet. Click <strong>Re-run checks</strong>.
      </div>

      <ul v-else class="space-y-3">
        <li
          v-for="check in checks"
          :key="check.key"
          class="p-4 rounded-lg border"
          :class="check.ok ? 'bg-emerald-900/20 border-emerald-700/50 text-emerald-100' : 'bg-rose-900/20 border-rose-700/50 text-rose-100'"
        >
          <div class="flex items-center justify-between gap-4">
            <span class="font-medium">{{ check.label }}</span>
            <span class="text-xs uppercase tracking-wide">
              {{ check.ok ? 'Pass' : (check.critical ? 'Blocking' : 'Warning') }}
            </span>
          </div>
          <p v-if="check.detail" class="mt-2 text-sm opacity-90">{{ check.detail }}</p>
        </li>
      </ul>

      <div
        class="p-4 rounded-lg border"
        :class="hasBlockingIssues ? 'bg-rose-900/30 border-rose-700/60 text-rose-100' : 'bg-emerald-900/30 border-emerald-700/60 text-emerald-100'"
      >
        <p v-if="hasBlockingIssues" class="text-sm">
          One or more blocking checks failed. Resolve those items, then re-run checks before continuing.
        </p>
        <p v-else class="text-sm">
          Preflight checks passed. Continue to configure onboarding.
        </p>
      </div>
    </div>
  </section>
</template>
