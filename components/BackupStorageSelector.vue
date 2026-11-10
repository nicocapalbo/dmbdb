<script setup>
import { computed, ref, watch } from 'vue'
import { backupDestinationProfile, backupStorageCatalog, backupStorageError, backupStorageSupported, backupStorageText as text } from '~/helper/backupStorage.js'
import { backupStorageRepository } from '~/services/backupStorage.js'

const props = defineProps({ modelValue: { type: String, default: '' }, capabilities: { type: Object, default: null }, kind: { type: String, default: 'symlink_manifest' }, disabled: Boolean, legacyLabel: { type: String, default: 'Keep configured backup path (default)' } })
const emit = defineEmits(['update:modelValue', 'catalog-changed'])
const repository = backupStorageRepository()
const supported = computed(() => backupStorageSupported(props.capabilities, props.kind))
const catalog = ref(null), busy = ref(false), error = ref(''), saved = ref('')
const defaultDraft = ref(''), id = ref(''), name = ref(''), path = ref(''), profilePreview = ref(null)
const selected = computed(() => backupDestinationProfile(catalog.value, props.modelValue))
const checkedAt = computed(() => {
  const value = selected.value?.last_checked_at
  const date = Number.isSafeInteger(value) && value > 0 ? new Date(value * 1000) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'not recorded'
})
const registered = item => item?.enabled === true && item?.registered === true && item?.ready === true
const payload = computed(() => ({ id: id.value.trim(), name: name.value.trim(), path: path.value.trim(), enabled: true }))
const validInput = computed(() => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.value.id) && payload.value.name && payload.value.path.startsWith('/') && !payload.value.path.startsWith('//'))
const previewMatches = computed(() => profilePreview.value?.protocol === 1 && profilePreview.value?.ready === true
  && profilePreview.value.input === JSON.stringify(payload.value))
watch(payload, () => { profilePreview.value = null; saved.value = '' })
const load = async () => {
  if (!supported.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const result = backupStorageCatalog(await repository.catalog())
    if (!result) throw new Error('Unsupported storage protocol')
    const changed = catalog.value !== null && JSON.stringify(catalog.value) !== JSON.stringify(result)
    catalog.value = result; defaultDraft.value = result.default_destination_id
    if (changed) emit('catalog-changed')
  } catch (value) { catalog.value = null; error.value = backupStorageError(value) }
  finally { busy.value = false }
}
watch(supported, value => { if (value) load(); else catalog.value = null }, { immediate: true })
const preview = async () => {
  if (busy.value || props.disabled || !validInput.value) return
  busy.value = true; error.value = ''; profilePreview.value = null; saved.value = ''
  const input = JSON.stringify(payload.value)
  try {
    const result = await repository.preview(payload.value)
    if (result?.protocol !== 1 || typeof result.ready !== 'boolean') throw new Error('Unconfirmed storage preview')
    profilePreview.value = { ...result, input }
  }
  catch (value) { error.value = backupStorageError(value) }
  finally { busy.value = false }
}
const save = async () => {
  if (busy.value || props.disabled || !previewMatches.value) return
  busy.value = true; error.value = ''; saved.value = ''
  try {
    const result = await repository.save(payload.value)
    if (result?.protocol !== 1 || !result.profile) throw new Error('Unconfirmed profile')
    saved.value = 'Destination registered. Existing service paths and defaults were preserved.'
    profilePreview.value = null
  } catch (value) { error.value = backupStorageError(value) }
  finally { busy.value = false }
  await load()
}
const saveDefault = async () => {
  if (busy.value || props.disabled || !catalog.value) return
  busy.value = true; error.value = ''; saved.value = ''
  try {
    const result = await repository.setDefault(defaultDraft.value)
    if (result?.protocol !== 1) throw new Error('Unconfirmed default')
    saved.value = 'Default saved. Only selections using the global default adopt it.'
  } catch (value) { error.value = backupStorageError(value) }
  finally { busy.value = false }
  await load()
}
</script>

