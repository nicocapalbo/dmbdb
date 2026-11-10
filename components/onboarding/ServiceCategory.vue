<script setup>
defineProps({
  category: { type: Object, required: true },
  modelValue: { type: Boolean, default: false },
  selectedCount: { type: Number, default: 0 },
  enabledCount: { type: Number, default: 0 },
  invalidCount: { type: Number, default: 0 }
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <details
    :data-service-category="category.key"
    :open="modelValue"
    class="rounded-lg border border-gray-600 bg-gray-900"
    @toggle="emit('update:modelValue', $event.target.open)"
  >
    <summary class="cursor-pointer rounded-lg p-4 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400">
      <span class="inline-flex flex-wrap items-center gap-2 align-middle">
        <span class="font-semibold">{{ category.title }}</span>
        <span class="text-xs text-gray-400">
          {{ category.services.length }} service{{ category.services.length === 1 ? '' : 's' }}
        </span>
        <span class="rounded bg-indigo-900/60 px-2 py-0.5 text-xs text-indigo-200">
          {{ selectedCount }} selected
        </span>
        <span v-if="enabledCount" class="rounded bg-green-900/60 px-2 py-0.5 text-xs text-green-200">
          {{ enabledCount }} already enabled
        </span>
        <span v-if="invalidCount" class="rounded bg-amber-900/60 px-2 py-0.5 text-xs text-amber-200">
          {{ invalidCount }} needs attention
        </span>
      </span>
      <span class="mt-1 block text-sm text-gray-400">{{ category.description }}</span>
    </summary>
    <div class="grid grid-cols-1 gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
      <slot />
    </div>
  </details>
</template>
