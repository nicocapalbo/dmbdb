<script setup>
import { computed } from 'vue'
import { infinidyskV2StorageWork } from '~/helper/infinidyskV2StorageWork.js'
import { formatInfiniDyskV2Bytes as bytes } from '~/helper/infinidyskV2.js'
const props = defineProps({ value: { type: Object, default: null } })
const work = computed(() => infinidyskV2StorageWork(props.value))
const amount = (value, minimum = false) => value === null ? 'not measured' : (minimum ? 'At least ' : '') + bytes(value)
</script>

<template>
  <section v-if="work" class="v2-storage-work space-y-3 rounded border border-slate-600 p-3 text-sm" aria-label="Migration storage work comparison" data-testid="v2-storage-work">
    <h4 class="font-semibold">How storage affects migration time</h4>
    <p class="v2-work-muted" data-testid="v2-storage-work-limits">Reusing v1 can be quicker when archive storage is fast. Keeping a local working copy can be quicker when a network archive is slow. Moving blobs externally frees local space but adds transfers and makes the importer read that storage.</p>
    <p v-if="work.sourceDataBytes !== null || work.legacyBlobBytes !== null" class="v2-work-muted" data-testid="v2-storage-work-source">Measured working data: {{ amount(work.sourceDataBytes) }} · Legacy blob input: {{ amount(work.legacyBlobBytes) }}.</p>
    <ul class="space-y-3">
      <li v-for="path in work.paths" :key="path.id" class="space-y-1 rounded border border-slate-600 p-3" :class="{ 'border-blue-400': path.selected }" :data-testid="'v2-storage-path-' + path.id">
        <p class="font-semibold">{{ path.label }}<span v-if="path.selected" class="ml-2 text-xs">Selected</span></p>
        <p class="v2-work-muted">{{ path.explanation }}</p>
        <dl class="v2-work-totals" aria-label="Added logical data movement"><template v-for="phase in path.phases" :key="phase.id"><dt>{{ phase.label }}</dt><dd :data-testid="'v2-storage-' + phase.id">{{ amount(phase.readBytes, phase.minimum) }} read · {{ amount(phase.writeBytes) }} written</dd></template></dl>
        <p v-if="path.needsArchive" class="v2-work-muted">Requires registered migration storage for the recovery archive.</p>
        <details class="pt-1" :data-testid="'v2-storage-details-' + path.id"><summary class="cursor-pointer">Copying, checks and restoration</summary>
          <div v-for="phase in path.phases" :key="phase.id" class="mt-2">
            <p class="font-medium">{{ phase.label }}</p>
            <ul v-if="phase.legs.length" class="v2-work-muted mt-1 list-inside list-disc"><li v-for="leg in phase.legs" :key="leg.id">{{ leg.label }} ({{ leg.storageLabel }}, {{ leg.passes }} {{ leg.passes === 1 ? 'pass' : 'passes' }}): {{ amount(leg.readBytes, leg.minimum) }} read · {{ amount(leg.writeBytes) }} written.</li></ul>
            <p v-else class="v2-work-muted">No extra transfer counted for this part; common checks still apply.</p>
          </div>
          <p v-if="path.id !== 'keep_local'" class="mt-2 v2-work-muted">A test migration always restores v1, so rebuilding it from the archive can outweigh the copying saved during preparation.</p>
        </details>
      </li>
    </ul>
    <p class="v2-work-muted">Every path still saves and verifies recovery data, converts with InfiniDysk and checks the result. Provider reads, small-file overhead, database growth and storage contention can dominate the time.</p>
    <p v-if="work.storageType === 'network'" class="v2-work-muted" data-testid="v2-storage-network-note">Your selected archive location is network storage. Archive writing and verification use that connection; moving blobs there also makes conversion read from it.</p>
    <p v-else-if="work.storageType === 'unknown'" class="v2-work-muted">The selected archive storage type could not be identified. Its speed has not been measured.</p>
    <p class="text-xs v2-work-muted">No measured fastest-to-slowest order is available. These are added logical file-byte estimates, not measured device or network traffic. They exclude the common backup, source fingerprints, conversion and candidate checks. Archive totals are lower bounds until its size is known. Pass totals already include every listed pass.</p>
    <p class="text-xs v2-work-muted">Preparing and activating the same candidate avoids repeating conversion. The older test-then-migrate flow restores v1, then repeats migration work.</p>
  </section>
</template>

<style scoped>
.v2-storage-work { color: var(--app-text, #e2e8f0); }
.v2-work-muted { color: var(--app-text-muted, #cbd5e1); }
.v2-work-totals { display: grid; grid-template-columns: minmax(6rem, .7fr) minmax(0, 1.3fr); gap: .25rem .75rem; padding-top: .25rem; }
.v2-work-totals dd { overflow-wrap: anywhere; }
@media (max-width: 480px) { .v2-work-totals { grid-template-columns: 1fr; } .v2-work-totals dd { margin-bottom: .25rem; } }
</style>
