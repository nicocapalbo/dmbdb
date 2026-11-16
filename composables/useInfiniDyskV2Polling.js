import { onBeforeUnmount, watch } from 'vue'
import { useInfiniDyskV2State } from '~/composables/useInfiniDyskV2State.js'

export const useInfiniDyskV2Polling = (enabled, options = {}) => {
  const { retainStatusPolling } = useInfiniDyskV2State()
  let release = null
  watch(enabled, value => {
    release?.(); release = null
    if (value) release = retainStatusPolling(options)
  }, { immediate: true })
  onBeforeUnmount(() => { release?.(); release = null })
}
