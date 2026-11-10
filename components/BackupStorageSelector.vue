<script setup>
import { computed, ref, watch } from 'vue'
import { backupDestinationProfile, backupStorageCatalog, backupStorageError, backupStoragePermissionFields, backupStorageSupported, backupStorageText as text } from '~/helper/backupStorage.js'
import { backupStorageRepository } from '~/services/backupStorage.js'

const props = defineProps({ modelValue: { type: String, default: '' }, capabilities: { type: Object, default: null }, kind: { type: String, default: 'symlink_manifest' }, disabled: Boolean, legacyLabel: { type: String, default: 'Keep configured backup path (default)' }, label: { type: String, default: 'Backup destination' } })
const emit = defineEmits(['update:modelValue', 'catalog-changed'])
const repository = backupStorageRepository()
const supported = computed(() => backupStorageSupported(props.capabilities, props.kind))
const catalog = ref(null), busy = ref(false), error = ref(''), catalogError = ref(''), saved = ref('')
const defaultDraft = ref(''), id = ref(''), name = ref(''), path = ref(''), profilePreview = ref(null)
const allowSharedPermissions = ref(false)
const sharedPermissionsSupported = computed(() => props.capabilities?.backup_storage_shared_permissions === true)
const selected = computed(() => backupDestinationProfile(catalog.value, props.modelValue))
const currentDefault = computed(() => backupDestinationProfile(catalog.value, '@default'))
const proposedDefault = computed(() => backupDestinationProfile(catalog.value, defaultDraft.value))
const currentDefaultLabel = computed(() => currentDefault.value?.name && currentDefault.value.name !== catalog.value?.default_destination_id
  ? `${currentDefault.value.name} (${catalog.value.default_destination_id})` : catalog.value?.default_destination_id || '')
const checkedAt = computed(() => {
  const value = selected.value?.last_checked_at
  const date = Number.isSafeInteger(value) && value > 0 ? new Date(value * 1000) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'not recorded'
})
const registered = item => item?.enabled === true && item?.registered === true && item?.ready === true
const payload = computed(() => ({ id: id.value.trim(), name: name.value.trim() || id.value.trim(), path: path.value.trim(), enabled: true, ...backupStoragePermissionFields(props.capabilities, allowSharedPermissions.value) }))
const validInput = computed(() => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.value.id) && payload.value.path.startsWith('/') && !payload.value.path.startsWith('//'))
const previewMatches = computed(() => profilePreview.value?.protocol === 1 && profilePreview.value?.ready === true
  && profilePreview.value.input === JSON.stringify(payload.value))
watch(payload, () => { profilePreview.value = null; saved.value = '' })
watch(sharedPermissionsSupported, value => { if (!value) allowSharedPermissions.value = false })
const load = async () => {
  if (!supported.value || busy.value) return
  const preserveDefaultDraft = catalog.value && defaultDraft.value !== catalog.value.default_destination_id
  busy.value = true; catalogError.value = ''
  try {
    const result = backupStorageCatalog(await repository.catalog())
    if (!result) throw new Error('Unsupported storage protocol')
    const changed = catalog.value !== null && JSON.stringify(catalog.value) !== JSON.stringify(result)
    catalog.value = result
    if (!preserveDefaultDraft) defaultDraft.value = result.default_destination_id
    if (changed) emit('catalog-changed')
  } catch (value) { catalogError.value = backupStorageError(value) }
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
  let confirmed = false
  try {
    const result = await repository.save(payload.value)
    if (result?.protocol !== 1 || !result.profile) throw new Error('Unconfirmed profile')
    saved.value = 'Destination registered. Existing service paths and defaults were preserved.'
    profilePreview.value = null
    confirmed = true
  } catch (value) { error.value = backupStorageError(value) }
  finally { busy.value = false }
  if (confirmed) await load()
}
const saveDefault = async destination => {
  if (busy.value || props.disabled || !catalog.value) return
  if (destination && !registered(backupDestinationProfile(catalog.value, destination))) return
  busy.value = true; error.value = ''; saved.value = ''
  let confirmed = false
  try {
    const result = await repository.setDefault(destination)
    if (result?.protocol !== 1 || result.default_destination_id !== destination) throw new Error('Unconfirmed default')
    catalog.value = { ...catalog.value, default_destination_id: destination }
    defaultDraft.value = destination
    emit('catalog-changed')
    saved.value = destination ? 'Global default saved. Only selections using the global default adopt it.' : 'Global default cleared. Existing backup selections and paths were preserved.'
    confirmed = true
  } catch (value) { error.value = backupStorageError(value) }
  finally { busy.value = false }
  if (confirmed) await load()
}
</script>

