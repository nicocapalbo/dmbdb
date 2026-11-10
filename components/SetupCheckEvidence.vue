<script setup>
import { setupCheckLabel, setupChangeValue, setupTimestamp } from '~/helper/setupArrangements.js'
defineProps({ evidence: { type: Object, default: () => ({}) } })
</script>

<template>
  <section v-if="evidence?.paths?.length || evidence?.checks?.length" class="space-y-2 text-sm" aria-label="Setup check results">
    <h4 class="font-semibold">Check results</h4>
    <template v-if="evidence.level === 'workflow_test'">
      <p v-if="evidence.stage">Stage: {{ String(evidence.stage).replaceAll('_', ' ') }}</p>
      <p><span v-if="Number.isFinite(evidence.download_bytes)">{{ evidence.download_bytes }} bytes downloaded</span><span v-if="Number.isSafeInteger(evidence.decoded_frames)"> · {{ evidence.decoded_frames }} decoded frames</span></p>
      <p>Test artifact cleanup: {{ evidence.cleanup_complete === true ? 'Completed' : evidence.cleanup_complete === false ? 'Needs attention' : 'Not verified' }}</p>
      <p v-if="setupTimestamp(evidence.verified_at)">Verified: <time :datetime="setupTimestamp(evidence.verified_at).datetime">{{ setupTimestamp(evidence.verified_at).text }}</time></p>
    </template>
    <p v-if="evidence.level === 'consumer_namespace'">Consumer filesystem namespace: {{ evidence.namespace_verified === true ? 'Verified' : 'Not verified' }}<span v-if="Number.isInteger(evidence.uid) && Number.isInteger(evidence.gid)"> · User {{ evidence.uid }}, group {{ evidence.gid }}</span></p>
    <ul v-if="evidence.paths?.length" class="space-y-2">
      <li v-for="(path, index) in evidence.paths" :key="index" class="rounded border border-gray-600 p-2">
        <p class="break-all">{{ path.path }} · {{ path.accessible === true ? 'Accessible' : path.accessible === false ? 'Not accessible' : 'Not verified' }}</p>
        <p>Content read: {{ path.content_checked === true ? 'Checked' : 'Not checked' }}<span v-if="Number.isFinite(path.read_bytes)"> · {{ path.read_bytes }} bytes</span><span v-if="path.content_checked === true"> · {{ path.sample_complete === true ? 'Complete sample' : 'Bounded sample' }}</span></p>
        <p v-if="path.reason">{{ path.reason }}</p>
      </li>
    </ul>
    <ul v-if="evidence.checks?.length" class="space-y-1">
      <li v-for="(check, index) in evidence.checks" :key="index">{{ check.label || check.name || 'Check' }} · {{ setupCheckLabel(check) }}<span v-if="check.reason || check.detail"> · {{ check.reason || check.detail }}</span></li>
    </ul>
    <p v-if="evidence.summary">{{ setupChangeValue({ field: 'summary' }, evidence.summary) }}</p>
  </section>
</template>
