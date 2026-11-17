<script setup>
import { computed } from 'vue'
import { infinidyskV2SourceQueue } from '~/helper/infinidyskV2Queue.js'
const props = defineProps({ value: { type: Object, default: null } })
const queue = computed(() => infinidyskV2SourceQueue(props.value))
</script>

<template>
  <section v-if="queue" class="space-y-1 rounded border border-slate-600 p-3 text-sm" data-testid="v2-source-queue">
    <h4 class="font-semibold">Queued downloads</h4>
    <p v-if="queue.policy === 'omit_from_v2'">Pending downloads are excluded from the v2 import. They remain in the v1 recovery copy and return if v1 is restored. Completed and failed history is preserved.</p>
    <p v-else>Queued downloads must finish or be handled in v1 before testing or upgrading. Failed history alone does not block migration.</p>
    <p v-if="queue.observedCount !== null" data-testid="v2-source-queue-observed">{{ queue.observation === 'captured' ? 'Pending downloads at the stopped-source check' : 'Observed pending downloads' }}: {{ queue.observedCount.toLocaleString('en-US') }}.</p>
    <p v-if="queue.observation === 'live'" class="text-xs v2-muted">This live count can change. DUMB checks the stopped source before preparing its import database.</p>
    <p v-else-if="queue.observation === 'unavailable'" class="text-xs v2-muted">The live queue count is unavailable. DUMB checks the stopped source before preparing its import database.</p>
    <p v-if="queue.omittedCount !== null" data-testid="v2-source-queue-omitted">Excluded from this v2 import: {{ queue.omittedCount.toLocaleString('en-US') }} queued downloads.</p>
  </section>
</template>

<style scoped>
.v2-muted { color: var(--app-text-muted, #cbd5e1); }
</style>