<template>
  <section v-if="supported" class="storage-card" data-testid="backup-storage">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <label class="storage-label flex-1 min-w-0">{{ label }}
        <select :value="modelValue" :disabled="disabled || busy || !catalog" class="storage-input mt-2" data-testid="backup-storage-selection" @change="emit('update:modelValue', $event.target.value)">
          <option value="">{{ legacyLabel }}</option>
          <option value="@default" :disabled="!registered(backupDestinationProfile(catalog, '@default'))">Use global default{{ catalog?.default_destination_id ? ` (${text(catalog.default_destination_id)})` : ' (not configured)' }}</option>
          <option v-for="item in catalog?.destinations || []" :key="item.id" :value="item.id" :disabled="!registered(item)">{{ text(item.name || item.id) }} · {{ item.storage_type === 'network' ? 'network archive' : 'local storage' }}{{ registered(item) ? '' : ' · unavailable' }}</option>
          <option v-if="modelValue && modelValue !== '@default' && !selected" :value="modelValue" disabled>Saved destination unavailable</option>
        </select>
      </label>
      <button type="button" class="storage-button self-start sm:self-auto" :disabled="busy || disabled" @click="load"><span class="material-symbols-rounded !text-base" aria-hidden="true">refresh</span>Refresh destinations</button>
    </div>
    <div v-if="selected" class="storage-muted space-y-1 text-xs">
      <p class="break-all">{{ text(selected.path) }} <span v-if="selected.filesystem_type">· {{ text(selected.filesystem_type) }}</span></p>
      <p>Last registration check: {{ checkedAt }}. Availability is rechecked at preview and use.</p>
      <p v-if="selected.allow_shared_permissions === true">Shared archive permissions were explicitly accepted for this destination. Access is controlled by the mount and its ACLs; DUMB does not secure the share.</p>
      <p v-for="(warning, index) in selected.warnings || []" :key="`selected-warning-${index}`">{{ text(warning) }}</p>
    </div>
    <p v-if="catalogError" role="alert" class="storage-feedback storage-error" data-testid="backup-storage-catalog-error">Could not refresh destinations: {{ catalogError }} Previously loaded choices may be out of date.</p>

    <section class="storage-default" aria-label="Global backup default" data-testid="backup-storage-default-management">
      <div class="min-w-0">
        <h4 class="font-semibold">Global default</h4>
        <p v-if="!catalog" class="storage-muted mt-1 text-xs">The current global default has not been confirmed. Refresh destinations before changing it.</p>
        <p v-else-if="catalog.default_destination_id" class="storage-muted mt-1 text-xs" data-testid="backup-storage-current-default">Current global default: {{ text(currentDefaultLabel) }}{{ registered(currentDefault) ? '' : ' · unavailable' }}</p>
        <p v-else class="storage-muted mt-1 text-xs" data-testid="backup-storage-current-default">No global default configured.</p>
      </div>
      <fieldset :disabled="busy || disabled || !catalog" class="grid min-w-0 grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-end">
        <label class="col-span-2 min-w-0 flex-1 text-xs lg:min-w-[12rem]">Choose a registered destination
          <select v-model="defaultDraft" class="storage-input mt-1" data-testid="backup-storage-default"><option value="">Choose a destination</option><option v-for="item in catalog?.destinations || []" :key="item.id" :value="item.id" :disabled="!registered(item)">{{ item.name && item.name !== item.id ? text(item.name) + ' (' + text(item.id) + ')' : text(item.id) }}</option></select>
        </label>
        <button type="button" class="storage-button" :disabled="!registered(proposedDefault) || defaultDraft === catalog?.default_destination_id" data-testid="backup-storage-save-default" @click="saveDefault(defaultDraft)">Set global default</button>
        <button type="button" class="storage-button storage-quiet" :disabled="!catalog?.default_destination_id" data-testid="backup-storage-clear-default" @click="saveDefault('')">Clear global default</button>
      </fieldset>
      <p class="storage-muted text-xs sm:col-span-2">Only jobs or services explicitly using the global default adopt changes. Existing paths and backups stay in place.</p>
    </section>

    <details class="storage-registration">
      <summary class="cursor-pointer font-medium">Register a backup destination</summary>
      <fieldset :disabled="busy || disabled" class="mt-4 space-y-4">
        <p class="storage-muted text-xs">Use an existing directory mounted inside DUMB, such as <code>/mnt/backups</code>. DUMB does not mount network shares or need their credentials here.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="storage-label">Destination ID<input v-model="id" class="storage-input mt-1" maxlength="64" pattern="[a-z0-9][a-z0-9_-]{0,63}" placeholder="backup_archive" autocomplete="off" data-testid="backup-storage-id"><span class="storage-muted mt-1 block text-xs font-normal">Lowercase letters, digits, underscores or hyphens.</span></label>
          <label class="storage-label">Display name (optional)<input v-model="name" class="storage-input mt-1" placeholder="Uses the destination ID if blank" data-testid="backup-storage-name"></label>
          <label class="storage-label sm:col-span-2">Existing container path<input v-model="path" class="storage-input mt-1" placeholder="/mnt/backups" autocomplete="off" data-testid="backup-storage-path"></label>
        </div>
        <label v-if="sharedPermissionsSupported" class="storage-consent">
          <input v-model="allowSharedPermissions" type="checkbox" class="mt-1 shrink-0" data-testid="backup-storage-shared-permissions">
          <span><strong class="block font-medium">Allow shared archive permissions</strong><span class="storage-muted mt-1 block text-xs leading-relaxed">I trust this storage’s access controls and everyone with access to backups containing credentials and private keys. DUMB does not make this storage private.</span></span>
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="storage-button" :disabled="!validInput" data-testid="backup-storage-preview" @click="preview">Preview destination</button>
          <button type="button" class="storage-button storage-primary" :disabled="!previewMatches" data-testid="backup-storage-register" @click="save">Register destination</button>
        </div>
        <div v-if="profilePreview" class="space-y-2 text-xs">
          <p v-for="(blocker, index) in profilePreview.blockers || []" :key="index" role="alert" class="storage-feedback storage-error">{{ text(typeof blocker === 'string' ? blocker : blocker.message) }}</p>
          <p v-for="(warning, index) in profilePreview.warnings || []" :key="`preview-warning-${index}`" class="storage-feedback">{{ text(warning) }}</p>
          <details v-if="profilePreview.observed_permissions" class="storage-muted"><summary class="cursor-pointer">Permission details</summary><p class="mt-2">Observed directory mode: {{ text(profilePreview.observed_permissions.directory_mode) || 'Not recorded' }}; marker file mode: {{ text(profilePreview.observed_permissions.file_mode) || 'Not recorded' }}. Mode bits do not prove ACL privacy or confidentiality.</p></details>
          <p v-if="profilePreview.ready === true" class="storage-muted">Metadata checks passed. Registration rechecks the destination and writes a small owned marker.</p>
        </div>
      </fieldset>
    </details>
    <p v-if="error" role="alert" class="storage-feedback storage-error" data-testid="backup-storage-error">{{ error }}</p>
    <p v-if="saved" role="status" class="storage-feedback">{{ saved }}</p>
    <p v-if="kind === 'infinidysk_v2_archive'" class="storage-muted text-xs">Cold archives may use network storage. Control state, verification files, the working candidate and active SQLite database stay local.</p>
  </section>
