<script setup>
const props = defineProps({
  items: { type: Array, required: true}
})
const itemsList = ref(props.items||[])

const selectedFilter = defineModel()
</script>

<template>
  <select id="logLevel" v-model="selectedFilter" class="h-[30px] text-sm bg-transparent text-slate-200 rounded px-2 py-1 border border-slate-600 focus:border-blue-500 outline-none">
    <option v-for="item in itemsList" :key="item.value" value="">
      {{item.label}}
    </option>
<!--    <option v-for="service in SERVICES" :key="service.process_name" :value="service.process_name">-->
<!--      {{ service.process_name }}-->
<!--    </option>-->
  </select>
</template>

