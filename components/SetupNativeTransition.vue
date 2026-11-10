<script setup>
import { computed, ref } from 'vue'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'
import { infinidyskV2NeedsAttention } from '~/helper/infinidyskV2.js'
import { setupNativeTransition } from '~/helper/setupInfiniDysk.js'

const props = defineProps({ action: { type: Object, required: true }, capabilities: { type: Object, default: () => ({}) }, busy: Boolean })
const { state, refresh, update } = useInfiniDyskV2State()
const error = ref('')
const opening = ref(false)
const transition = computed(() => setupNativeTransition(props.action, props.capabilities))
const nativeBusy = computed(() => state.value.busy || state.value.majorOpen || state.value.postgresOpen
  || infinidyskV2NeedsAttention(state.value.majorJob) || infinidyskV2NeedsAttention(state.value.postgresJob))
async function open() {
  if (!transition.value || props.busy || opening.value || nativeBusy.value) return
  const requested = transition.value
  opening.value = true; error.value = ''
  try {
    await refresh()
    const confirmed = setupNativeTransition(props.action, state.value.capabilities)
    if (props.busy || nativeBusy.value || !confirmed || JSON.stringify(confirmed) !== JSON.stringify(requested)
      || !state.value.majorStatusConfirmed || state.value.major?.runtime_generation === '2'
      || state.value.major?.mode !== requested.mode
      || !state.value.major?.supported_mount_backends?.includes(requested.mount_backend)) {
      error.value = 'The source or native workflow changed. Refresh setup choices and review any existing progress or recovery first.'
      return
    }
    update({ majorRequestedMountBackend: requested.mount_backend, majorOpen: true, postgresOpen: false })
  } catch {
    error.value = 'The native workflow could not be confirmed. Refresh setup choices before trying again.'
  } finally { opening.value = false }
}
</script>

<template>
  <div v-if="transition" class="space-y-2 rounded border border-amber-600 p-3" data-setup-native-transition>
    <p>InfiniDysk 2 {{ transition.mode === 'fresh' ? 'installation' : 'migration' }} uses the separate guarded wizard. Its preview, acknowledgements and recovery checks remain required. This setup action does not change the runtime.</p>
    <button type="button" class="rounded border border-amber-500 px-3 py-2 disabled:opacity-50" :disabled="busy || opening || nativeBusy" @click="open">Open guarded InfiniDysk 2 wizard</button>
    <p class="text-sm text-gray-300">After the native workflow finishes, refresh these setup choices and recheck the checklist. Native provider, account and Arr configuration remain manual until supported by a verified adapter.</p>
    <p v-if="nativeBusy" class="text-sm text-amber-200">Review the open native workflow or its progress and recovery before starting another transition.</p>
    <p v-if="error" role="alert" class="text-sm text-amber-200">{{ error }}</p>
  </div>
</template>
