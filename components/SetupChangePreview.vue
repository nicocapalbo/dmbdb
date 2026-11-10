<script setup>
import { setupChangeValue } from '~/helper/setupArrangements.js'
defineProps({ action: { type: Object, required: true } })
</script>

<template>
  <section v-if="action.evidence?.changes?.length || action.evidence?.side_effects?.length" class="space-y-2" aria-label="Proposed configuration changes">
    <h4 class="font-semibold">Review proposed changes</h4>
    <p class="text-sm text-gray-300">Review each field before authorizing changes to an existing configuration. Credentials are hidden.</p>
    <ul v-if="action.evidence?.side_effects?.length" class="list-disc pl-5 text-sm"><li v-for="(effect, index) in action.evidence.side_effects" :key="index">{{ setupChangeValue({ field: 'side_effect' }, effect) }}</li></ul>
    <div v-if="action.evidence?.changes?.length" class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <caption class="sr-only">Current and proposed values for this setup action</caption>
        <thead><tr><th class="p-2">Setting</th><th class="p-2">Current</th><th class="p-2">Proposed</th><th class="p-2">Ownership and approval</th></tr></thead>
        <tbody>
          <tr v-for="(change, index) in action.evidence.changes" :key="index" class="border-t border-gray-600">
            <th scope="row" class="p-2 break-all">{{ change.label || change.field }}</th>
            <td class="p-2 break-all">{{ setupChangeValue(change, change.before) }}</td>
            <td class="p-2 break-all">{{ setupChangeValue(change, change.after) }}</td>
            <td class="p-2">{{ change.managed === true ? 'Managed by DUMB' : change.managed === false ? 'Existing configuration' : 'Ownership not established' }}{{ change.requires_consent ? ' · Your approval required' : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
