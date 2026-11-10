<script setup>
import { computed, ref, watch } from 'vue'
import SetupFields from '~/components/SetupFields.vue'
import SetupChangePreview from '~/components/SetupChangePreview.vue'
import { setupAdoptionKeys, setupPreviewNeedsConsent } from '~/helper/setupArrangements.js'
const props = defineProps({ action: { type: Object, required: true }, fields: { type: Array, default: () => [] }, modelValue: { type: Object, default: () => ({}) }, busy: Boolean })
const emit = defineEmits(['update:modelValue', 'operate'])
const adoptionKeys = computed(() => setupAdoptionKeys(props.action))
const canAdopt = computed(() => props.fields.some(field => field.key === adoptionKeys.value.consent))
const workflow = computed(() => props.action.action === 'workflow_test')
const workflowKeys = computed(() => ({ probe: adoptionKeys.value.consent.replace(/::adopt_existing$/, '::workflow_probe'), preview: adoptionKeys.value.consent.replace(/::adopt_existing$/, '::workflow_preview_id'), cleanup: adoptionKeys.value.consent.replace(/::adopt_existing$/, '::workflow_cleanup') }))
const protectedKeys = computed(() => [...Object.values(adoptionKeys.value), ...(workflow.value ? [workflowKeys.value.preview] : [])])
const visibleFields = computed(() => props.fields.filter(field => !props.action.previewable || !protectedKeys.value.includes(field.key)))
const values = computed(() => Object.fromEntries(props.fields.filter(field => !protectedKeys.value.includes(field.key)).filter(field => Object.prototype.hasOwnProperty.call(props.modelValue, field.key)).map(field => [field.key, props.modelValue[field.key]])))
const signature = computed(() => JSON.stringify(values.value))
const requestedSignature = ref('')
const consent = ref(null)
watch(signature, () => { consent.value = null })
watch(() => props.action.id, () => { consent.value = null; requestedSignature.value = '' })
const previewId = computed(() => props.action.evidence?.preview_id || '')
const ready = computed(() => !!previewId.value && requestedSignature.value === signature.value && props.action.evidence?.preview_status === 'ready' && !props.busy)
const needsConsent = computed(() => canAdopt.value && setupPreviewNeedsConsent(props.action))
const cleanupOnly = computed(() => workflow.value && values.value[workflowKeys.value.cleanup] === true)
const workflowAuthorized = computed(() => !workflow.value || cleanupOnly.value || (ready.value && values.value[workflowKeys.value.probe]?.authorize_download_import_scan === true))
const accepted = computed(() => !!consent.value && consent.value.preview === previewId.value && consent.value.signature === signature.value)
function accept(event) {
  consent.value = event.target.checked && ready.value ? { preview: previewId.value, signature: signature.value } : null
}
function operate(operation) {
  if (operation === 'preview') { requestedSignature.value = signature.value; consent.value = null }
  const submitted = { ...values.value }
  if (operation === 'apply' && workflow.value) {
    if (!workflowAuthorized.value) return
    if (!cleanupOnly.value) submitted[workflowKeys.value.preview] = previewId.value
  }
  if (operation === 'apply' && props.action.previewable && canAdopt.value) {
    if (needsConsent.value && !accepted.value) return
    submitted[adoptionKeys.value.consent] = accepted.value
    if (accepted.value) submitted[adoptionKeys.value.preview] = previewId.value
  }
  emit('operate', { action: props.action, operation, values: submitted })
}
</script>

<template>
  <details class="pt-3 space-y-3">
    <summary class="cursor-pointer text-cyan-200">{{ action.explicit_only ? 'Configure and run this check' : 'Configure this step' }}</summary>
    <SetupFields :model-value="modelValue" :fields="visibleFields" :disabled="busy" @update:model-value="$emit('update:modelValue', $event)" />
    <SetupChangePreview :action="action" />
    <p v-if="action.explicit_only" class="text-sm text-amber-100">This check runs only when you choose to run it. Review its scope and limits first.</p>
    <p v-if="workflow" class="text-sm text-amber-100">This test can download data, import a selected item and refresh the selected media server. Authorize that scope, preview the proposed work, then choose Run this check.</p>
    <p v-if="cleanupOnly" class="text-sm text-amber-100">Cleanup recovery only removes artifacts owned by the recorded test. It does not start a new download or import; it may refresh the removed test entry in the media server.</p>
    <div v-if="action.previewable" class="space-y-2">
      <button type="button" class="rounded border border-cyan-400 px-3 py-2 disabled:opacity-50" :disabled="busy" @click="operate('preview')">Preview changes</button>
      <p v-if="!ready && action.evidence?.changes?.length" class="text-sm text-amber-100">Refresh the preview for your current choices before approving changes.</p>
      <label v-if="needsConsent" class="block text-sm"><input type="checkbox" :checked="accepted" :disabled="!ready" @change="accept"> I reviewed these changes and authorize updating this existing configuration.</label>
    </div>
    <button type="button" class="rounded bg-cyan-700 px-3 py-2 disabled:opacity-50" :disabled="busy || !workflowAuthorized || (action.previewable && needsConsent && !accepted)" @click="operate('apply')">{{ cleanupOnly ? 'Clean up test artifacts' : action.explicit_only ? 'Run this check' : 'Apply configuration' }}</button>
  </details>
</template>
