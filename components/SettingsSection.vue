<script setup>
import { useLocalStorage } from '@vueuse/core'

const props = defineProps({
  sectionId: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
})

const isOpen = useLocalStorage(
  `dmbdb.settings.section.${props.sectionId}.open`,
  true,
)

const contentId = computed(() => `settings-section-${props.sectionId}`)
</script>

<template>
  <section>
    <div class="w-full border-b border-slate-500 pb-3" :class="isOpen ? 'mb-6' : ''">
      <button
        type="button"
        class="group flex w-full items-center justify-between gap-4 rounded-md px-1 py-1 text-left transition hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        :aria-expanded="isOpen"
        :aria-controls="contentId"
        @click="isOpen = !isOpen"
      >
        <span class="min-w-0">
          <span class="block text-4xl font-medium">{{ title }}</span>
          <span v-if="description" class="mt-1 block text-sm text-slate-400">{{ description }}</span>
        </span>
        <span
          class="material-symbols-rounded shrink-0 text-slate-400 transition-transform group-hover:text-white"
          :class="isOpen ? 'rotate-180' : ''"
          aria-hidden="true"
        >expand_more</span>
      </button>
    </div>

    <div v-show="isOpen" :id="contentId">
      <slot />
    </div>
  </section>
</template>
