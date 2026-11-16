<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { useInfiniDyskV2Polling } from '~/composables/useInfiniDyskV2Polling.js'
import { useStatusStore } from '~/stores/status.js'
import { infinidyskV2JobPresentation } from '~/helper/infinidyskV2Presentation.js'
import { useAuthStore } from '~/stores/auth.js'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import { infinidyskV2ConsumerRecovery, infinidyskV2NeedsAttention, infinidyskV2NoticeVisible, infinidyskV2Support, isInfiniDyskV2JobActive, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
import { infinidyskV2PreviewBlocked, infinidyskV2PreviewTaskActive } from '~/helper/infinidyskV2Preview.js'
import InfiniDyskV2Panel from '~/components/InfiniDyskV2Panel.vue'
import InfiniDyskV2PostgresPanel from '~/components/InfiniDyskV2PostgresPanel.vue'

const auth = useAuthStore()
const serviceStatus = useStatusStore()
const route = useRoute()
const { state, refresh, update, reset } = useInfiniDyskV2State()
const allowed = computed(() => !['/login', '/setup'].includes(route.path) && (!auth.isAuthEnabled || auth.isAuthenticated))
const support = computed(() => infinidyskV2Support(state.value.capabilities))
const majorAttention = computed(() => infinidyskV2NeedsAttention(state.value.majorJob))
const previewAttention = computed(() => state.value.major?.runtime_generation !== '2' && (state.value.majorPreviewUncertain || state.value.majorPreviewPending
  || infinidyskV2PreviewTaskActive(state.value.majorPreviewTask) || state.value.majorPreviewTask?.preview_available === true
  || ['failed', 'interrupted'].includes(state.value.majorPreviewTask?.status)))
const consumerRecovery = computed(() => infinidyskV2ConsumerRecovery(state.value.majorJob))
const postgresAttention = computed(() => infinidyskV2NoticeVisible(state.value.postgresJob))
const freshAvailable = computed(() => support.value.migration && state.value.major?.mode === 'fresh'
  && state.value.major?.eligibility?.ready === true && state.value.major?.runtime_generation !== '2')
const majorPresentation = computed(() => infinidyskV2JobPresentation(state.value.majorJob))
const majorNoticeTitle = computed(() => {
  if (consumerRecovery.value && state.value.majorJob?.status === 'completed') return consumerRecovery.value.pending.length
    ? 'InfiniDysk 2 cutover retained · services left stopped' : 'InfiniDysk 2 cutover completed'
  return majorPresentation.value?.title || 'Migration status needs confirmation'
})

useInfiniDyskV2Polling(allowed)
watch(allowed, enabled => {
  if (!enabled) { serviceStatus.resetMigrationServices(); reset() }
}, { immediate: true })
watch([() => state.value.majorObservedAt, () => state.value.majorStatusConfirmed, () => state.value.majorJob?.job_id, () => state.value.majorJob?.status, () => state.value.majorJob?.stage], () => {
  if (allowed.value) serviceStatus.observeMigrationServices(state.value.majorJob, { confirmed: state.value.majorStatusConfirmed })
})
onBeforeUnmount(() => serviceStatus.resetMigrationServices())
</script>

<template>
  <template v-if="allowed">
    <div v-if="majorAttention || postgresAttention || freshAvailable || previewAttention" class="fixed bottom-4 left-4 right-4 z-[1000] mx-auto max-w-4xl space-y-2" aria-live="polite">
      <div v-if="majorAttention || freshAvailable" class="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500 bg-slate-900 p-3 text-amber-100">
        <p>{{ majorAttention ? majorNoticeTitle : 'InfiniDysk 2 fresh installation is available for review.' }}</p>
        <button class="button-small border border-amber-500" data-testid="v2-open-major" @click="update({ majorOpen: true, postgresOpen: false })">{{ majorAttention ? 'Open progress / recovery' : 'Open installation wizard' }}</button>
      </div>
      <div v-if="previewAttention && !majorAttention && !postgresAttention" class="flex flex-wrap items-center justify-between gap-2 rounded border border-blue-400 bg-slate-900 p-3">
        <div><p>{{ state.majorPreviewUncertain ? 'Migration preview status needs confirmation' : infinidyskV2PreviewTaskActive(state.majorPreviewTask) || state.majorPreviewPending ? 'Preparing migration preview' : state.majorPreviewTask?.preview_available ? 'Migration preview ready for review' : 'Migration preview needs attention' }}</p>
          <p class="text-sm">Read-only inspection; your services keep running. No migration has started.</p></div>
        <button class="button-small border border-blue-400" data-testid="v2-open-preview" @click="update({ majorOpen: true, postgresOpen: false })">Open preview status</button>
      </div>
      <div v-if="postgresAttention" class="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500 bg-slate-900 p-3 text-amber-100">
        <p>InfiniDysk 2 database conversion · {{ text(state.postgresJob.status) }}</p>
        <p v-if="state.postgresJob.cleanup_required" class="text-sm">Native cleanup needs review; SQLite remains active.</p>
        <button class="button-small border border-amber-500" data-testid="v2-open-postgres" @click="update({ postgresOpen: true, majorOpen: false })">{{ state.postgresJob.cleanup_required ? 'Open cleanup review' : 'Open progress / recovery' }}</button>
      </div>
      <p v-if="state.error" class="rounded bg-slate-900 p-2 text-sm text-rose-200">{{ state.error }}</p>
    </div>
    <InfiniDyskV2Panel :open="state.majorOpen" @close="update({ majorOpen: false })" />
    <InfiniDyskV2PostgresPanel :open="state.postgresOpen" @close="update({ postgresOpen: false })" />
  </template>
</template>

<style scoped>
[data-appearance-mode='light'] .text-amber-100 {
  @apply text-amber-800;
}

[data-appearance-mode='light'] .text-rose-200 {
  @apply text-rose-800;
}
</style>
