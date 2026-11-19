<script setup>
import { computed, useId } from 'vue'
import { setupFieldValue, setupFieldVisible, setupLibraryOptions, setupLibrarySupportsLanguage, setupNestedFields, setupDefaultValues, setupFieldIsSecret } from '~/helper/setupArrangements.js'
import { setupFieldGuidanceMap } from '~/helper/setupGuidance.js'
const props = defineProps({ fields: { type: Array, default: () => [] }, contextFields: { type: Array, default: () => [] }, actions: { type: Array, default: () => [] }, services: { type: Array, default: () => [] }, guided: Boolean, modelValue: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const prefix = useId()
const context = computed(() => props.contextFields.length ? props.contextFields : props.fields)
const visibleFields = computed(() => props.fields.filter(field => !field.internal && setupFieldVisible(field, props.modelValue, context.value)))
const guidanceByKey = computed(() => setupFieldGuidanceMap(visibleFields.value, { fields: context.value, values: props.modelValue, actions: props.actions, services: props.services }))
const guidance = field => guidanceByKey.value.get(field.key)
const label = field => props.guided ? guidance(field).label : field.label || field.key
const description = field => props.guided ? guidance(field).description : field.description
const value = field => setupFieldValue(field, props.modelValue)

const set = (key, value) => {
  if (props.disabled || props.fields.find(field => field.key === key)?.readonly === true) return
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
const options = field => (field.options || []).map(item => typeof item === 'object' ? item : { value: item, label: item })
const unavailable = field => field.readonly !== true && ['select', 'connection', 'multiselect'].includes(field.type) && options(field).length === 0
const retainedChoices = field => {
  const current = field.type === 'multiselect' ? rows(field) : [value(field)]
  return current.filter(choice => choice != null && choice !== '' && choice !== 0 && choice !== false
    && !options(field).some(option => String(option.value) === String(choice)))
}
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
const providerHelp = {
  name: 'Optional: a name you will recognize, such as your provider name.',
  host: 'Required: copy the server address from your Usenet provider account. Use the server hostname, not the provider website address.',
  port: 'Keep 563 for an encrypted connection unless your provider gives you another port.',
  username: 'Use the download account username supplied by your provider. It may differ from your website sign-in.',
  password: 'Use your provider download password or access key. Leave it blank only if your provider does not require one.',
  tls: 'Recommended: encrypts traffic between this app and your provider.',
  connections: 'How many connections this app may open at once. Leave room for other apps using the same account.',
  account_connection_limit: 'Optional: the total connection allowance for your account. DUMB uses this to check the shared budget across apps.',
}
const addRow = field => set(field.key, [...rows(field), field.type === 'libraries' ? { name: '', media_type: field.default_media_type || setupLibraryOptions(field)[0]?.value || '', paths: [], ...(setupLibrarySupportsLanguage(field) ? { language: 'en' } : {}), create_if_missing: true, ...(field.supports_scan_on_create === true ? { scan_on_create: false } : {}) } : { name: '', host: '', port: 563, username: '', password: '', tls: true, connections: 8 }])
const setRow = (field, index, key, value) => set(field.key, rows(field).map((row, i) => i === index ? { ...row, [key]: value } : row))
const fieldValue = (field, row, event) => field.type === 'boolean' ? event.target.checked : ['number', 'integer'].includes(field.type) ? (event.target.value === '' ? (field.optional ? undefined : '') : Number(event.target.value)) : field.type === 'paths' ? event.target.value.split('\n').map(value => value.trim()).filter(Boolean) : event.target.value
</script>

<template>
  <div class="space-y-5">
    <div v-for="field in visibleFields" :key="field.key" class="space-y-2" :data-setup-field="field.key">
      <label :for="prefix + field.key" class="block font-medium text-gray-100">{{ label(field) }} <span v-if="!guided && field.required" class="text-amber-300">(required)</span></label>
      <div class="flex flex-wrap gap-2 text-xs" data-setup-field-guidance>
        <span class="rounded border border-gray-500 px-2 py-1">{{ guidance(field).requirementLabel }}</span>
        <span v-if="unavailable(field)" class="rounded border border-blue-400 px-2 py-1">{{ guidance(field).unavailableKind === 'selection' ? 'Choose a compatible app' : 'Finish after app setup' }}</span>
      </div>
      <p v-if="description(field)" class="text-sm text-gray-300">{{ description(field) }}</p>
      <p v-if="guided && guidance(field).defaultExplanation" class="text-sm text-gray-300">{{ guidance(field).defaultExplanation }}</p>
      <p v-if="unavailable(field)" :id="prefix + field.key + '-availability'" role="status" class="rounded border border-blue-400/50 p-3 text-sm text-gray-200" data-setup-choice-unavailable>
        <template v-if="guidance(field).unavailableKind === 'selection'">
          {{ guidance(field).choiceHelp }} Go back to your app selections to add a compatible movie, TV or music app, then return here.
          <span v-if="retainedChoices(field).length">Your saved selection will be kept until you change it.</span>
        </template>
        <template v-else>
          <template v-if="retainedChoices(field).length">Your saved selection will be kept. The app is not providing its available choices yet.</template>
          <template v-else>There are no available choices yet. New apps provide these after they start and their initial setup is complete.</template>
          You can finish this choice from your setup checklist afterward. If the app is already running, finish its setup or check its connection, then refresh the choices.
        </template>
      </p>
      <details v-if="field.reason && unavailable(field)" class="text-sm text-gray-300"><summary class="cursor-pointer">More about this choice</summary><p class="mt-2">{{ field.reason }}</p></details>
      <p v-else-if="field.reason" class="text-sm text-amber-200">{{ field.reason }}</p>
      <template v-if="field.type === 'list'">
        <fieldset v-for="(row, index) in rows(field)" :key="index" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled || field.readonly">
          <legend>{{ field.item_label || 'Entry' }} {{ index + 1 }}</legend>
          <SetupFields :fields="setupNestedFields(field)" :context-fields="setupNestedFields(field)" :guided="guided" :actions="actions" :services="services" :model-value="row" :disabled="disabled" @update:model-value="setListRow(field, index, $event)" />
          <button type="button" class="text-red-200 underline" :disabled="disabled" @click="set(field.key, rows(field).filter((_, i) => i !== index))">Remove {{ field.item_label || 'entry' }} {{ index + 1 }}</button>
        </fieldset>
        <button type="button" :disabled="disabled || field.readonly || (field.max_items != null && rows(field).length >= field.max_items)" class="rounded border border-gray-500 px-3 py-2" @click="addListRow(field)">{{ field.add_label || 'Add ' + (field.item_label || 'entry') }}</button>
      </template>
      <fieldset v-else-if="field.type === 'object'" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled || field.readonly" :aria-label="label(field)">
        <SetupFields :fields="setupNestedFields(field)" :context-fields="setupNestedFields(field)" :guided="guided" :actions="actions" :services="services" :model-value="value(field) || setupDefaultValues(setupNestedFields(field))" :disabled="disabled" @update:model-value="set(field.key, $event)" />
      </fieldset>
      <template v-else-if="['libraries', 'nntp_providers'].includes(field.type)">
        <fieldset v-for="(row, index) in rows(field)" :key="index" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled || field.readonly">
          <legend>{{ field.type === 'libraries' ? 'Library' : 'Provider' }} {{ index + 1 }}</legend>
          <div v-for="child in children(field, row)" :key="child.key">
            <label class="block text-sm">
              {{ child.label }}
              <select v-if="child.type === 'select'" :aria-label="child.label" :value="row[child.key] || ''" class="block w-full bg-gray-900 p-2 rounded border border-gray-600" @change="setRow(field, index, child.key, $event.target.value)">
                <option v-for="option in childOptions(field, child)" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
              <textarea v-else-if="child.type === 'paths'" :value="(row[child.key] || []).join('\n')" rows="2" class="block w-full bg-gray-900 p-2 rounded border border-gray-600" @input="setRow(field, index, child.key, fieldValue(child, row, $event))" />
              <input v-else :type="child.type === 'boolean' ? 'checkbox' : child.type || 'text'" :value="row[child.key] ?? ''" :checked="child.type === 'boolean' && row[child.key] === true" :autocomplete="child.type === 'password' ? 'new-password' : 'off'" :class="child.type === 'boolean' ? 'ml-2' : 'block w-full bg-gray-900 p-2 rounded border border-gray-600'" @input="setRow(field, index, child.key, fieldValue(child, row, $event))">
            </label>
            <p v-if="guided && field.type === 'nntp_providers' && providerHelp[child.key]" class="mt-1 text-sm text-gray-300">{{ providerHelp[child.key] }}</p>
          </div>
          <button type="button" class="text-red-200 underline" @click="set(field.key, rows(field).filter((_, i) => i !== index))">Remove {{ field.type === 'libraries' ? 'library' : 'provider' }} {{ index + 1 }}</button>
        </fieldset>
        <button type="button" :disabled="disabled || field.readonly" class="rounded border border-gray-500 px-3 py-2" @click="addRow(field)">Add {{ field.type === 'libraries' ? 'library' : 'provider' }}</button>
      </template>
      <fieldset v-else-if="field.type === 'external_service'" class="space-y-3 rounded border border-gray-600 p-3" :disabled="disabled || field.readonly">
        <label v-for="child in nested.external_service" :key="child.key" class="block text-sm">
          {{ child.label }}
          <select v-if="child.type === 'select'" :aria-label="child.label" :value="modelValue[field.key]?.[child.key] || ''" class="block w-full bg-gray-900 p-2 rounded border border-gray-600" @change="set(field.key, { ...modelValue[field.key], [child.key]: $event.target.value })">
            <option value="">Choose a media server type…</option>
            <option v-for="option in childOptions(field, child)" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <input v-else :type="child.type === 'boolean' ? 'checkbox' : child.type || 'text'" :value="modelValue[field.key]?.[child.key] ?? ''" :checked="child.type === 'boolean' && (child.key === 'verify_tls' ? modelValue[field.key]?.[child.key] !== false : modelValue[field.key]?.[child.key] === true)" autocomplete="off" :class="child.type === 'boolean' ? 'ml-2' : 'block w-full bg-gray-900 p-2 rounded border border-gray-600'" @input="set(field.key, { ...modelValue[field.key], [child.key]: fieldValue(child, {}, $event) })">
        </label>
      </fieldset>
      <select v-else-if="['select', 'connection', 'multiselect'].includes(field.type)" :id="prefix + field.key" :aria-describedby="unavailable(field) ? prefix + field.key + '-availability' : undefined" :multiple="field.type === 'multiselect'" :disabled="disabled || field.readonly === true || unavailable(field)" class="block w-full bg-gray-900 p-2 rounded border border-gray-600" @change="set(field.key, field.type === 'multiselect' ? Array.from($event.target.selectedOptions, option => option.value) : $event.target.value)">
        <option v-if="field.type !== 'multiselect'" value="" :selected="!value(field)">{{ unavailable(field) ? guidance(field).unavailableKind === 'selection' ? 'No compatible apps selected' : 'Available after app setup' : 'Choose…' }}</option>
        <option v-for="(choice, index) in retainedChoices(field)" :key="'retained-' + index" :value="choice" selected>Saved selection{{ retainedChoices(field).length > 1 ? ' ' + (index + 1) : '' }} (kept)</option>
        <option v-for="option in options(field)" :key="String(option.value)" :value="option.value" :disabled="option.disabled === true" :selected="field.type === 'multiselect' ? (value(field) || []).map(String).includes(String(option.value)) : String(value(field) ?? '') === String(option.value)">{{ option.label }}</option>
      </select>
      <button v-if="field.type === 'multiselect' && options(field).length" type="button" :disabled="disabled || field.readonly" class="text-sm underline text-cyan-200" @click="set(field.key, [])">Choose no connections</button>
      <textarea v-if="field.type === 'textarea'" :id="prefix + field.key" :value="value(field) || ''" :disabled="disabled || field.readonly" class="block w-full bg-gray-900 p-2 rounded border border-gray-600" @input="set(field.key, $event.target.value)" />
      <input v-else-if="!['list', 'object', 'libraries', 'nntp_providers', 'external_service', 'select', 'connection', 'multiselect'].includes(field.type)" :id="prefix + field.key" :type="field.type === 'boolean' ? 'checkbox' : setupFieldIsSecret(field) ? 'password' : ['number', 'integer', 'url'].includes(field.type) ? (field.type === 'integer' ? 'number' : field.type) : 'text'" :value="value(field) ?? ''" :checked="field.type === 'boolean' && value(field) === true" :disabled="disabled || field.readonly" :min="field.minimum ?? field.min" :max="field.maximum ?? field.max" :autocomplete="setupFieldIsSecret(field) ? 'new-password' : 'off'" :placeholder="field.configured ? 'Configured; enter only to replace' : ''" :class="field.type === 'boolean' ? '' : 'block w-full bg-gray-900 p-2 rounded border border-gray-600'" @input="set(field.key, fieldValue(field, {}, $event))">
    </div>
  </div>
</template>
