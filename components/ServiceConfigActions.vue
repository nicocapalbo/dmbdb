<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  processConfig: { type: Boolean, default: true },
})

const emit = defineEmits(['apply-memory', 'save-file'])

const menuOpen = ref(false)
const root = ref(null)

const primaryLabel = computed(() => {
  if (props.busy) return 'Saving…'
  return props.processConfig ? 'Save to File' : 'Save Service Config'
})

const closeMenu = () => { menuOpen.value = false }

const handlePointerDown = (event) => {
  if (!root.value?.contains(event.target)) closeMenu()
}

const handleKeyDown = (event) => {
  if (event.key === 'Escape') closeMenu()
}

const save = () => {
  closeMenu()
  emit('save-file')
}

const applyMemory = () => {
  closeMenu()
  emit('apply-memory')
}

onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown)
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handlePointerDown)
  document.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div ref="root" class="relative flex items-stretch">
    <button
      type="button"
      class="button-small apply flex items-center rounded-r-none border border-blue-400/40 !py-2 !pl-3 !pr-4 !gap-1.5 text-white"
      :disabled="disabled"
      :title="processConfig ? 'Persist this configuration and apply it.' : 'Save this service-owned configuration file.'"
      @click="save"
    >
      <span class="material-symbols-rounded !text-[18px]">save_as</span>
      <span>{{ primaryLabel }}</span>
    </button>
    <button
      v-if="processConfig"
      type="button"
      class="button-small apply rounded-l-none border border-l-0 border-blue-400/40 !px-2 !py-2 text-white"
      :disabled="disabled"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      aria-label="Show additional configuration actions"
      title="Show additional configuration actions"
      @click.stop="menuOpen = !menuOpen"
    >
      <span class="material-symbols-rounded !text-[18px]">arrow_drop_down</span>
    </button>

    <div
      v-if="menuOpen && processConfig"
      class="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-600 bg-slate-900 shadow-2xl shadow-black/50"
      role="menu"
    >
      <button
        type="button"
        class="flex w-full items-start gap-3 px-3 py-3 text-left text-slate-100 hover:bg-slate-800"
        role="menuitem"
        :disabled="disabled"
        @click="applyMemory"
      >
        <span class="material-symbols-rounded mt-0.5 !text-[19px] text-sky-300">memory</span>
        <span>
          <span class="block text-sm font-medium">Apply in Memory</span>
          <span class="mt-0.5 block text-xs leading-4 text-slate-400">
            Use these settings for the current session without persisting them to the config file.
          </span>
        </span>
      </button>
    </div>
  </div>
</template>
