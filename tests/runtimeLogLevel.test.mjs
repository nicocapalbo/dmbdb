import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeRuntimeLogLevelState,
  runtimeDebugAction,
} from '../helper/runtimeLogLevel.js'

test('normalizes runtime API log-level state', () => {
  assert.deepEqual(
    normalizeRuntimeLogLevelState({
      configured_level: 'warning',
      configured_uvicorn_level: 'error',
      effective_level: 'debug',
      override_active: true,
      resets_on_restart: true,
    }),
    {
      configured_level: 'WARNING',
      configured_uvicorn_level: 'ERROR',
      effective_level: 'DEBUG',
      debug_enabled: true,
      override_active: true,
      temporary: true,
      resets_on_restart: true,
    },
  )
})

test('runtime DEBUG action disables an override and protects configured DEBUG', () => {
  assert.deepEqual(
    runtimeDebugAction({ debug_enabled: true, override_active: true }),
    { label: 'Disable DEBUG Logging', disabled: false, enable: false },
  )
  assert.deepEqual(
    runtimeDebugAction({ debug_enabled: true, override_active: false }),
    { label: 'DEBUG configured', disabled: true, enable: false },
  )
  assert.deepEqual(
    runtimeDebugAction({ debug_enabled: false, override_active: false }),
    { label: 'Enable DEBUG Logging', disabled: false, enable: true },
  )
})
