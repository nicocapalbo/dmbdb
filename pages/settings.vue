<script setup>
import { useProcessesStore } from "~/stores/processes.js";
import useService from '~/services/useService.js'
import { useRouter } from 'vue-router'
const router = useRouter()
const processesStore = useProcessesStore()
import axios from "axios";
const goToOnboarding = async () => {
  try {
    const { configService } = useService()
    await configService.resetOnboarding()
    router.push('/onboarding')
  } catch (e) {
    console.error('Failed to reset onboarding:', e)
  }
}
const services = computed(() => processesStore.enabledProcesses)
const projectName = computed(() => processesStore.projectName)
const sponsorUrl = (svc) => {
  const v = (svc && svc.sponsorship_url ? svc.sponsorship_url : '').trim()
  return v.length ? v : null
}
const Discord = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://discord.gg/T6uZGy5XYb'
    : 'https://discord.gg/8dqKUBtbp5'
)

const githubRepo = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://github.com/I-am-PUID-0/DUMB'
    : 'https://github.com/I-am-PUID-0/DMB'
)

const DocsUrl = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://i-am-puid-0.github.io/DUMB'
    : 'https://i-am-puid-0.github.io/DMB'
)

const dockerHubUrl = computed(() =>
  projectName.value === 'DUMB'
    ? 'https://hub.docker.com/r/iampuid0/dumb'
    : 'https://hub.docker.com/r/iampuid0/dmb'
)

const contributorsList = ref(null)

const getContributors = async () => {
  try {
    const repoUrl = githubRepo.value.replace('https://github.com/', '')
    const [repo1, repo2] = await Promise.all([
      axios.get(`https://api.github.com/repos/${repoUrl}/contributors`),
      axios.get('https://api.github.com/repos/nicocapalbo/dmbdb/contributors'),
    ])
    const merged = [...repo1.data, ...repo2.data]
    contributorsList.value = Array.from(
      new Map(merged.map(c => [c.id, c])).values()
    ).filter(c => c.id !== 41898282)
  } catch (e) {
    throw new Error(e)
  }
}

const goToContributor = (url) => window.open(url, '_blank')

getContributors()
</script>

<template>
  <div class="relative min-h-full text-white overflow-x-hidden bg-gray-900 flex flex-col gap-10 px-4 py-4 md:px-8 pb-16">
    <InfoBar />

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">About</p>
      </div>

      <div class="px-2 flex flex-col gap-4">
        <div v-for="(service, index) in services" :key="index" class="flex items-center gap-4">
          <p class="font-semibold min-w-48">{{ service.process_name }}</p>
          <a :href="service?.repo_url" target="_blank"
            class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
            <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
            <span>v{{ service?.version?.trim().replace('v', '') }}</span>
          </a>
          <a
            v-if="sponsorUrl(service)"
            :href="sponsorUrl(service)"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-pink-500/10 text-xs font-medium px-2 py-1 text-pink-300 border border-pink-500/30 hover:bg-pink-500/20 hover:text-pink-200 transition"
            aria-label="Sponsor this project"
            title="Sponsor this project"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                class="h-3.5 w-3.5 fill-current" aria-hidden="true">
              <path d="M12 21s-6.716-4.324-9.193-7.04C1.02 11.972 1 9.558 2.64 7.918a5.01 5.01 0 0 1 7.09 0L12 10.187l2.27-2.27a5.01 5.01 0 0 1 7.09 0c1.64 1.64 1.62 4.054-.167 6.042C18.716 16.676 12 21 12 21z"/>
            </svg>
            <span>Sponsor</span>
          </a>
        </div>
      </div>
    </div>

    <div class="mt-10 px-2">
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-medium"
        @click="goToOnboarding"
      >
        Launch Onboarding
      </button>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Support</p>
      </div>
      <div class="px-2 flex flex-col gap-4 divide-y divide-slate-700">
        <div class="flex items-center gap-4">
          <p class="font-semibold min-w-48">Discord</p>
          <a :href="Discord" class="underline">{{ Discord }}</a>
        </div>

        <div class="flex items-center gap-4 pt-4">
          <p class="font-semibold min-w-48">Github</p>
          <a :href="githubRepo" class=" underline">{{ githubRepo }}</a>
        </div>

        <div class="flex items-center gap-4 pt-4">
          <p class="font-semibold min-w-48">Docs</p>
          <a :href="DocsUrl" class="underline">{{ DocsUrl }}</a>
        </div>

        <div class="flex items-center gap-4 pt-4">
          <p class="font-semibold min-w-48">DockerHub</p>
          <a :href="dockerHubUrl" class="underline">{{ dockerHubUrl }}</a>
        </div>
      </div>
    </div>

    <div>
      <div class="border-b border-slate-500 w-full pb-3 mb-6">
        <p class="text-4xl font-medium">Contributors</p>
      </div>
      <div class="px-2 flex gap-2 items-center">
        <button v-for="contributor in contributorsList" :key="contributor.id"
          class="rounded-full h-16 w-16 bg-slate-800 border border-slate-500"
          @click="goToContributor(contributor.html_url)">
          <img :src="contributor.avatar_url" :alt="contributor.login" class="object-cover object-center rounded-full">
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
