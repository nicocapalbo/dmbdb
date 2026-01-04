export const extractRestartInfo = (source) => {
  if (!source || typeof source !== 'object') return null

  const candidate =
    source.restart ??
    source.auto_restart ??
    source.restart_state ??
    null

  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const stats = candidate.stats || candidate.restart_stats || candidate.counters || null
    if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
      return { ...candidate, stats }
    }
    const looksLikeStats = [
      'restart_attempts',
      'restart_successes',
      'restart_failures',
      'recent_restart_attempts',
      'last_restart_time',
      'last_exit_time',
      'last_exit_reason',
      'last_failure_reason',
    ].some((key) => key in candidate)
    if (looksLikeStats) {
      return { stats: candidate }
    }
    return candidate
  }

  if (source.restart_stats && typeof source.restart_stats === 'object' && !Array.isArray(source.restart_stats)) {
    return { stats: source.restart_stats }
  }

  return null
}
