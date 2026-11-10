<script setup>
import { computed } from 'vue'
import { frontendBuildDisplay, frontendInstalledSource } from '~/helper/frontendSource.js'
import { isDevelopmentVersion, projectServiceKind } from '~/helper/updateNotices.js'

const props = defineProps({ service: { type: Object, required: true } })
const installedSource = computed(() => frontendInstalledSource(props.service.version, [props.service]))
const buildDisplay = computed(() => frontendBuildDisplay(props.service.version, [props.service]))
const isDevelopmentBuild = computed(() => Boolean(projectServiceKind(props.service)) && (
  isDevelopmentVersion(props.service.version)
  || ['branch', 'commit'].includes(installedSource.value?.source_kind)
))
</script>

<template>
  <a data-testid="about-service-version" :href="service.repo_url" :title="buildDisplay.title || undefined" target="_blank" rel="noopener noreferrer"
    class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium">
    <span class="material-symbols-rounded !text-[16px]">open_in_new</span>
    <span>{{ buildDisplay.label }}</span>
  </a>
  <span
    v-if="isDevelopmentBuild"
    data-testid="about-dev-build"
    class="rounded-md border border-violet-400/25 bg-violet-500/10 px-2 py-1 text-xs font-medium text-violet-200"
    title="This component is running a development build. Release-distance counts apply only to published release tags."
  >
    Dev build
  </span>
</template>
