<script setup>
import { computed, useId } from 'vue'
import { setupFieldValue, setupFieldVisible, setupLibraryOptions, setupLibrarySupportsLanguage, setupNestedFields, setupDefaultValues, setupFieldIsSecret } from '~/helper/setupArrangements.js'
const props = defineProps({ fields: { type: Array, default: () => [] }, modelValue: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const prefix = useId()
const visibleFields = computed(() => props.fields.filter(field => !field.internal && setupFieldVisible(field, props.modelValue, props.fields)))
const value = field => setupFieldValue(field, props.modelValue)

const set = (key, value) => {
  if (props.disabled || props.fields.find(field => field.key === key)?.readonly === true) return
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
const options = field => (field.options || []).map(item => typeof item === 'object' ? item : { value: item, label: item })
const rows = field => Array.isArray(value(field)) ? value(field) : []
const addListRow = field => set(field.key, [...rows(field), setupDefaultValues(setupNestedFields(field))])
const setListRow = (field, index, row) => set(field.key, rows(field).map((current, i) => i === index ? row : current))
const nested = {
  libraries: [
    { key: 'name', label: 'Library name' }, { key: 'media_type', label: 'Media type', type: 'select', options: ['movie', 'show', 'music', 'book', 'podcast', 'mixed'] },
    { key: 'paths', label: 'Library paths, one per line', type: 'paths' }, { key: 'language', label: 'Language' },
    { key: 'create_if_missing', label: 'Create this library only when missing', type: 'boolean' },
    { key: 'scan_on_create', label: 'Scan this new library after creation', type: 'boolean' },
  ],
  nntp_providers: [
    { key: 'name', label: 'Provider name' }, { key: 'host', label: 'Server hostname' },
    { key: 'port', label: 'Port', type: 'number' }, { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', type: 'password' }, { key: 'tls', label: 'Use TLS', type: 'boolean' },
    { key: 'connections', label: 'Connections', type: 'number' },
    { key: 'account_connection_limit', label: 'Account connection limit (shared across clients)', type: 'number', optional: true },
  ],
  external_service: [
    { key: 'service_key', label: 'Service type', type: 'select', options: ['plex', 'jellyfin', 'emby'] }, { key: 'url', label: 'URL reachable from DUMB', type: 'url' },
    { key: 'api_key', label: 'API key', type: 'password' }, { key: 'verify_tls', label: 'Verify TLS certificate', type: 'boolean' },
    { key: 'allow_private', label: 'Allow this authorized private network endpoint', type: 'boolean' },
  ],
}
const children = (field, row) => (nested[field.type] || []).filter(child => field.type !== 'libraries' || (child.key !== 'language' || setupLibrarySupportsLanguage(field)) && (child.key !== 'scan_on_create' || field.supports_scan_on_create === true && row?.create_if_missing !== false))
const childOptions = (field, child) => field.type === 'libraries' && child.key === 'media_type' ? setupLibraryOptions(field) : (child.options || []).map(item => typeof item === 'object' ? item : { value: item, label: item })
const addRow = field => set(field.key, [...rows(field), field.type === 'libraries' ? { name: '', media_type: field.default_media_type || setupLibraryOptions(field)[0]?.value || '', paths: [], ...(setupLibrarySupportsLanguage(field) ? { language: 'en' } : {}), create_if_missing: true, ...(field.supports_scan_on_create === true ? { scan_on_create: false } : {}) } : { name: '', host: '', port: 563, username: '', password: '', tls: true, connections: 8 }])
const setRow = (field, index, key, value) => set(field.key, rows(field).map((row, i) => i === index ? { ...row, [key]: value } : row))
const fieldValue = (field, row, event) => field.type === 'boolean' ? event.target.checked : ['number', 'integer'].includes(field.type) ? (event.target.value === '' ? (field.optional ? undefined : '') : Number(event.target.value)) : field.type === 'paths' ? event.target.value.split('\n').map(value => value.trim()).filter(Boolean) : event.target.value
</script>

<template>
  <div class="space-y-5">
    <div v-for="field in visibleFields" :key="field.key" class="space-y-2" :data-setup-field="field.key">
      <label :for="prefix + field.key" class="block font-medium text-gray-100">{{ field.label || field.key }} <span v-if="field.required" class="text-amber-300">(required)</span></label>
      <p v-if="field.description" class="text-sm text-gray-300">{{ field.description }}</p>
      <p v-if="field.reason" class="text-sm text-amber-200">{{ field.reason }}</p>
      <template v-if="field.type === 'list'">
        <fieldset v-for="(row, index) in rows(field)" :key="index" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled">
          <legend>{{ field.item_label || 'Entry' }} {{ index + 1 }}</legend>
          <SetupFields :fields="setupNestedFields(field)" :model-value="row" :disabled="disabled" @update:model-value="setListRow(field, index, $event)" />
          <button type="button" class="text-red-200 underline" :disabled="disabled" @click="set(field.key, rows(field).filter((_, i) => i !== index))">Remove {{ field.item_label || 'entry' }} {{ index + 1 }}</button>
        </fieldset>
        <button type="button" :disabled="disabled || (field.max_items != null && rows(field).length >= field.max_items)" class="rounded border border-gray-500 px-3 py-2" @click="addListRow(field)">{{ field.add_label || 'Add ' + (field.item_label || 'entry') }}</button>
      </template>
      <fieldset v-else-if="field.type === 'object'" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled" :aria-label="field.label || field.key">
        <SetupFields :fields="setupNestedFields(field)" :model-value="value(field) || setupDefaultValues(setupNestedFields(field))" :disabled="disabled" @update:model-value="set(field.key, $event)" />
      </fieldset>
      <template v-else-if="['libraries', 'nntp_providers'].includes(field.type)">
        <fieldset v-for="(row, index) in rows(field)" :key="index" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled">
          <legend>{{ field.type === 'libraries' ? 'Library' : 'Provider' }} {{ index + 1 }}</legend>
          <div v-for="child in children(field, row)" :key="child.key">
            <label class="block text-sm">
              {{ child.label }}
              <select v-if="child.type === 'select'" :aria-label="child.label" :value="row[child.key] || ''" class="block w-full bg-gray-900 p-2 rounded" @change="setRow(field, index, child.key, $event.target.value)">
                <option v-for="option in childOptions(field, child)" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
              <textarea v-else-if="child.type === 'paths'" :value="(row[child.key] || []).join('\n')" rows="2" class="block w-full bg-gray-900 p-2 rounded" @input="setRow(field, index, child.key, fieldValue(child, row, $event))" />
              <input v-else :type="child.type === 'boolean' ? 'checkbox' : child.type || 'text'" :value="row[child.key] ?? ''" :checked="child.type === 'boolean' && row[child.key] === true" :autocomplete="child.type === 'password' ? 'new-password' : 'off'" :class="child.type === 'boolean' ? 'ml-2' : 'block w-full bg-gray-900 p-2 rounded'" @input="setRow(field, index, child.key, fieldValue(child, row, $event))">
            </label>
          </div>
          <button type="button" class="text-red-200 underline" @click="set(field.key, rows(field).filter((_, i) => i !== index))">Remove {{ field.type === 'libraries' ? 'library' : 'provider' }} {{ index + 1 }}</button>
        </fieldset>
        <button type="button" :disabled="disabled" class="rounded border border-gray-500 px-3 py-2" @click="addRow(field)">Add {{ field.type === 'libraries' ? 'library' : 'provider' }}</button>
      </template>
      <fieldset v-else-if="field.type === 'external_service'" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled">
        <label v-for="child in nested.external_service" :key="child.key" class="block text-sm">
          {{ child.label }}
          <select v-if="child.type === 'select'" :aria-label="child.label" :value="modelValue[field.key]?.[child.key] || ''" class="block w-full bg-gray-900 p-2 rounded" @change="set(field.key, { ...modelValue[field.key], [child.key]: $event.target.value })">
            <option value="">Choose a media server type…</option>
            <option v-for="option in childOptions(field, child)" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <input v-else :type="child.type === 'boolean' ? 'checkbox' : child.type || 'text'" :value="modelValue[field.key]?.[child.key] ?? ''" :checked="child.type === 'boolean' && (child.key === 'verify_tls' ? modelValue[field.key]?.[child.key] !== false : modelValue[field.key]?.[child.key] === true)" autocomplete="off" :class="child.type === 'boolean' ? 'ml-2' : 'block w-full bg-gray-900 p-2 rounded'" @input="set(field.key, { ...modelValue[field.key], [child.key]: fieldValue(child, {}, $event) })">
        </label>
      </fieldset>
      <select v-else-if="['select', 'connection', 'multiselect'].includes(field.type)" :id="prefix + field.key" :multiple="field.type === 'multiselect'" :disabled="disabled || field.readonly === true || options(field).length === 0" class="block w-full bg-gray-900 p-2 rounded" @change="set(field.key, field.type === 'multiselect' ? Array.from($event.target.selectedOptions, option => option.value) : $event.target.value)">
        <option v-if="field.type !== 'multiselect'" value="" :selected="!value(field)">Choose…</option>
        <option v-for="option in options(field)" :key="String(option.value)" :value="option.value" :selected="field.type === 'multiselect' ? (value(field) || []).map(String).includes(String(option.value)) : String(value(field) ?? '') === String(option.value)">{{ option.label }}</option>
      </select>
      <button v-if="field.type === 'multiselect' && options(field).length" type="button" :disabled="disabled" class="text-sm underline text-cyan-200" @click="set(field.key, [])">Choose no connections</button>
      <textarea v-if="field.type === 'textarea'" :id="prefix + field.key" :value="value(field) || ''" :disabled="disabled" class="block w-full bg-gray-900 p-2 rounded" @input="set(field.key, $event.target.value)" />
      <input v-else-if="!['list', 'object', 'libraries', 'nntp_providers', 'external_service', 'select', 'connection', 'multiselect'].includes(field.type)" :id="prefix + field.key" :type="field.type === 'boolean' ? 'checkbox' : setupFieldIsSecret(field) ? 'password' : ['number', 'integer', 'url'].includes(field.type) ? (field.type === 'integer' ? 'number' : field.type) : 'text'" :value="value(field) ?? ''" :checked="field.type === 'boolean' && value(field) === true" :disabled="disabled" :min="field.minimum ?? field.min" :max="field.maximum ?? field.max" :autocomplete="setupFieldIsSecret(field) ? 'new-password' : 'off'" :placeholder="field.configured ? 'Configured; enter only to replace' : ''" :class="field.type === 'boolean' ? '' : 'block w-full bg-gray-900 p-2 rounded'" @input="set(field.key, fieldValue(field, {}, $event))">
    </div>
  </div>
</template>
