<script setup>
const appVersion = useRuntimeConfig().public.appVersion // Retrieve the app version

const goToRepo = () => {
  const url = `https://github.com/nicocapalbo/dmbdb`
  window.open(url, "_blank")
}
</script>

<template>
  <button class="button-small w-max bg-gray-800 hover:bg-gray-700 group transition-all ease-in-out duration-200 transition-discrete" @click="goToRepo()">
    <span class="text-xs font-semibold text-slate-100">v{{ appVersion }}</span>
  </button>
</template>
