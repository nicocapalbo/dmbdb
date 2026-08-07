<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  attention: { type: Boolean, default: false },
  defaultTabOptions: { type: Array, default: () => [] },
  currentTab: { type: Number, default: 0 },
})

const defaultTab = defineModel('defaultTab', { type: Number, default: 0 })

const menuOpen = ref(false)
const root = ref(null)

const visibleGroups = computed(() => props.groups
  .map((group) => ({
    ...group,
    items: (group.items || []).filter((item) => item?.visible !== false),
  }))
  .filter((group) => group.items.length))

const defaultTabValue = computed({
  get: () => defaultTab.value,
  set: (value) => { defaultTab.value = Number(value) },
})

const currentTabLabel = computed(() => (
  props.defaultTabOptions.find((item) => Number(item.value) === Number(props.currentTab))?.label || 'current tab'
))

const closeMenu = () => { menuOpen.value = false }

const handlePointerDown = (event) => {
  if (!root.value?.contains(event.target)) closeMenu()
}

const handleKeyDown = (event) => {
  if (event.key === 'Escape') closeMenu()
}

const selectAction = (item) => {
  if (item.disabled) return
  closeMenu()
  item.onSelect?.()
}

const useCurrentTabAsDefault = () => {
  defaultTab.value = Number(props.currentTab)
  closeMenu()
}

const itemClasses = (item) => {
  if (item.disabled) return 'cursor-not-allowed text-slate-500'
  if (item.tone === 'danger') return 'text-rose-200 hover:bg-rose-950/50'
  if (item.tone === 'support') return 'text-pink-200 hover:bg-pink-950/40'
  return 'text-slate-100 hover:bg-slate-800'
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
  <div ref="root" class="relative">
    <button
      type="button"
      class="button-small relative flex items-center border border-slate-50/20 !px-3 !py-2 !gap-1 hover:apply"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      aria-label="Service tools"
      title="Service tools"
      @click.stop="menuOpen = !menuOpen"
    >
      <span class="material-symbols-rounded !text-[18px]">handyman</span>
      <span class="hidden min-[360px]:inline">Tools</span>
      <span class="material-symbols-rounded !text-[18px]">arrow_drop_down</span>
      <span
        v-if="attention"
        class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-sky-400"
        aria-label="A tool has an active operation"
      />
    </button>

    <div
      v-if="menuOpen"
      class="absolute right-0 top-full z-50 mt-1 max-h-[min(70vh,34rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-600 bg-slate-900 py-1 shadow-2xl shadow-black/50"
      role="menu"
    >
      <section
        v-for="(group, groupIndex) in visibleGroups"
        :key="group.id || group.label"
        :class="groupIndex ? 'border-t border-slate-700/80' : ''"
        class="py-1"
      >
        <p class="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {{ group.label }}
        </p>
        <template v-for="item in group.items" :key="item.id">
          <a
            v-if="item.href"
            :href="item.href"
            target="_blank"
            rel="noopener noreferrer"
            class="flex w-full items-start gap-3 px-3 py-2 text-left"
            :class="itemClasses(item)"
            role="menuitem"
            @click="closeMenu"
          >
            <span class="material-symbols-rounded mt-0.5 !text-[19px]" :class="item.iconClass">{{ item.icon }}</span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-3 text-sm font-medium">
                <span>{{ item.label }}</span>
                <span v-if="item.status" class="shrink-0 text-[10px] uppercase tracking-wide" :class="item.statusClass || 'text-sky-300'">{{ item.status }}</span>
              </span>
              <span v-if="item.description" class="mt-0.5 block text-xs leading-4 text-slate-400">{{ item.description }}</span>
            </span>
          </a>
          <button
            v-else
            type="button"
            class="flex w-full items-start gap-3 px-3 py-2 text-left"
            :class="itemClasses(item)"
            :disabled="item.disabled"
            role="menuitem"
            @click="selectAction(item)"
          >
            <span
              class="material-symbols-rounded mt-0.5 !text-[19px]"
              :class="[item.iconClass, item.spin ? 'animate-spin' : '']"
            >{{ item.icon }}</span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-3 text-sm font-medium">
                <span>{{ item.label }}</span>
                <span v-if="item.status" class="shrink-0 text-[10px] uppercase tracking-wide" :class="item.statusClass || 'text-sky-300'">{{ item.status }}</span>
              </span>
              <span v-if="item.description" class="mt-0.5 block text-xs leading-4 text-slate-400">{{ item.description }}</span>
            </span>
          </button>
        </template>
      </section>
      <section
        v-if="defaultTabOptions.length"
        class="border-t border-slate-700/80 px-3 py-2"
      >
        <p class="pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Preferences
        </p>
        <label class="block text-xs text-slate-400">
          Default tab
          <SelectComponent
            v-model="defaultTabValue"
            :items="defaultTabOptions"
            class="mt-1 w-full"
          />
        </label>
        <button
          type="button"
          class="mt-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
          @click="useCurrentTabAsDefault"
        >
          <span class="material-symbols-rounded !text-[17px] text-sky-300">check_circle</span>
          <span>Use {{ currentTabLabel }}</span>
        </button>
      </section>
    </div>
  </div>
</template>
