<script setup>
import { computed } from 'vue'
import { setupChoiceLines, setupFieldValue, setupFieldVisible } from '~/helper/setupArrangements.js'
const props = defineProps({ data: { type: Object, default: () => ({}) } })
const choices = computed(() => (props.data.arrangement_schema?.fields || []).filter(field => !field.internal && setupFieldVisible(field, props.data.values || {}, props.data.arrangement_schema?.fields || [])).map(field => ({
    key: field.key,
    label: field.label || 'Setup choice',
    service: (props.data.services || []).find(service => service.id === field.resource_id)?.name || '',
    lines: setupChoiceLines(field, setupFieldValue(field, props.data.values || {})),
  })).filter(choice => choice.lines.length))
</script>
<template>
  <section v-if="choices.length" class="rounded-lg border border-gray-600 p-4 space-y-3" data-setup-choices>
    <h3 class="text-lg font-semibold text-white">Your setup choices</h3>
    <dl class="space-y-3 text-sm">
      <div v-for="choice in choices" :key="choice.key">
        <dt class="font-semibold text-gray-100">{{ choice.service ? choice.service + ' · ' : '' }}{{ choice.label }}</dt>
        <dd v-for="(line, index) in choice.lines" :key="index" class="text-gray-300 break-words">{{ line }}</dd>
      </div>
    </dl>
  </section>
</template>
