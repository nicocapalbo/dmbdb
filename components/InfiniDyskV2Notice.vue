<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { useLocalStorage, useTimestamp } from '@vueuse/core'
import { useInfiniDyskV2Polling } from '~/composables/useInfiniDyskV2Polling.js'
import { useStatusStore } from '~/stores/status.js'
import { infinidyskV2JobPresentation } from '~/helper/infinidyskV2Presentation.js'
import { useAuthStore } from '~/stores/auth.js'
import { useProcessesStore } from '~/stores/processes.js'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import { infinidyskV2ConsumerRecovery, infinidyskV2NeedsAttention, infinidyskV2NoticeVisible, infinidyskV2Support, isInfiniDyskV2JobActive, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
import { INFINIDYSK_V2_INVITATION_STORAGE_KEY, deferInfiniDyskV2Invitation, infinidyskV2InvitationDue, infinidyskV2UpgradeInvitationAvailable, normalizeInfiniDyskV2InvitationPreference } from '~/helper/infinidyskV2Invitation.js'
import { infinidyskV2PreviewBlocked, infinidyskV2PreviewTaskActive } from '~/helper/infinidyskV2Preview.js'
import InfiniDyskV2Panel from '~/components/InfiniDyskV2Panel.vue'
import InfiniDyskV2PostgresPanel from '~/components/InfiniDyskV2PostgresPanel.vue'

const auth = useAuthStore()
const processes = useProcessesStore()
const serviceStatus = useStatusStore()
const route = useRoute()
const onboarding = computed(() => /^\/onboarding(?:\/|$)/.test(route.path))
const { state, refresh, update, reset } = useInfiniDyskV2State()
const allowed = computed(() => !['/login', '/setup'].includes(route.path) && (!auth.isAuthEnabled || auth.isAuthenticated))
const support = computed(() => infinidyskV2Support(state.value.capabilities))
const invitationPreference = useLocalStorage(INFINIDYSK_V2_INVITATION_STORAGE_KEY, normalizeInfiniDyskV2InvitationPreference(null), { mergeDefaults: true })
const now = useTimestamp({ interval: 60_000 })
const majorAttention = computed(() => infinidyskV2NeedsAttention(state.value.majorJob))
const previewAttention = computed(() => state.value.major?.runtime_generation !== '2' && (state.value.majorPreviewUncertain || state.value.majorPreviewPending
  || infinidyskV2PreviewTaskActive(state.value.majorPreviewTask) || state.value.majorPreviewTask?.preview_available === true
  || ['failed', 'interrupted'].includes(state.value.majorPreviewTask?.status)))
const consumerRecovery = computed(() => infinidyskV2ConsumerRecovery(state.value.majorJob))
const postgresAttention = computed(() => infinidyskV2NoticeVisible(state.value.postgresJob))
const upgradeInvitationVisible = computed(() => !onboarding.value && !processes.needsOnboarding
  && support.value.migration && state.value.majorStatusConfirmed === true
  && !majorAttention.value && !previewAttention.value && !postgresAttention.value
  && infinidyskV2UpgradeInvitationAvailable(state.value.major, processes.enabledProcesses)
  && infinidyskV2InvitationDue(invitationPreference.value, now.value / 1000))
const deferInvitation = duration => {
  invitationPreference.value = deferInfiniDyskV2Invitation(invitationPreference.value, duration, now.value / 1000)
}
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
    <div v-if="majorAttention || postgresAttention || previewAttention || upgradeInvitationVisible" class="mx-auto max-w-4xl space-y-2" :class="onboarding ? 'mb-4 px-8' : 'fixed bottom-4 left-4 right-4 z-[1000]'" aria-live="polite">
      <div v-if="upgradeInvitationVisible" class="space-y-2 rounded border border-blue-400 bg-slate-900 p-3" data-testid="v2-upgrade-invitation">
        <p class="font-semibold">InfiniDysk 2 upgrade is available to review</p>
        <p class="text-sm">Review the migration plan when you are ready. Nothing starts automatically.</p>
        <div class="flex flex-wrap gap-2">
          <button class="button-small border border-blue-400" data-testid="v2-review-upgrade" @click="update({ majorOpen: true, postgresOpen: false })">Review upgrade</button>
          <button class="button-small border border-slate-500" data-testid="v2-remind-tomorrow" @click="deferInvitation(86400)">Remind me tomorrow</button>
          <button class="button-small border border-slate-500" data-testid="v2-remind-week" @click="deferInvitation(604800)">Remind me in a week</button>
          <button class="button-small border border-slate-500" data-testid="v2-dismiss-upgrade" @click="deferInvitation('permanent')">Don't show again</button>
        </div>
        <p class="text-xs">These choices are saved in this browser. You can always open the wizard from InfiniDysk service tools.</p>
      </div>
      <div v-if="majorAttention" class="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500 bg-slate-900 p-3 text-amber-100">
        <p>{{ majorNoticeTitle }}</p>
        <button class="button-small border border-amber-500" data-testid="v2-open-major" @click="update({ majorOpen: true, postgresOpen: false })">{{ majorPresentation?.state === 'prepared' ? 'Review and activate' : 'Open progress / recovery' }}</button>
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
