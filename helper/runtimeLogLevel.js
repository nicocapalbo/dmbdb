const VALID_LEVELS = new Set(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'])

const normalizeLevel = (value, fallback = 'INFO') => {
  const level = String(value || '').trim().toUpperCase()
  if (level === 'WARN') return 'WARNING'
  return VALID_LEVELS.has(level) ? level : fallback
}

export const normalizeRuntimeLogLevelState = (payload) => {
  const configuredLevel = normalizeLevel(payload?.configured_level)
  const configuredUvicornLevel = normalizeLevel(
    payload?.configured_uvicorn_level,
    configuredLevel,
  )
  const effectiveLevel = normalizeLevel(payload?.effective_level, configuredLevel)
  const overrideActive = payload?.override_active === true
  return {
    configured_level: configuredLevel,
    configured_uvicorn_level: configuredUvicornLevel,
    effective_level: effectiveLevel,
    debug_enabled: effectiveLevel === 'DEBUG',
    override_active: overrideActive,
    temporary: overrideActive,
    resets_on_restart: payload?.resets_on_restart !== false,
  }
}

export const runtimeDebugAction = (state) => {
  if (state?.override_active) {
    return { label: 'Disable DEBUG Logging', disabled: false, enable: false }
  }
  if (state?.debug_enabled) {
    return { label: 'DEBUG configured', disabled: true, enable: false }
  }
  return { label: 'Enable DEBUG Logging', disabled: false, enable: true }
}
