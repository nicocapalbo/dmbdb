<script setup lang="ts">
import {SERVICES} from "~/constants/constants";
</script>

<template>
<div id="" class="h-full max-h-full antialiased relative">
  <div class="flex justify-between w-full h-full max-h-full overflow-hidden">
    <div class="w-full max-w-[300px] border-r border-slate-200 shadow">
      <div class="h-full p-4 flex flex-col gap-8">
        <NuxtLink :to="{name: 'index'}" class="px-4 py-2 hover:bg-stone-700 rounded-lg text-3xl text-white">
          DMB
        </NuxtLink>
        <div class="flex flex-col gap-4">
          <NuxtLink
            :to="{name: 'services-serviceId', params: {serviceId: value.id}}"
            v-for="(value, key, index) in SERVICES"
            :key="index"
            class="px-4 py-2 hover:bg-stone-700 rounded-lg text-white"
          >
            {{value.name}}
          </NuxtLink>
        </div>
      </div>
    </div>
    <slot/>
  </div>
</div>
</template>

<style scoped>

</style>
