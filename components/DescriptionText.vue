<script setup>
import { computed } from 'vue'
import { descriptionParts } from '~/helper/descriptionText.js'

const props = defineProps({
  text: { type: [String, Number], default: '' },
  lineBreaks: {
    type: String,
    default: 'none',
    validator: (value) => ['none', 'all', 'paragraphs'].includes(value),
  },
  linkClass: {
    type: String,
    default: 'text-blue-400 underline break-words',
  },
})

const parts = computed(() => descriptionParts(props.text, { lineBreaks: props.lineBreaks }))
</script>

<template>
  <template v-for="(part, index) in parts" :key="`${index}-${part.type}`">
    <a
      v-if="part.type === 'link'"
      :href="part.href"
      target="_blank"
      rel="noopener noreferrer"
      :class="linkClass"
    >{{ part.text }}</a>
    <template v-else-if="part.type === 'break'">
      <br v-for="count in part.count" :key="`${index}-${count}`" />
    </template>
    <span v-else>{{ part.text }}</span>
  </template>
</template>
