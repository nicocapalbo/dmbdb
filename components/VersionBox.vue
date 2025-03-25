<script setup>
const appVersion = useRuntimeConfig().public.appVersion // Retrieve the app version

const goToRepo = () => {
  const url = `https://github.com/nicocapalbo/dmbdb`
  window.open(url, "_blank")
}
</script>

<template>
  <button class="z-10 absolute bottom-4 right-4 w-max rounded-md p-1 bg-slate-900 hover:bg-slate-300 group transition-all ease-in-out duration-500 transition-discrete" @click="goToRepo()">
    <span class="text-xs font-semibold text-slate-100 group-hover:text-slate-900">v{{ appVersion }}</span>
  </button>
</template>
