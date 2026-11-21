<script setup>
import { computed } from 'vue'
import { backupServiceSelectionReady } from '~/helper/installationBackupServices.js'

const props = defineProps({ scope: { type: String, default: 'installation' }, serviceIds: { type: Array, default: () => [] }, services: { type: Array, default: () => [] }, loading: Boolean, error: String, disabled: Boolean, testId: { type: String, default: 'installation-scope' } })
const emit = defineEmits(['update:scope', 'update:serviceIds', 'refresh'])
const selectScope = value => { emit('update:scope', value); if (value === 'installation') emit('update:serviceIds', []) }
const selectService = (id, checked) => emit('update:serviceIds', checked ? [...props.serviceIds, id] : props.serviceIds.filter(value => value !== id))
const serviceNames = ids => ids.map(id => props.services.find(service => service.id === id)?.name || id).join(', ')
const missingSharedOwners = computed(() => [...new Set(props.services.filter(service => props.serviceIds.includes(service.id)).flatMap(service => service.required_service_ids || []))].filter(id => !props.serviceIds.includes(id)))
</script>

<template>
  <fieldset class="scope space-y-3" :disabled="disabled" :data-testid="testId">
    <legend class="font-medium text-sm">What would you like to protect?</legend>
    <label class="scope-option"><input type="radio" :name="testId" value="installation" :checked="scope === 'installation'" @change="selectScope('installation')"><span><strong>Entire DUMB installation</strong><span class="scope-muted block text-xs mt-1">DUMB settings and accounts, plus all supported managed application state.</span></span></label>
    <label class="scope-option"><input type="radio" :name="testId" value="services" :checked="scope === 'services'" :data-testid="`${testId}-services`" @change="selectScope('services')"><span><strong>Selected services</strong><span class="scope-muted block text-xs mt-1">Protect individual service instances. Restoring them preserves other apps and your DUMB accounts.</span></span></label>
    <div v-if="scope === 'services'" class="space-y-3" :data-testid="`${testId}-choices`">
      <p class="scope-muted text-xs">Select one or more service instances. Required managed databases are included where supported; the review lists coverage and any limitations.</p>
      <p v-if="loading" role="status" class="scope-muted text-sm">Loading service backup choices…</p>
      <p v-if="error" role="alert" class="scope-error text-sm">{{ error }}</p>
      <div v-if="services.length" class="scope-list space-y-2">
        <label v-for="service in services" :key="service.id" class="scope-option" :class="{ 'opacity-60': !service.available || service.blocking_reasons.length }"><input type="checkbox" :checked="serviceIds.includes(service.id)" :disabled="!service.available || service.blocking_reasons.length > 0 || (serviceIds.length >= 64 && !serviceIds.includes(service.id))" :data-testid="`${testId}-service-${service.id}`" @change="selectService(service.id, $event.target.checked)"><span><strong>{{ service.name }}</strong><span v-if="service.required_service_ids?.length" class="scope-muted block text-xs mt-1">Back up together with {{ serviceNames(service.required_service_ids) }} because they share application data.</span><span v-for="reason in service.blocking_reasons" :key="reason" class="scope-muted block text-xs mt-1">{{ reason }}</span><span v-if="!service.available && !service.blocking_reasons.length" class="scope-muted block text-xs mt-1">Individual backup is unavailable for this service.</span></span></label>
      </div>
      <p v-else-if="!loading && !error" class="scope-muted text-sm">No supported service instances are configured yet.</p>
      <p v-if="!loading && missingSharedOwners.length" class="scope-muted text-xs" :data-testid="`${testId}-required-services`">Also select {{ serviceNames(missingSharedOwners) }} to include all apps sharing this data.</p>
      <p v-else-if="!loading && !backupServiceSelectionReady(services, serviceIds)" class="scope-muted text-xs">Select at least one available service before continuing.</p>
      <p v-if="serviceIds.length >= 64" class="scope-muted text-xs">One archive can contain up to 64 service instances. Create another service bundle to protect more.</p>
      <button type="button" class="scope-refresh" :disabled="loading" @click="emit('refresh')">Refresh service choices</button>
    </div>
  </fieldset>
</template>

<style scoped>
.scope { @apply rounded-lg border p-3; border-color: var(--app-border-soft); }
.scope-option { @apply flex items-start gap-3 rounded-lg p-2 text-sm; }
.scope-option input { @apply mt-1 shrink-0; }
.scope-muted { color: var(--app-text-muted); }
.scope-error { color: var(--app-danger); }
.scope-list { @apply max-h-72 overflow-y-auto; }
.scope-refresh { @apply rounded-lg border px-3 py-2 text-xs disabled:opacity-50; border-color: var(--app-border); }
</style>