<template>
  <section v-if="supported" class="space-y-2 rounded border border-slate-600 p-3 text-sm" data-testid="backup-storage">
    <label class="block">Backup destination
      <select :value="modelValue" :disabled="disabled || busy || !catalog" class="mt-1 block w-full rounded border border-slate-600 bg-slate-900 p-2" data-testid="backup-storage-selection" @change="emit('update:modelValue', $event.target.value)">
        <option value="">{{ legacyLabel }}</option>
        <option value="@default" :disabled="!registered(backupDestinationProfile(catalog, '@default'))">Use global default{{ catalog?.default_destination_id ? ` (${text(catalog.default_destination_id)})` : ' (not configured)' }}</option>
        <option v-for="item in catalog?.destinations || []" :key="item.id" :value="item.id" :disabled="!registered(item)">{{ text(item.name || item.id) }} · {{ item.storage_type === 'network' ? 'network archive' : 'local storage' }}{{ registered(item) ? '' : ' · unavailable' }}</option>
        <option v-if="modelValue && modelValue !== '@default' && !selected" :value="modelValue" disabled>Saved destination unavailable</option>
      </select>
    </label>
    <p v-if="selected" class="break-all">{{ text(selected.path) }} · {{ text(selected.filesystem_type) }}. Registration is cached; availability and identity are rechecked at preview and use.</p>
    <p v-if="selected">Last registration check: {{ checkedAt }}</p>
    <p>Only paths already mounted inside the DUMB container can be registered. DUMB does not mount network shares. Choosing a profile is explicit; existing backup paths remain unchanged.</p>
    <p v-if="kind === 'infinidysk_v2_archive'">Network storage holds verified cold archives only. Control state, verification files, the working candidate and active SQLite database stay on local storage; review their remaining space requirements.</p>
    <p v-if="error" role="alert" class="text-rose-200">{{ error }}</p>
    <p v-if="saved" role="status">{{ saved }}</p>
    <button class="button-small" :disabled="busy || disabled" @click="load">Refresh destinations</button>
    <details>
      <summary class="cursor-pointer">Register destinations and manage the global default</summary>
      <fieldset :disabled="busy || disabled" class="mt-2 space-y-2">
        <p>Use the container path of an existing mounted directory, such as <code>/mnt/backups</code>. No network address or credentials are needed here.</p>
        <label class="block">Destination ID<input v-model="id" class="block w-full rounded bg-slate-800 p-2" maxlength="64" pattern="[a-z0-9][a-z0-9_-]{0,63}" autocomplete="off" data-testid="backup-storage-id"></label>
        <p>Use a lowercase ID with letters, digits, underscores or hyphens, starting with a letter or digit.</p>
        <label class="block">Name<input v-model="name" class="block w-full rounded bg-slate-800 p-2" data-testid="backup-storage-name"></label>
        <label class="block">Existing container path<input v-model="path" class="block w-full rounded bg-slate-800 p-2" placeholder="/mnt/backups" autocomplete="off" data-testid="backup-storage-path"></label>
        <button class="button-small" :disabled="!validInput" data-testid="backup-storage-preview" @click="preview">Preview destination</button>
        <p v-for="(blocker, index) in profilePreview?.blockers || []" :key="index" class="text-rose-200">{{ text(typeof blocker === 'string' ? blocker : blocker.message) }}</p>
        <p v-if="profilePreview?.ready === true">Metadata checks passed. Registration rechecks the destination and writes a small owned marker.</p>
        <button class="button-small" :disabled="!previewMatches" data-testid="backup-storage-register" @click="save">Register destination</button>
        <label class="block">Global default
          <select v-model="defaultDraft" class="block w-full rounded bg-slate-900 p-2" data-testid="backup-storage-default"><option value="">No default</option><option v-for="item in catalog?.destinations || []" :key="item.id" :value="item.id" :disabled="!registered(item)">{{ text(item.name || item.id) }}</option></select>
        </label>
        <button class="button-small" :disabled="!catalog || defaultDraft === catalog.default_destination_id" data-testid="backup-storage-save-default" @click="saveDefault">Save global default</button>
        <p>A global default affects only jobs or services explicitly set to use it. It does not move existing backups.</p>
      </fieldset>
    </details>
  </section>
</template>

<style scoped>
[data-appearance-mode='light'] .text-rose-200 { @apply text-rose-800; }
</style>
