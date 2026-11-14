<script setup>
import { backupBytes } from '~/helper/installationBackups.js'
defineProps({ progress: { type: Object, required: true }, active: { type: Boolean, default: false } })
</script>

<template>
  <div class="space-y-2" data-testid="installation-phase-progress">
    <div v-if="active" class="space-y-1">
      <p class="text-sm font-medium" data-testid="installation-phase-percent">{{ progress.percent === null ? 'Working — total for this phase is not yet known' : `${progress.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% of this phase` }}</p>
      <progress class="h-2 w-full" max="100" :value="progress.percent === null ? undefined : progress.percent" aria-label="Current backup phase progress" />
      <p class="text-xs opacity-80">Progress applies to the current phase. Reaching 100% of one phase does not mean the complete operation has finished.</p>
    </div>
    <dl class="grid gap-3 text-sm sm:grid-cols-3">
      <div v-if="progress.entries !== null"><dt class="text-xs opacity-80">{{ progress.entries_label }}</dt><dd>{{ progress.entries.toLocaleString() }}<span v-if="progress.total_entries !== null"> / {{ progress.total_entries.toLocaleString() }}</span></dd></div>
      <div v-if="progress.logical_bytes !== null"><dt class="text-xs opacity-80">{{ progress.logical_label }}</dt><dd>{{ backupBytes(progress.logical_bytes) }}<span v-if="progress.total_logical_bytes !== null"> / {{ backupBytes(progress.total_logical_bytes) }}</span></dd></div>
      <div v-if="progress.bytes_processed !== null"><dt class="text-xs opacity-80">{{ progress.bytes_label }}</dt><dd>{{ backupBytes(progress.bytes_processed) }}<span v-if="progress.total_bytes !== null"> / {{ backupBytes(progress.total_bytes) }}</span></dd></div>
    </dl>
  </div>
</template>
