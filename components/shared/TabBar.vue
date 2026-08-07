<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  optionList: { type: Array, required: true },
  optionCount: { type: Array },
  selectedTab: { type: Number, required: true },
  blur: { type: Boolean, default: false },
  type: String
})

const emits = defineEmits(['selectedTab'])

const scroller = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
let resizeObserver: ResizeObserver | null = null

const toggleTab = (tabId: number) => {
  emits('selectedTab', tabId)
}

const updateScrollState = () => {
  const element = scroller.value
  if (!element) return
  canScrollLeft.value = element.scrollLeft > 2
  canScrollRight.value = element.scrollLeft + element.clientWidth < element.scrollWidth - 2
}

const revealSelectedTab = async (behavior: ScrollBehavior = 'smooth') => {
  await nextTick()
  const element = scroller.value
  const selected = element?.querySelector<HTMLElement>('[data-selected="true"]')
  if (!element || !selected) return

  const selectedLeft = selected.offsetLeft
  const selectedRight = selectedLeft + selected.offsetWidth
  const visibleLeft = element.scrollLeft
  const visibleRight = visibleLeft + element.clientWidth

  if (selectedLeft < visibleLeft) {
    element.scrollTo({ left: selectedLeft, behavior })
  } else if (selectedRight > visibleRight) {
    element.scrollTo({ left: selectedRight - element.clientWidth, behavior })
  }
  window.requestAnimationFrame(updateScrollState)
}

watch(
  () => props.selectedTab,
  () => revealSelectedTab(),
)

watch(
  () => props.optionList,
  async () => {
    await nextTick()
    updateScrollState()
    revealSelectedTab('auto')
  },
  { deep: true },
)

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    updateScrollState()
    revealSelectedTab('auto')
  })
  if (scroller.value) resizeObserver.observe(scroller.value)
  updateScrollState()
  revealSelectedTab('auto')
})

onBeforeUnmount(() => resizeObserver?.disconnect())

</script>

<template>
  <div class="relative min-w-0 max-w-full overflow-hidden border-b border-gray-200 dark:border-gray-700">
    <div
      ref="scroller"
      class="no-scrollbar -mb-px flex max-w-full overflow-x-auto overscroll-x-contain scroll-smooth text-center text-sm font-medium text-gray-500 dark:text-gray-400"
      @scroll.passive="updateScrollState"
    >
      <button
        v-for="(option,index) in optionList"
        :key="index"
        type="button"
        :data-selected="(option?.value ?? index) === selectedTab"
        :class="{'!text-blue-400 !border-blue-400': (option?.value ?? index) === selectedTab, '!cursor-not-allowed !text-slate-600 hover:!text-slate-600 !border-slate-600hover:!border-slate-600': option.disabled }"
        class="flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-t-lg border-b-2 border-transparent px-2 py-2 text-slate-300 hover:border-blue-400 hover:text-blue-400 dark:hover:text-blue-400 md:gap-2 md:px-4"
        @click="!option.disabled && toggleTab(option?.value ?? index)"
      >
        <span class="material-symbols-rounded !text-[15px] md:!text-[18px]">{{option.icon}}</span>
        <span class="text-sm md:text-base">{{option.text}}</span>
      </button>
    </div>
    <div
      v-if="canScrollLeft"
      class="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-start bg-gradient-to-r from-slate-900 via-slate-900/85 to-transparent pl-0.5 text-slate-400"
      aria-hidden="true"
    >
      <span class="material-symbols-rounded !text-[17px]">chevron_left</span>
    </div>
    <div
      v-if="canScrollRight"
      class="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end bg-gradient-to-l from-slate-900 via-slate-900/85 to-transparent pr-0.5 text-slate-300"
      aria-hidden="true"
    >
      <span class="material-symbols-rounded !text-[17px]">chevron_right</span>
    </div>
  </div>
</template>