</template>

<style scoped>
.storage-card { @apply min-w-0 space-y-4 rounded-xl border p-4 text-sm; background: var(--app-surface); border-color: var(--app-border-soft); }
.storage-label { @apply block text-sm font-medium; }
.storage-input { @apply block w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50; background: var(--app-panel-deep); border-color: var(--app-border); color: var(--app-text); }
.storage-muted { color: var(--app-text-muted); }
.storage-button { @apply inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40; border-color: var(--app-border); }
.storage-button:not(:disabled):hover { background: var(--app-bg-soft); }
.storage-primary { background: var(--app-accent); border-color: transparent; color: var(--app-accent-contrast); }
.storage-primary:not(:disabled):hover { background: var(--app-accent-hover); }
.storage-quiet { border-color: transparent; color: var(--app-text-muted); }
.storage-default { @apply grid gap-3 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]; border-color: var(--app-border-soft); }
.storage-registration { @apply border-t pt-4; border-color: var(--app-border-soft); }
.storage-consent { @apply flex items-start gap-3 rounded-lg border p-3; border-color: var(--app-warning); }
.storage-feedback { @apply rounded-lg border px-3 py-2 text-xs leading-relaxed; border-color: var(--app-border); }
.storage-error { border-color: var(--app-danger); color: var(--app-text); }
</style>
