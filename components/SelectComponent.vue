<script setup>
const props = defineProps({
  items: { type: Array, required: true}
})

const itemsList = computed(() => props.items);

const selectedFilter = defineModel()
</script>

<template>
  <select id="logLevel" v-model="selectedFilter" class="h-[30px] text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 rounded px-2 py-1 border border-slate-600 focus:border-blue-500 outline-none">
    <option v-for="item in itemsList" :key="item.value" :value="item.value" class="bg-transparent">
      {{item.label}}
    </option>
  </select>
</template>

