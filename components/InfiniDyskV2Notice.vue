<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { useAuthStore } from '~/stores/auth.js'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import { infinidyskV2NeedsAttention, infinidyskV2NoticeVisible, infinidyskV2Support, isInfiniDyskV2JobActive, safeInfiniDyskV2Text as text } from '~/helper/infinidyskV2.js'
import InfiniDyskV2Panel from '~/components/InfiniDyskV2Panel.vue'
import InfiniDyskV2PostgresPanel from '~/components/InfiniDyskV2PostgresPanel.vue'

const auth = useAuthStore()
const route = useRoute()
const { state, refresh, update, reset } = useInfiniDyskV2State()
const allowed = computed(() => !['/login', '/setup'].includes(route.path) && (!auth.isAuthEnabled || auth.isAuthenticated))
const support = computed(() => infinidyskV2Support(state.value.capabilities))
const majorAttention = computed(() => infinidyskV2NeedsAttention(state.value.majorJob))
const postgresAttention = computed(() => infinidyskV2NoticeVisible(state.value.postgresJob))
const freshAvailable = computed(() => support.value.migration && state.value.major?.mode === 'fresh'
  && state.value.major?.eligibility?.ready === true && state.value.major?.runtime_generation !== '2')
let timer = null
let generation = 0
const stop = () => { if (timer) clearTimeout(timer); timer = null; generation++ }
const poll = async current => {
  if (!allowed.value || current !== generation) return
  await refresh()
  if (!allowed.value || current !== generation) return
  timer = setTimeout(() => poll(current), isInfiniDyskV2JobActive(state.value.majorJob) || isInfiniDyskV2JobActive(state.value.postgresJob) ? 2000 : 15000)
}
watch(allowed, enabled => {
  stop()
  if (enabled) poll(generation)
  else reset()
}, { immediate: true })
onBeforeUnmount(stop)
</script>

<template>
  <template v-if="allowed">
    <div v-if="majorAttention || postgresAttention || freshAvailable" class="fixed bottom-4 left-4 right-4 z-[1000] mx-auto max-w-4xl space-y-2" aria-live="polite">
      <div v-if="majorAttention || freshAvailable" class="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500 bg-slate-900 p-3 text-amber-100">
        <p>{{ majorAttention ? (state.majorJob.cleanup ? `InfiniDysk v1 cleanup · ${text(state.majorJob.cleanup.state)}` : `InfiniDysk 2 migration · ${text(state.majorJob.status)}`) : 'InfiniDysk 2 fresh installation is available for review.' }}</p>
        <button class="button-small border border-amber-500" data-testid="v2-open-major" @click="update({ majorOpen: true, postgresOpen: false })">{{ majorAttention ? 'Open progress / recovery' : 'Open installation wizard' }}</button>
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
