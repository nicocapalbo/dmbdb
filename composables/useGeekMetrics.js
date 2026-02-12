import { ref, computed, watch, toValue } from 'vue'
import { processRepository } from '~/services/process.js'

/**
 * Composable that fetches a one-shot /api/metrics snapshot when geek mode
 * is active.  Used by the service page GeekInfoPanel.
 *
 * @param {import('vue').Ref<string>|string} processName - current process name
 * @param {import('vue').Ref<boolean>|boolean} enabled - geek mode flag
 */
export function useGeekMetrics(processName, enabled) {
  const repo = processRepository()

  const metricsSnapshot = ref(null)
  const metricsLoading = ref(false)
  const metricsError = ref('')
  const metricsFetchMs = ref(null)

  const currentProcessMetrics = computed(() => {
    const name = toValue(processName)
    if (!name || !metricsSnapshot.value) return null
    const managed = metricsSnapshot.value.dumb_managed || []
    return managed.find((p) => p.name === name) || null
  })

  const systemMetrics = computed(() => metricsSnapshot.value?.system || null)

  const fetchMetrics = async () => {
    const name = toValue(processName)
    if (!name) return
    metricsLoading.value = true
    metricsError.value = ''
    try {
      const t0 = performance.now()
      const data = await repo.fetchMetricsSnapshot()
      metricsFetchMs.value = Math.round(performance.now() - t0)
      metricsSnapshot.value = data
    } catch (err) {
      metricsError.value = err?.message || 'Failed to fetch metrics'
      console.warn('useGeekMetrics: fetch failed', err)
    } finally {
      metricsLoading.value = false
    }
  }

  watch(
    () => toValue(enabled),
    (isEnabled) => {
      if (isEnabled && !metricsSnapshot.value) fetchMetrics()
    },
    { immediate: true },
  )

  return {
    metricsSnapshot,
    metricsLoading,
    metricsError,
    metricsFetchMs,
    currentProcessMetrics,
    systemMetrics,
    refresh: fetchMetrics,
  }
}
