<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { backupStorageAvailability, backupStorageError, backupStorageManagementSupported, backupStoragePermissionFields, backupStorageRevalidationReady, backupStorageRevalidationSupported, backupStorageText as text, backupStorageUsage } from '~/helper/backupStorage.js'
import { backupStorageRepository } from '~/services/backupStorage.js'

const props = defineProps({ catalog: { type: Object, default: null }, capabilities: { type: Object, default: null }, kind: { type: String, default: 'symlink_manifest' }, disabled: Boolean })
const emit = defineEmits(['changed', 'busy'])
const repository = backupStorageRepository()
const busy = ref(false), errors = ref({}), messages = ref({}), checks = ref({})
const editing = ref(''), removing = ref(''), review = ref(null), confirmed = ref(false)
const editName = ref(''), editEnabled = ref(true), editShared = ref(false)
const now = ref(Date.now())
const supported = computed(() => backupStorageManagementSupported(props.capabilities, props.kind))
const revalidationSupported = computed(() => backupStorageRevalidationSupported(props.capabilities, props.kind))
const sharedSupported = computed(() => props.capabilities?.backup_storage_shared_permissions === true)
const profiles = computed(() => props.catalog?.destinations || [])
const signature = profile => JSON.stringify([profile?.id, profile?.name, profile?.path, profile?.enabled, profile?.allow_shared_permissions])
const observed = profile => {
  const checked = checks.value[profile.id]
  if (checked?.input !== signature(profile)) return profile
  return profile.live_checked === true && Number.isSafeInteger(profile.checked_at) && profile.checked_at >= checked.profile.checked_at ? profile : checked.profile
}
const usage = profile => {
  const values = backupStorageUsage(Array.isArray(profile.usage) ? profile.usage : checks.value[profile.id]?.input === signature(profile) ? checks.value[profile.id].usage : [])
  return props.catalog?.default_destination_id === profile.id && !values.includes('Current global default') ? ['Current global default', ...values] : values
}
const editedProfile = computed(() => profiles.value.find(item => item.id === editing.value))
const editPayload = computed(() => editedProfile.value ? { id: editedProfile.value.id, path: editedProfile.value.path, name: editName.value.trim() || editedProfile.value.id, enabled: editEnabled.value === true, ...backupStoragePermissionFields(props.capabilities, editShared.value) } : null)
const reviewedProfile = computed(() => profiles.value.find(item => item.id === review.value?.destination_id))
const canConfirm = computed(() => !props.disabled && backupStorageRevalidationReady({ capabilities: props.capabilities, kind: props.kind, profile: reviewedProfile.value, review: review.value, confirmed: confirmed.value, busy: busy.value, now: now.value }))
const expired = computed(() => review.value && (!Number.isSafeInteger(review.value.expires_at) || review.value.expires_at * 1000 <= now.value))
const setBusy = value => { busy.value = value; emit('busy', value) }
const fail = (id, value) => { errors.value = { ...errors.value, [id]: backupStorageError(value) } }
const clearFeedback = id => { errors.value = { ...errors.value, [id]: '' }; messages.value = { ...messages.value, [id]: '' } }
const time = value => Number.isSafeInteger(value) && value > 0 ? new Date(value * 1000).toLocaleString() : 'not recorded'
const beginEdit = profile => {
  if (!supported.value || busy.value || props.disabled || editing.value) return
  editing.value = profile.id; removing.value = ''; review.value = null; confirmed.value = false
  editName.value = profile.name || profile.id; editEnabled.value = profile.enabled === true; editShared.value = profile.allow_shared_permissions === true
}
const check = async profile => {
  if (!supported.value || busy.value || props.disabled) return
  const input = signature(profile); clearFeedback(profile.id); setBusy(true)
  let changed = false
  try {
    const result = await repository.check(profile.id)
    if (result?.protocol !== 1 || result.profile?.id !== profile.id || result.profile.live_checked !== true || typeof result.profile.ready !== 'boolean' || (!Number.isSafeInteger(result.checked_at) || result.checked_at <= 0)) throw new Error('Unconfirmed destination check')
    checks.value = { ...checks.value, [profile.id]: { input, profile: result.profile, usage: result.usage } }
    changed = true
  } catch (value) { fail(profile.id, value) }
  finally { setBusy(false) }
  if (changed) emit('changed')
}
const save = async () => {
  const profile = editedProfile.value
  if (!supported.value || busy.value || props.disabled || !profile || !editPayload.value) return
  const payload = { ...editPayload.value }; clearFeedback(profile.id); setBusy(true)
  let changed = false
  try {
    const result = await repository.update(profile.id, payload)
    if (result?.protocol !== 1 || result.profile?.id !== profile.id) throw new Error('Unconfirmed destination update')
    messages.value = { ...messages.value, [profile.id]: 'Registration updated. Archive files, saved selections and global defaults were preserved.' }
    editing.value = ''; changed = true
  } catch (value) { fail(profile.id, value) }
  finally { setBusy(false) }
  if (changed) emit('changed')
}
const beginRemove = profile => {
  if (!supported.value || busy.value || props.disabled || editing.value) return
  removing.value = profile.id; editing.value = ''; review.value = null; confirmed.value = false
}
const remove = async profile => {
  if (!supported.value || busy.value || props.disabled || removing.value !== profile.id || usage(profile).length) return
  clearFeedback(profile.id); setBusy(true)
  let changed = false
  try {
    const result = await repository.remove(profile.id)
    if (result?.protocol !== 1 || result.destination_id !== profile.id || result.removed !== true || result.archives_preserved !== true || result.receipts_preserved !== true) throw new Error('Registration removal outcome was not confirmed. Refresh destinations before retrying.')
    messages.value = { ...messages.value, [profile.id]: 'Registration removed. Archive files and recovery receipts were retained; restore requires registering the same ID and storage again.' }
    removing.value = ''; delete checks.value[profile.id]; changed = true
  } catch (value) { fail(profile.id, value) }
  finally { setBusy(false) }
  if (changed) emit('changed')
}
const previewRevalidation = async profile => {
  if (!revalidationSupported.value || busy.value || props.disabled || editing.value || observed(profile).revalidation_required !== true) return
  clearFeedback(profile.id); setBusy(true); review.value = null; confirmed.value = false
  try {
    const result = await repository.revalidationPreview(profile.id)
    if (result?.protocol !== 1 || typeof result.ready !== 'boolean' || typeof result.revalidation_required !== 'boolean') throw new Error('Unconfirmed mount review')
    review.value = { ...result, destination_id: profile.id, input: signature(profile) }
  } catch (value) { fail(profile.id, value) }
  finally { setBusy(false) }
}
const revalidate = async () => {
  if (!canConfirm.value) return
  const id = review.value.destination_id; clearFeedback(id); setBusy(true)
  let changed = false
  try {
    const result = await repository.revalidate(id, { token: review.value.token, confirm: true })
    if (result?.protocol !== 1 || result.profile?.id !== id) throw new Error('Unconfirmed mount validation')
    delete checks.value[id]
    review.value = null; confirmed.value = false; messages.value = { ...messages.value, [id]: 'The controller mount check was refreshed. Archive storage and backup files were preserved.' }; changed = true
  } catch (value) { review.value = null; confirmed.value = false; fail(id, value) }
  finally { setBusy(false) }
  if (changed) emit('changed')
}
watch([supported, revalidationSupported], () => { review.value = null; confirmed.value = false })
watch(() => profiles.value.map(signature).join('\n'), () => { if (review.value && signature(reviewedProfile.value) !== review.value.input) { review.value = null; confirmed.value = false } })
let timer
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => { clearInterval(timer); emit('busy', false) })
</script>

