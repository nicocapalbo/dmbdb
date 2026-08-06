<script setup>
import { computed, ref, watch } from 'vue'
import useService from '~/services/useService.js'

const props = defineProps({
  processName: { type: String, required: true },
})
const emit = defineEmits(['close', 'completed'])
const { processService } = useService()

const action = ref('reset')
const confirmation = ref('')
const preview = ref(null)
const loading = ref(false)
const applying = ref(false)
const error = ref('')
let previewRequest = 0

const isRemove = computed(() => action.value === 'remove')
const confirmationMatches = computed(() => (
  confirmation.value === String(preview.value?.confirmation || props.processName)
))
const canApply = computed(() => (
  !!preview.value && confirmationMatches.value && !loading.value && !applying.value
))
const configActionLabel = computed(() => (
  preview.value?.default_instance_after_removal
    ? `Remove this custom instance and restore the disabled ${preview.value.default_instance_after_removal} template.`
    : preview.value?.config_action === 'remove_instance'
    ? 'Remove this custom instance from dumb_config.'
    : 'Replace this service/instance block with its disabled DUMB defaults.'
))

const errorDetail = (candidate, fallback) => (
  candidate?.response?.data?.detail
  || candidate?.data?.detail
  || candidate?.message
  || fallback
)

const loadPreview = async () => {
  const requestId = ++previewRequest
  loading.value = true
  error.value = ''
  preview.value = null
  try {
    const result = await processService.previewServiceReset(props.processName, action.value)
    if (requestId === previewRequest) preview.value = result
  } catch (candidate) {
    if (requestId === previewRequest) {
      error.value = errorDetail(candidate, 'Unable to preview this operation.')
    }
  } finally {
    if (requestId === previewRequest) loading.value = false
  }
}

const requestClose = () => {
  if (!applying.value) emit('close')
}

const apply = async () => {
  if (!canApply.value) return
  applying.value = true
  error.value = ''
  try {
    const result = await processService.resetService(
      props.processName,
      action.value,
      confirmation.value,
    )
    emit('completed', result)
  } catch (candidate) {
    error.value = errorDetail(candidate, 'The service could not be reset.')
  } finally {
    applying.value = false
  }
}

watch(action, () => {
  confirmation.value = ''
  loadPreview()
}, { immediate: true })
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3"
    role="dialog"
    aria-modal="true"
    aria-labelledby="service-reset-title"
    @click.self="requestClose"
  >
    <div class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-rose-500/40 bg-slate-900 shadow-2xl">
      <div class="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
        <div>
          <h2 id="service-reset-title" class="text-lg font-semibold text-white">Reset or remove {{ processName }}</h2>
          <p class="mt-1 text-sm text-slate-400">DUMB stops the selected process before changing configuration or files.</p>
        </div>
        <button class="material-symbols-rounded text-slate-400 hover:text-white" title="Close" :disabled="applying" @click="requestClose">close</button>
      </div>

      <div class="space-y-4 overflow-y-auto p-4">
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="cursor-pointer rounded border p-3" :class="action === 'reset' ? 'border-sky-500 bg-sky-950/30' : 'border-slate-700 bg-slate-950/25'">
            <span class="flex items-start gap-2">
              <input v-model="action" type="radio" value="reset" class="mt-1 accent-sky-400" :disabled="applying" />
              <span><strong class="text-slate-100">Reset DUMB configuration</strong><span class="mt-1 block text-xs text-slate-400">Disable and restore DUMB defaults while keeping application files and data.</span></span>
            </span>
          </label>
          <label class="cursor-pointer rounded border p-3" :class="action === 'remove' ? 'border-rose-500 bg-rose-950/30' : 'border-slate-700 bg-slate-950/25'">
            <span class="flex items-start gap-2">
              <input v-model="action" type="radio" value="remove" class="mt-1 accent-rose-400" :disabled="applying" />
              <span><strong class="text-rose-100">Remove service files</strong><span class="mt-1 block text-xs text-slate-400">Also clear only the selected service's DUMB-owned config/runtime/data paths.</span></span>
            </span>
          </label>
        </div>

        <div v-if="loading" class="rounded border border-slate-700 bg-slate-950/30 p-3 text-sm text-slate-300">Building a scoped preview…</div>
        <div v-else-if="preview" class="space-y-3">
          <div class="rounded border border-slate-700 bg-slate-950/30 p-3 text-sm text-slate-300">
            <p><strong class="text-slate-100">Configuration:</strong> {{ configActionLabel }}</p>
            <p class="mt-1"><strong class="text-slate-100">Process:</strong> Stop {{ preview.process_name }} before applying.</p>
            <p class="mt-1"><strong class="text-slate-100">Recovery:</strong> A private full-config backup is written before configuration changes. Removed service files are not backed up.</p>
          </div>

          <div v-if="isRemove" class="rounded border border-rose-500/40 bg-rose-950/20 p-3">
            <h3 class="font-semibold text-rose-100">Managed paths to clear</h3>
            <ul v-if="preview.file_targets?.length" class="mt-2 space-y-1 text-xs text-rose-100/85">
              <li v-for="target in preview.file_targets" :key="`${target.operation}:${target.path}`" class="break-all font-mono">
                {{ target.path }}
                <span v-if="target.resolved_path && target.resolved_path !== target.path" class="block pl-3 text-slate-400">→ {{ target.resolved_path }}</span>
                <span class="font-sans text-slate-500">({{ target.exists ? (target.operation === 'clear_directory' ? 'clear directory contents' : 'delete file') : 'not currently present' }})</span>
              </li>
            </ul>
            <p v-else class="mt-2 text-sm text-amber-200">No exclusively owned managed file paths can be safely removed for this target.</p>
          </div>

          <div v-if="preview.warnings?.length" class="rounded border border-amber-500/40 bg-amber-950/25 p-3 text-sm text-amber-100">
            <h3 class="font-semibold">Review warnings</h3>
            <ul class="mt-2 list-disc space-y-1 pl-5"><li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li></ul>
          </div>

          <div class="rounded border border-emerald-700/40 bg-emerald-950/20 p-3 text-sm text-emerald-100/85">
            <h3 class="font-semibold text-emerald-100">Always retained</h3>
            <ul class="mt-2 list-disc space-y-1 pl-5"><li v-for="item in preview.retained" :key="item">{{ item }}</li></ul>
          </div>

          <label class="block text-sm text-slate-200">
            Type <code class="rounded bg-black/35 px-1.5 py-0.5 text-white">{{ preview.confirmation }}</code> to confirm:
            <input v-model="confirmation" class="mt-2 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white outline-none focus:border-rose-400" autocomplete="off" :disabled="applying" />
          </label>
        </div>

        <div v-if="error" class="rounded border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-100" role="alert">{{ error }}</div>
      </div>

      <div class="flex flex-wrap justify-end gap-2 border-t border-slate-700 px-4 py-3">
        <button class="button-small border border-slate-600 !px-4 !py-2" :disabled="applying" @click="requestClose">Cancel</button>
        <button class="button-small border border-rose-500/50 bg-rose-800 !px-4 !py-2 text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!canApply" @click="apply">
          <span class="material-symbols-rounded !text-[18px]">{{ applying ? 'progress_activity' : isRemove ? 'delete_forever' : 'restart_alt' }}</span>
          <span>{{ applying ? 'Working…' : isRemove ? 'Remove selected service files' : 'Reset DUMB configuration' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
