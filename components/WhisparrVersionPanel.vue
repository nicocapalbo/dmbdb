<script setup>
import { computed } from 'vue'
import { savedWhisparrProfile, whisparrProfilesSupported, whisparrVersionChoice } from '~/helper/whisparrProfiles.js'

const props = defineProps({
  config: { type: Object, default: null },
  savedConfig: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['select-version'])

const supported = computed(() => whisparrProfilesSupported(props.savedConfig))
const selectedVersion = computed(() => whisparrVersionChoice(props.config))
const pending = computed(() => !!props.config && selectedVersion.value !== whisparrVersionChoice(props.savedConfig))
const postgresEnabled = computed(() => props.savedConfig?.postgres_enabled === true || props.config?.postgres_enabled === true)
const savedProfile = computed(() => savedWhisparrProfile(props.savedConfig, selectedVersion.value))
const selectDisabled = computed(() => props.disabled || !props.config || postgresEnabled.value)

function selectVersion(event) {
  if (selectDisabled.value) return
  emit('select-version', event.target.value)
}
</script>

<template>
  <section v-if="supported" class="rounded-lg border border-sky-500/35 bg-sky-950/20 p-4 text-sm text-slate-200" aria-label="Whisparr saved libraries">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <label class="font-semibold text-slate-100" for="whisparr-library-version">Whisparr version</label>
      <select
        id="whisparr-library-version"
        :value="selectedVersion"
        :disabled="selectDisabled"
        aria-describedby="whisparr-library-help"
        class="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
        @change="selectVersion"
      >
        <option value="">Detect existing version</option>
        <option value="v2">Whisparr v2</option>
        <option value="v3">Whisparr v3 (Eros)</option>
      </select>
    </div>
    <p id="whisparr-library-help" class="mt-3 text-xs leading-5 text-slate-300">
      DUMB keeps a separate saved library for each version and selects its data directory automatically.
      Switching back reuses that version's saved library. Libraries are not converted between v2 and Eros.
      Detect existing version preserves an identified version and uses v2 for a fresh installation.
    </p>
    <p v-if="!config" class="mt-2 text-xs text-amber-200">
      Fix the configuration JSON before choosing a version.
    </p>
    <p v-else-if="postgresEnabled" class="mt-2 text-xs text-amber-200">
      PostgreSQL libraries require a separate Whisparr instance and database for each version.
    </p>
    <template v-else>
      <p v-if="savedProfile" class="mt-2 break-all text-xs text-slate-400">
        Saved library directory: <code class="text-slate-200">{{ savedProfile.config_dir }}</code>
      </p>
      <p v-else-if="selectedVersion" class="mt-2 text-xs text-slate-400">
        DUMB will prepare a separate library for this version when it is configured.
      </p>
      <p class="mt-2 text-xs" :class="pending ? 'text-amber-200' : 'text-slate-400'">
        {{ pending
          ? 'Version change pending. Review the config diff and save, then Start or Restart to switch the running service.'
          : 'Choose a version, review and save the configuration, then Start or Restart to switch.' }}
      </p>
    </template>
  </section>
</template>
