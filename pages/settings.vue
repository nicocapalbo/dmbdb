<script setup>
import {useProcessesStore} from "~/stores/processes.js";

const processesStore = useProcessesStore()
import axios from "axios";
const appVersion = useRuntimeConfig().public.appVersion // Retrieve the app version

const contributorsList = ref(null)

const services = computed(() => {
  return processesStore.getProcessesList
})

const versionNumer = (process_name) => {
  return services.value.find((service) => service.process_name === process_name).version
}

const getContributors = async() => {
  try {

    const [repo1, repo2] = await Promise.all([
      axios.get('https://api.github.com/repos/I-am-PUID-0/DMB/contributors'),
      axios.get('https://api.github.com/repos/nicocapalbo/dmbdb/contributors')
    ]);
    // Merge both contributor lists
    const mergedContributors = [...repo1.data, ...repo2.data];

    // Remove duplicates using a Map (keyed by 'id')
    const uniqueContributors = Array.from(
        new Map(mergedContributors.map(contributor => [contributor.id, contributor])).values()
    );

    contributorsList.value = uniqueContributors.filter(c => c.id !== 41898282);
  } catch (e) {
    throw new Error(e)
  }
}

const goToContributor = (url) => {
  window.open(url, '_blank')
}

getContributors()

</script>

<template>
  <div class="relative h-full text-white overflow-auto bg-gray-900 flex flex-col gap-10 px-4 py-4 md:px-8 pb-16">
    <InfoBar />

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">About</p>
      </div>

      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-4">
            <p class="font-semibold min-w-48">DMB</p>
            <a href="https://github.com/I-am-PUID-0/DMB" target="_blank" class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
              <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
              <span>v{{versionNumer('DMB API')}}</span>
            </a>
          </div>

          <div class="flex items-center gap-4">
            <p class="font-semibold min-w-48">DMB Frontend</p>
            <a href="https://github.com/nicocapalbo/dmbdb" target="_blank" class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
              <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
              <span>v{{appVersion}}</span>
            </a>
          </div>
        </div>

        <div class="border-b border-slate-700"></div>

        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-4">
            <p class="font-semibold min-w-48">Riven Backend</p>
            <a href="https://github.com/rivenmedia/riven" target="_blank" class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
              <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
              <span>v{{versionNumer('Riven Backend')}}</span>
            </a>
          </div>

          <div class="flex items-center gap-4">
            <p class="font-semibold min-w-48">Riven Frontend</p>
            <a href="https://github.com/rivenmedia/riven-frontend" target="_blank" class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
              <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
              <span>{{versionNumer('Riven Frontend')}}</span>
            </a>
          </div>
        </div>

        <div class="border-b border-slate-700"></div>

        <div class="flex items-center gap-4">
          <p class="font-semibold min-w-48">Zilean</p>
          <a href="https://github.com/iPromKnight/zilean" target="_blank" class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
            <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
            <span>{{versionNumer('Zilean')}}</span>
          </a>
        </div>

        <div class="border-b border-slate-700"></div>

        <div class="flex items-center gap-4">
          <p class="font-semibold min-w-48">Zurg</p>
          <a href="https://github.com/debridmediamanager/zurg-testing" target="_blank" class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
            <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
            <span>{{versionNumer('Zurg w/ RealDebrid')}}</span>
          </a>
        </div>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Support</p>
      </div>
      <div class="flex flex-col gap-4 divide-y divide-slate-700">
        <div class="flex items-center gap-4">
          <p class="font-semibold min-w-48">Discord</p>
          <a href="https://discord.gg/8dqKUBtbp5" class="underline">https://discord.gg/8dqKUBtbp5</a>
        </div>

        <div class="flex items-center gap-4 pt-4">
          <p class="font-semibold min-w-48">Github</p>
          <a href="https://github.com/I-am-PUID-0/DMB" class="underline">https://github.com/I-am-PUID-0/DMB</a>
        </div>

        <div class="flex items-center gap-4 pt-4">
          <p class="font-semibold min-w-48">Wiki</p>
          <a href="https://i-am-puid-0.github.io/DMB/" class="underline">https://i-am-puid-0.github.io/DMB/</a>
        </div>

        <div class="flex items-center gap-4 pt-4">
          <p class="font-semibold min-w-48">DockerHub</p>
          <a href="https://hub.docker.com/r/iampuid0/dmb" class="underline">https://hub.docker.com/r/iampuid0/dmb</a>
        </div>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Contributors</p>
      </div>
      <div class="flex gap-2 items-center">
        <button v-for="contributor in contributorsList" :key="contributor.id" class="rounded-full h-16 w-16 bg-slate-800 border border-slate-500" @click="goToContributor(contributor.html_url)">
          <img :src="contributor.avatar_url" :alt="contributor.login" class="object-cover object-center rounded-full">
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>
