<script setup lang="ts">
import ServiceCard from "~/components/ServiceCard.vue";
import {SERVICES} from "~/constants/constants.js";
import dmbImage from '~/public/images/DMB.png'
import ServicePoller from "~/components/ServicePoller.vue";
</script>

<template>
  <div class="relative p-4 w-full bg-opacity-10 bg-cover bg-center">
    <img :src="dmbImage" class="-z-10 w-full h-full absolute top-0 right-0 left-0 bottom-0 object-cover opacity-50" alt="">
    <ServicePoller />
    <div class="flex flex-col gap-8 w-max mx-auto">
      <ServiceCard
          v-for="(service, index) in SERVICES"
          :service="service"
          :key="index"
      />
    </div>
  </div>
</template>

<style scoped>

</style>