<template>
  <section v-if="catalog" class="destination-management" aria-label="Registered backup destinations" data-testid="backup-destinations">
    <div><h4 class="font-semibold">Registered destinations</h4><p class="destination-muted mt-1 text-xs">Registration alone does not confirm that storage is connected. Backup previews check it again before use.</p></div>
    <p v-if="!profiles.length" class="destination-muted text-xs">No destinations registered.</p>
    <article v-for="profile in profiles" :key="profile.id" class="destination-row" :data-testid="`backup-destination-${profile.id}`">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0"><p class="font-medium">{{ text(profile.name || profile.id) }} <span class="destination-muted text-xs">({{ text(profile.id) }})</span><span v-if="catalog.default_destination_id === profile.id" class="destination-badge ml-2">Global default</span></p><p class="destination-muted mt-1 break-all text-xs">{{ text(profile.path) }}</p></div>
        <span class="destination-badge">{{ backupStorageAvailability(observed(profile)) }}</span>
      </div>
      <p v-if="observed(profile).live_checked === true" class="destination-muted text-xs">Last explicit availability check: {{ time(observed(profile).checked_at || observed(profile).last_checked_at) }}</p>
      <p v-for="(blocker, index) in observed(profile).blockers || []" :key="`blocker-${index}`" class="destination-feedback destination-error">{{ text(typeof blocker === 'string' ? blocker : blocker?.message) }}</p>
      <ul v-if="usage(profile).length" class="destination-muted list-inside list-disc text-xs"><li v-for="reason in usage(profile)" :key="reason">{{ reason }}</li></ul>
      <div v-if="supported" class="flex flex-wrap gap-2">
        <button type="button" class="destination-button" :disabled="disabled || busy" :data-testid="`backup-destination-check-${profile.id}`" @click="check(profile)">Check availability</button>
        <button type="button" class="destination-button" :disabled="disabled || busy || Boolean(editing)" :data-testid="`backup-destination-edit-${profile.id}`" @click="beginEdit(profile)">Edit</button>
        <button type="button" class="destination-button" :disabled="disabled || busy || Boolean(editing)" :data-testid="`backup-destination-remove-${profile.id}`" @click="beginRemove(profile)">Remove registration</button>
        <button v-if="revalidationSupported && observed(profile).revalidation_required === true" type="button" class="destination-button" :disabled="disabled || busy || Boolean(editing)" :data-testid="`backup-destination-review-${profile.id}`" @click="previewRevalidation(profile)">Review mount change</button>
      </div>
      <form v-if="editing === profile.id" class="destination-form" @submit.prevent="save">
        <p class="text-xs">Destination ID and registered path stay fixed. Register another destination to use a different storage location.</p>
        <label class="block text-xs">Display name<input v-model="editName" class="destination-input mt-1" :disabled="disabled || busy || !supported" :data-testid="`backup-destination-name-${profile.id}`"></label>
        <label class="flex items-start gap-2 text-xs"><input v-model="editEnabled" type="checkbox" :disabled="disabled || busy || !supported"><span>Enable this destination for backups</span></label>
        <label v-if="sharedSupported" class="flex items-start gap-2 text-xs"><input v-model="editShared" type="checkbox" :disabled="disabled || busy || !supported"><span>Allow shared archive permissions. I trust this mount with backup credentials and private keys.</span></label>
        <div class="flex flex-wrap gap-2"><button type="submit" class="destination-button destination-primary" :disabled="disabled || busy || !supported" :data-testid="`backup-destination-save-${profile.id}`">Save changes</button><button type="button" class="destination-button" :disabled="busy" :data-testid="`backup-destination-cancel-${profile.id}`" @click="editing = ''">Cancel</button></div>
      </form>
      <div v-if="removing === profile.id" class="destination-form" :data-testid="`backup-destination-remove-review-${profile.id}`">
        <p class="text-xs">Remove this registration only. Archive files, the owned marker and recovery receipts remain. Restoring old backups requires registering the same destination ID and storage again.</p>
        <p v-if="usage(profile).length" class="destination-muted text-xs">Resolve the references listed above before removing this registration. Defaults and schedules are not cleared automatically.</p>
        <div class="flex flex-wrap gap-2"><button type="button" class="destination-button" :disabled="disabled || busy || !supported || usage(profile).length > 0" :data-testid="`backup-destination-confirm-remove-${profile.id}`" @click="remove(profile)">Confirm remove registration</button><button type="button" class="destination-button" :disabled="busy" @click="removing = ''">Cancel</button></div>
      </div>
      <div v-if="review?.destination_id === profile.id" class="destination-form" :data-testid="`backup-destination-mount-review-${profile.id}`">
        <p class="text-xs">Review this controller’s changed mount identity for the same registered archive. This does not adopt different storage or move backups.</p>
        <p v-if="review.ready === true" class="destination-muted text-xs">The mount attachment changed; existing destination ownership was verified.</p>
        <dl class="grid gap-2 text-xs sm:grid-cols-2"><div><dt class="font-medium">Registered archive</dt><dd class="destination-muted break-all">{{ text(review.registered?.path) }} · {{ text(review.registered?.filesystem_type) }}</dd></div><div><dt class="font-medium">Observed archive</dt><dd class="destination-muted break-all">{{ text(review.observed?.path) }} · {{ text(review.observed?.filesystem_type) }}</dd></div></dl>
        <p v-for="(blocker, index) in review.blockers || []" :key="`review-blocker-${index}`" class="destination-feedback destination-error">{{ text(typeof blocker === 'string' ? blocker : blocker?.message) }}</p>
        <p v-if="review.revalidation_required === false" class="destination-muted text-xs">No mount confirmation is needed. Check availability again to refresh the displayed status.</p>
        <template v-else-if="review.ready === true"><p v-if="expired" class="destination-feedback destination-error">This mount review expired. Review the mount again before confirming.</p><label class="flex items-start gap-2 text-xs"><input v-model="confirmed" type="checkbox" :disabled="disabled || busy || expired" :data-testid="`backup-destination-mount-consent-${profile.id}`"><span>I verified that the mounted directory is the same archive storage and contains the retained backups.</span></label><button type="button" class="destination-button destination-primary" :disabled="!canConfirm" :data-testid="`backup-destination-confirm-mount-${profile.id}`" @click="revalidate">Confirm controller mount check</button></template>
      </div>
      <p v-if="errors[profile.id]" role="alert" class="destination-feedback destination-error" :data-testid="`backup-destination-error-${profile.id}`">{{ errors[profile.id] }}</p>
      <p v-if="messages[profile.id]" role="status" class="destination-feedback">{{ messages[profile.id] }}</p>
    </article>
    <template v-for="(message, id) in messages" :key="`retained-message-${id}`"><p v-if="message && !profiles.some(profile => profile.id === id)" role="status" class="destination-feedback">{{ text(id) }}: {{ message }}</p></template>
    <template v-for="(message, id) in errors" :key="`retained-error-${id}`"><p v-if="message && !profiles.some(profile => profile.id === id)" role="alert" class="destination-feedback destination-error">{{ text(id) }}: {{ message }}</p></template>
  </section>
</template>

<style scoped>
.destination-management { @apply space-y-3 border-t pt-4; border-color: var(--app-border-soft); }
.destination-row { @apply min-w-0 space-y-3 rounded-lg border p-3; border-color: var(--app-border-soft); }
.destination-muted { color: var(--app-text-muted); }
.destination-badge { @apply inline-block rounded border px-2 py-1 text-xs; border-color: var(--app-border); color: var(--app-text-muted); }
.destination-button { @apply inline-flex min-h-9 items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40; border-color: var(--app-border); }
.destination-button:not(:disabled):hover { background: var(--app-bg-soft); }
.destination-primary { background: var(--app-accent); color: var(--app-accent-contrast); border-color: transparent; }
.destination-primary:not(:disabled):hover { background: var(--app-accent-hover); }
.destination-input { @apply block w-full min-w-0 rounded-lg border px-3 py-2 text-sm; background: var(--app-panel-deep); border-color: var(--app-border); }
.destination-form { @apply space-y-3 rounded-lg border p-3; border-color: var(--app-border); background: var(--app-panel-deep); }
.destination-feedback { @apply rounded border px-3 py-2 text-xs leading-relaxed; border-color: var(--app-border); }
.destination-error { border-color: var(--app-danger); }
</style>
