<script setup>

const props = defineProps({
  placeholder: { type: String, required: true }
})

const model = defineModel()

</script>

<template>
  <input
    :id="model"
    type="text"
    v-model="model"
    :placeholder="placeholder"
    class="text-sm bg-transparent text-slate-200 rounded px-2 py-1 border border-slate-600 focus:border-blue-500 outline-none"
  />
</template>

<style scoped>

</style>
