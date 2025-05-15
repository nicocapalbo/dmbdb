<script setup lang="ts">

const props = defineProps({
  optionList: { type: Array, required: true },
  optionCount: { type: Array },
  selectedTab: { type: Number, required: true },
  blur: { type: Boolean, default: false },
  type: String
})

const emits = defineEmits(['selectedTab'])

const toggleTab = (tabId: number) => {
  emits('selectedTab', tabId)
}

</script>

<template>
  <div class="border-b border-gray-200 dark:border-gray-700">
    <div class="flex flex-wrap -mb-px text-sm font-medium text-center text-gray-500 dark:text-gray-400">
      <div
        v-for="(option,index) in optionList"
        :key="index"
        :class="{'!text-blue-400 !border-blue-400': (option?.value ?? index) === selectedTab, '!cursor-not-allowed !text-slate-600 hover:!text-slate-600 !border-slate-600hover:!border-slate-600': option.disabled }"
        class="flex items-center justify-center gap-2 px-4 py-2 border-b-2 border-transparent rounded-t-lg text-slate-300 hover:text-blue-400 hover:border-blue-400 dark:hover:text-blue-400 group cursor-pointer"
        @click="!option.disabled && toggleTab(option?.value ?? index)"
      >
        <span class="material-symbols-rounded !text-[18px]">{{option.icon}}</span>
        <span>{{option.text}}</span>
      </div>
    </div>
  </div>
</template>
