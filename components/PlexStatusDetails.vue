<script setup>
import {
  plexComponentCount,
  plexStatusLabel,
  plexStatusToneClass,
} from '~/helper/plexStatus.js'

const props = defineProps({
  status: { type: Object, default: null },
})

const componentCount = computed(() => plexComponentCount(props.status || {}))
const fetchedLabel = computed(() => {
  const timestamp = Number(props.status?.fetched_at)
  if (!Number.isFinite(timestamp)) return 'Not collected yet'
  return new Date(timestamp * 1000).toLocaleString()
})
const formatStatus = (value = '') => String(value || 'unknown').replaceAll('_', ' ')
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="rounded-full border px-2 py-0.5 text-[10px] uppercase"
        :class="plexStatusToneClass(status || {})"
      >
        {{ plexStatusLabel(status || {}) }}
      </span>
      <span v-if="status?.enabled" class="text-[11px] text-slate-400">
        {{ componentCount }} components · checked {{ fetchedLabel }}
      </span>
      <span v-if="status?.response_ms != null" class="text-[11px] text-slate-500">
        {{ status.response_ms }} ms
      </span>
    </div>

    <p class="text-sm text-slate-200">{{ status?.description || 'Plex status is unavailable.' }}</p>
    <p v-if="status?.error" class="rounded border border-amber-700/40 bg-amber-900/20 p-2 text-xs text-amber-200">
      {{ status.error }}
    </p>

    <div v-if="status?.affected_components?.length" class="space-y-1">
      <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Affected components</p>
      <div
        v-for="component in status.affected_components"
        :key="component.id || component.name"
        class="flex items-center justify-between gap-3 rounded border border-slate-700/60 bg-slate-950/20 px-3 py-2 text-xs"
      >
        <span>{{ component.name }}</span>
        <span class="uppercase text-orange-300">{{ formatStatus(component.status) }}</span>
      </div>
    </div>

    <div v-if="status?.active_incidents?.length" class="space-y-1">
      <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Active incidents</p>
      <div
        v-for="incident in status.active_incidents"
        :key="incident.id || incident.name"
        class="rounded border border-orange-700/40 bg-orange-900/15 px-3 py-2 text-xs"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <a
            v-if="incident.shortlink"
            :href="incident.shortlink"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-orange-200 hover:text-orange-100"
          >{{ incident.name }} ↗</a>
          <span v-else class="font-medium text-orange-200">{{ incident.name }}</span>
          <span class="uppercase text-slate-400">{{ formatStatus(incident.status) }} · {{ incident.impact }}</span>
        </div>
      </div>
    </div>

    <div v-if="status?.scheduled_maintenances?.length" class="space-y-1">
      <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Scheduled maintenance</p>
      <div
        v-for="maintenance in status.scheduled_maintenances"
        :key="maintenance.id || maintenance.name"
        class="rounded border border-sky-700/40 bg-sky-900/15 px-3 py-2 text-xs"
      >
        <a
          v-if="maintenance.shortlink"
          :href="maintenance.shortlink"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-sky-200 hover:text-sky-100"
        >{{ maintenance.name }} ↗</a>
        <span v-else class="font-medium text-sky-200">{{ maintenance.name }}</span>
      </div>
    </div>

    <p
      v-if="status?.enabled && status?.available && !status?.affected_components?.length && !status?.active_incidents?.length"
      class="text-xs text-emerald-300"
    >
      No affected Plex components or active incidents were reported in the latest sample.
    </p>
  </div>
</template>
